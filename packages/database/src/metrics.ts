import Decimal from "decimal.js";
import { financialEngine } from "@mastershopee/financial-engine";
import type { MarketplaceType } from "@prisma/client";
import { prisma } from "./index";
import { revenueOrdersWhere } from "./order-status";

export interface ComputeMetricsInput {
  workspaceId: string;
  /** Day to aggregate, as `YYYY-MM-DD` in the workspace's own calendar. */
  date: string;
}

/**
 * Pre-aggregation of one workspace-day into `DailyMetric` / `ProductMetric` /
 * `MarketplaceMetric` (§54, §61) so the dashboard never recomputes over raw
 * orders on every request. Idempotent — safe to re-run for the same day
 * (e.g. after a late-arriving refund) via upsert.
 *
 * Lives here rather than in the worker because two callers need it and they
 * must never disagree: the scheduled job, and a spreadsheet import, which has
 * no queue to hand the work to and would otherwise leave the dashboard blank
 * for every month it just loaded (§60 — one implementation).
 */
export async function computeDailyMetrics(data: ComputeMetricsInput): Promise<void> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: data.workspaceId } });
  const dayStart = new Date(`${data.date}T00:00:00`);
  const dayEnd = new Date(`${data.date}T23:59:59.999`);

  const orders = await prisma.order.findMany({
    // Cancelled, refunded and returned orders are excluded: they are real rows
    // the operator can see in the orders list, but they are not revenue.
    where: { workspaceId: workspace.id, orderedAt: { gte: dayStart, lte: dayEnd }, ...revenueOrdersWhere },
    include: { items: true, refunds: true },
  });

  const results = orders.map((order) =>
    financialEngine.calculateOrder({
      grossAmount: order.grossAmount,
      discountAmount: order.discountAmount,
      commissionAmount: order.commissionAmount,
      marketplaceFeeAmount: order.marketplaceFeeAmount,
      shippingSubsidizedByMerchant: order.shippingSubsidizedByMerchant,
      taxAmount: order.taxAmount,
      adSpendAttributed: order.adSpendAttributed,
      refundAmount: order.refunds.reduce((acc, r) => acc.plus(r.amount as unknown as Decimal), new Decimal(0)),
      items: order.items.map((i) => ({ quantity: i.quantity, unitCost: i.unitCostSnapshot ?? new Decimal(0) })),
    }),
  );

  const total = financialEngine.aggregate(results, workspace.currency);

  // Products with zero cost history make the day's numbers an estimate, not final (§96, §61).
  const productsMissingCost = await prisma.product.count({ where: { workspaceId: workspace.id, costs: { none: {} } } });

  await prisma.dailyMetric.upsert({
    where: { workspaceId_date: { workspaceId: workspace.id, date: dayStart } },
    update: {
      grossRevenue: total.grossRevenue.toFixed(),
      netRevenue: total.netRevenue.toFixed(),
      productCost: total.productCost.toFixed(),
      commission: total.commission.toFixed(),
      marketplaceFees: total.marketplaceFees.toFixed(),
      shipping: total.shipping.toFixed(),
      adSpend: total.adSpend.toFixed(),
      taxes: total.taxes.toFixed(),
      refunds: total.refunds.toFixed(),
      otherCosts: total.otherCosts.toFixed(),
      grossProfit: total.grossProfit.toFixed(),
      netProfit: total.netProfit.toFixed(),
      orderCount: orders.length,
      dataQuality: productsMissingCost > 0 ? "partial" : "complete",
      computedAt: new Date(),
    },
    create: {
      workspaceId: workspace.id,
      date: dayStart,
      grossRevenue: total.grossRevenue.toFixed(),
      netRevenue: total.netRevenue.toFixed(),
      productCost: total.productCost.toFixed(),
      commission: total.commission.toFixed(),
      marketplaceFees: total.marketplaceFees.toFixed(),
      shipping: total.shipping.toFixed(),
      adSpend: total.adSpend.toFixed(),
      taxes: total.taxes.toFixed(),
      refunds: total.refunds.toFixed(),
      otherCosts: total.otherCosts.toFixed(),
      grossProfit: total.grossProfit.toFixed(),
      netProfit: total.netProfit.toFixed(),
      orderCount: orders.length,
      dataQuality: productsMissingCost > 0 ? "partial" : "complete",
    },
  });

  // Per-marketplace rollup (§11 — participação percentual).
  const byMarketplace = new Map<MarketplaceType, typeof results>();
  orders.forEach((order, i) => {
    const list = byMarketplace.get(order.marketplace) ?? [];
    list.push(results[i]!);
    byMarketplace.set(order.marketplace, list);
  });
  for (const [marketplace, list] of byMarketplace) {
    const agg = financialEngine.aggregate(list, workspace.currency);
    await prisma.marketplaceMetric.upsert({
      where: { workspaceId_marketplace_date: { workspaceId: workspace.id, marketplace, date: dayStart } },
      update: { grossRevenue: agg.grossRevenue.toFixed(), netProfit: agg.netProfit.toFixed(), orderCount: list.length, computedAt: new Date() },
      create: {
        workspaceId: workspace.id,
        marketplace,
        date: dayStart,
        grossRevenue: agg.grossRevenue.toFixed(),
        netProfit: agg.netProfit.toFixed(),
        orderCount: list.length,
      },
    });
  }

  // Per-product rollup (§14-15, §47) — this is what the NEGATIVE_MARGIN_PRODUCT
  // alert rule reads (see apps/worker/src/jobs/check-alerts.ts).
  const byProduct = new Map<string, { units: number; results: typeof results; hasCost: boolean }>();
  for (const order of orders) {
    for (const item of order.items) {
      if (!item.productId) continue;
      const itemResult = financialEngine.calculateOrder({
        grossAmount: new Decimal(item.unitPrice).times(item.quantity),
        commissionAmount: item.commissionAmount,
        marketplaceFeeAmount: item.feeAmount,
        taxAmount: item.taxAmount,
        adSpendAttributed: item.adSpendAttributed,
        items: [{ quantity: item.quantity, unitCost: item.unitCostSnapshot ?? new Decimal(0) }],
      });
      const entry = byProduct.get(item.productId) ?? { units: 0, results: [], hasCost: item.unitCostSnapshot !== null };
      entry.units += item.quantity;
      entry.results.push(itemResult);
      byProduct.set(item.productId, entry);
    }
  }

  for (const [productId, entry] of byProduct) {
    const agg = financialEngine.aggregate(entry.results, workspace.currency);
    await prisma.productMetric.upsert({
      where: { workspaceId_productId_date: { workspaceId: workspace.id, productId, date: dayStart } },
      update: {
        unitsSold: entry.units,
        revenue: agg.grossRevenue.toFixed(),
        cost: agg.productCost.toFixed(),
        fees: agg.commission.add(agg.marketplaceFees).toFixed(),
        adSpend: agg.adSpend.toFixed(),
        netProfit: agg.netProfit.toFixed(),
        margin: agg.marginPercent.toFixed(4),
        dataQuality: entry.hasCost ? "complete" : "partial",
        computedAt: new Date(),
      },
      create: {
        workspaceId: workspace.id,
        productId,
        date: dayStart,
        unitsSold: entry.units,
        revenue: agg.grossRevenue.toFixed(),
        cost: agg.productCost.toFixed(),
        fees: agg.commission.add(agg.marketplaceFees).toFixed(),
        adSpend: agg.adSpend.toFixed(),
        netProfit: agg.netProfit.toFixed(),
        margin: agg.marginPercent.toFixed(4),
        dataQuality: entry.hasCost ? "complete" : "partial",
      },
    });
  }
}

/**
 * Recompute a set of days, oldest first.
 *
 * Days are given as `YYYY-MM-DD` strings and de-duplicated here, so a caller
 * can hand over one entry per imported order row without counting how many
 * distinct days that is.
 */
export async function recomputeMetricsForDays(workspaceId: string, days: Iterable<string>): Promise<number> {
  const unique = [...new Set(days)].sort();
  for (const date of unique) {
    await computeDailyMetrics({ workspaceId, date });
  }
  return unique.length;
}

/**
 * Fill in cost snapshots that were unknown when an order was imported.
 *
 * An order item freezes the cost in force on its order date (§16). When the
 * catalogue had no cost yet, that snapshot is null and the item's profit is
 * flagged incomplete rather than assumed to be zero. Registering the cost
 * afterwards should settle those items — but only those: an item that already
 * carries a snapshot keeps it, because that was the real cost at the time and
 * overwriting it with today's price would rewrite history.
 *
 * Returns the days whose metrics are now stale, for the caller to recompute.
 */
export async function backfillMissingCostSnapshots(productId: string): Promise<string[]> {
  const costs = await prisma.productCost.findMany({
    where: { productId },
    orderBy: { effectiveFrom: "asc" },
    select: { unitCost: true, effectiveFrom: true },
  });
  if (costs.length === 0) return [];

  const items = await prisma.orderItem.findMany({
    where: { productId, unitCostSnapshot: null },
    select: { id: true, order: { select: { orderedAt: true } } },
  });

  const touchedDays = new Set<string>();

  for (const item of items) {
    const orderedAt = item.order.orderedAt;
    // The last cost that had already taken effect on the order date. An order
    // older than every registered cost stays null: inventing a cost for it
    // would be worse than admitting we do not know.
    let applicable: (typeof costs)[number] | undefined;
    for (const cost of costs) {
      if (cost.effectiveFrom <= orderedAt) applicable = cost;
      else break;
    }
    if (!applicable) continue;

    await prisma.orderItem.update({
      where: { id: item.id },
      data: { unitCostSnapshot: applicable.unitCost },
    });
    touchedDays.add(orderedAt.toISOString().slice(0, 10));
  }

  return [...touchedDays];
}

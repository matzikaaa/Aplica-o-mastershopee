import Decimal from "decimal.js";
import { prisma, type MarketplaceType } from "@mastershopee/database";
import { financialEngine } from "@mastershopee/financial-engine";
import type { ComputeMetricsJobData } from "../queues.js";

/**
 * Pre-aggregates one workspace-day into `DailyMetric` / `ProductMetric` /
 * `MarketplaceMetric` (§54, §61) so the dashboard never recomputes over raw
 * orders on every request. Idempotent — safe to re-run for the same day
 * (e.g. after a late-arriving refund) via upsert.
 */
export async function computeDailyMetrics(data: ComputeMetricsJobData): Promise<void> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: data.workspaceId } });
  const dayStart = new Date(`${data.date}T00:00:00`);
  const dayEnd = new Date(`${data.date}T23:59:59.999`);

  const orders = await prisma.order.findMany({
    where: { workspaceId: workspace.id, orderedAt: { gte: dayStart, lte: dayEnd } },
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

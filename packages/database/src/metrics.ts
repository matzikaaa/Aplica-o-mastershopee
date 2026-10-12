import Decimal from "decimal.js";
import { financialEngine } from "@mastershopee/financial-engine";
import type { MarketplaceType } from "@prisma/client";
import { prisma } from "./index";
import { revenueOrdersWhere, unknownCostWhere } from "./order-status";
import { calcularItensDoPedido, calcularPedido, snapshotDoCusto } from "./order-profit";
import { chaveDoDia, dataDoDia, fimDoDia, inicioDoDia } from "@mastershopee/shared";

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
  // O dia do vendedor, não o do servidor: em UTC o dia virava às 21h de
  // Brasília e a venda da noite entrava no dia seguinte. `dayStart`/`dayEnd`
  // são os instantes reais para filtrar pedidos; `dia` é o valor da coluna
  // de data sem hora em que a métrica é guardada.
  const dayStart = inicioDoDia(data.date, workspace.timezone);
  const dayEnd = fimDoDia(data.date, workspace.timezone);
  const dia = dataDoDia(data.date);

  const orders = await prisma.order.findMany({
    // Cancelled, refunded and returned orders are excluded: they are real rows
    // the operator can see in the orders list, but they are not revenue.
    where: { workspaceId: workspace.id, orderedAt: { gte: dayStart, lte: dayEnd }, ...revenueOrdersWhere },
    include: { items: true, refunds: true },
  });

  const results = orders.map((order) => calcularPedido(order));

  const total = financialEngine.aggregate(results, workspace.currency);

  // Campaign-level ad spend for the day. When it exists it *is* the day's ad
  // spend: per-order `adSpendAttributed` is an allocation of the same money
  // across orders, so adding the two would count the spend twice. The
  // allocation stays useful per product; the day's total comes from here.
  const campaignSpend = await prisma.adSpend.aggregate({
    where: { date: dia, campaign: { workspaceId: workspace.id } },
    _sum: { spend: true },
  });
  const campaignAdSpend = new Decimal(String(campaignSpend._sum.spend ?? 0));
  const dayAdSpend = campaignAdSpend.gt(0) ? campaignAdSpend : total.adSpend.toDecimal();
  // The engine already subtracted the per-order figure; correct by the delta.
  const dayNetProfit = total.netProfit.toDecimal().plus(total.adSpend.toDecimal()).minus(dayAdSpend);

  // Products with zero cost history make the day's numbers an estimate, not final (§96, §61).
  const productsMissingCost = await prisma.product.count({ where: { workspaceId: workspace.id, costs: { none: {} } } });

  await prisma.dailyMetric.upsert({
    where: { workspaceId_date: { workspaceId: workspace.id, date: dia } },
    update: {
      grossRevenue: total.grossRevenue.toFixed(),
      netRevenue: total.netRevenue.toFixed(),
      productCost: total.productCost.toFixed(),
      commission: total.commission.toFixed(),
      marketplaceFees: total.marketplaceFees.toFixed(),
      shipping: total.shipping.toFixed(),
      adSpend: dayAdSpend.toFixed(4),
      taxes: total.taxes.toFixed(),
      refunds: total.refunds.toFixed(),
      otherCosts: total.otherCosts.toFixed(),
      grossProfit: total.grossProfit.toFixed(),
      netProfit: dayNetProfit.toFixed(4),
      orderCount: orders.length,
      dataQuality: productsMissingCost > 0 ? "partial" : "complete",
      computedAt: new Date(),
    },
    create: {
      workspaceId: workspace.id,
      date: dia,
      grossRevenue: total.grossRevenue.toFixed(),
      netRevenue: total.netRevenue.toFixed(),
      productCost: total.productCost.toFixed(),
      commission: total.commission.toFixed(),
      marketplaceFees: total.marketplaceFees.toFixed(),
      shipping: total.shipping.toFixed(),
      adSpend: dayAdSpend.toFixed(4),
      taxes: total.taxes.toFixed(),
      refunds: total.refunds.toFixed(),
      otherCosts: total.otherCosts.toFixed(),
      grossProfit: total.grossProfit.toFixed(),
      netProfit: dayNetProfit.toFixed(4),
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
      where: { workspaceId_marketplace_date: { workspaceId: workspace.id, marketplace, date: dia } },
      update: { grossRevenue: agg.grossRevenue.toFixed(), netProfit: agg.netProfit.toFixed(), orderCount: list.length, computedAt: new Date() },
      create: {
        workspaceId: workspace.id,
        marketplace,
        date: dia,
        grossRevenue: agg.grossRevenue.toFixed(),
        netProfit: agg.netProfit.toFixed(),
        orderCount: list.length,
      },
    });
  }

  // Um marketplace que tinha venda no dia e não tem mais (pedido cancelado
  // depois, ou o dia recortado no fuso certo) não pode manter a linha velha.
  await prisma.marketplaceMetric.deleteMany({
    where: { workspaceId: workspace.id, date: dia, marketplace: { notIn: [...byMarketplace.keys()] } },
  });

  // Per-product rollup (§14-15, §47) — this is what the NEGATIVE_MARGIN_PRODUCT
  // alert rule reads (see packages/database/src/alert-checks.ts).
  const byProduct = new Map<string, { units: number; results: typeof results; hasCost: boolean }>();
  for (const order of orders) {
    for (const { item, resultado: itemResult } of calcularItensDoPedido(order)) {
      if (!item.productId) continue;
      const entry = byProduct.get(item.productId) ?? { units: 0, results: [], hasCost: item.unitCostSnapshot !== null };
      entry.units += item.quantity;
      entry.results.push(itemResult);
      byProduct.set(item.productId, entry);
    }
  }

  for (const [productId, entry] of byProduct) {
    const agg = financialEngine.aggregate(entry.results, workspace.currency);
    await prisma.productMetric.upsert({
      where: { workspaceId_productId_date: { workspaceId: workspace.id, productId, date: dia } },
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
        date: dia,
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

  // Mesma regra por produto: o "produto no prejuízo" de ontem não pode vir de
  // uma linha que nenhum pedido sustenta mais.
  await prisma.productMetric.deleteMany({
    where: { workspaceId: workspace.id, date: dia, productId: { notIn: [...byProduct.keys()] } },
  });
}

/**
 * Avança o recálculo de um workspace marcado com `metricsRecomputeFrom`.
 *
 * Quando a regra do cálculo muda (como embalagem e imposto passarem a entrar
 * no lucro), as métricas guardadas ficam velhas — e o painel lê as guardadas.
 * Recalcular um histórico inteiro não cabe numa função serverless, então isto
 * anda dentro de um prazo, guarda onde parou e é chamado de novo pela rotina
 * diária e pela sincronização de quando o painel abre, até zerar.
 */
export async function recalcularMetricasPendentes(
  workspaceId: string,
  prazoMs: number,
): Promise<{ dias: number; terminou: boolean }> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { metricsRecomputeFrom: true, timezone: true },
  });
  const desde = ws?.metricsRecomputeFrom;
  if (!desde) return { dias: 0, terminou: true };

  const limite = Date.now() + prazoMs;
  // Os dias com pedido, no fuso do vendedor — e os que já têm métrica
  // guardada: com o dia recortado em outro fuso, uma métrica antiga pode
  // estar num dia que não tem mais pedido, e precisa ser zerada, não
  // esquecida. Dia vazio fora disso não precisa de recálculo.
  const linhas = await prisma.$queryRaw<{ dia: Date }[]>`
    SELECT dia FROM (
      SELECT DISTINCT (("orderedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${ws.timezone})::date AS dia
      FROM "Order"
      WHERE "workspaceId" = ${workspaceId} AND "orderedAt" >= ${desde}
      UNION
      SELECT "date" AS dia FROM "DailyMetric"
      WHERE "workspaceId" = ${workspaceId} AND "date" >= ${desde}
    ) dias
    ORDER BY dia`;

  let feitos = 0;
  for (const { dia } of linhas) {
    if (Date.now() > limite) {
      await prisma.workspace.update({ where: { id: workspaceId }, data: { metricsRecomputeFrom: dia } });
      return { dias: feitos, terminou: false };
    }
    await computeDailyMetrics({ workspaceId, date: dia.toISOString().slice(0, 10) });
    feitos++;
  }

  await prisma.workspace.update({ where: { id: workspaceId }, data: { metricsRecomputeFrom: null } });
  return { dias: feitos, terminou: true };
}

/**
 * Recalcula os dias em que caem estas vendas, no fuso do workspace.
 *
 * Quem sincroniza tem o instante de cada pedido, não o fuso do vendedor; a
 * conversão para "que dia é isso para ele" mora aqui, num lugar só. Antes
 * cada chamador usava `toISOString().slice(0, 10)` — o dia em UTC —, e a
 * venda das 22h de Brasília recalculava o dia seguinte.
 */
export async function recomputeMetricsForOrderDates(workspaceId: string, instantes: Iterable<Date>): Promise<number> {
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { timezone: true } });
  const dias = new Set<string>();
  for (const t of instantes) dias.add(chaveDoDia(t, ws.timezone));
  return recomputeMetricsForDays(workspaceId, dias);
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
    select: {
      unitCost: true,
      packagingCost: true,
      operationalCost: true,
      otherCosts: true,
      taxPercent: true,
      effectiveFrom: true,
    },
  });
  if (costs.length === 0) return [];

  const items = await prisma.orderItem.findMany({
    where: { productId, ...unknownCostWhere() },
    select: { id: true, order: { select: { orderedAt: true, workspace: { select: { timezone: true } } } } },
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
      // O custo inteiro, não só o unitário: embalagem e imposto do mesmo
      // registro também valiam naquela data.
      data: snapshotDoCusto(applicable),
    });
    // O dia da venda no fuso do vendedor: é a chave que `computeDailyMetrics`
    // recorta.
    touchedDays.add(chaveDoDia(orderedAt, item.order.workspace.timezone));
  }

  return [...touchedDays];
}

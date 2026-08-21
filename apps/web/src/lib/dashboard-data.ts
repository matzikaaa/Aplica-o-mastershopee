import { prisma, revenueOrdersWhere } from "@mastershopee/database";
import { financialEngine } from "@mastershopee/financial-engine";
import type { DateRange } from "@mastershopee/shared";
import type { MarketplaceType } from "@mastershopee/database";
import Decimal from "decimal.js";

export interface KpiSummary {
  grossRevenue: number;
  netProfit: number;
  marginPercent: number;
  orderCount: number;
  averageTicket: number;
  adSpend: number;
  dataQuality: "complete" | "partial" | "processing" | "stale" | "error";
}

function sumMetrics(rows: { grossRevenue: unknown; netProfit: unknown; adSpend: unknown; orderCount: number; dataQuality: string }[]): KpiSummary {
  let grossRevenue = new Decimal(0);
  let netProfit = new Decimal(0);
  let adSpend = new Decimal(0);
  let orderCount = 0;
  let hasProcessing = false;

  for (const row of rows) {
    grossRevenue = grossRevenue.plus(row.grossRevenue as Decimal);
    netProfit = netProfit.plus(row.netProfit as Decimal);
    adSpend = adSpend.plus(row.adSpend as Decimal);
    orderCount += row.orderCount;
    if (row.dataQuality !== "complete") hasProcessing = true;
  }

  const marginPercent = grossRevenue.isZero() ? new Decimal(0) : netProfit.dividedBy(grossRevenue).times(100);
  const averageTicket = orderCount === 0 ? new Decimal(0) : grossRevenue.dividedBy(orderCount);

  return {
    grossRevenue: grossRevenue.toNumber(),
    netProfit: netProfit.toNumber(),
    marginPercent: marginPercent.toNumber(),
    orderCount,
    averageTicket: averageTicket.toNumber(),
    adSpend: adSpend.toNumber(),
    dataQuality: rows.length === 0 ? "processing" : hasProcessing ? "partial" : "complete",
  };
}

export async function getKpiSummary(workspaceId: string, range: DateRange): Promise<KpiSummary> {
  const rows = await prisma.dailyMetric.findMany({
    where: { workspaceId, date: { gte: range.from, lte: range.to } },
  });
  return sumMetrics(rows);
}

export async function getRevenueSeries(workspaceId: string, range: DateRange) {
  const rows = await prisma.dailyMetric.findMany({
    where: { workspaceId, date: { gte: range.from, lte: range.to } },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    grossRevenue: Number(r.grossRevenue),
    netProfit: Number(r.netProfit),
    adSpend: Number(r.adSpend),
    expenses: Number(r.commission) + Number(r.marketplaceFees) + Number(r.shipping) + Number(r.taxes),
  }));
}

export async function getFinancialComposition(workspaceId: string, range: DateRange) {
  const rows = await prisma.dailyMetric.findMany({
    where: { workspaceId, date: { gte: range.from, lte: range.to } },
  });

  const sum = (pick: (r: (typeof rows)[number]) => Decimal) =>
    rows.reduce((acc, r) => acc.plus(pick(r)), new Decimal(0)).toNumber();

  return {
    grossRevenue: sum((r) => r.grossRevenue as unknown as Decimal),
    commission: sum((r) => r.commission as unknown as Decimal),
    marketplaceFees: sum((r) => r.marketplaceFees as unknown as Decimal),
    adSpend: sum((r) => r.adSpend as unknown as Decimal),
    productCost: sum((r) => r.productCost as unknown as Decimal),
    shipping: sum((r) => r.shipping as unknown as Decimal),
    taxes: sum((r) => r.taxes as unknown as Decimal),
    netProfit: sum((r) => r.netProfit as unknown as Decimal),
  };
}

export async function getMarketplaceBreakdown(workspaceId: string, range: DateRange) {
  const rows = await prisma.order.groupBy({
    by: ["marketplace"],
    where: { workspaceId, orderedAt: { gte: range.from, lte: range.to }, ...revenueOrdersWhere },
    _sum: { grossAmount: true },
    _count: true,
  });
  const total = rows.reduce((acc, r) => acc + Number(r._sum.grossAmount ?? 0), 0);
  return rows.map((r) => ({
    marketplace: r.marketplace as MarketplaceType,
    grossRevenue: Number(r._sum.grossAmount ?? 0),
    orderCount: r._count,
    sharePercent: total === 0 ? 0 : (Number(r._sum.grossAmount ?? 0) / total) * 100,
  }));
}

export interface ProductRankingRow {
  productId: string;
  sku: string;
  name: string;
  unitsSold: number;
  revenue: number;
  netProfit: number;
  marginPercent: number;
  /**
   * Units sold in the period whose cost was unknown, so they were computed
   * with cost zero. Anything above zero means this row's profit is an upper
   * bound, not a result — and a "prejuízo" badge on such a row would be
   * reporting an arithmetic artifact as a business fact.
   */
  unitsWithoutCost: number;
}

/** Computes per-product profit for a date range via the financial engine over raw order items (§14, §15, §47). */
export async function getProductRanking(workspaceId: string, range: DateRange): Promise<ProductRankingRow[]> {
  const items = await prisma.orderItem.findMany({
    where: {
      order: { workspaceId, orderedAt: { gte: range.from, lte: range.to }, ...revenueOrdersWhere },
      productId: { not: null },
    },
    include: { product: true, order: true },
  });

  const byProduct = new Map<
    string,
    { sku: string; name: string; units: number; unitsWithoutCost: number; revenue: Decimal; profit: Decimal }
  >();

  for (const item of items) {
    if (!item.product) continue;
    const result = financialEngine.calculateOrder({
      grossAmount: new Decimal(item.unitPrice).times(item.quantity),
      commissionAmount: item.commissionAmount,
      marketplaceFeeAmount: item.feeAmount,
      adSpendAttributed: item.adSpendAttributed,
      taxAmount: item.taxAmount,
      items: [{ quantity: item.quantity, unitCost: item.unitCostSnapshot ?? 0 }],
    });

    const existing = byProduct.get(item.productId!) ?? {
      sku: item.product.sku,
      name: item.product.name,
      units: 0,
      unitsWithoutCost: 0,
      revenue: new Decimal(0),
      profit: new Decimal(0),
    };
    existing.units += item.quantity;
    if (item.unitCostSnapshot === null) existing.unitsWithoutCost += item.quantity;
    existing.revenue = existing.revenue.plus(result.grossRevenue.toDecimal());
    existing.profit = existing.profit.plus(result.netProfit.toDecimal());
    byProduct.set(item.productId!, existing);
  }

  return Array.from(byProduct.entries()).map(([productId, v]) => ({
    productId,
    sku: v.sku,
    name: v.name,
    unitsSold: v.units,
    unitsWithoutCost: v.unitsWithoutCost,
    revenue: v.revenue.toNumber(),
    netProfit: v.profit.toNumber(),
    marginPercent: v.revenue.isZero() ? 0 : v.profit.dividedBy(v.revenue).times(100).toNumber(),
  }));
}

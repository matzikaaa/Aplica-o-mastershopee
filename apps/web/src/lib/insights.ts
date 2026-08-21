import { prisma } from "@mastershopee/database";
import type { DateRange } from "@mastershopee/shared";
import { financialEngine } from "@mastershopee/financial-engine";
import Decimal from "decimal.js";

export type InsightTone = "positive" | "negative" | "neutral";

export interface Insight {
  id: string;
  tone: InsightTone;
  headline: string;
  /** The raw numbers behind `headline` — always shown alongside it, never hidden (§66). */
  evidence: { label: string; value: string }[];
}

/**
 * §66 — rule-based (not LLM-based) insights computed directly from
 * DailyMetric/ProductMetric rows the worker already aggregates. Every
 * headline here is a plain-language restatement of numbers shown right
 * next to it — never an inference presented without the data behind it.
 */
/**
 * `previousRange` is null for "Desde o início": there is no window before
 * everything. Comparison-shaped insights ("lucro subiu X%") are simply not
 * produced then, instead of being computed against an empty period and
 * reported as a real movement.
 */
export async function generateInsights(
  workspaceId: string,
  range: DateRange,
  previousRange: DateRange | null,
): Promise<Insight[]> {
  if (!previousRange) {
    const lossInsight = await getLossMakingProductsInsight(workspaceId, range);
    return lossInsight ? [lossInsight] : [];
  }

  const insights: Insight[] = [];

  const [current, previous, lossProducts, adSpendMovers] = await Promise.all([
    prisma.dailyMetric.findMany({ where: { workspaceId, date: { gte: range.from, lte: range.to } } }),
    prisma.dailyMetric.findMany({ where: { workspaceId, date: { gte: previousRange.from, lte: previousRange.to } } }),
    getLossMakingProductsInsight(workspaceId, range),
    getAdSpendMarginMovers(workspaceId, range, previousRange),
  ]);

  const currentNetProfit = current.reduce((sum, r) => sum.plus(r.netProfit as unknown as Decimal), new Decimal(0));
  const previousNetProfit = previous.reduce((sum, r) => sum.plus(r.netProfit as unknown as Decimal), new Decimal(0));
  const currentRevenue = current.reduce((sum, r) => sum.plus(r.grossRevenue as unknown as Decimal), new Decimal(0));
  const previousRevenue = previous.reduce((sum, r) => sum.plus(r.grossRevenue as unknown as Decimal), new Decimal(0));
  const currentAdSpend = current.reduce((sum, r) => sum.plus(r.adSpend as unknown as Decimal), new Decimal(0));
  const previousAdSpend = previous.reduce((sum, r) => sum.plus(r.adSpend as unknown as Decimal), new Decimal(0));

  const profitChange = financialEngine.percentChange(currentNetProfit.toNumber(), previousNetProfit.toNumber());
  if (profitChange !== null && Math.abs(profitChange.toNumber()) >= 5 && !previousNetProfit.isZero()) {
    const revenueChange = financialEngine.percentChange(currentRevenue.toNumber(), previousRevenue.toNumber());
    const adSpendChange = financialEngine.percentChange(currentAdSpend.toNumber(), previousAdSpend.toNumber());
    const isPositive = profitChange.isPositive();

    let explanation = "";
    if (revenueChange !== null && adSpendChange !== null) {
      if (isPositive && revenueChange.toNumber() > 0 && adSpendChange.toNumber() < revenueChange.toNumber()) {
        explanation = " — faturamento cresceu mais do que o gasto com ADS.";
      } else if (!isPositive && adSpendChange.toNumber() > revenueChange.toNumber()) {
        explanation = " — o gasto com ADS cresceu mais rápido do que o faturamento.";
      }
    }

    insights.push({
      id: "profit-change",
      tone: isPositive ? "positive" : "negative",
      headline: `Seu lucro líquido ${isPositive ? "aumentou" : "caiu"} ${Math.abs(profitChange.toNumber()).toFixed(1)}% no período${explanation}`,
      evidence: [
        { label: "Lucro líquido (período atual)", value: currentNetProfit.toFixed(2) },
        { label: "Lucro líquido (período anterior)", value: previousNetProfit.toFixed(2) },
        { label: "Faturamento (período atual)", value: currentRevenue.toFixed(2) },
        { label: "ADS (período atual)", value: currentAdSpend.toFixed(2) },
      ],
    });
  }

  if (lossProducts) insights.push(lossProducts);
  insights.push(...adSpendMovers);

  return insights;
}

async function getLossMakingProductsInsight(workspaceId: string, range: DateRange): Promise<Insight | null> {
  const rows = await prisma.productMetric.findMany({
    where: { workspaceId, date: { gte: range.from, lte: range.to }, netProfit: { lt: 0 } },
    include: { product: true },
  });
  if (rows.length === 0) return null;

  const totalLoss = rows.reduce((sum, r) => sum.plus(r.netProfit as unknown as Decimal), new Decimal(0)).abs();

  return {
    id: "loss-products",
    tone: "negative",
    headline: `Você perdeu aproximadamente ${totalLoss.toFixed(2)} no período em ${rows.length} produto(s) com margem negativa.`,
    evidence: rows
      .sort((a, b) => Number(a.netProfit) - Number(b.netProfit))
      .slice(0, 5)
      .map((r) => ({ label: r.product.name, value: `${Number(r.netProfit).toFixed(2)} (margem ${Number(r.margin).toFixed(1)}%)` })),
  };
}

async function getAdSpendMarginMovers(workspaceId: string, range: DateRange, previousRange: DateRange): Promise<Insight[]> {
  const [current, previous] = await Promise.all([
    prisma.productMetric.findMany({ where: { workspaceId, date: { gte: range.from, lte: range.to } }, include: { product: true } }),
    prisma.productMetric.findMany({ where: { workspaceId, date: { gte: previousRange.from, lte: previousRange.to } } }),
  ]);

  // Aggregate each product's daily rows into one period total before
  // comparing — otherwise the same product would produce one near-duplicate
  // insight per day it appears in both periods.
  interface ProductTotals {
    adSpend: Decimal;
    revenue: Decimal;
    netProfit: Decimal;
  }
  function sumByProduct<T extends { productId: string; adSpend: unknown; revenue: unknown; netProfit: unknown }>(
    rows: T[],
  ): Map<string, ProductTotals> {
    const byProduct = new Map<string, ProductTotals>();
    for (const row of rows) {
      const existing = byProduct.get(row.productId) ?? { adSpend: new Decimal(0), revenue: new Decimal(0), netProfit: new Decimal(0) };
      existing.adSpend = existing.adSpend.plus(row.adSpend as unknown as Decimal);
      existing.revenue = existing.revenue.plus(row.revenue as unknown as Decimal);
      existing.netProfit = existing.netProfit.plus(row.netProfit as unknown as Decimal);
      byProduct.set(row.productId, existing);
    }
    return byProduct;
  }

  const productNames = new Map(current.map((row) => [row.productId, row.product.name]));
  const currentByProduct = sumByProduct(current);
  const previousByProduct = sumByProduct(previous);
  const insights: Insight[] = [];

  for (const [productId, curr] of currentByProduct) {
    const prev = previousByProduct.get(productId);
    if (!prev || prev.adSpend.isZero() || curr.revenue.isZero() || prev.revenue.isZero()) continue;

    const currMargin = curr.netProfit.dividedBy(curr.revenue).times(100);
    const prevMargin = prev.netProfit.dividedBy(prev.revenue).times(100);
    const adSpendChange = financialEngine.percentChange(curr.adSpend.toNumber(), prev.adSpend.toNumber());
    const marginDrop = prevMargin.minus(currMargin);

    // Only surface the clearest cases: ADS grew meaningfully and margin dropped meaningfully alongside it.
    if (adSpendChange !== null && adSpendChange.toNumber() > 25 && marginDrop.toNumber() > 5) {
      insights.push({
        id: `ad-margin-${productId}`,
        tone: "negative",
        headline: `O gasto com ADS de "${productNames.get(productId)}" subiu ${adSpendChange.toNumber().toFixed(0)}% e a margem caiu de ${prevMargin.toFixed(1)}% para ${currMargin.toFixed(1)}%.`,
        evidence: [
          { label: "ADS (período anterior)", value: prev.adSpend.toFixed(2) },
          { label: "ADS (período atual)", value: curr.adSpend.toFixed(2) },
          { label: "Margem (período anterior)", value: `${prevMargin.toFixed(1)}%` },
          { label: "Margem (período atual)", value: `${currMargin.toFixed(1)}%` },
        ],
      });
    }
  }

  return insights.sort((a, b) => a.headline.localeCompare(b.headline)).slice(0, 3);
}

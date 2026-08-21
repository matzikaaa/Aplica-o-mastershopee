import Decimal from "decimal.js";
import type { MarketplaceType } from "@prisma/client";
import { prisma } from "./index";
import { revenueOrdersWhere } from "./order-status";

/**
 * Effective marketplace rates measured from the workspace's own orders.
 *
 * Deliberately *not* a table of published commission rates: those vary by
 * category, change without notice, and shipping the wrong one as if it were
 * official would put an invented number at the base of every pricing
 * decision (§96). What each marketplace actually charged this seller is
 * already in the synced orders, so it is derived from there — and when there
 * is no history, nothing is returned and the operator types the rate in.
 */

export interface EffectiveRates {
  marketplace: MarketplaceType;
  /** Orders the averages are based on — shown so the operator can judge them. */
  sampleOrders: number;
  commissionPercent: Decimal;
  marketplaceFeePercent: Decimal;
  taxPercent: Decimal;
  adSpendPercent: Decimal;
  periodDays: number;
}

/**
 * Returns `null` when the workspace has no revenue for that marketplace in
 * the window — an average over nothing is not a rate.
 */
export async function effectiveMarketplaceRates(
  workspaceId: string,
  marketplace: MarketplaceType,
  periodDays = 90,
): Promise<EffectiveRates | null> {
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  const agg = await prisma.order.aggregate({
    where: {
      workspaceId,
      marketplace,
      orderedAt: { gte: since },
      // Cancelled orders often carry reversed or zeroed fees; including them
      // would drag the averages away from what a real sale costs.
      ...revenueOrdersWhere,
    },
    _sum: {
      grossAmount: true,
      commissionAmount: true,
      marketplaceFeeAmount: true,
      taxAmount: true,
      adSpendAttributed: true,
    },
    _count: true,
  });

  const gross = new Decimal(agg._sum.grossAmount?.toString() ?? "0");
  if (gross.lte(0)) return null;

  const pct = (value: unknown) =>
    new Decimal(value?.toString() ?? "0").dividedBy(gross).times(100);

  return {
    marketplace,
    sampleOrders: agg._count,
    periodDays,
    commissionPercent: pct(agg._sum.commissionAmount),
    marketplaceFeePercent: pct(agg._sum.marketplaceFeeAmount),
    taxPercent: pct(agg._sum.taxAmount),
    adSpendPercent: pct(agg._sum.adSpendAttributed),
  };
}

/** Same measurement for every marketplace the workspace has sold on. */
export async function allEffectiveMarketplaceRates(
  workspaceId: string,
  periodDays = 90,
): Promise<Partial<Record<MarketplaceType, EffectiveRates>>> {
  const marketplaces: MarketplaceType[] = ["SHOPEE", "MERCADO_LIVRE", "SHEIN", "TIKTOK_SHOP"];
  const results = await Promise.all(
    marketplaces.map((m) => effectiveMarketplaceRates(workspaceId, m, periodDays)),
  );

  const map: Partial<Record<MarketplaceType, EffectiveRates>> = {};
  for (const r of results) {
    if (r) map[r.marketplace] = r;
  }
  return map;
}

import { allEffectiveMarketplaceRates } from "@mastershopee/database";
import type { MarketplaceType } from "@mastershopee/shared";
import { requireWorkspace } from "@/lib/session";
import { PriceCalculator, type MarketplaceRateOption } from "@/components/pricing/price-calculator";

export const dynamic = "force-dynamic";

const MARKETPLACES: MarketplaceType[] = ["SHOPEE", "MERCADO_LIVRE", "SHEIN", "TIKTOK_SHOP"];

/**
 * Price calculator (§67-68).
 *
 * The marketplace deductions are seeded from what each marketplace actually
 * charged this workspace, measured from its own synced orders — not from a
 * published rate table. Those tables vary by category and change without
 * notice, so shipping one as if it were authoritative would put an invented
 * number underneath every pricing decision (§96). With no history the fields
 * simply start empty and say so.
 */
export default async function PricingPage() {
  const { workspace } = await requireWorkspace();
  const rates = await allEffectiveMarketplaceRates(workspace.id);

  const options: MarketplaceRateOption[] = MARKETPLACES.map((marketplace) => {
    const r = rates[marketplace];
    return {
      marketplace,
      rates: r
        ? {
            commissionPercent: r.commissionPercent.toFixed(2),
            marketplaceFeePercent: r.marketplaceFeePercent.toFixed(2),
            taxPercent: r.taxPercent.toFixed(2),
            adSpendPercent: r.adSpendPercent.toFixed(2),
            sampleOrders: r.sampleOrders,
            periodDays: r.periodDays,
          }
        : null,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Calculadora de preço</h1>
        <p className="text-sm text-muted-foreground">
          Descubra por quanto vender para atingir a margem que você quer — ou quanto sobra num preço que já pensou.
        </p>
      </div>

      <PriceCalculator options={options} />
    </div>
  );
}

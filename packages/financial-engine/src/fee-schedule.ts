import Decimal from "decimal.js";
import { Money } from "@mastershopee/shared";
import { simulatePrice, suggestPrice, type SimulatePriceResult, type SuggestedPriceResult } from "./pricing";

/**
 * Price-banded marketplace fees.
 *
 * Shopee (and others) charge a percentage *plus a fixed amount per item*,
 * and both change with the item's price band. That breaks the flat-percentage
 * model in pricing.ts in two ways:
 *
 *  1. The fixed fee is a per-sale cost, not a percentage — it belongs with
 *     the fixed costs when solving for price.
 *  2. Solving "what price gives me X% margin" becomes piecewise: the band
 *     determines the fee, but the price determines the band. Each band is
 *     solved independently and the answer is kept only if it actually lands
 *     inside the band it assumed (see suggestPriceForSchedule).
 *
 * A consequence worth surfacing to the operator: the jump between bands is
 * a discontinuity, so a target margin can be unreachable in a gap, and
 * pricing just below a boundary can beat pricing just above it.
 */

export interface FeeBand {
  /** Inclusive lower bound. */
  minPrice: Decimal.Value;
  /** Exclusive upper bound; null means "no upper limit". */
  maxPrice: Decimal.Value | null;
  commissionPercent: Decimal.Value;
  /** Charged once per item sold, regardless of price. */
  fixedFeePerItem: Decimal.Value;
}

export interface FeeSchedule {
  id: string;
  label: string;
  /** Where these numbers came from, so the UI can attribute and date them. */
  source: string;
  effectiveFrom: string;
  verified: boolean;
  bands: FeeBand[];
}

/**
 * Shopee Brasil, effective March 2026.
 *
 * NOT verified against Shopee's own seller-education page: that domain is
 * unreachable from this environment. The figures below were corroborated
 * across independent secondary sources, but they are shipped as an editable
 * starting point, never as an authority — the UI must let the operator
 * correct them and must say where they came from (§96).
 *
 * Not modelled here: the extra R$3/item reported for CPF sellers above ~450
 * orders per 90 days, since it depends on seller status the app cannot
 * observe. Operators in that bracket should add it as an extra cost.
 */
export const SHOPEE_FEE_SCHEDULE: FeeSchedule = {
  id: "shopee-br-2026-03",
  label: "Shopee Brasil — tabela de março/2026",
  source: "fontes públicas corroboradas (não verificado na página oficial da Shopee)",
  effectiveFrom: "2026-03-01",
  verified: false,
  bands: [
    { minPrice: 0, maxPrice: 8, commissionPercent: 50, fixedFeePerItem: 0 },
    { minPrice: 8, maxPrice: 80, commissionPercent: 20, fixedFeePerItem: 4 },
    { minPrice: 80, maxPrice: 100, commissionPercent: 14, fixedFeePerItem: 16 },
    { minPrice: 100, maxPrice: 200, commissionPercent: 14, fixedFeePerItem: 20 },
    { minPrice: 200, maxPrice: null, commissionPercent: 14, fixedFeePerItem: 26 },
  ],
};

export function resolveBand(schedule: FeeSchedule, price: Decimal.Value): FeeBand | null {
  const p = new Decimal(price);
  return (
    schedule.bands.find(
      (b) => p.gte(b.minPrice) && (b.maxPrice === null || p.lt(b.maxPrice)),
    ) ?? null
  );
}

export interface ScheduleCostInput {
  currency?: string;
  unitCost: Decimal.Value;
  packagingCost?: Decimal.Value;
  otherCosts?: Decimal.Value;
  /** Percentages that apply on top of the band's commission. */
  taxPercent?: Decimal.Value;
  estimatedAdSpendPercent?: Decimal.Value;
  extraFixedFeePerItem?: Decimal.Value;
}

export interface BandedSuggestion {
  band: FeeBand;
  result: SuggestedPriceResult;
}

export interface BandedSuggestionOutcome {
  /** Prices that are self-consistent: each lands inside the band it assumed. */
  viable: BandedSuggestion[];
  /**
   * Bands whose solved price fell outside themselves. Kept because a target
   * margin unreachable in every band is a real answer the operator needs,
   * not an error to swallow.
   */
  rejected: BandedSuggestion[];
}

/**
 * Solves the target margin in every band and keeps only the self-consistent
 * answers. Usually one; occasionally more (then the cheapest viable price is
 * normally the one to pick); sometimes none, when the margin falls in a gap
 * created by a band jump.
 */
export function suggestPriceForSchedule(
  input: ScheduleCostInput & { desiredMarginPercent: Decimal.Value },
  schedule: FeeSchedule,
): BandedSuggestionOutcome {
  const viable: BandedSuggestion[] = [];
  const rejected: BandedSuggestion[] = [];

  for (const band of schedule.bands) {
    let result: SuggestedPriceResult;
    try {
      result = suggestPrice({
        currency: input.currency,
        unitCost: input.unitCost,
        packagingCost: input.packagingCost,
        // The per-item fee behaves exactly like a fixed cost when isolating price.
        otherCosts: new Decimal(input.otherCosts ?? 0)
          .plus(band.fixedFeePerItem)
          .plus(input.extraFixedFeePerItem ?? 0),
        commissionPercent: band.commissionPercent,
        taxPercent: input.taxPercent,
        estimatedAdSpendPercent: input.estimatedAdSpendPercent,
        desiredMarginPercent: input.desiredMarginPercent,
      });
    } catch {
      // Deductions plus margin exceed 100% in this band — no price works here.
      continue;
    }

    const price = new Decimal(result.recommendedPrice.toFixed(4));
    const insideBand =
      price.gte(band.minPrice) && (band.maxPrice === null || price.lt(band.maxPrice));

    (insideBand ? viable : rejected).push({ band, result });
  }

  return { viable, rejected };
}

export interface BandedSimulation {
  band: FeeBand;
  result: SimulatePriceResult;
  fixedFeeApplied: Money;
}

/** "Se eu vender por R$ X nesta tabela, quanto sobra?" */
export function simulatePriceForSchedule(
  input: ScheduleCostInput & { price: Decimal.Value },
  schedule: FeeSchedule,
): BandedSimulation | null {
  const band = resolveBand(schedule, input.price);
  if (!band) return null;

  const currency = input.currency ?? "BRL";
  const fixedFeeApplied = Money.of(band.fixedFeePerItem, currency).add(
    Money.of(input.extraFixedFeePerItem ?? 0, currency),
  );

  const result = simulatePrice({
    currency,
    unitCost: input.unitCost,
    packagingCost: input.packagingCost,
    otherCosts: new Decimal(input.otherCosts ?? 0).plus(fixedFeeApplied.toFixed(4)),
    commissionPercent: band.commissionPercent,
    taxPercent: input.taxPercent,
    estimatedAdSpendPercent: input.estimatedAdSpendPercent,
    price: input.price,
  });

  return { band, result, fixedFeeApplied };
}

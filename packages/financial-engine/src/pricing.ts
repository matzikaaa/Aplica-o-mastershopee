import Decimal from "decimal.js";
import { Money } from "@mastershopee/shared";

export interface SuggestedPriceInput {
  currency?: string;
  unitCost: Decimal.Value;
  packagingCost?: Decimal.Value;
  otherCosts?: Decimal.Value;
  commissionPercent: Decimal.Value; // e.g. 14 for 14%
  marketplaceFeePercent?: Decimal.Value;
  taxPercent?: Decimal.Value;
  estimatedAdSpendPercent?: Decimal.Value; // % of price, based on historical average — always labeled as an estimate
  desiredMarginPercent: Decimal.Value;
}

export interface SuggestedPriceResult {
  currency: string;
  fixedCosts: Money;
  percentualDeductionsPercent: Decimal;
  minimumPrice: Money;
  recommendedPrice: Money;
  estimatedProfit: Money;
  estimatedMarginPercent: Decimal;
  isEstimate: true;
}

/**
 * Reverse-engineers a sale price from a target margin (§67 — Calculadora de
 * preço). All percentual marketplace deductions (commission, fee, tax, ads)
 * apply on top of the final price, so solving requires isolating price:
 *
 *   price = fixedCosts / (1 − marginPercent/100 − sumOfPercentDeductions/100)
 *
 * Ad spend is always an estimate based on historical averages — the result
 * is explicitly flagged `isEstimate: true` and the UI must say so (§67 last line).
 */
export function suggestPrice(input: SuggestedPriceInput): SuggestedPriceResult {
  const currency = input.currency ?? "BRL";
  const fixedCosts = Money.of(input.unitCost, currency)
    .add(Money.of(input.packagingCost ?? 0, currency))
    .add(Money.of(input.otherCosts ?? 0, currency));

  const percentualDeductionsPercent = new Decimal(input.commissionPercent)
    .plus(input.marketplaceFeePercent ?? 0)
    .plus(input.taxPercent ?? 0)
    .plus(input.estimatedAdSpendPercent ?? 0);

  const marginPercent = new Decimal(input.desiredMarginPercent);
  const denominator = new Decimal(100)
    .minus(marginPercent)
    .minus(percentualDeductionsPercent)
    .dividedBy(100);

  if (denominator.lte(0)) {
    throw new Error(
      "A margem desejada somada às taxas percentuais ultrapassa 100% do preço — ajuste os parâmetros.",
    );
  }

  const recommendedPrice = fixedCosts.divide(denominator);
  const minimumPrice = fixedCosts.divide(
    new Decimal(100).minus(percentualDeductionsPercent).dividedBy(100),
  );

  const percentualDeductionsAmount = recommendedPrice.multiply(
    percentualDeductionsPercent.dividedBy(100),
  );
  const estimatedProfit = recommendedPrice.subtract(fixedCosts).subtract(percentualDeductionsAmount);
  const estimatedMarginPercent = estimatedProfit.percentOf(recommendedPrice);

  return {
    currency,
    fixedCosts,
    percentualDeductionsPercent,
    minimumPrice,
    recommendedPrice,
    estimatedProfit,
    estimatedMarginPercent,
    isEstimate: true,
  };
}

export interface SimulatePriceInput extends Omit<SuggestedPriceInput, "desiredMarginPercent"> {
  price: Decimal.Value;
}

export interface SimulatePriceResult {
  currency: string;
  price: Money;
  fixedCosts: Money;
  percentualDeductions: Money;
  estimatedProfit: Money;
  estimatedMarginPercent: Decimal;
  isEstimate: true;
}

/** "Se eu vender por R$ 59,90, quanto sobra?" (§68). */
export function simulatePrice(input: SimulatePriceInput): SimulatePriceResult {
  const currency = input.currency ?? "BRL";
  const price = Money.of(input.price, currency);
  const fixedCosts = Money.of(input.unitCost, currency)
    .add(Money.of(input.packagingCost ?? 0, currency))
    .add(Money.of(input.otherCosts ?? 0, currency));

  const percentualDeductionsPercent = new Decimal(input.commissionPercent)
    .plus(input.marketplaceFeePercent ?? 0)
    .plus(input.taxPercent ?? 0)
    .plus(input.estimatedAdSpendPercent ?? 0);

  const percentualDeductions = price.multiply(percentualDeductionsPercent.dividedBy(100));
  const estimatedProfit = price.subtract(fixedCosts).subtract(percentualDeductions);
  const estimatedMarginPercent = estimatedProfit.percentOf(price);

  return {
    currency,
    price,
    fixedCosts,
    percentualDeductions,
    estimatedProfit,
    estimatedMarginPercent,
    isEstimate: true,
  };
}

export interface AdPerformanceInput {
  spend: Decimal.Value;
  attributedRevenue: Decimal.Value;
  clicks?: number;
  impressions?: number;
}

export interface AdPerformanceResult {
  roas: Decimal | null; // Return on Ad Spend = revenue / spend
  acos: Decimal | null; // Advertising Cost of Sale = spend / revenue * 100
  cpc: Decimal | null;
}

/** Only ever fed with data actually returned by a marketplace Ads API — never fabricated (§18). */
export function calculateAdPerformance(input: AdPerformanceInput): AdPerformanceResult {
  const spend = new Decimal(input.spend);
  const revenue = new Decimal(input.attributedRevenue);

  return {
    roas: spend.isZero() ? null : revenue.dividedBy(spend),
    acos: revenue.isZero() ? null : spend.dividedBy(revenue).times(100),
    cpc: input.clicks && input.clicks > 0 ? spend.dividedBy(input.clicks) : null,
  };
}

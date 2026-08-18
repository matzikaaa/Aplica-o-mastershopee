import Decimal from "decimal.js";
import { Money } from "@mastershopee/shared";
import type { ProfitBreakdown } from "@mastershopee/shared";

export interface OrderItemCostInput {
  quantity: number;
  unitCost?: Decimal.Value;
  packagingCost?: Decimal.Value;
  operationalCost?: Decimal.Value;
  otherCosts?: Decimal.Value;
}

export interface OrderEconomicsInput {
  currency?: string;
  grossAmount: Decimal.Value;
  discountAmount?: Decimal.Value;
  commissionAmount?: Decimal.Value;
  marketplaceFeeAmount?: Decimal.Value;
  shippingSubsidizedByMerchant?: Decimal.Value;
  taxAmount?: Decimal.Value;
  adSpendAttributed?: Decimal.Value;
  refundAmount?: Decimal.Value;
  otherCosts?: Decimal.Value;
  items: OrderItemCostInput[];
}

export interface OrderEconomicsResult {
  currency: string;
  grossRevenue: Money;
  discounts: Money;
  netRevenue: Money;
  productCost: Money;
  packaging: Money;
  operational: Money;
  commission: Money;
  marketplaceFees: Money;
  shipping: Money;
  taxes: Money;
  adSpend: Money;
  refunds: Money;
  otherCosts: Money;
  grossProfit: Money;
  netProfit: Money;
  marginPercent: Decimal;
}

const zero = (currency: string) => Money.zero(currency);

/**
 * Centralized financial math. Every profit/margin figure surfaced anywhere
 * in the product (dashboard cards, product table, order detail, DRE,
 * WhatsApp report) must be produced by this engine — never recomputed ad
 * hoc in a UI component or API route (§60).
 *
 *   Faturamento
 *   − descontos/cancelamentos           = Receita líquida
 *   − custo dos produtos (CMV)          = Lucro bruto
 *   − comissões − taxas − fretes
 *   − ADS − impostos − outros custos    = Lucro líquido
 */
export class FinancialCalculationEngine {
  calculateOrder(input: OrderEconomicsInput): OrderEconomicsResult {
    const currency = input.currency ?? "BRL";
    const m = (v: Decimal.Value | undefined) => Money.of(v ?? 0, currency);

    const grossRevenue = m(input.grossAmount);
    const discounts = m(input.discountAmount);
    const refunds = m(input.refundAmount);
    const netRevenue = grossRevenue.subtract(discounts).subtract(refunds);

    let productCost = zero(currency);
    let packaging = zero(currency);
    let operational = zero(currency);
    let itemOtherCosts = zero(currency);
    for (const item of input.items) {
      const qty = new Decimal(item.quantity);
      productCost = productCost.add(m(item.unitCost).multiply(qty));
      packaging = packaging.add(m(item.packagingCost).multiply(qty));
      operational = operational.add(m(item.operationalCost).multiply(qty));
      itemOtherCosts = itemOtherCosts.add(m(item.otherCosts).multiply(qty));
    }

    const commission = m(input.commissionAmount);
    const marketplaceFees = m(input.marketplaceFeeAmount);
    const shipping = m(input.shippingSubsidizedByMerchant);
    const taxes = m(input.taxAmount);
    const adSpend = m(input.adSpendAttributed);
    const otherCosts = m(input.otherCosts).add(itemOtherCosts);

    const grossProfit = netRevenue.subtract(productCost).subtract(packaging).subtract(operational);
    const netProfit = grossProfit
      .subtract(commission)
      .subtract(marketplaceFees)
      .subtract(shipping)
      .subtract(taxes)
      .subtract(adSpend)
      .subtract(otherCosts);

    const marginPercent = grossRevenue.isZero()
      ? new Decimal(0)
      : netProfit.percentOf(grossRevenue);

    return {
      currency,
      grossRevenue,
      discounts,
      netRevenue,
      productCost,
      packaging,
      operational,
      commission,
      marketplaceFees,
      shipping,
      taxes,
      adSpend,
      refunds,
      otherCosts,
      grossProfit,
      netProfit,
      marginPercent,
    };
  }

  /** Sums multiple order results into one period aggregate (dashboard KPI cards, DailyMetric rows). */
  aggregate(results: OrderEconomicsResult[], currency = "BRL"): OrderEconomicsResult {
    if (results.length === 0) {
      return this.calculateOrder({ grossAmount: 0, items: [], currency });
    }
    const sum = (pick: (r: OrderEconomicsResult) => Money) => Money.sum(results.map(pick), currency);

    const grossRevenue = sum((r) => r.grossRevenue);
    const netProfit = sum((r) => r.netProfit);

    return {
      currency,
      grossRevenue,
      discounts: sum((r) => r.discounts),
      netRevenue: sum((r) => r.netRevenue),
      productCost: sum((r) => r.productCost),
      packaging: sum((r) => r.packaging),
      operational: sum((r) => r.operational),
      commission: sum((r) => r.commission),
      marketplaceFees: sum((r) => r.marketplaceFees),
      shipping: sum((r) => r.shipping),
      taxes: sum((r) => r.taxes),
      adSpend: sum((r) => r.adSpend),
      refunds: sum((r) => r.refunds),
      otherCosts: sum((r) => r.otherCosts),
      grossProfit: sum((r) => r.grossProfit),
      netProfit,
      marginPercent: grossRevenue.isZero() ? new Decimal(0) : netProfit.percentOf(grossRevenue),
    };
  }

  /** Percent change vs. a prior-period value, for the "+18,4% vs período anterior" comparisons (§48). */
  percentChange(current: Decimal.Value, previous: Decimal.Value): Decimal | null {
    const prev = new Decimal(previous);
    if (prev.isZero()) return null; // undefined % change — render as "novo" in the UI, never divide by zero
    return new Decimal(current).minus(prev).dividedBy(prev.abs()).times(100);
  }

  /** Turns a calculated result into the line-by-line breakdown shown in the "Como calculamos?" drawer (§21, §83). */
  explain(result: OrderEconomicsResult): ProfitBreakdown {
    return {
      grossRevenue: result.grossRevenue.toFixed(),
      discounts: result.discounts.toFixed(),
      commission: result.commission.toFixed(),
      marketplaceFees: result.marketplaceFees.toFixed(),
      shipping: result.shipping.toFixed(),
      adSpend: result.adSpend.toFixed(),
      productCost: result.productCost.toFixed(),
      packaging: result.packaging.toFixed(),
      taxes: result.taxes.toFixed(),
      refunds: result.refunds.toFixed(),
      otherCosts: result.otherCosts.toFixed(),
      netProfit: result.netProfit.toFixed(),
      marginPercent: result.marginPercent.toFixed(2),
    };
  }
}

export const financialEngine = new FinancialCalculationEngine();

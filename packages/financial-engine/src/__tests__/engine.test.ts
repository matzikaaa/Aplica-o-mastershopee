import { describe, expect, it } from "vitest";
import { FinancialCalculationEngine } from "../engine";

describe("FinancialCalculationEngine.calculateOrder", () => {
  const engine = new FinancialCalculationEngine();

  it("matches the worked example from the spec (§21): venda R$69,90 -> lucro R$23,92", () => {
    const result = engine.calculateOrder({
      grossAmount: 69.9,
      commissionAmount: 9.08,
      marketplaceFeeAmount: 2.0,
      adSpendAttributed: 8.21,
      taxAmount: 4.19,
      items: [{ quantity: 1, unitCost: 21.0, packagingCost: 1.5 }],
    });

    expect(result.netProfit.toFixed(2)).toBe("23.92");
  });

  it("never uses floating point for money — repeated fractional cents stay exact", () => {
    const result = engine.calculateOrder({
      grossAmount: 10,
      items: [{ quantity: 3, unitCost: 0.1 }],
    });
    // 3 * 0.10 = 0.30 exactly — a naive float sum can drift to 0.30000000000000004
    expect(result.productCost.toFixed(2)).toBe("0.30");
  });

  it("computes margin as netProfit / grossRevenue * 100", () => {
    const result = engine.calculateOrder({
      grossAmount: 100,
      commissionAmount: 10,
      items: [{ quantity: 1, unitCost: 50 }],
    });
    // netProfit = 100 - 50 - 10 = 40 -> margin 40%
    expect(result.marginPercent.toFixed(2)).toBe("40.00");
  });

  it("returns zero margin (not NaN/Infinity) when gross revenue is zero", () => {
    const result = engine.calculateOrder({ grossAmount: 0, items: [] });
    expect(result.marginPercent.toFixed(2)).toBe("0.00");
  });

  it("flags negative margin for a loss-making order (organizador de tênis example, §15)", () => {
    const result = engine.calculateOrder({
      grossAmount: 30,
      commissionAmount: 4.2,
      adSpendAttributed: 15,
      items: [{ quantity: 1, unitCost: 14.9, packagingCost: 1.5 }],
    });
    expect(result.netProfit.isNegative()).toBe(true);
  });

  it("deducts discounts and refunds before computing gross profit", () => {
    const result = engine.calculateOrder({
      grossAmount: 100,
      discountAmount: 10,
      refundAmount: 5,
      items: [{ quantity: 1, unitCost: 20 }],
    });
    expect(result.netRevenue.toFixed(2)).toBe("85.00");
    expect(result.grossProfit.toFixed(2)).toBe("65.00");
  });

  it("aggregates multiple orders into one period total", () => {
    const a = engine.calculateOrder({ grossAmount: 100, items: [{ quantity: 1, unitCost: 40 }] });
    const b = engine.calculateOrder({ grossAmount: 200, items: [{ quantity: 1, unitCost: 80 }] });
    const total = engine.aggregate([a, b]);
    expect(total.grossRevenue.toFixed(2)).toBe("300.00");
    expect(total.netProfit.toFixed(2)).toBe("180.00");
  });

  it("aggregate of an empty period returns zeroed result, not a crash", () => {
    const total = engine.aggregate([]);
    expect(total.grossRevenue.toFixed(2)).toBe("0.00");
    expect(total.marginPercent.toFixed(2)).toBe("0.00");
  });

  it("percentChange returns null (not divide-by-zero) when the previous period was zero", () => {
    expect(engine.percentChange(100, 0)).toBeNull();
  });

  it("percentChange computes a signed percentage delta", () => {
    const change = engine.percentChange(118.4, 100);
    expect(change?.toFixed(1)).toBe("18.4");
  });

  it("explain() produces a breakdown whose components sum back to the same net profit", () => {
    const result = engine.calculateOrder({
      grossAmount: 69.9,
      commissionAmount: 9.08,
      marketplaceFeeAmount: 2.0,
      adSpendAttributed: 8.21,
      taxAmount: 4.19,
      items: [{ quantity: 1, unitCost: 21.0, packagingCost: 1.5 }],
    });
    const breakdown = engine.explain(result);
    expect(breakdown.netProfit).toBe(result.netProfit.toFixed(2));
    expect(Number(breakdown.marginPercent)).toBeCloseTo(result.marginPercent.toNumber(), 2);
  });

  it("sums per-item costs by quantity, not treated as a flat per-order cost", () => {
    const result = engine.calculateOrder({
      grossAmount: 300,
      items: [{ quantity: 3, unitCost: 20, packagingCost: 2 }],
    });
    expect(result.productCost.toFixed(2)).toBe("60.00");
    expect(result.packaging.toFixed(2)).toBe("6.00");
  });
});

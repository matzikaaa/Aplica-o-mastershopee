import { describe, expect, it } from "vitest";
import { suggestPrice, simulatePrice, calculateAdPerformance } from "../pricing";

describe("suggestPrice", () => {
  it("recommends a price that, when simulated back, yields the desired margin", () => {
    const suggestion = suggestPrice({
      unitCost: 18,
      packagingCost: 1.5,
      commissionPercent: 14,
      marketplaceFeePercent: 2,
      taxPercent: 6,
      desiredMarginPercent: 15,
    });

    const check = simulatePrice({
      unitCost: 18,
      packagingCost: 1.5,
      commissionPercent: 14,
      marketplaceFeePercent: 2,
      taxPercent: 6,
      price: suggestion.recommendedPrice.toNumber(),
    });

    expect(check.estimatedMarginPercent.toNumber()).toBeCloseTo(15, 1);
  });

  it("throws instead of returning a nonsensical negative price when margin+fees exceed 100%", () => {
    expect(() =>
      suggestPrice({
        unitCost: 10,
        commissionPercent: 60,
        marketplaceFeePercent: 30,
        desiredMarginPercent: 20,
      }),
    ).toThrow();
  });

  it("always flags the result as an estimate (§67)", () => {
    const suggestion = suggestPrice({
      unitCost: 10,
      commissionPercent: 10,
      desiredMarginPercent: 20,
    });
    expect(suggestion.isEstimate).toBe(true);
  });
});

describe("simulatePrice", () => {
  it('answers "if I sell for R$59.90, what is left?" (§68)', () => {
    const result = simulatePrice({
      unitCost: 22,
      packagingCost: 1.5,
      commissionPercent: 14,
      taxPercent: 6,
      price: 59.9,
    });
    expect(result.estimatedProfit.toNumber()).toBeGreaterThan(0);
    expect(result.price.toFixed(2)).toBe("59.90");
  });
});

describe("calculateAdPerformance", () => {
  it("computes ROAS and ACOS from real spend/revenue only", () => {
    const perf = calculateAdPerformance({ spend: 100, attributedRevenue: 450, clicks: 50 });
    expect(perf.roas?.toFixed(2)).toBe("4.50");
    expect(perf.acos?.toFixed(2)).toBe("22.22");
    expect(perf.cpc?.toFixed(2)).toBe("2.00");
  });

  it("returns null rather than Infinity/NaN when spend is zero", () => {
    const perf = calculateAdPerformance({ spend: 0, attributedRevenue: 0 });
    expect(perf.roas).toBeNull();
    expect(perf.acos).toBeNull();
    expect(perf.cpc).toBeNull();
  });
});

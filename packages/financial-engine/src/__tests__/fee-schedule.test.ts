import { describe, expect, it } from "vitest";
import {
  SHOPEE_FEE_SCHEDULE,
  resolveBand,
  simulatePriceForSchedule,
  suggestPriceForSchedule,
} from "../fee-schedule";

describe("resolveBand — faixas da Shopee", () => {
  it("coloca cada preço na faixa correta, com limite superior exclusivo", () => {
    expect(resolveBand(SHOPEE_FEE_SCHEDULE, "7.99")!.commissionPercent).toBe(50);
    expect(resolveBand(SHOPEE_FEE_SCHEDULE, "8.00")!.fixedFeePerItem).toBe(4);
    expect(resolveBand(SHOPEE_FEE_SCHEDULE, "79.99")!.fixedFeePerItem).toBe(4);
    // R$80,00 troca de faixa: comissão cai para 14% mas o fixo salta para R$16.
    expect(resolveBand(SHOPEE_FEE_SCHEDULE, "80.00")!.fixedFeePerItem).toBe(16);
    expect(resolveBand(SHOPEE_FEE_SCHEDULE, "199.99")!.fixedFeePerItem).toBe(20);
    expect(resolveBand(SHOPEE_FEE_SCHEDULE, "200.00")!.fixedFeePerItem).toBe(26);
    expect(resolveBand(SHOPEE_FEE_SCHEDULE, "5000.00")!.fixedFeePerItem).toBe(26);
  });
});

describe("simulatePriceForSchedule", () => {
  it("aplica a comissão e o fixo da faixa do preço informado", () => {
    // R$100: 14% = R$14,00 + R$20 fixo. Custo R$30 => sobra 100-14-20-30 = 36.
    const sim = simulatePriceForSchedule({ unitCost: 30, price: 100 }, SHOPEE_FEE_SCHEDULE)!;

    expect(sim.band.fixedFeePerItem).toBe(20);
    expect(sim.fixedFeeApplied.toFixed(2)).toBe("20.00");
    expect(sim.result.estimatedProfit.toFixed(2)).toBe("36.00");
    expect(Number(sim.result.estimatedMarginPercent.toString())).toBeCloseTo(36, 2);
  });

  it("mostra a armadilha da troca de faixa: R$79,99 sobra mais que R$80,00", () => {
    const abaixo = simulatePriceForSchedule({ unitCost: 30, price: "79.99" }, SHOPEE_FEE_SCHEDULE)!;
    const acima = simulatePriceForSchedule({ unitCost: 30, price: "80.00" }, SHOPEE_FEE_SCHEDULE)!;

    // 79,99: 20% (16,00) + 4 fixo => sobra ~30,00
    // 80,00: 14% (11,20) + 16 fixo => sobra ~22,80
    expect(Number(abaixo.result.estimatedProfit.toFixed(2))).toBeGreaterThan(
      Number(acima.result.estimatedProfit.toFixed(2)),
    );
  });

  it("soma a taxa extra por item quando informada", () => {
    const sem = simulatePriceForSchedule({ unitCost: 30, price: 100 }, SHOPEE_FEE_SCHEDULE)!;
    const com = simulatePriceForSchedule(
      { unitCost: 30, price: 100, extraFixedFeePerItem: 3 },
      SHOPEE_FEE_SCHEDULE,
    )!;

    expect(com.fixedFeeApplied.toFixed(2)).toBe("23.00");
    expect(Number(sem.result.estimatedProfit.toFixed(2)) - Number(com.result.estimatedProfit.toFixed(2))).toBeCloseTo(3, 2);
  });
});

describe("suggestPriceForSchedule — resolve faixa a faixa", () => {
  it("só aceita o preço que cai dentro da própria faixa que o gerou", () => {
    const out = suggestPriceForSchedule(
      { unitCost: 30, desiredMarginPercent: 20 },
      SHOPEE_FEE_SCHEDULE,
    );

    for (const v of out.viable) {
      const price = Number(v.result.recommendedPrice.toFixed(4));
      expect(price).toBeGreaterThanOrEqual(Number(v.band.minPrice));
      if (v.band.maxPrice !== null) expect(price).toBeLessThan(Number(v.band.maxPrice));
    }
    expect(out.viable.length).toBeGreaterThan(0);
  });

  it("descarta as faixas cujo preço calculado cairia fora delas", () => {
    const out = suggestPriceForSchedule(
      { unitCost: 30, desiredMarginPercent: 20 },
      SHOPEE_FEE_SCHEDULE,
    );

    for (const r of out.rejected) {
      const price = Number(r.result.recommendedPrice.toFixed(4));
      const outside =
        price < Number(r.band.minPrice) ||
        (r.band.maxPrice !== null && price >= Number(r.band.maxPrice));
      expect(outside).toBe(true);
    }
  });

  it("o preço sugerido reproduz a margem pedida quando simulado de volta", () => {
    const out = suggestPriceForSchedule(
      { unitCost: 30, packagingCost: 2, desiredMarginPercent: 25, taxPercent: 6 },
      SHOPEE_FEE_SCHEDULE,
    );
    const best = out.viable[0]!;

    const back = simulatePriceForSchedule(
      { unitCost: 30, packagingCost: 2, taxPercent: 6, price: best.result.recommendedPrice.toFixed(4) },
      SHOPEE_FEE_SCHEDULE,
    )!;

    expect(Number(back.result.estimatedMarginPercent.toString())).toBeCloseTo(25, 1);
  });

  it("não retorna nada viável quando a margem é impossível em qualquer faixa", () => {
    // 90% de margem + 14% comissão + 6% imposto ultrapassa 100% do preço.
    const out = suggestPriceForSchedule(
      { unitCost: 30, desiredMarginPercent: 90, taxPercent: 6 },
      SHOPEE_FEE_SCHEDULE,
    );

    expect(out.viable).toHaveLength(0);
  });
});

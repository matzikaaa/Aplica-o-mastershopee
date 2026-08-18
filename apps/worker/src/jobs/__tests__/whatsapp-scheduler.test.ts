import { describe, expect, it } from "vitest";
import { buildDailySummaryMessage, zonedTime } from "../whatsapp-scheduler.js";

describe("buildDailySummaryMessage (§23 — resumo diário no WhatsApp)", () => {
  it("includes faturamento, lucro, margem, pedidos and ADS from the metric row", () => {
    const message = buildDailySummaryMessage("Loja do Marcos", {
      grossRevenue: "12482.20",
      netProfit: "2781.42",
      orderCount: 267,
      adSpend: "1084.72",
    });

    expect(message).toContain("Loja do Marcos");
    expect(message).toContain("267");
    expect(message).toMatch(/Margem: 22[.,]28%/);
    expect(message).toContain("💰");
    expect(message).toContain("💵");
  });

  it("does not divide by zero when yesterday had no revenue", () => {
    const message = buildDailySummaryMessage("Loja Vazia", {
      grossRevenue: "0",
      netProfit: "0",
      orderCount: 0,
      adSpend: "0",
    });
    expect(message).toMatch(/Margem: 0[.,]00%/);
    expect(message).not.toContain("NaN");
    expect(message).not.toContain("Infinity");
  });
});

describe("zonedTime (§63 — workspace timezone drives the daily-report schedule)", () => {
  it("returns a Date object usable for hour/minute comparisons", () => {
    const result = zonedTime("America/Sao_Paulo");
    expect(result).toBeInstanceOf(Date);
    expect(result.getHours()).toBeGreaterThanOrEqual(0);
    expect(result.getHours()).toBeLessThan(24);
  });

  it("produces different wall-clock hours for timezones with a real offset gap", () => {
    // Tokyo is always at least 10h ahead of São Paulo — never the same wall-clock hour.
    const saoPaulo = zonedTime("America/Sao_Paulo");
    const tokyo = zonedTime("Asia/Tokyo");
    expect(saoPaulo.getHours()).not.toBe(tokyo.getHours());
  });
});

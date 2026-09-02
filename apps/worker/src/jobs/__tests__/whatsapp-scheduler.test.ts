import { describe, expect, it } from "vitest";
import {
  buildDailySummaryMessage,
  morningBriefParams,
  stockSummaryLine,
  zonedTime,
} from "@mastershopee/shared";

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

describe("resumo da manhã — resultado e estoque na mesma mensagem", () => {
  const metric = { grossRevenue: 1000, netProfit: 250, orderCount: 12, adSpend: 80 };

  it("lista os produtos a repor, zerado marcado", () => {
    const texto = buildDailySummaryMessage("Archi Store", metric, "ontem", [
      { productName: "Kit 2 Rolos", sku: "LAVANDROLL-2", quantity: 0, daysOfCover: 0, isOutOfStock: true },
      { productName: "Veda Porta", sku: "VEDAPORT-1", quantity: 7, daysOfCover: 3.4, isOutOfStock: false },
    ]);

    expect(texto).toContain("LAVANDROLL-2 — 0 un, ZERADO");
    expect(texto).toContain("VEDAPORT-1 — 7 un, 3 dias de cobertura");
  });

  it("diz que está tudo certo em vez de omitir estoque", () => {
    // Silêncio sobre estoque é indistinguível de uma verificação que não rodou.
    expect(buildDailySummaryMessage("Archi Store", metric, "ontem", [])).toContain(
      "nenhum produto precisa de reposição",
    );
  });

  it("corta a lista em cinco e diz quantos ficaram de fora", () => {
    const itens = Array.from({ length: 8 }, (_, i) => ({
      productName: `P${i}`,
      sku: `SKU-${i}`,
      quantity: 1,
      daysOfCover: 1,
      isOutOfStock: false,
    }));
    const texto = buildDailySummaryMessage("Archi Store", metric, "ontem", itens);

    expect(texto).toContain("SKU-4");
    expect(texto).not.toContain("SKU-5 —");
    expect(texto).toContain("e mais 3 produto(s)");
  });

  it("o placar do template cabe numa linha, que é o que a Meta aceita", () => {
    const linha = stockSummaryLine([
      { productName: "A", sku: "A", quantity: 0, daysOfCover: 0, isOutOfStock: true },
      { productName: "B", sku: "B", quantity: 2, daysOfCover: 1, isOutOfStock: false },
    ]);
    expect(linha).toBe("Estoque: 2 produto(s) para repor, 1 zerado(s)");
    expect(linha).not.toContain("\n");
  });

  it("o template combinado tem os 6 do relatório mais o estoque", () => {
    const params = morningBriefParams("Archi Store", metric, []);
    expect(params).toHaveLength(7);
    expect(params[6]).toBe("Estoque: tudo certo");
  });
});

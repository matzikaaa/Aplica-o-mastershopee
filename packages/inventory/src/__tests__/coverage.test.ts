import { describe, expect, it } from "vitest";
import { averageDailySales, calculateStockCoverage, projectStockoutDate } from "../coverage";

describe("calculateStockCoverage — ponto de reposição", () => {
  it("alerta quando a cobertura cai no prazo do fornecedor mais a folga", () => {
    // O cenário do brief: fornecedor entrega em 5 dias, operador quer 3 dias
    // de folga => precisa comprar enquanto ainda restam 8 dias de estoque.
    // 16 unidades vendendo 2/dia = 8 dias exatos, o limite.
    const c = calculateStockCoverage({ quantity: 16, averageDailySales: 2, leadTimeDays: 5, safetyDays: 3 });

    expect(c.reorderPointDays).toBe(8);
    expect(c.daysOfCover).toBe(8);
    expect(c.needsReorder).toBe(true);
  });

  it("não alerta enquanto a cobertura está acima do ponto de reposição", () => {
    // 20 unidades a 2/dia = 10 dias de cobertura, acima dos 8 do ponto.
    const c = calculateStockCoverage({ quantity: 20, averageDailySales: 2, leadTimeDays: 5, safetyDays: 3 });

    expect(c.daysOfCover).toBe(10);
    expect(c.needsReorder).toBe(false);
    expect(c.isOutOfStock).toBe(false);
  });

  it("sugere comprar o suficiente para voltar ao ponto de reposição", () => {
    // Ponto = 8 dias x 2/dia = 16 unidades alvo; tem 6 => faltam 10.
    const c = calculateStockCoverage({ quantity: 6, averageDailySales: 2, leadTimeDays: 5, safetyDays: 3 });

    expect(c.suggestedPurchaseUnits).toBe(10);
    expect(c.needsReorder).toBe(true);
  });

  it("marca ruptura quando o estoque zerou e o produto ainda vende", () => {
    const c = calculateStockCoverage({ quantity: 0, averageDailySales: 3, leadTimeDays: 5, safetyDays: 3 });

    expect(c.isOutOfStock).toBe(true);
    expect(c.needsReorder).toBe(true);
    expect(c.daysOfCover).toBe(0);
  });

  it("não inventa projeção para produto sem vendas no período", () => {
    const c = calculateStockCoverage({ quantity: 4, averageDailySales: 0, leadTimeDays: 5, safetyDays: 3 });

    expect(c.daysOfCover).toBeNull();
    expect(c.suggestedPurchaseUnits).toBeNull();
    expect(c.needsReorder).toBe(false);
    // Estoque baixo sem demanda não é urgência — alertar aqui seria ruído.
    expect(c.isOutOfStock).toBe(false);
  });

  it("sem prazo nem folga configurados, só alerta ao zerar", () => {
    const comEstoque = calculateStockCoverage({ quantity: 5, averageDailySales: 1, leadTimeDays: 0, safetyDays: 0 });
    expect(comEstoque.needsReorder).toBe(false);

    const zerado = calculateStockCoverage({ quantity: 0, averageDailySales: 1, leadTimeDays: 0, safetyDays: 0 });
    expect(zerado.needsReorder).toBe(true);
  });

  it("trata quantidade negativa como zero em vez de propagar o erro", () => {
    const c = calculateStockCoverage({ quantity: -3, averageDailySales: 1, leadTimeDays: 2, safetyDays: 1 });
    expect(c.daysOfCover).toBe(0);
    expect(c.isOutOfStock).toBe(true);
  });
});

describe("projectStockoutDate", () => {
  it("projeta a data de ruptura a partir da cobertura", () => {
    const from = new Date("2026-03-10T00:00:00Z");
    const c = calculateStockCoverage({ quantity: 10, averageDailySales: 2, leadTimeDays: 0, safetyDays: 0 });

    const date = projectStockoutDate(c, from);
    expect(date?.toISOString().slice(0, 10)).toBe("2026-03-15"); // 5 dias depois
  });

  it("retorna null quando não há velocidade de venda", () => {
    const c = calculateStockCoverage({ quantity: 10, averageDailySales: 0, leadTimeDays: 0, safetyDays: 0 });
    expect(projectStockoutDate(c)).toBeNull();
  });
});

describe("averageDailySales", () => {
  it("divide pelo período inteiro, não pelos dias com venda", () => {
    // 7 unidades num único dia de uma janela de 7 dias é 1/dia.
    expect(averageDailySales(7, 7)).toBe(1);
  });

  it("é zero para janela inválida em vez de dividir por zero", () => {
    expect(averageDailySales(10, 0)).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import {
  chaveDoDia,
  dataDoDia,
  diasDoPeriodo,
  fimDoDia,
  horarioDeParedeNoFuso,
  inicioDoDia,
  previousPeriod,
  resolveDateRange,
  somarDias,
} from "../date-range.js";

const TZ = "America/Sao_Paulo";

describe("dias no fuso do workspace", () => {
  // O motivo desta mudança: o servidor roda em UTC e o dia virava às 21h de
  // Brasília. Uma venda às 22h30 do dia 11 entrava no dia 12.
  it("uma venda às 22h30 de Brasília é do mesmo dia, não do seguinte", () => {
    const venda = new Date("2026-10-12T01:30:00Z"); // 22h30 do dia 11 em Brasília
    expect(chaveDoDia(venda, TZ)).toBe("2026-10-11");
    expect(chaveDoDia(venda, "UTC")).toBe("2026-10-12");
  });

  it("a meia-noite de Brasília é 03:00 UTC", () => {
    expect(inicioDoDia("2026-10-11", TZ).toISOString()).toBe("2026-10-11T03:00:00.000Z");
    expect(fimDoDia("2026-10-11", TZ).toISOString()).toBe("2026-10-12T02:59:59.999Z");
  });

  it("acerta a meia-noite também em fuso com horário de verão", () => {
    // Nova York: 9 de março de 2025 começa em −05:00 e vira −04:00 às 2h.
    expect(inicioDoDia("2025-03-09", "America/New_York").toISOString()).toBe("2025-03-09T05:00:00.000Z");
    expect(inicioDoDia("2025-03-10", "America/New_York").toISOString()).toBe("2025-03-10T04:00:00.000Z");
  });

  it("o horário do relatório da Shopee é lido como horário de Brasília", () => {
    const lido = new Date(2026, 9, 12, 1, 15, 0); // "12/10/2026 01:15", como parseBrDate devolve
    const instante = horarioDeParedeNoFuso(lido, TZ);
    expect(instante.toISOString()).toBe("2026-10-12T04:15:00.000Z");
    expect(chaveDoDia(instante, TZ)).toBe("2026-10-12");
  });

  it("soma dias atravessando mês e ano", () => {
    expect(somarDias("2026-02-28", 1)).toBe("2026-03-01");
    expect(somarDias("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("colunas de data sem hora recebem a meia-noite UTC do dia", () => {
    expect(dataDoDia("2026-10-11").toISOString()).toBe("2026-10-11T00:00:00.000Z");
  });
});

describe("resolveDateRange (§10)", () => {
  it("'hoje' às 22h30 de Brasília ainda é o dia 11 inteiro, das 00h às 23h59", () => {
    const range = resolveDateRange("today", TZ, new Date("2026-10-12T01:30:00Z"));
    expect(range.fromKey).toBe("2026-10-11");
    expect(range.toKey).toBe("2026-10-11");
    expect(range.from.toISOString()).toBe("2026-10-11T03:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-10-12T02:59:59.999Z");
  });

  it("last_7_days spans exactly 7 calendar days ending today", () => {
    const range = resolveDateRange("last_7_days", TZ, new Date("2026-10-11T15:00:00Z"));
    expect(range.fromKey).toBe("2026-10-05");
    expect(range.toKey).toBe("2026-10-11");
    const dias = Math.round((range.to.getTime() + 1 - range.from.getTime()) / 86_400_000);
    expect(dias).toBe(7);
  });

  it("last_month resolves to the full previous calendar month", () => {
    const range = resolveDateRange("last_month", TZ, new Date("2026-03-15T15:00:00Z"));
    expect(range.fromKey).toBe("2026-02-01");
    expect(range.toKey).toBe("2026-02-28");
  });

  it("this_month vai do dia 1 até hoje", () => {
    const range = resolveDateRange("this_month", TZ, new Date("2026-10-11T15:00:00Z"));
    expect(range.fromKey).toBe("2026-10-01");
    expect(range.toKey).toBe("2026-10-11");
  });

  it("o filtro de colunas de data usa as chaves, não os instantes", () => {
    const range = resolveDateRange("today", TZ, new Date("2026-10-11T15:00:00Z"));
    expect(diasDoPeriodo(range)).toEqual({
      gte: new Date("2026-10-11T00:00:00.000Z"),
      lte: new Date("2026-10-11T00:00:00.000Z"),
    });
  });
});

describe("previousPeriod (§48 — hoje x ontem comparisons)", () => {
  it("returns an equal-length window immediately preceding the given range", () => {
    const range = resolveDateRange("last_7_days", TZ, new Date("2026-01-14T15:00:00Z"));
    const prev = previousPeriod(range);
    // `previousPeriod` devolve null para intervalo inválido; afirmar aqui é
    // o que faz o teste falhar por isso em vez de por acesso a null.
    expect(prev).not.toBeNull();
    if (!prev) return;
    expect(prev.fromKey).toBe("2026-01-01");
    expect(prev.toKey).toBe("2026-01-07");
    expect(prev.to.getTime()).toBe(range.from.getTime() - 1);
  });

  it("'hoje' compara com 'ontem'", () => {
    const prev = previousPeriod(resolveDateRange("today", TZ, new Date("2026-10-11T15:00:00Z")));
    expect(prev?.fromKey).toBe("2026-10-10");
    expect(prev?.toKey).toBe("2026-10-10");
  });
});

describe("all_time — resultado total", () => {
  it("cobre desde antes de qualquer marketplace existir ate o fim de hoje", () => {
    const range = resolveDateRange("all_time", TZ, new Date("2026-08-21T15:00:00Z"));
    expect(range.fromKey).toBe("2000-01-01");
    expect(range.toKey).toBe("2026-08-21");
  });

  it("nao tem periodo anterior — comparar contra o vazio seria numero inventado", () => {
    const range = resolveDateRange("all_time", TZ);
    expect(previousPeriod(range)).toBeNull();
  });

  it("os demais periodos continuam tendo um anterior", () => {
    const range = resolveDateRange("last_30_days", TZ);
    expect(previousPeriod(range)).not.toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { resolveDateRange, previousPeriod } from "../date-range.js";

const TZ = "America/Sao_Paulo";

describe("resolveDateRange (§10)", () => {
  it("today spans the full current day", () => {
    const range = resolveDateRange("today", TZ);
    expect(range.from.getHours()).toBe(0);
    expect(range.to.getHours()).toBe(23);
  });

  it("last_7_days spans exactly 7 calendar days ending today", () => {
    const range = resolveDateRange("last_7_days", TZ);
    const days = Math.round((range.to.getTime() - range.from.getTime()) / (24 * 3600 * 1000));
    expect(days).toBe(7); // from 00:00 six days ago through 23:59:59.999 today => 7 calendar days
  });

  it("last_month resolves to the full previous calendar month", () => {
    const now = new Date(2026, 2, 15); // March 15, 2026
    const range = resolveDateRange("last_month", TZ, now);
    expect(range.from.getMonth()).toBe(1); // February
    expect(range.to.getMonth()).toBe(1);
  });
});

describe("previousPeriod (§48 — hoje x ontem comparisons)", () => {
  it("returns an equal-length window immediately preceding the given range", () => {
    const range = { from: new Date(2026, 0, 8), to: new Date(2026, 0, 14, 23, 59, 59, 999) };
    const prev = previousPeriod(range);
    // `previousPeriod` devolve null para intervalo inválido; afirmar aqui é
    // o que faz o teste falhar por isso em vez de por acesso a null.
    expect(prev).not.toBeNull();
    if (!prev) return;
    const rangeLengthMs = range.to.getTime() - range.from.getTime();
    const prevLengthMs = prev.to.getTime() - prev.from.getTime();
    expect(Math.round(prevLengthMs / 1000)).toBe(Math.round(rangeLengthMs / 1000));
    expect(prev.to.getTime()).toBeLessThan(range.from.getTime());
  });
});

describe("all_time — resultado total", () => {
  it("cobre desde antes de qualquer marketplace existir ate o fim de hoje", () => {
    const range = resolveDateRange("all_time", "America/Sao_Paulo", new Date("2026-08-21T15:00:00Z"));
    expect(range.from.getFullYear()).toBeLessThanOrEqual(2000);
    expect(range.to.getHours()).toBe(23);
    expect(range.to.getMinutes()).toBe(59);
  });

  it("nao tem periodo anterior — comparar contra o vazio seria numero inventado", () => {
    const range = resolveDateRange("all_time", "America/Sao_Paulo");
    expect(previousPeriod(range)).toBeNull();
  });

  it("os demais periodos continuam tendo um anterior", () => {
    const range = resolveDateRange("last_30_days", "America/Sao_Paulo");
    expect(previousPeriod(range)).not.toBeNull();
  });
});

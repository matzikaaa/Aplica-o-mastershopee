import { describe, expect, it } from "vitest";
import { Money } from "../money.js";

describe("Money — never float, always Decimal (§62)", () => {
  it("adds/subtracts without floating point drift", () => {
    const a = Money.of("0.1");
    const b = Money.of("0.2");
    expect(a.add(b).toFixed(2)).toBe("0.30");
  });

  it("throws on currency mismatch instead of silently mixing currencies", () => {
    const brl = Money.of(10, "BRL");
    const usd = Money.of(10, "USD");
    expect(() => brl.add(usd)).toThrow(/Currency mismatch/);
  });

  it("percentOf returns 0 instead of dividing by zero", () => {
    const value = Money.of(50);
    const base = Money.zero();
    expect(value.percentOf(base).toNumber()).toBe(0);
  });

  it("sum() aggregates a list of Money values", () => {
    const total = Money.sum([Money.of(10), Money.of(20), Money.of(30)]);
    expect(total.toFixed(2)).toBe("60.00");
  });

  it("formats as Brazilian currency", () => {
    expect(Money.of(1234.5).format()).toContain("1.234,50");
  });
});

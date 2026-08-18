import Decimal from "decimal.js";

/**
 * All money in the system flows through this type. Never use `number`/float
 * for currency — Decimal avoids the rounding drift that would otherwise
 * silently corrupt profit calculations over millions of orders.
 */
export class Money {
  private readonly value: Decimal;
  readonly currency: string;

  private constructor(value: Decimal.Value, currency: string) {
    this.value = new Decimal(value);
    this.currency = currency;
  }

  static of(value: Decimal.Value, currency = "BRL"): Money {
    return new Money(value, currency);
  }

  static zero(currency = "BRL"): Money {
    return new Money(0, currency);
  }

  private assertSameCurrency(other: Money) {
    if (other.currency !== this.currency) {
      throw new Error(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  multiply(factor: Decimal.Value): Money {
    return new Money(this.value.times(factor), this.currency);
  }

  divide(divisor: Decimal.Value): Money {
    return new Money(this.value.dividedBy(divisor), this.currency);
  }

  percentOf(base: Money): Decimal {
    if (base.value.isZero()) return new Decimal(0);
    return this.value.dividedBy(base.value).times(100);
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  toDecimal(): Decimal {
    return this.value;
  }

  toNumber(): number {
    return this.value.toNumber();
  }

  /** Rounds to the currency's minor unit (2 decimals for BRL) for storage/display. */
  toFixed(decimals = 2): string {
    return this.value.toFixed(decimals, Decimal.ROUND_HALF_UP);
  }

  format(locale = "pt-BR"): string {
    return new Intl.NumberFormat(locale, { style: "currency", currency: this.currency }).format(
      this.value.toNumber(),
    );
  }

  static sum(items: Money[], currency = "BRL"): Money {
    return items.reduce((acc, m) => acc.add(m), Money.zero(currency));
  }
}

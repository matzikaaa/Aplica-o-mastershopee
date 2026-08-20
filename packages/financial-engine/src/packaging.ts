import Decimal from "decimal.js";
import { Money } from "@mastershopee/shared";

/**
 * Packaging cost per shipment (§67 — feeds the price calculator).
 *
 * Packaging is almost always bought in bulk — a roll of 100 bags, a box of
 * 500 labels — while the price calculator needs the cost of *one* shipment.
 * Doing that division by hand is where operators lose cents that quietly
 * eat the margin, so it is done here, with the same Decimal discipline as
 * the rest of the money code (§62).
 */

export interface PackagingComponent {
  name: string;
  /** What was paid for the whole pack. */
  packPrice: Decimal.Value;
  /** How many units come in that pack. */
  unitsPerPack: Decimal.Value;
  /** How many of those units one shipment consumes. Defaults to 1. */
  unitsUsed?: Decimal.Value;
}

export interface PackagingLine {
  name: string;
  costPerUnit: Money;
  unitsUsed: Decimal;
  subtotal: Money;
}

export interface PackagingCostResult {
  currency: string;
  lines: PackagingLine[];
  totalPerShipment: Money;
}

export function calculatePackagingCost(
  components: PackagingComponent[],
  currency = "BRL",
): PackagingCostResult {
  const lines: PackagingLine[] = [];
  let total = Money.of(0, currency);

  for (const component of components) {
    const unitsPerPack = new Decimal(component.unitsPerPack);
    if (unitsPerPack.lte(0)) {
      throw new Error(
        `"${component.name}": informe quantas unidades vêm no pacote (precisa ser maior que zero).`,
      );
    }

    const unitsUsed = new Decimal(component.unitsUsed ?? 1);
    if (unitsUsed.lt(0)) {
      throw new Error(`"${component.name}": a quantidade usada por envio não pode ser negativa.`);
    }

    const costPerUnit = Money.of(component.packPrice, currency).divide(unitsPerPack);
    const subtotal = costPerUnit.multiply(unitsUsed);

    lines.push({ name: component.name, costPerUnit, unitsUsed, subtotal });
    total = total.add(subtotal);
  }

  return { currency, lines, totalPerShipment: total };
}

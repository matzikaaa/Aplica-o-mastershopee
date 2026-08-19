/**
 * Reorder maths — the single place that decides whether a product is about
 * to run out (§60: one implementation, never duplicated per screen/job).
 *
 * Framework-free and side-effect-free on purpose: the worker calls it to
 * decide whether to raise an alert, and the dashboard calls it to render the
 * same verdict, so the two can never disagree about what "low stock" means.
 */

export interface StockCoverageInput {
  /** Units currently on hand. */
  quantity: number;
  /** Units sold per day, averaged over a recent window. */
  averageDailySales: number;
  /** Days the supplier takes to deliver after an order is placed. */
  leadTimeDays: number;
  /** Extra days of slack the operator wants on top of the lead time. */
  safetyDays: number;
}

export interface StockCoverage {
  /**
   * How many days the current quantity lasts at the current sales pace.
   * `null` when there were no sales in the window — with no velocity there
   * is no honest way to project a stockout date, and guessing one would be
   * exactly the kind of invented number this project refuses to show (§96).
   */
  daysOfCover: number | null;
  /** Cover below which an order must be placed to avoid running dry. */
  reorderPointDays: number;
  needsReorder: boolean;
  /** Already at zero with demand on the product. */
  isOutOfStock: boolean;
  /**
   * Units to buy so that stock returns to the reorder point.
   * `null` whenever `daysOfCover` is null — same reasoning.
   */
  suggestedPurchaseUnits: number | null;
}

export function calculateStockCoverage(input: StockCoverageInput): StockCoverage {
  const quantity = Math.max(0, Math.trunc(input.quantity));
  const velocity = Math.max(0, input.averageDailySales);
  const reorderPointDays = Math.max(0, input.leadTimeDays) + Math.max(0, input.safetyDays);

  // No sales in the window: the product isn't consuming stock, so there is
  // nothing to project and nothing to reorder for.
  if (velocity === 0) {
    return {
      daysOfCover: null,
      reorderPointDays,
      needsReorder: false,
      isOutOfStock: false,
      suggestedPurchaseUnits: null,
    };
  }

  const daysOfCover = quantity / velocity;
  const targetUnits = Math.ceil(velocity * reorderPointDays);

  return {
    daysOfCover,
    reorderPointDays,
    needsReorder: daysOfCover <= reorderPointDays,
    isOutOfStock: quantity === 0,
    suggestedPurchaseUnits: Math.max(0, targetUnits - quantity),
  };
}

/**
 * Date the product is projected to hit zero, or `null` when there is no
 * sales velocity to project from.
 */
export function projectStockoutDate(coverage: StockCoverage, from: Date = new Date()): Date | null {
  if (coverage.daysOfCover === null) return null;
  return new Date(from.getTime() + coverage.daysOfCover * 24 * 60 * 60 * 1000);
}

/**
 * Average units sold per day over `windowDays`. Deliberately divides by the
 * full window rather than by days that happened to have sales: a product
 * that sold 7 units on one day of a 7-day window moves 1/day, not 7/day, and
 * the optimistic reading would delay the reorder alert past the lead time.
 */
export function averageDailySales(unitsSoldInWindow: number, windowDays: number): number {
  if (windowDays <= 0) return 0;
  return Math.max(0, unitsSoldInWindow) / windowDays;
}

import type { OrderStatus } from "@prisma/client";

/**
 * Statuses that never represent money the seller keeps.
 *
 * A cancelled order still exists as a row — the marketplace exports it and we
 * import it, because "the order was cancelled" is itself information the
 * operator needs. What it must never do is count as revenue. In a real Shopee
 * export roughly one order in seven lands here, so leaving these in inflates
 * revenue by double digits while every individual number still looks right.
 *
 * Every place that sums money out of orders filters on this list; the orders
 * *list* deliberately does not, so cancellations stay visible.
 */
export const NON_REVENUE_ORDER_STATUSES: OrderStatus[] = ["CANCELED", "REFUNDED", "RETURNED"];

/** Spread into a Prisma `where` to keep only orders that count as revenue. */
export const revenueOrdersWhere = { status: { notIn: NON_REVENUE_ORDER_STATUSES } } as const;

export function countsAsRevenue(status: OrderStatus): boolean {
  return !NON_REVENUE_ORDER_STATUSES.includes(status);
}

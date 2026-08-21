import { Prisma, type StockMovementType } from "@prisma/client";
import { prisma } from "./index";
import { revenueOrdersWhere } from "./order-status";

/**
 * Stock ledger operations. Every balance change goes through here so the
 * StockMovement history and StockItem.quantity are always written together,
 * inside one transaction — a balance that drifts from its own ledger is
 * unauditable, and this is the only thing standing between the operator and
 * a number they cannot explain.
 */

export interface RecordMovementInput {
  workspaceId: string;
  productId: string;
  type: StockMovementType;
  /** Always positive: direction comes from `type`, not from the caller's sign. */
  units: number;
  note?: string;
  createdByUserId?: string;
  /** Set for marketplace sales — makes the movement idempotent. */
  orderItemId?: string;
  occurredAt?: Date;
}

const INBOUND: StockMovementType[] = ["PURCHASE_IN", "RETURN_IN", "CANCELLATION_IN"];

/** Ensures a StockItem row exists for the product, returning it. */
export async function ensureStockItem(workspaceId: string, productId: string) {
  return prisma.stockItem.upsert({
    where: { productId },
    update: {},
    create: { workspaceId, productId, quantity: 0 },
  });
}

/**
 * Applies one movement and returns the resulting balance, or `null` when the
 * movement was already recorded (same `orderItemId`) and was therefore
 * skipped.
 *
 * ADJUSTMENT treats `units` as the signed delta the caller asked for; every
 * other type derives its sign from the direction table above.
 */
export async function recordStockMovement(input: RecordMovementInput): Promise<number | null> {
  const signedDelta =
    input.type === "ADJUSTMENT"
      ? Math.trunc(input.units)
      : (INBOUND.includes(input.type) ? 1 : -1) * Math.abs(Math.trunc(input.units));

  if (signedDelta === 0) return null;

  try {
    return await prisma.$transaction(async (tx) => {
      const item = await tx.stockItem.upsert({
        where: { productId: input.productId },
        update: {},
        create: { workspaceId: input.workspaceId, productId: input.productId, quantity: 0 },
      });

      // Stock is allowed to go negative rather than being clamped at zero:
      // a marketplace can legitimately report a sale the operator never
      // registered as received, and silently absorbing it would hide a real
      // bookkeeping gap behind a tidy-looking zero.
      const balanceAfter = item.quantity + signedDelta;

      await tx.stockMovement.create({
        data: {
          workspaceId: input.workspaceId,
          stockItemId: item.id,
          type: input.type,
          quantity: signedDelta,
          balanceAfter,
          orderItemId: input.orderItemId,
          note: input.note,
          createdByUserId: input.createdByUserId,
          occurredAt: input.occurredAt ?? new Date(),
        },
      });

      await tx.stockItem.update({
        where: { id: item.id },
        data: {
          quantity: balanceAfter,
          // Any inbound movement clears the "already warned" flag so a later
          // shortage can alert again.
          ...(signedDelta > 0 ? { lowStockNotifiedAt: null } : {}),
        },
      });

      return balanceAfter;
    });
  } catch (err) {
    // P2002 on orderItemId: this sale is already in the ledger. Marketplace
    // syncs re-read the same orders on every run, so this is the expected
    // path, not an error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && input.orderItemId) {
      return null;
    }
    throw err;
  }
}

/**
 * Deducts the units of one sold order item. Safe to call repeatedly for the
 * same item — the second call is a no-op.
 */
export async function applySaleToStock(params: {
  workspaceId: string;
  productId: string;
  orderItemId: string;
  units: number;
  occurredAt?: Date;
  note?: string;
}): Promise<number | null> {
  return recordStockMovement({
    workspaceId: params.workspaceId,
    productId: params.productId,
    type: "SALE_OUT",
    units: params.units,
    orderItemId: params.orderItemId,
    occurredAt: params.occurredAt,
    note: params.note,
  });
}

/**
 * Gives units back when a sale is cancelled, refunded or returned.
 *
 * Returns `null` — changing nothing — unless that exact order item was
 * actually deducted before. An order that arrives already cancelled never
 * consumed stock, so crediting it would invent units that were never there;
 * and the `reversal:` key makes the credit itself idempotent across syncs.
 */
export async function reverseSaleFromStock(params: {
  workspaceId: string;
  productId: string;
  orderItemId: string;
  units: number;
  type: Extract<StockMovementType, "CANCELLATION_IN" | "RETURN_IN">;
  note?: string;
}): Promise<number | null> {
  const original = await prisma.stockMovement.findUnique({
    where: { orderItemId: params.orderItemId },
  });
  if (!original || original.type !== "SALE_OUT") return null;

  return recordStockMovement({
    workspaceId: params.workspaceId,
    productId: params.productId,
    type: params.type,
    units: params.units,
    orderItemId: `reversal:${params.orderItemId}`,
    note: params.note,
  });
}

/**
 * Units sold per product over the last `windowDays`, used as the demand
 * signal for reorder alerts. Counts actual order items rather than metric
 * rollups so it stays correct even before the daily aggregation job runs.
 */
export async function unitsSoldPerProduct(
  workspaceId: string,
  windowDays: number,
): Promise<Map<string, number>> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await prisma.orderItem.groupBy({
    by: ["productId"],
    where: {
      productId: { not: null },
      order: {
        workspaceId,
        orderedAt: { gte: since },
        // Cancelled and refunded orders never consumed stock.
        ...revenueOrdersWhere,
      },
    },
    _sum: { quantity: true },
  });

  const result = new Map<string, number>();
  for (const row of rows) {
    if (row.productId) result.set(row.productId, row._sum.quantity ?? 0);
  }
  return result;
}

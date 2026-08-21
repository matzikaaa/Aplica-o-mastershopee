import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __mastershopeePrisma: PrismaClient | undefined;
}

// Reuse a single client across hot-reloads in dev and across serverless
// invocations that share a warm container.
export const prisma =
  globalThis.__mastershopeePrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__mastershopeePrisma = prisma;
}

export * from "@prisma/client";

export {
  NON_REVENUE_ORDER_STATUSES,
  revenueOrdersWhere,
  countsAsRevenue,
} from "./order-status";

export {
  mergeProducts,
  resolveProductBySku,
  type MergeProductsInput,
  type MergeProductsResult,
} from "./product-merge";

export {
  computeDailyMetrics,
  recomputeMetricsForDays,
  backfillMissingCostSnapshots,
  type ComputeMetricsInput,
} from "./metrics";

export {
  ensureStockItem,
  recordStockMovement,
  applySaleToStock,
  reverseSaleFromStock,
  unitsSoldPerProduct,
  type RecordMovementInput,
} from "./stock";

export {
  effectiveMarketplaceRates,
  allEffectiveMarketplaceRates,
  type EffectiveRates,
} from "./marketplace-rates";

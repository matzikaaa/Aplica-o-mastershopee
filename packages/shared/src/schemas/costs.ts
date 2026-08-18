import { z } from "zod";

export const productCostSchema = z.object({
  productId: z.string().cuid(),
  unitCost: z.number().nonnegative(),
  packagingCost: z.number().nonnegative().default(0),
  operationalCost: z.number().nonnegative().default(0),
  taxPercent: z.number().min(0).max(100).default(0),
  otherCosts: z.number().nonnegative().default(0),
  effectiveFrom: z.coerce.date(),
});
export type ProductCostInput = z.infer<typeof productCostSchema>;

export const bulkCostRowSchema = z.object({
  sku: z.string().min(1),
  cost: z.number().nonnegative(),
  packaging: z.number().nonnegative().default(0),
  tax: z.number().min(0).max(100).default(0),
  otherCosts: z.number().nonnegative().default(0),
});
export type BulkCostRow = z.infer<typeof bulkCostRowSchema>;

export interface BulkImportResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; sku?: string; message: string }>;
}

import { prisma } from "./index";

export interface MergeProductsInput {
  workspaceId: string;
  /** SKU that stays — all history ends up here. */
  keepSku: string;
  /** SKU that disappears as a product and becomes an alias of the one kept. */
  mergeSku: string;
  userId?: string;
}

export interface MergeProductsResult {
  keptProductId: string;
  keptSku: string;
  mergedSku: string;
  orderItemsMoved: number;
  costsMoved: number;
  stockMovementsMoved: number;
  unitsTransferred: number;
  aliasesInherited: string[];
}

/**
 * Fold one product into another, keeping every historical row.
 *
 * The case this exists for is a mistyped SKU in the marketplace's own
 * catalogue: the same physical product sells under two codes, so its orders,
 * costs and stock are split across two products that should never have been
 * two. Merging moves the history rather than deleting it, and registers the
 * disappearing SKU as an alias so the next import of the same spreadsheet
 * resolves it to the surviving product instead of recreating the split.
 *
 * Runs in a single transaction: a half-merged catalogue — orders moved but
 * stock left behind — would be worse than no merge at all.
 */
export async function mergeProducts(input: MergeProductsInput): Promise<MergeProductsResult> {
  const { workspaceId, keepSku, mergeSku, userId } = input;

  if (keepSku === mergeSku) {
    throw new Error("Os dois SKUs são o mesmo — não há o que unificar.");
  }

  return prisma.$transaction(async (tx) => {
    const keep = await tx.product.findUnique({
      where: { workspaceId_sku: { workspaceId, sku: keepSku } },
      include: { stockItem: true },
    });
    const merge = await tx.product.findUnique({
      where: { workspaceId_sku: { workspaceId, sku: mergeSku } },
      include: { stockItem: true, skuAliases: true },
    });

    if (!keep) throw new Error(`SKU ${keepSku} não existe neste workspace.`);
    if (!merge) throw new Error(`SKU ${mergeSku} não existe neste workspace.`);

    const orderItems = await tx.orderItem.updateMany({
      where: { productId: merge.id },
      data: { productId: keep.id },
    });

    // Cost history moves as-is: both timelines belong to the same physical
    // product, and the "cost effective on the order date" lookup already
    // reads whichever entry was in force.
    const costs = await tx.productCost.updateMany({
      where: { productId: merge.id },
      data: { productId: keep.id },
    });

    await tx.marketplaceProduct.updateMany({
      where: { productId: merge.id },
      data: { productId: keep.id },
    });

    // Pre-aggregated metrics are derived, and (workspace, product, date) is
    // unique — moving them would collide. They are dropped and recomputed.
    await tx.productMetric.deleteMany({ where: { productId: merge.id } });

    let stockMovementsMoved = 0;
    let unitsTransferred = 0;

    if (merge.stockItem) {
      const target =
        keep.stockItem ??
        (await tx.stockItem.create({ data: { workspaceId, productId: keep.id, quantity: 0 } }));

      const moved = await tx.stockMovement.updateMany({
        where: { stockItemId: merge.stockItem.id },
        data: { stockItemId: target.id },
      });
      stockMovementsMoved = moved.count;
      unitsTransferred = merge.stockItem.quantity;

      // The moved rows keep the balanceAfter they had on the old SKU's own
      // ledger — that is what the balance genuinely was at the time, and
      // rewriting history to make the merged chain look continuous would be
      // fabrication. This adjustment is the visible seam that explains the
      // jump and carries the balance across.
      if (unitsTransferred !== 0) {
        const balanceAfter = target.quantity + unitsTransferred;
        await tx.stockMovement.create({
          data: {
            workspaceId,
            stockItemId: target.id,
            type: "ADJUSTMENT",
            quantity: unitsTransferred,
            balanceAfter,
            note: `Saldo transferido do SKU ${mergeSku} na unificação`,
            createdByUserId: userId,
          },
        });
        await tx.stockItem.update({ where: { id: target.id }, data: { quantity: balanceAfter } });
      }

      await tx.stockItem.delete({ where: { id: merge.stockItem.id } });
    }

    // Aliases the disappearing product had collected itself must follow it,
    // or a second merge would strand them.
    const aliasesInherited = merge.skuAliases.map((a) => a.sku);
    await tx.productSkuAlias.updateMany({
      where: { productId: merge.id },
      data: { productId: keep.id },
    });

    await tx.productSkuAlias.create({
      data: { workspaceId, productId: keep.id, sku: mergeSku, mergedByUserId: userId },
    });

    await tx.product.delete({ where: { id: merge.id } });

    return {
      keptProductId: keep.id,
      keptSku: keep.sku,
      mergedSku: mergeSku,
      orderItemsMoved: orderItems.count,
      costsMoved: costs.count,
      stockMovementsMoved,
      unitsTransferred,
      aliasesInherited,
    };
  });
}

/**
 * Resolve a SKU coming off a spreadsheet to the product it belongs to,
 * following a merge if one happened. Returns null when the SKU is genuinely
 * unknown — the caller decides whether that means "create it" or "skip it".
 */
export async function resolveProductBySku(workspaceId: string, sku: string) {
  const direct = await prisma.product.findUnique({
    where: { workspaceId_sku: { workspaceId, sku } },
  });
  if (direct) return direct;

  const alias = await prisma.productSkuAlias.findUnique({
    where: { workspaceId_sku: { workspaceId, sku } },
    include: { product: true },
  });
  return alias?.product ?? null;
}

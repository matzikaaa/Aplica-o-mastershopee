import { NextResponse } from "next/server";
import { prisma, type MarketplaceType } from "@mastershopee/database";
import { normalizeOrderStatus, parseBrDate, parseBrNumber, type ImportSummary } from "@mastershopee/shared";
import { requireWorkspace } from "@/lib/session";
import { ensureImportAccount } from "@/lib/import-account";

interface Row {
  externalOrderId?: string;
  orderedAt?: string;
  sku?: string;
  quantity?: string;
  grossAmount?: string;
  commissionAmount?: string;
  marketplaceFeeAmount?: string;
  shippingSubsidizedByMerchant?: string;
  taxAmount?: string;
  status?: string;
}

/**
 * Historical order import from a marketplace's own export.
 *
 * Idempotent on (import account, external order id): re-importing the same
 * file updates in place instead of duplicating revenue. One export row is one
 * order *item*, so several rows can share an order number — the order totals
 * accumulate across its items as they are read.
 *
 * Deliberately does NOT move stock. These are past sales, already reflected
 * in whatever balance the operator declared as current; debiting them again
 * would double-count.
 */
export async function POST(request: Request) {
  const { workspace, user } = await requireWorkspace();
  const { rows, marketplace } = (await request.json()) as { rows: Row[]; marketplace: MarketplaceType };

  if (!marketplace) {
    return NextResponse.json({ error: "Informe o marketplace de origem." }, { status: 400 });
  }

  const account = await ensureImportAccount(workspace.id, marketplace);
  const summary: ImportSummary = { created: 0, updated: 0, skipped: 0, errors: [] };
  const seenOrders = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const line = i + 2;
    const externalOrderId = row.externalOrderId?.trim();
    const sku = row.sku?.trim();
    const orderedAt = parseBrDate(row.orderedAt);
    const quantity = parseBrNumber(row.quantity);
    const grossAmount = parseBrNumber(row.grossAmount);

    const missing: string[] = [];
    if (!externalOrderId) missing.push("nº do pedido");
    if (!sku) missing.push("SKU");
    if (!orderedAt) missing.push("data válida");
    if (quantity === null) missing.push("quantidade");
    if (grossAmount === null) missing.push("valor da venda");

    if (missing.length > 0) {
      summary.skipped++;
      summary.errors.push({ row: line, reference: externalOrderId, message: `Faltando: ${missing.join(", ")}.` });
      continue;
    }

    // Narrowed once, after validation, so the rest reads without assertions.
    const orderId = externalOrderId!;
    const skuValue = sku!;
    const orderDate = orderedAt!;
    const qty = Math.max(1, Math.trunc(quantity!));
    const gross = grossAmount!;

    try {
      const commission = parseBrNumber(row.commissionAmount) ?? 0;
      const fee = parseBrNumber(row.marketplaceFeeAmount) ?? 0;
      const shipping = parseBrNumber(row.shippingSubsidizedByMerchant) ?? 0;
      const tax = parseBrNumber(row.taxAmount) ?? 0;
      const status = normalizeOrderStatus(row.status) as "PAID";

      const isFirstRowOfOrder = !seenOrders.has(orderId);
      seenOrders.add(orderId);

      const product = await prisma.product.findUnique({
        where: { workspaceId_sku: { workspaceId: workspace.id, sku: skuValue } },
      });

      const order = await prisma.order.upsert({
        where: {
          marketplaceAccountId_externalOrderId: {
            marketplaceAccountId: account.id,
            externalOrderId: orderId,
          },
        },
        // The first row of an order resets its totals so a re-import replaces
        // rather than accumulates; later rows of the same order add to them.
        update: isFirstRowOfOrder
          ? {
              status,
              orderedAt: orderDate,
              grossAmount: gross,
              commissionAmount: commission,
              marketplaceFeeAmount: fee,
              shippingSubsidizedByMerchant: shipping,
              taxAmount: tax,
            }
          : {
              grossAmount: { increment: gross },
              commissionAmount: { increment: commission },
              marketplaceFeeAmount: { increment: fee },
              shippingSubsidizedByMerchant: { increment: shipping },
              taxAmount: { increment: tax },
            },
        create: {
          workspaceId: workspace.id,
          marketplaceAccountId: account.id,
          marketplace,
          externalOrderId: orderId,
          status,
          orderedAt: orderDate,
          grossAmount: gross,
          commissionAmount: commission,
          marketplaceFeeAmount: fee,
          shippingSubsidizedByMerchant: shipping,
          taxAmount: tax,
        },
      });

      // Cost effective on the order date, never today's cost (§16).
      const cost = product
        ? await prisma.productCost.findFirst({
            where: { productId: product.id, effectiveFrom: { lte: orderDate } },
            orderBy: { effectiveFrom: "desc" },
          })
        : null;

      const itemId = `${order.id}:${skuValue}`;
      await prisma.orderItem.upsert({
        where: { id: itemId },
        update: {
          quantity: qty,
          unitPrice: gross / qty,
          commissionAmount: commission,
          feeAmount: fee,
          taxAmount: tax,
        },
        create: {
          id: itemId,
          orderId: order.id,
          productId: product?.id,
          externalSku: skuValue,
          title: product?.name ?? skuValue,
          quantity: qty,
          unitPrice: gross / qty,
          unitCostSnapshot: cost?.unitCost ?? null,
          commissionAmount: commission,
          feeAmount: fee,
          taxAmount: tax,
        },
      });

      if (isFirstRowOfOrder) summary.created++;
      else summary.updated++;

      if (!product) {
        summary.errors.push({
          row: line,
          reference: skuValue,
          message: "Pedido importado, mas o SKU não existe no catálogo — sem custo, o lucro fica incompleto.",
        });
      }
    } catch (err) {
      summary.errors.push({
        row: line,
        reference: orderId,
        message: err instanceof Error ? err.message : "Falha ao gravar a linha.",
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      action: "import.orders",
      metadata: { marketplace, orders: seenOrders.size, errors: summary.errors.length },
    },
  });

  return NextResponse.json(summary);
}

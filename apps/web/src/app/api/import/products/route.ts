import { NextResponse } from "next/server";
import { prisma, recordStockMovement } from "@mastershopee/database";
import { parseBrNumber, type ImportSummary } from "@mastershopee/shared";
import { requireWorkspace } from "@/lib/session";

interface Row {
  sku?: string;
  name?: string;
  unitCost?: string;
  packagingCost?: string;
  quantity?: string;
  supplierName?: string;
  leadTimeDays?: string;
}

/**
 * Bulk product load: creates/updates the product, optionally its current cost
 * and its opening stock balance.
 *
 * Stock is set as an ADJUSTMENT to the declared balance rather than an
 * addition, so re-importing a corrected sheet converges instead of stacking.
 * The declared quantity is treated as "what is on the shelf today", which
 * already reflects past sales — imported historical orders therefore do not
 * debit it again.
 */
export async function POST(request: Request) {
  const { workspace, user } = await requireWorkspace();
  const { rows } = (await request.json()) as { rows: Row[] };

  const summary: ImportSummary = { created: 0, updated: 0, skipped: 0, errors: [] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const line = i + 2; // +1 for the header row, +1 for 1-based counting
    const sku = row.sku?.trim();
    const name = row.name?.trim();

    if (!sku || !name) {
      summary.skipped++;
      summary.errors.push({ row: line, reference: sku, message: "SKU e nome são obrigatórios." });
      continue;
    }

    try {
      const existing = await prisma.product.findUnique({
        where: { workspaceId_sku: { workspaceId: workspace.id, sku } },
      });

      const product = await prisma.product.upsert({
        where: { workspaceId_sku: { workspaceId: workspace.id, sku } },
        update: { name },
        create: { workspaceId: workspace.id, sku, name },
      });
      existing ? summary.updated++ : summary.created++;

      const unitCost = parseBrNumber(row.unitCost);
      if (unitCost !== null) {
        const packaging = parseBrNumber(row.packagingCost) ?? 0;
        await prisma.productCost.create({
          data: {
            productId: product.id,
            unitCost,
            packagingCost: packaging,
            effectiveFrom: new Date(),
            createdByUserId: user.id,
          },
        });
      }

      const quantity = parseBrNumber(row.quantity);
      const leadTimeDays = parseBrNumber(row.leadTimeDays);
      const supplierName = row.supplierName?.trim() || null;

      if (quantity !== null || leadTimeDays !== null || supplierName) {
        const item = await prisma.stockItem.upsert({
          where: { productId: product.id },
          update: {},
          create: { workspaceId: workspace.id, productId: product.id, quantity: 0 },
        });

        if (quantity !== null) {
          const delta = Math.trunc(quantity) - item.quantity;
          if (delta !== 0) {
            await recordStockMovement({
              workspaceId: workspace.id,
              productId: product.id,
              type: "ADJUSTMENT",
              units: delta,
              note: "Importação de planilha — saldo declarado",
              createdByUserId: user.id,
            });
          }
        }

        await prisma.stockItem.update({
          where: { productId: product.id },
          data: {
            ...(supplierName ? { supplierName } : {}),
            ...(leadTimeDays !== null ? { leadTimeDays: Math.trunc(leadTimeDays) } : {}),
          },
        });
      }
    } catch (err) {
      summary.errors.push({
        row: line,
        reference: sku,
        message: err instanceof Error ? err.message : "Falha ao gravar a linha.",
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      action: "import.products",
      metadata: { created: summary.created, updated: summary.updated, errors: summary.errors.length },
    },
  });

  return NextResponse.json(summary);
}

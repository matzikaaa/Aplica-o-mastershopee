import { NextResponse } from "next/server";
import {
  backfillMissingCostSnapshots,
  prisma,
  recomputeMetricsForDays,
  recordStockMovement,
  resolveProductBySku,
} from "@mastershopee/database";
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
  const { rows, applyToHistory } = (await request.json()) as { rows: Row[]; applyToHistory?: boolean };

  // A cost registered today does not apply to an order from May — the cost
  // lookup is date-effective (§16), so by default the history keeps saying
  // "custo desconhecido". The operator can declare that this cost also held
  // back then; the app never assumes it on their behalf.
  const historyStart = applyToHistory
    ? (
        await prisma.order.findFirst({
          where: { workspaceId: workspace.id },
          orderBy: { orderedAt: "asc" },
          select: { orderedAt: true },
        })
      )?.orderedAt ?? null
    : null;

  const summary: ImportSummary = { created: 0, updated: 0, skipped: 0, errors: [] };
  const costedProductIds = new Set<string>();

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
      // Resolved through aliases: a SKU merged into another product updates
      // the survivor instead of resurrecting the one that was merged away.
      const existing = await resolveProductBySku(workspace.id, sku);

      const product = existing
        ? await prisma.product.update({ where: { id: existing.id }, data: { name } })
        : await prisma.product.create({ data: { workspaceId: workspace.id, sku, name } });
      existing ? summary.updated++ : summary.created++;

      const unitCost = parseBrNumber(row.unitCost);
      if (unitCost !== null) {
        costedProductIds.add(product.id);
        const packaging = parseBrNumber(row.packagingCost) ?? 0;
        await prisma.productCost.create({
          data: {
            productId: product.id,
            unitCost,
            packagingCost: packaging,
            effectiveFrom: historyStart ?? new Date(),
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

  // Orders imported before their cost existed get it now, and the days they
  // fall on are re-aggregated.
  const staleDays = new Set<string>();
  if (historyStart) {
    for (const id of costedProductIds) {
      for (const day of await backfillMissingCostSnapshots(id)) staleDays.add(day);
    }
    await recomputeMetricsForDays(workspace.id, staleDays);
  }

  await prisma.auditLog.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      action: "import.products",
      metadata: { created: summary.created, updated: summary.updated, errors: summary.errors.length },
    },
  });

  if (historyStart) {
    summary.note =
      staleDays.size > 0
        ? `Custos aplicados também ao histórico: ${staleDays.size} dias recalculados. O lucro dos pedidos que estavam sem custo já aparece no painel.`
        : "Custos aplicados também ao histórico — nenhum pedido estava sem custo.";
  } else {
    summary.note = "Custos válidos a partir de hoje. Pedidos anteriores continuam marcados como sem custo.";
  }

  return NextResponse.json(summary);
}

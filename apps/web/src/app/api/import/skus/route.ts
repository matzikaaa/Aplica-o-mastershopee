import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { collectDiscoveredSkus, type ImportSummary } from "@mastershopee/shared";
import { requireWorkspace } from "@/lib/session";

interface Row {
  sku?: string;
  name?: string;
}

/**
 * Catalogue discovery: reads the SKUs out of any marketplace report and
 * registers them as products, nothing else.
 *
 * This exists because the operator does not have a product list to type in —
 * the list *is* whatever appears in their reports. Costs are deliberately not
 * touched here: a product with no cost shows up on /custos as "não
 * cadastrado", which is the honest state, instead of being born with a zero
 * cost that would silently inflate profit (§75).
 *
 * Existing products are left exactly as they are — a SKU already in the
 * catalogue may have been renamed by the operator, and a report should never
 * overwrite that.
 */
export async function POST(request: Request) {
  const { workspace, user } = await requireWorkspace();
  const { rows } = (await request.json()) as { rows: Row[] };

  const summary: ImportSummary = { created: 0, updated: 0, skipped: 0, errors: [] };

  // One report row is one *sale*, so the same SKU repeats dozens of times.
  // Collapse first, so the database is touched once per product rather than
  // once per line.
  const { skus: discovered, blankRows } = collectDiscoveredSkus(rows);

  summary.skipped = blankRows.length;
  for (const line of blankRows.slice(0, 50)) {
    summary.errors.push({ row: line, message: "Linha sem SKU." });
  }

  for (const { sku, name, row: line } of discovered) {
    try {
      const existing = await prisma.product.findUnique({
        where: { workspaceId_sku: { workspaceId: workspace.id, sku } },
        select: { id: true },
      });

      if (existing) {
        summary.updated++;
        continue;
      }

      await prisma.product.create({
        data: { workspaceId: workspace.id, sku, name: name ?? sku },
      });
      summary.created++;

      if (!name) {
        summary.errors.push({
          row: line,
          reference: sku,
          message: "Sem coluna de nome — cadastrado com o próprio SKU como nome provisório.",
        });
      }
    } catch (err) {
      summary.errors.push({
        row: line,
        reference: sku,
        message: err instanceof Error ? err.message : "Falha ao cadastrar o SKU.",
      });
    }
  }

  const withoutCost = await prisma.product.count({
    where: { workspaceId: workspace.id, costs: { none: {} } },
  });

  summary.note =
    withoutCost > 0
      ? `${withoutCost} ${withoutCost === 1 ? "produto está" : "produtos estão"} sem custo cadastrado. Preencha em Custos antes de importar os pedidos — sem custo o lucro sai incompleto, e o app avisa em vez de estimar.`
      : "Todos os produtos do catálogo já têm custo cadastrado. Pode importar os pedidos.";

  await prisma.auditLog.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      action: "import.skus",
      metadata: { discovered: discovered.length, created: summary.created, withoutCost },
    },
  });

  return NextResponse.json(summary);
}

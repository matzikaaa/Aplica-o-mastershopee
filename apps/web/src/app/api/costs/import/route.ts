import { NextResponse } from "next/server";
import { prisma, resolveProductBySku } from "@mastershopee/database";
import { bulkCostRowSchema, type BulkImportResult } from "@mastershopee/shared";
import { requireWorkspace } from "@/lib/session";

/** §17 — bulk cost import. Rows are parsed client-side (CSV/XLSX) and posted here as JSON for validation + persistence. */
export async function POST(request: Request) {
  const { workspace, user } = await requireWorkspace();
  const { rows } = (await request.json()) as { rows: unknown[] };

  const result: BulkImportResult = { imported: 0, updated: 0, skipped: 0, errors: [] };

  for (let i = 0; i < rows.length; i++) {
    const parsed = bulkCostRowSchema.safeParse(rows[i]);
    if (!parsed.success) {
      result.errors.push({ row: i + 1, message: parsed.error.issues.map((iss) => iss.message).join(", ") });
      continue;
    }

    // Through aliases, so a cost sheet written with a SKU that has since been
    // merged still lands on the surviving product.
    const product = await resolveProductBySku(workspace.id, parsed.data.sku);
    if (!product) {
      result.skipped++;
      result.errors.push({ row: i + 1, sku: parsed.data.sku, message: "SKU não encontrado no workspace." });
      continue;
    }

    const hadPreviousCost = (await prisma.productCost.count({ where: { productId: product.id } })) > 0;

    await prisma.productCost.create({
      data: {
        productId: product.id,
        unitCost: parsed.data.cost,
        packagingCost: parsed.data.packaging,
        taxPercent: parsed.data.tax,
        otherCosts: parsed.data.otherCosts,
        effectiveFrom: new Date(),
        createdByUserId: user.id,
      },
    });

    if (hadPreviousCost) result.updated++;
    else result.imported++;
  }

  await prisma.auditLog.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      action: "product.cost.bulk_import",
      metadata: JSON.parse(JSON.stringify(result)),
    },
  });

  return NextResponse.json(result);
}

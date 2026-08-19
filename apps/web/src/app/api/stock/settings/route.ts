import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, ensureStockItem } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";

const settingsSchema = z.object({
  productId: z.string().min(1),
  supplierName: z.string().max(120).optional().nullable(),
  leadTimeDays: z.number().int().min(0).max(365),
  safetyDays: z.number().int().min(0).max(365),
});

/** Reorder configuration per product: supplier lead time + desired slack. */
export async function POST(request: Request) {
  const { workspace, user } = await requireWorkspace();

  const parsed = settingsSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().formErrors[0] ?? "Dados inválidos." }, { status: 400 });
  }

  const product = await prisma.product.findFirst({
    where: { id: parsed.data.productId, workspaceId: workspace.id },
    select: { id: true },
  });
  if (!product) {
    return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
  }

  await ensureStockItem(workspace.id, product.id);
  await prisma.stockItem.update({
    where: { productId: product.id },
    data: {
      supplierName: parsed.data.supplierName?.trim() || null,
      leadTimeDays: parsed.data.leadTimeDays,
      safetyDays: parsed.data.safetyDays,
      // Changing the thresholds re-arms the alert: the previous "already
      // warned" flag was set against different rules.
      lowStockNotifiedAt: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      action: "stock.settings_updated",
      entityType: "Product",
      entityId: product.id,
      metadata: { leadTimeDays: parsed.data.leadTimeDays, safetyDays: parsed.data.safetyDays },
    },
  });

  return NextResponse.json({ ok: true });
}

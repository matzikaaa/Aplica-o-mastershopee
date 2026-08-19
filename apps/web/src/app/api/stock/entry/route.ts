import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, recordStockMovement } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";

const entrySchema = z.object({
  productId: z.string().min(1),
  units: z.number().int().positive("Informe uma quantidade maior que zero."),
  note: z.string().max(280).optional(),
});

/** §8 — stock entry for a product, scoped to the caller's workspace. */
export async function POST(request: Request) {
  const { workspace, user } = await requireWorkspace();

  const parsed = entrySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().formErrors[0] ?? "Dados inválidos." }, { status: 400 });
  }

  // Ownership check: never trust a productId from the client without
  // confirming it belongs to this workspace (§8).
  const product = await prisma.product.findFirst({
    where: { id: parsed.data.productId, workspaceId: workspace.id },
    select: { id: true, name: true },
  });
  if (!product) {
    return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
  }

  const balance = await recordStockMovement({
    workspaceId: workspace.id,
    productId: product.id,
    type: "PURCHASE_IN",
    units: parsed.data.units,
    note: parsed.data.note,
    createdByUserId: user.id,
  });

  await prisma.auditLog.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      action: "stock.entry",
      entityType: "Product",
      entityId: product.id,
      metadata: { units: parsed.data.units, balanceAfter: balance },
    },
  });

  return NextResponse.json({ ok: true, balance });
}

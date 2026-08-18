import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { productCostSchema } from "@mastershopee/shared";
import { requireWorkspace } from "@/lib/session";

export async function POST(request: Request) {
  const { workspace, user } = await requireWorkspace();
  const body = await request.json();
  const parsed = productCostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Ownership check (§38): the product must belong to this workspace, never trust the client blindly.
  const product = await prisma.product.findFirst({ where: { id: parsed.data.productId, workspaceId: workspace.id } });
  if (!product) {
    return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
  }

  const cost = await prisma.productCost.create({
    data: { ...parsed.data, createdByUserId: user.id },
  });

  await prisma.auditLog.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      action: "product.cost.updated",
      entityType: "Product",
      entityId: product.id,
      metadata: { unitCost: parsed.data.unitCost, effectiveFrom: parsed.data.effectiveFrom.toISOString() },
    },
  });

  return NextResponse.json(cost);
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { agruparEstoque, desagruparEstoque, prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";

const agruparSchema = z.object({
  baseProductId: z.string().cuid(),
  membros: z
    .array(z.object({ productId: z.string().cuid(), unitsPerSale: z.number().int().min(1).max(999) }))
    .min(1),
});

export async function POST(request: Request) {
  const { workspace, user } = await requireWorkspace();

  const parsed = agruparSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos para agrupar." }, { status: 400 });
  }

  try {
    const resultado = await agruparEstoque(
      workspace.id,
      parsed.data.baseProductId,
      parsed.data.membros,
      user.id,
    );

    await prisma.auditLog.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        action: "stock.group.created",
        entityType: "Product",
        entityId: parsed.data.baseProductId,
        metadata: JSON.parse(JSON.stringify(resultado)),
      },
    });

    return NextResponse.json(resultado);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Não foi possível agrupar." },
      { status: 409 },
    );
  }
}

export async function DELETE(request: Request) {
  const { workspace, user } = await requireWorkspace();

  const { productId } = (await request.json().catch(() => ({}))) as { productId?: string };
  if (!productId) return NextResponse.json({ error: "Informe o produto." }, { status: 400 });

  try {
    await desagruparEstoque(workspace.id, productId);
    await prisma.auditLog.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        action: "stock.group.removed",
        entityType: "Product",
        entityId: productId,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Não foi possível desagrupar." },
      { status: 409 },
    );
  }
}

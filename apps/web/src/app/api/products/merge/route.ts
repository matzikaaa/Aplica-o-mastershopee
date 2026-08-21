import { NextResponse } from "next/server";
import { mergeProducts, prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";

/**
 * Fold one SKU into another (§16 — history is never silently discarded).
 *
 * Irreversible by design: the merged product row is deleted and its history
 * moves. The confirmation lives in the UI, which shows exactly how many
 * orders, costs and units are about to move before the operator commits.
 */
export async function POST(request: Request) {
  const { workspace, user } = await requireWorkspace();
  const { keepSku, mergeSku } = (await request.json()) as { keepSku?: string; mergeSku?: string };

  if (!keepSku?.trim() || !mergeSku?.trim()) {
    return NextResponse.json({ error: "Informe os dois SKUs." }, { status: 400 });
  }

  try {
    const result = await mergeProducts({
      workspaceId: workspace.id,
      keepSku: keepSku.trim(),
      mergeSku: mergeSku.trim(),
      userId: user.id,
    });

    await prisma.auditLog.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        action: "product.merge",
        entityType: "Product",
        entityId: result.keptProductId,
        metadata: { ...result },
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Não foi possível unificar os SKUs." },
      { status: 400 },
    );
  }
}

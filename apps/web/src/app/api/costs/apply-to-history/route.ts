import { NextResponse } from "next/server";
import { aplicarCustosAoHistorico, prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";

/**
 * Declare that the earliest cost registered for each product was already in
 * force when its oldest sale happened.
 *
 * Costs are date-effective (§16), so a cost registered today does not apply to
 * an order from May — the item keeps a null snapshot and its profit is flagged
 * incomplete. That is the right default: the app cannot know what a product
 * cost three months ago. But an operator loading their history for the first
 * time *does* know, and this is how they say so.
 *
 * It backdates the real ProductCost row rather than quietly filling snapshots,
 * so the change shows up in the product's cost history instead of hiding
 * inside the orders, and it is written to the audit log.
 */
export async function POST() {
  const { workspace, user } = await requireWorkspace();

  const { backdated, daysRecomputed, stillMissing } = await aplicarCustosAoHistorico(workspace.id);

  await prisma.auditLog.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      action: "product.cost.applied_to_history",
      metadata: { backdated, daysRecomputed, stillMissing },
    },
  });

  return NextResponse.json({ backdated, daysRecomputed, stillMissing });
}

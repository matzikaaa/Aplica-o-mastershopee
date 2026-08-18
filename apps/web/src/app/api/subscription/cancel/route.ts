import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";

export async function POST() {
  const { workspace, role } = await requireWorkspace();
  if (role !== "OWNER") {
    return NextResponse.json({ error: "Apenas o proprietário pode cancelar a assinatura." }, { status: 403 });
  }

  await prisma.subscription.update({
    where: { workspaceId: workspace.id },
    data: { cancelAtPeriodEnd: true, canceledAt: new Date() },
  });

  await prisma.auditLog.create({ data: { workspaceId: workspace.id, action: "subscription.canceled" } });

  return NextResponse.json({ ok: true });
}

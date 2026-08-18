import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";

export async function POST(request: Request, { params }: { params: { marketplace: string } }) {
  const { workspace, user } = await requireWorkspace();
  const { accountId } = await request.json();

  const account = await prisma.marketplaceAccount.findFirst({
    where: { id: accountId, workspaceId: workspace.id },
  });
  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  }

  await prisma.marketplaceAccount.update({
    where: { id: account.id },
    data: { status: "DISCONNECTED", disconnectedAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      action: "marketplace.disconnected",
      entityType: "MarketplaceAccount",
      entityId: account.id,
    },
  });

  return NextResponse.json({ ok: true });
}

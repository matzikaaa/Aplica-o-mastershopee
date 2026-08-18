import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";
import { marketplaceSyncQueue } from "@/lib/queue";

/** "Sincronizar agora" (§33) — manually enqueues an incremental sync for one connected account. */
export async function POST(request: Request) {
  const { workspace } = await requireWorkspace();
  const { accountId } = await request.json();

  const account = await prisma.marketplaceAccount.findFirst({
    where: { id: accountId, workspaceId: workspace.id },
  });
  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  }
  if (account.status === "SYNCING") {
    return NextResponse.json({ error: "Já existe uma sincronização em andamento." }, { status: 409 });
  }

  await marketplaceSyncQueue.add("manual-incremental-sync", {
    marketplaceAccountId: account.id,
    type: "INCREMENTAL",
  });

  return NextResponse.json({ ok: true });
}

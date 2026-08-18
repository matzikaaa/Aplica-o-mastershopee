import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";

/**
 * Polled by the Integrations page to show real first-sync progress (§82).
 * Returns the most recent IntegrationSync for the given account — no
 * invented stage labels, just the actual status/itemsProcessed the worker
 * is writing as it goes (see apps/worker/src/jobs/sync-marketplace.ts).
 */
export async function GET(request: Request) {
  const { workspace } = await requireWorkspace();
  const accountId = new URL(request.url).searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json({ error: "accountId is required" }, { status: 400 });
  }

  const account = await prisma.marketplaceAccount.findFirst({ where: { id: accountId, workspaceId: workspace.id } });
  if (!account) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sync = await prisma.integrationSync.findFirst({
    where: { marketplaceAccountId: accountId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    accountStatus: account.status,
    sync: sync
      ? {
          status: sync.status,
          itemsProcessed: sync.itemsProcessed,
          errorMessage: sync.errorMessage,
          startedAt: sync.startedAt,
          finishedAt: sync.finishedAt,
        }
      : null,
  });
}

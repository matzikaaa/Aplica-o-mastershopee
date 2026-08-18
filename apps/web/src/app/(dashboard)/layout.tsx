import { redirect } from "next/navigation";
import { prisma } from "@mastershopee/database";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { requireWorkspace } from "@/lib/session";
import { getPlanPermissionService } from "@/lib/billing-context";

// Every page under here reads the signed-in user's workspace-scoped data —
// never eligible for static generation/caching across different users.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, workspace } = await requireWorkspace();

  const permissions = await getPlanPermissionService(workspace.id);
  if (!permissions.hasDashboardAccess()) {
    redirect("/subscription?blocked=1");
  }

  // §72, §81 — the header's sync indicator reflects real MarketplaceAccount
  // status instead of always claiming "Sincronizado".
  const accounts = await prisma.marketplaceAccount.findMany({
    where: { workspaceId: workspace.id, status: { not: "DISCONNECTED" } },
    select: { status: true },
  });
  const syncStatus = accounts.some((a) => a.status === "ERROR" || a.status === "TOKEN_EXPIRED")
    ? "error"
    : accounts.some((a) => a.status === "SYNCING")
      ? "syncing"
      : "synced";

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header workspaceName={workspace.name} userName={user.name} userEmail={user.email} syncStatus={syncStatus} />
        <main className="flex-1 overflow-y-auto bg-muted/20 p-6">{children}</main>
      </div>
    </div>
  );
}

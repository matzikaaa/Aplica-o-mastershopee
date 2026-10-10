import { redirect } from "next/navigation";
import { prisma } from "@mastershopee/database";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { requireWorkspace } from "@/lib/session";
import { getPlanPermissionService, workspaceEmCortesia } from "@/lib/billing-context";
import { isStripeConfigured } from "@/lib/stripe";
import { AutoSync } from "@/components/dashboard/auto-sync";
import { TrialBanner } from "@/components/layout/trial-banner";
import { diasRestantesDeTeste } from "@mastershopee/billing";

// Every page under here reads the signed-in user's workspace-scoped data —
// never eligible for static generation/caching across different users.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, workspace } = await requireWorkspace();

  const permissions = await getPlanPermissionService(workspace.id);
  if (!permissions.hasDashboardAccess()) {
    redirect("/subscription?blocked=1");
  }

  const assinatura = await prisma.subscription.findUnique({
    where: { workspaceId: workspace.id },
    select: { status: true, trialEndsAt: true, providerSubscriptionId: true },
  });
  // A contagem só aparece quando o teste de fato vai acabar: sem meio de
  // pagamento ou em cortesia, "faltam 3 dias — escolha um plano" seria uma
  // ameaça falsa apontando para um botão que não cobra.
  const testeVale = isStripeConfigured() && !(await workspaceEmCortesia(workspace.id));
  const diasDeTeste = assinatura && testeVale ? diasRestantesDeTeste(assinatura) : null;

  // §72, §81 — the header's sync indicator reflects real MarketplaceAccount
  // status instead of always claiming "Sincronizado".
  const accounts = await prisma.marketplaceAccount.findMany({
    where: { workspaceId: workspace.id, status: { not: "DISCONNECTED" } },
    select: { status: true },
  });

  // NOT_CONNECTED accounts are the placeholders spreadsheet imports hang off.
  // They must never count towards "Sincronizado": nothing synced, the operator
  // loaded the data by hand, and saying otherwise would invent a status.
  const live = accounts.filter((a) => a.status !== "NOT_CONNECTED");
  const syncStatus =
    live.length === 0
      ? accounts.length > 0
        ? "manual"
        : "none"
      : live.some((a) => a.status === "ERROR" || a.status === "TOKEN_EXPIRED")
        ? "error"
        : live.some((a) => a.status === "SYNCING")
          ? "syncing"
          : "synced";

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header workspaceName={workspace.name} userName={user.name} userEmail={user.email} syncStatus={syncStatus} />
        {diasDeTeste !== null && <TrialBanner dias={diasDeTeste} />}
        <main className="flex-1 overflow-y-auto bg-muted/20 p-6">{children}</main>
        {/* No layout, não numa página: a sincronização tem que acontecer
            abrindo o painel por qualquer porta — Visão Geral, Pedidos,
            Estoque. Presa a uma tela só, ela depende de o vendedor passar
            justamente por ela, que é de novo pedir que ele faça o trabalho. */}
        {live.length > 0 && <AutoSync />}
      </div>
    </div>
  );
}

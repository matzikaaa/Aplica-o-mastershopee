import { prisma } from "@mastershopee/database";
import { PLAN_ORDER, type PlanCode } from "@mastershopee/billing";
import { TrendingUp } from "lucide-react";
import { requireUser } from "@/lib/session";
import { CreateWorkspaceForm } from "@/components/onboarding/create-workspace-form";
import { OnboardingChecklist, type ChecklistStep } from "@/components/onboarding/onboarding-checklist";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireUser();

  const membership = await prisma.workspaceMember.findFirst({
    where: { userId: user.id },
    include: { workspace: true },
    orderBy: { joinedAt: "asc" },
  });

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-6 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-center justify-center gap-2 font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <TrendingUp className="h-4.5 w-4.5" />
          </span>
          Mastershopee
        </div>
        <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">{children}</div>
      </div>
    </div>
  );

  if (!membership) {
    const defaultPlanCode = PLAN_ORDER.includes(user.intendedPlanCode as PlanCode)
      ? (user.intendedPlanCode as PlanCode)
      : undefined;
    return shell(
      <>
        <h1 className="text-xl font-semibold">Vamos criar sua central financeira</h1>
        <p className="mt-1 text-sm text-muted-foreground">Isso leva menos de um minuto.</p>
        <div className="mt-6">
          <CreateWorkspaceForm defaultPlanCode={defaultPlanCode} />
        </div>
      </>,
    );
  }

  const workspace = membership.workspace;
  // "Vendas carregadas" is satisfied by either route — an OAuth connection or
  // a spreadsheet import. Insisting on a connected marketplace would leave the
  // checklist permanently unfinished for an operator whose history is already
  // in the app, loaded by hand.
  const [connectedCount, orderCount, costCount, whatsapp] = await Promise.all([
    prisma.marketplaceAccount.count({ where: { workspaceId: workspace.id, status: "CONNECTED" } }),
    prisma.order.count({ where: { workspaceId: workspace.id } }),
    prisma.productCost.count({ where: { product: { workspaceId: workspace.id } } }),
    prisma.whatsappConfiguration.findUnique({ where: { workspaceId: workspace.id } }),
  ]);

  const steps: ChecklistStep[] = [
    { key: "account", label: "Conta criada", href: "/onboarding", done: true },
    { key: "subscription", label: "Assinatura ativada (teste grátis)", href: "/subscription", done: true },
    {
      key: "sales",
      label: connectedCount > 0 ? "Marketplace conectado" : "Vendas carregadas (conexão ou planilha)",
      href: orderCount > 0 || connectedCount > 0 ? "/dashboard" : "/import",
      done: connectedCount > 0 || orderCount > 0,
    },
    { key: "costs", label: "Custos cadastrados", href: "/costs", done: costCount > 0 },
    { key: "whatsapp", label: "WhatsApp configurado", href: "/settings", done: Boolean(whatsapp?.verified) },
  ];

  return shell(
    <>
      <h1 className="text-xl font-semibold">Quase lá, {user.name.split(" ")[0]}!</h1>
      <p className="mt-1 text-sm text-muted-foreground">Complete os passos abaixo para aproveitar tudo da plataforma.</p>
      <div className="mt-6">
        <OnboardingChecklist steps={steps} />
      </div>
    </>,
  );
}

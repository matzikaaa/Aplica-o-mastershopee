import { prisma } from "@mastershopee/database";
import { PLAN_CATALOG, PLAN_ORDER, isUnlimited, type PlanCode } from "@mastershopee/billing";
import { requireWorkspace } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SubscriptionActions } from "@/components/subscription/subscription-actions";
import { formatCurrency, formatDate } from "@/lib/utils";

const STATUS_LABELS: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "default" }> = {
  trialing: { label: "Período de teste", variant: "default" },
  active: { label: "Ativa", variant: "success" },
  past_due: { label: "Pagamento pendente", variant: "warning" },
  canceled: { label: "Cancelada", variant: "destructive" },
  expired: { label: "Expirada", variant: "destructive" },
  incomplete: { label: "Incompleta", variant: "destructive" },
};

export default async function SubscriptionPage({ searchParams }: { searchParams: { blocked?: string } }) {
  const { workspace } = await requireWorkspace();

  const [subscription, accountCounts] = await Promise.all([
    prisma.subscription.findUnique({ where: { workspaceId: workspace.id }, include: { plan: true } }),
    prisma.marketplaceAccount.groupBy({
      by: ["marketplace"],
      where: { workspaceId: workspace.id, status: { not: "DISCONNECTED" } },
      _count: true,
    }),
  ]);

  const planCode = (subscription?.plan.code ?? "STARTER") as PlanCode;
  const plan = PLAN_CATALOG[planCode];
  const status = subscription?.status ?? "incomplete";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Assinatura</h1>

      {searchParams.blocked && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Sua assinatura precisa estar ativa para acessar o painel completo.
        </div>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base text-foreground">Plano atual</CardTitle>
          <Badge variant={STATUS_LABELS[status]?.variant ?? "default"}>{STATUS_LABELS[status]?.label ?? status}</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold">{plan.name}</span>
            <span className="text-muted-foreground">
              {formatCurrency(subscription?.interval === "yearly" ? plan.priceYearly : plan.priceMonthly)}/
              {subscription?.interval === "yearly" ? "ano" : "mês"}
            </span>
          </div>
          {subscription?.currentPeriodEnd && (
            <p className="text-sm text-muted-foreground">Próxima cobrança em {formatDate(subscription.currentPeriodEnd)}</p>
          )}
          {subscription?.cancelAtPeriodEnd && (
            <p className="text-sm text-warning">Cancelamento agendado para o fim do período atual.</p>
          )}

          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-sm font-medium">Limites utilizados</p>
            {(["SHOPEE", "MERCADO_LIVRE", "SHEIN", "TIKTOK_SHOP"] as const).map((m) => {
              const used = accountCounts.find((a) => a.marketplace === m)?._count ?? 0;
              return (
                <div key={m} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{m}</span>
                  <span>
                    {used} / {isUnlimited(plan.limits.marketplaceAccountsPerType) ? "∞" : plan.limits.marketplaceAccountsPerType}
                  </span>
                </div>
              );
            })}
          </div>

          <SubscriptionActions currentPlan={planCode} />
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        {PLAN_ORDER.map((code) => (
          <div
            key={code}
            className={`rounded-xl border p-4 text-sm ${code === planCode ? "border-primary bg-primary/5" : "border-border"}`}
          >
            <p className="font-semibold">{PLAN_CATALOG[code].name}</p>
            <p className="mt-1 text-muted-foreground">{formatCurrency(PLAN_CATALOG[code].priceMonthly)}/mês</p>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Cobrança recorrente processada via Stripe. Sem chaves de API configuradas neste ambiente
        (STRIPE_SECRET_KEY), as ações acima operam em modo de desenvolvimento diretamente no registro
        da assinatura — consulte o README para configurar o Stripe em produção.
      </p>
    </div>
  );
}

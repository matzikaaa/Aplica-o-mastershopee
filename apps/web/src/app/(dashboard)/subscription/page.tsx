import { nomeDoMarketplace } from "@mastershopee/shared";
import { isStripeConfigured } from "@/lib/stripe";
import { isProviderConfigured } from "@mastershopee/integrations";
import { getIntegrationEnv } from "@/lib/integration-env";
import { prisma } from "@mastershopee/database";
import { PLAN_CATALOG, isUnlimited, type PlanCode } from "@mastershopee/billing";
import { statusDeAcesso } from "@/lib/billing-context";
import { requireWorkspace } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlanPicker, SubscriptionActions } from "@/components/subscription/subscription-actions";
import { formatCurrency, formatDate } from "@/lib/utils";

const STATUS_LABELS: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "default" }> = {
  trialing: { label: "Período de teste", variant: "default" },
  active: { label: "Ativa", variant: "success" },
  past_due: { label: "Pagamento pendente", variant: "warning" },
  canceled: { label: "Cancelada", variant: "destructive" },
  expired: { label: "Expirada", variant: "destructive" },
  incomplete: { label: "Incompleta", variant: "destructive" },
};

export default async function SubscriptionPage({
  searchParams,
}: {
  searchParams: { blocked?: string; checkout?: string };
}) {
  const { workspace, user } = await requireWorkspace();

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
  // Mesma regra do bloqueio: a tela não pode dizer "Em teste" para quem o
  // painel acabou de barrar por teste vencido.
  const status = await statusDeAcesso(workspace.id, subscription);
  const env = getIntegrationEnv();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Assinatura</h1>

      {/* O Stripe devolve o cliente para cá depois do Checkout. O plano muda
          quando o webhook chega, segundos depois — sem este aviso, quem acabou
          de pagar via o plano antigo e achava que o pagamento não valeu. */}
      {searchParams.checkout === "sucesso" && (
        <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          Pagamento recebido. O novo plano é ativado em instantes — se ainda aparecer o anterior, recarregue a página.
        </div>
      )}
      {searchParams.checkout === "cancelado" && (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Pagamento não concluído. Nenhuma cobrança foi feita.
        </div>
      )}

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
          {/* No teste não há cobrança marcada: "Próxima cobrança em" na tela de
              quem nem cadastrou cartão parece uma cobrança que vai acontecer. */}
          {status === "trialing" && subscription?.trialEndsAt ? (
            <p className="text-sm text-muted-foreground">
              Teste grátis até {formatDate(subscription.trialEndsAt)}.{" "}
              {subscription.providerSubscriptionId
                ? "A primeira cobrança acontece nessa data."
                : "Para continuar depois disso, escolha um plano. Nada é cobrado sem você confirmar."}
            </p>
          ) : (
            subscription?.currentPeriodEnd &&
            !subscription.cancelAtPeriodEnd && (
              <p className="text-sm text-muted-foreground">Próxima cobrança em {formatDate(subscription.currentPeriodEnd)}</p>
            )
          )}
          {subscription?.cancelAtPeriodEnd && (
            <p className="text-sm text-warning">
              Cancelamento agendado
              {subscription.currentPeriodEnd
                ? `: o acesso continua até ${formatDate(subscription.currentPeriodEnd)}, sem nova cobrança.`
                : " para o fim do período atual."}
            </p>
          )}

          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-sm font-medium">Limites utilizados</p>
            {/* Mesma regra do card de Integrações: "Mercado Livre 0 / 3" num
                plano que ainda não conecta Mercado Livre é limite de algo que
                não existe. Conta já conectada continua aparecendo. */}
            {(["SHOPEE", "MERCADO_LIVRE", "SHEIN", "TIKTOK_SHOP"] as const).map((m) => {
              const used = accountCounts.find((a) => a.marketplace === m)?._count ?? 0;
              if (used === 0 && !isProviderConfigured(m, env)) return null;
              return (
                <div key={m} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{nomeDoMarketplace(m)}</span>
                  <span>
                    {used} / {isUnlimited(plan.limits.marketplaceAccountsPerType) ? "∞" : plan.limits.marketplaceAccountsPerType}
                  </span>
                </div>
              );
            })}
          </div>

          <SubscriptionActions
            temCobranca={Boolean(subscription?.providerCustomerId) && isStripeConfigured()}
            cancelamentoAgendado={Boolean(subscription?.cancelAtPeriodEnd)}
          />
        </CardContent>
      </Card>

      <PlanPicker
        currentPlan={planCode}
        intervaloAtual={subscription?.interval === "yearly" ? "yearly" : "monthly"}
        semAssinaturaPaga={
          !subscription?.providerSubscriptionId || status === "canceled" || status === "expired"
        }
      />

      {/* Nota de configuração é para quem opera a plataforma. Sem esse filtro,
          com a produção ainda sem Stripe, todo cliente lia "STRIPE_SECRET_KEY"
          e "consulte o README" na tela onde decide se paga. */}
      {user.isSuperAdmin && !isStripeConfigured() && (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          Visível só para administradores: o Stripe não está configurado neste ambiente, então os botões acima não
          cobram. Ver docs/producao.md.
        </p>
      )}
    </div>
  );
}

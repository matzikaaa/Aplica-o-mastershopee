import { prisma } from "@mastershopee/database";
import { isProviderConfigured } from "@mastershopee/integrations";
import { MARKETPLACE_LABELS, type MarketplaceType } from "@mastershopee/shared";
import { requireWorkspace } from "@/lib/session";
import { getPlanPermissionService } from "@/lib/billing-context";
import { getIntegrationEnv } from "@/lib/integration-env";
import { MARKETPLACE_TO_SLUG } from "@/lib/marketplace-slug";
import { MarketplaceCard } from "@/components/integrations/marketplace-card";
import { ShopeeDiagnose } from "@/components/integrations/shopee-diagnose";
import { ShopeePreview } from "@/components/integrations/shopee-preview";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: { error?: string; reason?: string; connected?: string; message?: string; queue?: string; marketplace?: string };
}) {
  const { workspace } = await requireWorkspace();
  const env = getIntegrationEnv();
  const [permissions, accounts] = await Promise.all([
    getPlanPermissionService(workspace.id),
    prisma.marketplaceAccount.findMany({ where: { workspaceId: workspace.id } }),
  ]);
  const limit = permissions.getMarketplaceLimit();
  const marketplaces = Object.keys(MARKETPLACE_LABELS) as MarketplaceType[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integrações</h1>
        <p className="text-sm text-muted-foreground">Conecte suas contas para sincronizar vendas, taxas e anúncios automaticamente.</p>
      </div>

      {searchParams.connected && (
        <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          {searchParams.queue === "unavailable"
            ? 'Conexão realizada. A sincronização automática não está configurada neste ambiente — use "Importar pedidos" abaixo para trazer os pedidos agora.'
            : "Conexão realizada! A primeira sincronização começou — pode levar alguns minutos."}
        </div>
      )}
      {searchParams.error === "plan_limit" && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">{searchParams.reason}</div>
      )}
      {searchParams.error === "not_configured" && (
        <div className="rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          Esse marketplace ainda não tem credenciais de parceiro configuradas neste ambiente.
        </div>
      )}
      {/* Sem estes dois, uma autorização que volta sem `state` — ou sem `code` —
          recarrega a página sem faixa nenhuma, e o vendedor fica olhando para
          "nenhuma conta conectada" sem nada que explique. Foi assim que um
          state perdido no redirect passou despercebido por duas rodadas. */}
      {searchParams.error === "invalid_callback" && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          A autorização voltou incompleta do marketplace (faltou o código ou a identificação da sessão). Tente conectar
          de novo sem deixar a aba parada por mais de 10 minutos.
        </div>
      )}
      {searchParams.error === "invalid_state" && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          A identificação da sessão de conexão não confere ou expirou. Comece de novo pelo botão Conectar — o link de
          autorização vale 10 minutos.
        </div>
      )}
      {searchParams.error === "oauth_failed" && (
        <div className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p>Não foi possível concluir a conexão.</p>
          {/* O callback já traz o erro do marketplace aqui. Trocá-lo por
              "tente novamente" transforma uma causa identificada em uma
              tentativa às cegas — foi o que escondeu uma troca de token
              recusada por falta do shop_id. */}
          {searchParams.message && <p className="font-mono text-xs opacity-90">{searchParams.message}</p>}
        </div>
      )}

      {/* Only when partner credentials exist: before that the card would be a
          button that can only ever say "não configurado". */}
      {isProviderConfigured("SHOPEE", env) && <ShopeeDiagnose />}
      {isProviderConfigured("SHOPEE", env) && <ShopeePreview />}

      <div className="grid gap-4 sm:grid-cols-2">
        {marketplaces.map((m) => (
          <MarketplaceCard
            key={m}
            name={MARKETPLACE_LABELS[m]}
            slug={MARKETPLACE_TO_SLUG[m]}
            configured={isProviderConfigured(m, env)}
            limit={limit === -1 ? Infinity : limit}
            accounts={accounts
              .filter((a) => a.marketplace === m)
              .map((a) => ({
                id: a.id,
                displayName: a.displayName,
                status: a.status,
                lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
              }))}
          />
        ))}
      </div>
    </div>
  );
}

import { MARKETPLACE_LABELS, type MarketplaceType } from "@mastershopee/shared";
import { prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";
import { getPlanPermissionService } from "@/lib/billing-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Megaphone, Lock } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

/**
 * §18-19: only ever renders numbers the marketplace's Ads API actually
 * returned. Right now every provider's fetchAdSpend throws
 * MarketplaceNotImplementedError (see packages/integrations/README.md) —
 * pending Ads API partner approval — so this page shows an honest
 * "not available yet" state per marketplace instead of invented metrics.
 */
export default async function AdsPage() {
  const { workspace } = await requireWorkspace();
  const permissions = await getPlanPermissionService(workspace.id);
  const adsGate = permissions.canUseAds();

  const [accounts, campaignCount] = await Promise.all([
    prisma.marketplaceAccount.findMany({ where: { workspaceId: workspace.id } }),
    prisma.adCampaign.count({ where: { workspaceId: workspace.id } }),
  ]);

  if (!adsGate.allowed) {
    return (
      <EmptyState
        icon={Lock}
        title="Publicidade é um recurso do plano Pro"
        description={adsGate.reason}
        action={
          <Link href="/subscription" className={buttonVariants({ size: "sm" })}>
            Conhecer plano Pro
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Publicidade</h1>
        <p className="text-sm text-muted-foreground">Gasto, ROAS e ACOS por campanha, direto das APIs oficiais de anúncios.</p>
      </div>

      {campaignCount === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="Dados de publicidade ainda não disponíveis"
          description="Nenhum dos marketplaces conectados liberou o acesso à API de Ads para esta conta ainda. Assim que a integração de anúncios for aprovada, os dados aparecerão aqui automaticamente."
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {accounts.map((account) => (
          <Card key={account.id}>
            <CardHeader>
              <CardTitle>{MARKETPLACE_LABELS[account.marketplace as MarketplaceType]}</CardTitle>
            </CardHeader>
            <CardContent>
              <Badge variant="outline">Dados de anúncios indisponíveis</Badge>
              <p className="mt-2 text-xs text-muted-foreground">
                Requer acesso à API de Ads do marketplace, pendente de aprovação de parceiro.
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

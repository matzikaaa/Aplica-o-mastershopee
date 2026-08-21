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
import { ManualAdSpendDialog } from "@/components/ads/manual-ad-spend-dialog";
import { Table, TableHead, TableHeader, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";

/**
 * §18-19: never renders an ad number the operator did not either measure or
 * declare. Every provider's fetchAdSpend still throws
 * MarketplaceNotImplementedError (see packages/integrations/README.md) —
 * pending Ads API partner approval — so the automatic route shows an honest
 * "not available yet" per marketplace, and the manual route lets the operator
 * enter what they actually spent. Entries split from a period total are
 * labelled as rateio wherever they appear.
 */
export default async function AdsPage() {
  const { workspace } = await requireWorkspace();
  const permissions = await getPlanPermissionService(workspace.id);
  const adsGate = permissions.canUseAds();

  const [accounts, campaigns] = await Promise.all([
    prisma.marketplaceAccount.findMany({ where: { workspaceId: workspace.id } }),
    prisma.adCampaign.findMany({
      where: { workspaceId: workspace.id },
      include: {
        spend: { orderBy: { date: "asc" } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  const campaignRows = campaigns
    .filter((c) => c.spend.length > 0)
    .map((c) => {
      const total = c.spend.reduce((acc, s) => acc + Number(s.spend), 0);
      const revenue = c.spend.reduce((acc, s) => acc + Number(s.attributedRevenue), 0);
      return {
        id: c.id,
        name: c.name,
        marketplace: c.marketplace as MarketplaceType,
        from: c.spend[0]!.date,
        to: c.spend[c.spend.length - 1]!.date,
        days: c.spend.length,
        total,
        revenue,
        // Null, never 0, when no revenue was entered: attributedRevenue is
        // optional, and "0.00x" would assert the campaign sold nothing when
        // the truth is that nobody said.
        roas: revenue > 0 && total > 0 ? revenue / total : null,
        estimated: c.spend.some((s) => s.isEstimated),
      };
    })
    .sort((a, b) => b.total - a.total);

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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Publicidade</h1>
          <p className="text-sm text-muted-foreground">
            Gasto, ROAS e ACOS por campanha. Enquanto a API de anúncios não libera, lance o que você gastou.
          </p>
        </div>
        <ManualAdSpendDialog />
      </div>

      {campaignRows.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="Nenhum gasto de anúncio registrado"
          description="Nenhum marketplace liberou a API de Ads para esta conta ainda. Até lá, lance manualmente o que você gastou — o valor entra no lucro líquido e no ROAS como qualquer outro custo."
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campanha</TableHead>
                <TableHead>Período</TableHead>
                <TableHead>Gasto</TableHead>
                <TableHead>Receita</TableHead>
                <TableHead>ROAS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaignRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <p className="font-medium">{row.name}</p>
                    <p className="text-xs text-muted-foreground">{MARKETPLACE_LABELS[row.marketplace]}</p>
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatDate(row.from)} — {formatDate(row.to)}
                    <span className="block text-xs text-muted-foreground">
                      {row.days} {row.days === 1 ? "dia" : "dias"}
                      {row.estimated && " · rateio diário"}
                    </span>
                  </TableCell>
                  <TableCell>{formatCurrency(row.total)}</TableCell>
                  <TableCell>{row.revenue > 0 ? formatCurrency(row.revenue) : "—"}</TableCell>
                  <TableCell>{row.roas === null ? "—" : `${row.roas.toFixed(2)}x`}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {campaignRows.some((r) => r.estimated) && (
        <p className="text-xs text-muted-foreground">
          Campanhas marcadas com <strong>rateio diário</strong> vieram de um total de período dividido igualmente pelos
          dias. O total é o que você informou; o valor de cada dia é aritmética, não medição — então a curva diária do
          painel é aproximada nesse trecho, embora o total do período esteja correto.
        </p>
      )}

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

import Link from "next/link";
import { AlertTriangle, TrendingDown, TrendingUp } from "lucide-react";
import { prisma } from "@mastershopee/database";
import { resolveDateRange, previousPeriod, type DateRangePreset, type MarketplaceType } from "@mastershopee/shared";
import { financialEngine } from "@mastershopee/financial-engine";
import { calculateOperationHealth } from "@mastershopee/financial-engine";
import { requireWorkspace } from "@/lib/session";
import {
  getKpiSummary,
  getRevenueSeries,
  getFinancialComposition,
  getProductRanking,
  getMarketplaceBreakdown,
} from "@/lib/dashboard-data";
import { MetricCard } from "@/components/dashboard/metric-card";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { MarketplaceFilter } from "@/components/dashboard/marketplace-filter";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { FinancialComposition } from "@/components/dashboard/financial-composition";
import { IncompleteCostBanner } from "@/components/dashboard/incomplete-cost-banner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency, formatPercent } from "@/lib/utils";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { period?: string; marketplace?: string };
}) {
  const { workspace } = await requireWorkspace();
  const period = (searchParams.period ?? "last_30_days") as DateRangePreset;
  const marketplace = (searchParams.marketplace ?? "all") as MarketplaceType | "all";

  const range = resolveDateRange(period, workspace.timezone);
  const previous = previousPeriod(range);

  // Gated on whether there are sales at all, not on whether an API connection
  // exists: a workspace loaded from spreadsheet exports has real orders, real
  // fees and real profit, and telling that operator there is nothing to show
  // would be false.
  const hasAnyOrder = (await prisma.order.count({ where: { workspaceId: workspace.id } })) > 0;

  if (!hasAnyOrder) {
    return (
      <EmptyState
        title="Nenhuma venda por aqui ainda"
        description="Traga seu histórico de uma das duas formas: conecte a loja para sincronizar sozinho, ou suba a planilha que o marketplace já exporta."
        action={
          <span className="flex flex-wrap items-center justify-center gap-4">
            <Link href="/import" className="text-sm font-medium text-primary hover:underline">
              Importar planilha →
            </Link>
            <Link href="/integrations" className="text-sm font-medium text-primary hover:underline">
              Conectar marketplace →
            </Link>
          </span>
        }
      />
    );
  }

  const [current, prev, series, composition, ranking, marketplaceBreakdown, itemsWithoutCost] = await Promise.all([
    getKpiSummary(workspace.id, range),
    getKpiSummary(workspace.id, previous),
    getRevenueSeries(workspace.id, range),
    getFinancialComposition(workspace.id, range),
    getProductRanking(workspace.id, range),
    getMarketplaceBreakdown(workspace.id, range),
    // Items sold in this period with no cost snapshot — not products without a
    // cost record. A cost registered today leaves every older sale uncosted
    // while the catalogue looks complete, and only this count sees that.
    prisma.orderItem.count({
      where: {
        productId: { not: null },
        unitCostSnapshot: null,
        order: { workspaceId: workspace.id, orderedAt: { gte: range.from, lte: range.to } },
      },
    }),
  ]);

  const lossProducts = ranking.filter((p) => p.netProfit < 0).sort((a, b) => a.netProfit - b.netProfit);
  const topProfitable = [...ranking].sort((a, b) => b.netProfit - a.netProfit).slice(0, 5);

  const health = calculateOperationHealth({
    netMarginPercent: current.marginPercent,
    roas: current.adSpend > 0 ? current.grossRevenue / current.adSpend : null,
    negativeMarginProductShare: ranking.length ? (lossProducts.length / ranking.length) * 100 : 0,
    returnRatePercent: 0,
    revenueGrowthPercent: financialEngine.percentChange(current.grossRevenue, prev.grossRevenue)?.toNumber() ?? null,
    connectedIntegrationsHealthy: 1,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Visão Geral</h1>
          <p className="text-sm text-muted-foreground">Quanto você vendeu, quanto lucrou e onde agir.</p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <DateRangePicker current={period} />
          <MarketplaceFilter current={marketplace} />
        </div>
      </div>

      {itemsWithoutCost > 0 && <IncompleteCostBanner itemsWithoutCost={itemsWithoutCost} />}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Faturamento"
          value={formatCurrency(current.grossRevenue)}
          changePercent={financialEngine.percentChange(current.grossRevenue, prev.grossRevenue)?.toNumber() ?? null}
          tooltip="Total vendido no período, antes de qualquer dedução."
        />
        <MetricCard
          label="Lucro líquido"
          value={formatCurrency(current.netProfit)}
          changePercent={financialEngine.percentChange(current.netProfit, prev.netProfit)?.toNumber() ?? null}
          tooltip="Faturamento menos comissões, taxas, ADS, custo dos produtos, frete e impostos."
          tone={current.netProfit >= 0 ? "success" : "destructive"}
        />
        <MetricCard
          label="Margem líquida"
          value={formatPercent(current.marginPercent)}
          tooltip="Lucro líquido dividido pelo faturamento."
        />
        <MetricCard
          label="Pedidos"
          value={current.orderCount.toLocaleString("pt-BR")}
          changePercent={financialEngine.percentChange(current.orderCount, prev.orderCount)?.toNumber() ?? null}
        />
        <MetricCard label="Ticket médio" value={formatCurrency(current.averageTicket)} tooltip="Faturamento dividido pelo número de pedidos." />
        <MetricCard label="Gastos com ADS" value={formatCurrency(current.adSpend)} tooltip="Investimento em publicidade atribuído aos pedidos do período." />
        <MetricCard
          label="ROAS"
          value={current.adSpend > 0 ? `${(current.grossRevenue / current.adSpend).toFixed(1)}x` : "—"}
          tooltip="Retorno sobre o investimento em anúncios: faturamento / gasto com ADS."
        />
        <MetricCard
          label="Produtos com prejuízo"
          value={String(lossProducts.length)}
          tone={lossProducts.length > 0 ? "destructive" : "success"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RevenueChart data={series} />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Saúde da operação</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-semibold">{health.score}</span>
              <span className="text-muted-foreground">/ 100</span>
              <Badge variant={health.score >= 65 ? "success" : health.score >= 40 ? "warning" : "destructive"}>
                {health.label}
              </Badge>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{health.methodology}</p>
          </CardContent>
        </Card>
      </div>

      <FinancialComposition {...composition} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top produtos por lucro</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topProfitable.length === 0 && <p className="text-sm text-muted-foreground">Sem vendas no período.</p>}
            {topProfitable.map((p) => (
              <div key={p.productId} className="flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.unitsSold} unidades vendidas</p>
                </div>
                <div className="flex items-center gap-1 font-medium text-success">
                  <TrendingUp className="h-3.5 w-3.5" />
                  {formatCurrency(p.netProfit)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className={lossProducts.length > 0 ? "border-destructive/30" : undefined}>
          <CardHeader>
            <CardTitle>Atenção necessária — produtos no prejuízo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {lossProducts.length === 0 && <p className="text-sm text-muted-foreground">Nenhum produto no prejuízo neste período. 🎉</p>}
            {lossProducts.slice(0, 5).map((p) => (
              <div key={p.productId} className="flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.unitsSold} unidades · margem {formatPercent(p.marginPercent)}</p>
                </div>
                <div className="flex items-center gap-1 font-medium text-destructive">
                  <TrendingDown className="h-3.5 w-3.5" />
                  {formatCurrency(p.netProfit)}
                </div>
              </div>
            ))}
            {lossProducts.length > 0 && (
              <Link href="/products?status=loss" className="block text-xs font-medium text-primary hover:underline">
                Ver todos os produtos deficitários →
              </Link>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Participação por marketplace</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {marketplaceBreakdown.map((m) => (
            <div key={m.marketplace} className="flex items-center gap-3 text-sm">
              <span className="w-32 shrink-0 font-medium">{m.marketplace}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${m.sharePercent}%` }} />
              </div>
              <span className="w-16 shrink-0 text-right text-muted-foreground">{m.sharePercent.toFixed(0)}%</span>
              <span className="w-28 shrink-0 text-right font-medium">{formatCurrency(m.grossRevenue)}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

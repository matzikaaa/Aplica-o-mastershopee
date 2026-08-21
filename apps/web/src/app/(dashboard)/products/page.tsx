import Link from "next/link";
import { resolveDateRange, classifyProductHealth, type DateRangePreset } from "@mastershopee/shared";
import { requireWorkspace } from "@/lib/session";
import { getProductRanking } from "@/lib/dashboard-data";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableHead, TableHeader, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { Package } from "lucide-react";

const STATUS_CONFIG = {
  profitable: { label: "Lucrativo", variant: "success" as const, dot: "🟢" },
  low_margin: { label: "Margem baixa", variant: "warning" as const, dot: "🟡" },
  loss: { label: "Prejuízo", variant: "destructive" as const, dot: "🔴" },
};

export default async function ProductsPage({ searchParams }: { searchParams: { period?: string; status?: string } }) {
  const { workspace } = await requireWorkspace();
  const period = (searchParams.period ?? "last_30_days") as DateRangePreset;
  const range = resolveDateRange(period, workspace.timezone);

  const fullRanking = await getProductRanking(workspace.id, range);
  const activeStatus = searchParams.status;
  let ranking = activeStatus
    ? fullRanking.filter((p) => classifyProductHealth(p.marginPercent) === activeStatus)
    : fullRanking;
  ranking = [...ranking].sort((a, b) => b.revenue - a.revenue);

  // Products whose sales carry no cost at all: their profit is computed with
  // cost zero, so it is an upper bound rather than a result.
  const incompleteRows = ranking.filter((p) => p.unitsWithoutCost > 0).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Produtos</h1>
          <p className="text-sm text-muted-foreground">Faturamento, custo e lucro por SKU.</p>
        </div>
        <DateRangePicker current={period} />
      </div>

      {activeStatus && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">Mostrando apenas:</span>
          <span className="font-medium">
            {STATUS_CONFIG[activeStatus as keyof typeof STATUS_CONFIG]?.label ?? activeStatus}
          </span>
          <span className="text-muted-foreground">
            · {ranking.length} de {fullRanking.length} produtos
          </span>
          <Link href={`/products?period=${period}`} className="ml-auto font-medium text-primary hover:underline">
            Ver todos
          </Link>
        </div>
      )}

      {ranking.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Nenhuma venda de produto neste período"
          description="Assim que houver pedidos sincronizados, os produtos aparecerão aqui com faturamento, custo e lucro."
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead>Unidades</TableHead>
                <TableHead>Faturamento</TableHead>
                <TableHead>Lucro</TableHead>
                <TableHead>Margem</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ranking.map((p) => {
                const status = STATUS_CONFIG[classifyProductHealth(p.marginPercent)];
                return (
                  <TableRow key={p.productId}>
                    <TableCell>
                      <p className="font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.sku}</p>
                    </TableCell>
                    <TableCell>{p.unitsSold}</TableCell>
                    <TableCell>{formatCurrency(p.revenue)}</TableCell>
                    <TableCell className={p.netProfit < 0 ? "text-destructive" : "text-success"}>
                      {formatCurrency(p.netProfit)}
                    </TableCell>
                    <TableCell>{formatPercent(p.marginPercent)}</TableCell>
                    <TableCell>
                      {p.unitsWithoutCost > 0 ? (
                        <Badge variant="outline" title={`${p.unitsWithoutCost} unidade(s) vendida(s) sem custo cadastrado`}>
                          ⚪ Sem custo
                        </Badge>
                      ) : (
                        <Badge variant={status.variant}>
                          {status.dot} {status.label}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {incompleteRows > 0 && (
        <p className="text-xs text-muted-foreground">
          {incompleteRows} produto(s) marcado(s) como <strong>Sem custo</strong> tiveram vendas sem custo conhecido, então
          o lucro deles é calculado com custo zero — é um teto, não um resultado.{" "}
          <Link href="/costs" className="text-primary hover:underline">
            Cadastrar custos →
          </Link>
        </p>
      )}
    </div>
  );
}

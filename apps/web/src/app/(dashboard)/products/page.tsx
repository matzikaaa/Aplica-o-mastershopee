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

  let ranking = await getProductRanking(workspace.id, range);
  if (searchParams.status) {
    ranking = ranking.filter((p) => classifyProductHealth(p.marginPercent) === searchParams.status);
  }
  ranking.sort((a, b) => b.revenue - a.revenue);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Produtos</h1>
          <p className="text-sm text-muted-foreground">Faturamento, custo e lucro por SKU.</p>
        </div>
        <DateRangePicker current={period} />
      </div>

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
                      <Badge variant={status.variant}>
                        {status.dot} {status.label}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Produtos sem custo cadastrado usam custo zero na estimativa de lucro.{" "}
        <Link href="/costs" className="text-primary hover:underline">
          Cadastrar custos →
        </Link>
      </p>
    </div>
  );
}

import { resolveDateRange, type DateRangePreset } from "@mastershopee/shared";
import { requireWorkspace } from "@/lib/session";
import { getFinancialComposition, getKpiSummary } from "@/lib/dashboard-data";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";

/** §26-27 — simplified DRE from Receita bruta down to Lucro líquido. */
export default async function FinancialPage({ searchParams }: { searchParams: { period?: string } }) {
  const { workspace } = await requireWorkspace();
  const period = (searchParams.period ?? "this_month") as DateRangePreset;
  const range = resolveDateRange(period, workspace.timezone);

  const [composition, summary] = await Promise.all([
    getFinancialComposition(workspace.id, range),
    getKpiSummary(workspace.id, range),
  ]);

  // Toda linha sai das métricas guardadas, e a conta fecha por construção.
  // Antes "Cancelamentos" e "Descontos" eram zeros escritos no código, a
  // receita líquida ignorava reembolsos, e embalagem e outros custos não
  // apareciam: as linhas não somavam o lucro mostrado no fim — no relatório
  // que vai para o contador.
  const c = composition;
  const descontos = c.grossRevenue - c.netRevenue - c.refunds;
  const lucroAntesDosCustosDoProduto = c.netRevenue - c.productCost;
  const embalagemEOperacional = lucroAntesDosCustosDoProduto - c.grossProfit;

  const rows: { label: string; value: number; bold?: boolean; divider?: boolean; tone?: boolean }[] = [
    { label: "Receita bruta", value: c.grossRevenue, bold: true },
    { label: "(-) Descontos", value: -descontos },
    { label: "(-) Devoluções e reembolsos", value: -c.refunds },
    { label: "= Receita líquida", value: c.netRevenue, bold: true, divider: true },
    { label: "(-) CMV (custo dos produtos)", value: -c.productCost },
    { label: "(-) Embalagem e custo operacional", value: -embalagemEOperacional },
    { label: "= Lucro bruto", value: c.grossProfit, bold: true, divider: true },
    { label: "(-) Comissões", value: -c.commission },
    { label: "(-) Taxas do marketplace", value: -c.marketplaceFees },
    { label: "(-) Fretes", value: -c.shipping },
    { label: "(-) ADS", value: -c.adSpend },
    { label: "(-) Impostos", value: -c.taxes },
    { label: "(-) Outros custos", value: -c.otherCosts },
    { label: "= Lucro líquido", value: c.netProfit, bold: true, divider: true, tone: true },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Financeiro — DRE simplificada</h1>
          <p className="text-sm text-muted-foreground">
            {summary.dataQuality !== "complete" && "Dados parciais para o período — "}
            Atualizado com base nos pedidos sincronizados.
          </p>
        </div>
        <DateRangePicker current={period} />
      </div>

      <Card className="mx-auto max-w-xl">
        <CardHeader>
          <CardTitle>Demonstrativo de resultado ({formatDate(range.from, workspace.timezone)} — {formatDate(range.to, workspace.timezone)})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {rows.map((row) => (
            <div
              key={row.label}
              className={`flex items-center justify-between py-2 text-sm ${row.divider ? "border-t border-border pt-3" : ""}`}
            >
              <span className={row.bold ? "font-semibold" : "text-muted-foreground"}>{row.label}</span>
              <span
                className={`font-medium ${row.tone ? (row.value >= 0 ? "text-success" : "text-destructive") : row.value < 0 ? "text-destructive" : ""}`}
              >
                {formatCurrency(row.value)}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

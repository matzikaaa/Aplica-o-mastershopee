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

  const receitaLiquida = composition.grossRevenue;
  const cmv = composition.productCost;
  const lucroBruto = receitaLiquida - cmv;

  const rows = [
    { label: "Receita bruta", value: composition.grossRevenue, bold: true },
    { label: "(-) Cancelamentos", value: 0 },
    { label: "(-) Descontos", value: 0 },
    { label: "= Receita líquida", value: receitaLiquida, bold: true, divider: true },
    { label: "(-) CMV (custo dos produtos)", value: -cmv },
    { label: "= Lucro bruto", value: lucroBruto, bold: true, divider: true },
    { label: "(-) Comissões", value: -composition.commission },
    { label: "(-) Taxas do marketplace", value: -composition.marketplaceFees },
    { label: "(-) Fretes", value: -composition.shipping },
    { label: "(-) ADS", value: -composition.adSpend },
    { label: "(-) Impostos", value: -composition.taxes },
    { label: "= Lucro líquido", value: composition.netProfit, bold: true, divider: true, tone: true },
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
          <CardTitle>Demonstrativo de resultado ({formatDate(range.from)} — {formatDate(range.to)})</CardTitle>
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

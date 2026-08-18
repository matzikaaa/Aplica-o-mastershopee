import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

interface Props {
  grossRevenue: number;
  commission: number;
  marketplaceFees: number;
  adSpend: number;
  productCost: number;
  shipping: number;
  taxes: number;
  netProfit: number;
}

/** §13 — waterfall showing exactly where every real went, faturamento → lucro líquido. */
export function FinancialComposition(props: Props) {
  const rows = [
    { label: "Faturamento", value: props.grossRevenue, isTotal: true },
    { label: "Comissões", value: -props.commission },
    { label: "Taxas do marketplace", value: -props.marketplaceFees },
    { label: "ADS", value: -props.adSpend },
    { label: "Custo dos produtos", value: -props.productCost },
    { label: "Fretes", value: -props.shipping },
    { label: "Impostos", value: -props.taxes },
    { label: "Lucro líquido", value: props.netProfit, isTotal: true },
  ];

  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.value)), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Composição financeira</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3">
            <span className={`w-40 shrink-0 text-sm ${row.isTotal ? "font-semibold" : "text-muted-foreground"}`}>
              {row.label}
            </span>
            <div className="h-6 flex-1 overflow-hidden rounded bg-muted">
              <div
                className={`h-full rounded ${row.value < 0 ? "bg-destructive/70" : row.isTotal ? "bg-success" : "bg-primary"}`}
                style={{ width: `${(Math.abs(row.value) / maxAbs) * 100}%` }}
              />
            </div>
            <span
              className={`w-32 shrink-0 text-right text-sm font-medium ${
                row.value < 0 ? "text-destructive" : row.isTotal ? "text-success" : "text-foreground"
              }`}
            >
              {row.value < 0 ? "-" : ""}
              {formatCurrency(Math.abs(row.value))}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

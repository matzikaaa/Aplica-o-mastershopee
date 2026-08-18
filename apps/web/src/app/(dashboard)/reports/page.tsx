import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireWorkspace } from "@/lib/session";
import { getPlanPermissionService } from "@/lib/billing-context";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const REPORTS = [
  { id: "orders", title: "Pedidos", description: "Todos os pedidos do período com detalhamento de lucro." },
  { id: "financial", title: "DRE / Lucro", description: "Demonstrativo de resultado simplificado." },
  { id: "products", title: "Produtos", description: "Faturamento, custo e margem por produto." },
];

/** §26 — report catalog. Only "Pedidos" has a working export today; the rest are structured but not yet wired to real export endpoints. */
export default async function ReportsPage() {
  const { workspace } = await requireWorkspace();
  const permissions = await getPlanPermissionService(workspace.id);
  const advanced = permissions.canUseAdvancedReports().allowed;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
        <p className="text-sm text-muted-foreground">Exporte seus dados em CSV ou XLSX.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((report) => (
          <Card key={report.id}>
            <CardHeader>
              <CardTitle>{report.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{report.description}</p>
              {report.id === "orders" ? (
                <div className="flex gap-2">
                  <a href="/api/reports/orders?format=csv" className="text-sm font-medium text-primary hover:underline">
                    Exportar CSV
                  </a>
                  {advanced ? (
                    <a href="/api/reports/orders?format=xlsx" className="text-sm font-medium text-primary hover:underline">
                      Exportar XLSX
                    </a>
                  ) : (
                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Lock className="h-3 w-3" /> XLSX (Pro)
                    </span>
                  )}
                </div>
              ) : (
                <Badge variant="outline">Em breve</Badge>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

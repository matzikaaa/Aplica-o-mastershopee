import Link from "next/link";
import { FileText, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { requireWorkspace } from "@/lib/session";
import { getPlanPermissionService } from "@/lib/billing-context";
import { mesAnterior, rotuloDoMes } from "@/lib/fechamento-mensal";

/**
 * §26 — relatórios.
 *
 * O fechamento mensal reúne o que antes eram três cartões, dois deles "Em
 * breve": DRE, produtos e pedidos do mês, num documento para o contador.
 */
export default async function ReportsPage() {
  const { workspace } = await requireWorkspace();
  const permissions = await getPlanPermissionService(workspace.id);
  const advanced = permissions.canUseAdvancedReports().allowed;
  const mes = mesAnterior(workspace.timezone);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
        <p className="text-sm text-muted-foreground">Documentos para o contador e exportações dos seus dados.</p>
      </div>

      <Card className="border-primary/30">
        <CardHeader className="flex-row items-start gap-3 space-y-0">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileText className="h-5 w-5" />
          </span>
          <div>
            <CardTitle className="text-base text-foreground">Fechamento mensal para o contador</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Resultado do mês (DRE), todos os pedidos com lucro líquido, repasses da Shopee para conciliar com o extrato,
              cancelados e devolvidos, produtos vendidos e a receita dos últimos 12 meses. Sai para imprimir ou em PDF
              {advanced ? ", e em planilha com uma aba para cada parte." : "; a planilha faz parte do plano Pro."}
            </p>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Link href={`/reports/fechamento?mes=${mes}`} className={buttonVariants()}>
            Abrir fechamento de {rotuloDoMes(mes).toLowerCase()}
          </Link>
          <Link href="/reports/fechamento" className={buttonVariants({ variant: "ghost" })}>
            Escolher outro mês
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pedidos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Lista de pedidos com o detalhamento do lucro, com os mesmos filtros da tela de Pedidos (busca, status,
            prejuízo). Para escolher período e filtros, use o botão Exportar em Pedidos.
          </p>
          <div className="flex gap-4">
            <a href="/api/reports/orders?format=csv" className="text-sm font-medium text-primary hover:underline">
              Últimos 30 dias (CSV)
            </a>
            {advanced ? (
              <a href="/api/reports/orders?format=xlsx" className="text-sm font-medium text-primary hover:underline">
                Últimos 30 dias (XLSX)
              </a>
            ) : (
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <Lock className="h-3 w-3" /> XLSX (Pro)
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

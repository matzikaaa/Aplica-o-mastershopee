import { prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableHead, TableHeader, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { AddCostDialog } from "@/components/costs/add-cost-dialog";
import { ImportCostsDialog } from "@/components/costs/import-costs-dialog";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";
import { Receipt, TriangleAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default async function CostsPage() {
  const { workspace } = await requireWorkspace();

  const products = await prisma.product.findMany({
    where: { workspaceId: workspace.id },
    include: { costs: { orderBy: { effectiveFrom: "desc" }, take: 1 } },
    orderBy: { name: "asc" },
  });

  // Products without a cost come first: they are the ones blocking a real
  // profit number, so they are what the operator actually came here to fix.
  const sorted = [...products].sort((a, b) => {
    const pending = Number(a.costs.length > 0) - Number(b.costs.length > 0);
    return pending !== 0 ? pending : a.name.localeCompare(b.name, "pt-BR");
  });
  const missingCost = products.filter((p) => p.costs.length === 0).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Custos</h1>
          <p className="text-sm text-muted-foreground">
            Custo unitário, embalagem e impostos por produto — com histórico preservado.
          </p>
        </div>
        <ImportCostsDialog />
      </div>

      {missingCost > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div>
              <p className="text-sm font-medium">
                {missingCost} {missingCost === 1 ? "produto sem custo cadastrado" : "produtos sem custo cadastrado"}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Enquanto o custo não estiver aqui, o lucro desses SKUs fica marcado como incompleto — não estimamos por
                você. Eles estão no topo da lista.
              </p>
            </div>
          </div>
          <Link href="/import" className={buttonVariants({ size: "sm", variant: "outline", className: "shrink-0" })}>
            Importar planilha
          </Link>
        </div>
      )}

      {products.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Nenhum produto ainda"
          description="Conecte um marketplace ou use Importar planilha › Descobrir SKUs para montar o catálogo a partir dos seus próprios relatórios."
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead>Custo unitário</TableHead>
                <TableHead>Embalagem</TableHead>
                <TableHead>Imposto</TableHead>
                <TableHead>Vigente desde</TableHead>
                <TableHead>Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((p) => {
                const current = p.costs[0];
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <p className="font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.sku}</p>
                    </TableCell>
                    <TableCell>{current ? formatCurrency(current.unitCost.toString()) : "—"}</TableCell>
                    <TableCell>{current ? formatCurrency(current.packagingCost.toString()) : "—"}</TableCell>
                    <TableCell>{current ? `${current.taxPercent}%` : "—"}</TableCell>
                    <TableCell>{current ? formatDate(current.effectiveFrom) : "Não cadastrado"}</TableCell>
                    <TableCell>
                      <AddCostDialog productId={p.id} productName={p.name} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

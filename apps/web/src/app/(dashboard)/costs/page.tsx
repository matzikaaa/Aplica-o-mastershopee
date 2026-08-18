import { prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableHead, TableHeader, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { AddCostDialog } from "@/components/costs/add-cost-dialog";
import { ImportCostsDialog } from "@/components/costs/import-costs-dialog";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Receipt } from "lucide-react";

export default async function CostsPage() {
  const { workspace } = await requireWorkspace();

  const products = await prisma.product.findMany({
    where: { workspaceId: workspace.id },
    include: { costs: { orderBy: { effectiveFrom: "desc" }, take: 1 } },
    orderBy: { name: "asc" },
  });

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

      {products.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Nenhum produto ainda"
          description="Produtos aparecem aqui automaticamente após a primeira sincronização com um marketplace."
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
              {products.map((p) => {
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

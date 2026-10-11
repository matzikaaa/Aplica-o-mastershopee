import { prisma, unknownCostWhere, vendasSemCusto } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";
import { EmptyState } from "@/components/ui/empty-state";
import { CostsTable } from "@/components/costs/costs-table";
import { ImportCostsDialog } from "@/components/costs/import-costs-dialog";
import { MergeSkusDialog } from "@/components/products/merge-skus-dialog";
import { IncompleteCostBanner } from "@/components/dashboard/incomplete-cost-banner";
import { UnknownCostList } from "@/components/costs/unknown-cost-list";
import Link from "next/link";
import { Receipt, TriangleAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default async function CostsPage() {
  const { workspace } = await requireWorkspace();

  const products = await prisma.product.findMany({
    where: { workspaceId: workspace.id },
    include: {
      costs: { orderBy: { effectiveFrom: "desc" }, take: 1 },
      stockItem: { select: { quantity: true } },
      skuAliases: { select: { sku: true } },
      _count: { select: { orderItems: true, costs: true } },
    },
    orderBy: { name: "asc" },
  });

  const mergeCandidates = products.map((p) => ({
    sku: p.sku,
    name: p.name,
    orderItems: p._count.orderItems,
    costs: p._count.costs,
    units: p.stockItem?.quantity ?? 0,
  }));

  // Products without a cost come first: they are the ones blocking a real
  // profit number, so they are what the operator actually came here to fix.
  const sorted = [...products].sort((a, b) => {
    const pending = Number(a.costs.length > 0) - Number(b.costs.length > 0);
    return pending !== 0 ? pending : a.name.localeCompare(b.name, "pt-BR");
  });
  const missingCost = products.filter((p) => p.costs.length === 0).length;

  // Sales whose cost is still unknown. Distinct from "product without a cost":
  // a catalogue can look complete here while every older sale stays uncosted,
  // because the registered cost only takes effect from its own date (§16).
  // This is the page the operator checks after seeing the dashboard warning,
  // so the same warning — and the same one-click fix — belongs here too.
  const itemsWithoutCost = await prisma.orderItem.count({
    where: { productId: { not: null }, ...unknownCostWhere(), order: { workspaceId: workspace.id } },
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
        <div className="flex gap-2">
          <MergeSkusDialog products={mergeCandidates} />
          <ImportCostsDialog />
        </div>
      </div>

      {itemsWithoutCost > 0 && (
        <div className="space-y-3">
          <IncompleteCostBanner itemsWithoutCost={itemsWithoutCost} scope="em todo o histórico" showCostsLink={false} />
          {/* O aviso diz quantos; a lista diz quais. Separados, o número vira
              enigma — foi o que aconteceu com "3 itens sem custo" numa tela
              em que todo produto mostrava custo preenchido. */}
          <UnknownCostList vendas={await vendasSemCusto(workspace.id)} />
        </div>
      )}

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
        <CostsTable
          produtos={sorted.map((p) => {
            const atual = p.costs[0];
            return {
              id: p.id,
              sku: p.sku,
              name: p.name,
              aliases: p.skuAliases.map((a) => a.sku),
              unitCost: atual ? atual.unitCost.toString() : null,
              packagingCost: atual ? atual.packagingCost.toString() : null,
              operationalCost: atual ? atual.operationalCost.toString() : null,
              taxPercent: atual ? atual.taxPercent.toString() : null,
              otherCosts: atual ? atual.otherCosts.toString() : null,
              effectiveFrom: atual ? atual.effectiveFrom.toISOString() : null,
            };
          })}
        />
      )}
    </div>
  );
}

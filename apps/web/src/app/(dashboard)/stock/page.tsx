import Link from "next/link";
import { Boxes, TriangleAlert } from "lucide-react";
import { prisma, unitsSoldPerProduct } from "@mastershopee/database";
import { averageDailySales, calculateStockCoverage, projectStockoutDate } from "@mastershopee/inventory";
import { requireWorkspace } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { StockEntryDialog } from "@/components/stock/stock-entry-dialog";
import { ReorderSettingsDialog } from "@/components/stock/reorder-settings-dialog";

export const dynamic = "force-dynamic";

const SALES_WINDOW_DAYS = 30;

/**
 * Stock overview. Outbound movement is fully automatic (marketplace syncs
 * debit each sold item), so this page exists for the one manual step —
 * registering arriving goods — plus the reorder verdict.
 *
 * The "low stock" decision comes from @mastershopee/inventory, the same code
 * the worker uses for the WhatsApp alert, so the screen and the alert can
 * never disagree (§60).
 */
export default async function StockPage() {
  const { workspace } = await requireWorkspace();

  const [items, sold] = await Promise.all([
    prisma.stockItem.findMany({
      where: { workspaceId: workspace.id },
      include: { product: { select: { id: true, name: true, sku: true } } },
      orderBy: { product: { name: "asc" } },
    }),
    unitsSoldPerProduct(workspace.id, SALES_WINDOW_DAYS),
  ]);

  const rows = items.map((item) => {
    const velocity = averageDailySales(sold.get(item.productId) ?? 0, SALES_WINDOW_DAYS);
    const coverage = calculateStockCoverage({
      quantity: item.quantity,
      averageDailySales: velocity,
      leadTimeDays: item.leadTimeDays,
      safetyDays: item.safetyDays,
    });
    return { item, coverage, stockoutAt: projectStockoutDate(coverage) };
  });

  const needsAttention = rows.filter((r) => r.coverage.needsReorder);
  const totalUnits = rows.reduce((sum, r) => sum + r.item.quantity, 0);

  if (items.length === 0) {
    return (
      <div className="space-y-6">
        <Header />
        <EmptyState
          icon={Boxes}
          title="Nenhum produto com estoque controlado ainda"
          description="Os produtos aparecem aqui automaticamente assim que forem sincronizados de um marketplace conectado. A partir daí, cada venda desconta o saldo sozinha e você só precisa dar entrada nas cargas que chegarem."
          action={
            <Link href="/integrations" className={buttonVariants({ size: "sm" })}>
              Conectar marketplace
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header />

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Produtos controlados" value={String(items.length)} />
        <SummaryCard label="Unidades em estoque" value={totalUnits.toLocaleString("pt-BR")} />
        <SummaryCard
          label="Precisam de reposição"
          value={String(needsAttention.length)}
          tone={needsAttention.length > 0 ? "warning" : "default"}
        />
      </div>

      {needsAttention.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p>
            {needsAttention.length === 1
              ? "1 produto não tem estoque suficiente para cobrir o prazo do fornecedor."
              : `${needsAttention.length} produtos não têm estoque suficiente para cobrir o prazo do fornecedor.`}{" "}
            Um aviso é enviado no WhatsApp quando o número configurado está verificado.
          </p>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Produto</th>
                <th className="px-4 py-3 text-right font-medium">Saldo</th>
                <th className="px-4 py-3 text-right font-medium">Venda/dia</th>
                <th className="px-4 py-3 text-right font-medium">Cobertura</th>
                <th className="px-4 py-3 text-left font-medium">Situação</th>
                <th className="px-4 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ item, coverage, stockoutAt }) => {
                const velocity = averageDailySales(sold.get(item.productId) ?? 0, SALES_WINDOW_DAYS);
                return (
                  <tr key={item.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/stock/${item.productId}`} className="font-medium hover:underline">
                        {item.product.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {item.product.sku}
                        {item.supplierName ? ` · ${item.supplierName}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">
                      <span className={item.quantity <= 0 ? "text-destructive" : undefined}>{item.quantity}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {velocity > 0 ? velocity.toFixed(1) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {coverage.daysOfCover === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <>
                          {Math.floor(coverage.daysOfCover)} dias
                          {stockoutAt && (
                            <div className="text-xs text-muted-foreground">
                              até {stockoutAt.toLocaleDateString("pt-BR")}
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        isOutOfStock={coverage.isOutOfStock}
                        needsReorder={coverage.needsReorder}
                        hasVelocity={coverage.daysOfCover !== null}
                        suggested={coverage.suggestedPurchaseUnits}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <ReorderSettingsDialog
                          productId={item.productId}
                          productName={item.product.name}
                          supplierName={item.supplierName}
                          leadTimeDays={item.leadTimeDays}
                          safetyDays={item.safetyDays}
                        />
                        <StockEntryDialog
                          productId={item.productId}
                          productName={item.product.name}
                          sku={item.product.sku}
                          currentQuantity={item.quantity}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Velocidade calculada sobre os últimos {SALES_WINDOW_DAYS} dias de pedidos reais, ignorando cancelados e
        devolvidos. Produtos sem venda no período não têm cobertura projetada — sem histórico, qualquer previsão
        seria chute.
      </p>
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Estoque</h1>
      <p className="text-sm text-muted-foreground">
        As vendas descontam o saldo automaticamente. Você só dá entrada no que chega.
      </p>
    </div>
  );
}

function SummaryCard({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "warning" }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p
          className={`mt-1 text-3xl font-semibold tabular-nums tracking-tight ${
            tone === "warning" && value !== "0" ? "text-warning" : ""
          }`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function StatusBadge({
  isOutOfStock,
  needsReorder,
  hasVelocity,
  suggested,
}: {
  isOutOfStock: boolean;
  needsReorder: boolean;
  hasVelocity: boolean;
  suggested: number | null;
}) {
  if (isOutOfStock) return <Badge variant="destructive">Zerado</Badge>;
  if (needsReorder) {
    return (
      <div className="flex flex-col items-start gap-0.5">
        <Badge variant="warning">Repor agora</Badge>
        {suggested && suggested > 0 && (
          <span className="text-xs text-muted-foreground">comprar ~{suggested} un.</span>
        )}
      </div>
    );
  }
  if (!hasVelocity) return <Badge variant="outline">Sem venda no período</Badge>;
  return <Badge variant="success">Saudável</Badge>;
}

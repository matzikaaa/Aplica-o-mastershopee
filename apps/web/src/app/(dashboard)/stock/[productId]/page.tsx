import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, History } from "lucide-react";
import { prisma, unitsSoldPerProduct, type StockMovementType } from "@mastershopee/database";
import { averageDailySales, calculateStockCoverage, projectStockoutDate } from "@mastershopee/inventory";
import { requireWorkspace } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StockEntryDialog } from "@/components/stock/stock-entry-dialog";
import { ReorderSettingsDialog } from "@/components/stock/reorder-settings-dialog";

export const dynamic = "force-dynamic";

const SALES_WINDOW_DAYS = 30;
const PAGE_SIZE = 100;

/**
 * Movement history for one product. The balance shown on the stock list is a
 * running total, and this is where it can be explained line by line — a
 * number the operator cannot audit is a number they cannot trust (§21, §83).
 */
export default async function StockDetailPage({ params }: { params: { productId: string } }) {
  const { workspace } = await requireWorkspace();

  // §8 — scope by workspace, never trust the id in the URL on its own.
  const product = await prisma.product.findFirst({
    where: { id: params.productId, workspaceId: workspace.id },
    select: { id: true, name: true, sku: true },
  });
  if (!product) notFound();

  const [item, movements, sold] = await Promise.all([
    prisma.stockItem.findUnique({ where: { productId: product.id } }),
    prisma.stockMovement.findMany({
      where: { stockItem: { productId: product.id } },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: PAGE_SIZE,
    }),
    unitsSoldPerProduct(workspace.id, SALES_WINDOW_DAYS),
  ]);

  const quantity = item?.quantity ?? 0;
  const velocity = averageDailySales(sold.get(product.id) ?? 0, SALES_WINDOW_DAYS);
  const coverage = calculateStockCoverage({
    quantity,
    averageDailySales: velocity,
    leadTimeDays: item?.leadTimeDays ?? 0,
    safetyDays: item?.safetyDays ?? 0,
  });
  const stockoutAt = projectStockoutDate(coverage);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/stock"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Estoque
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{product.name}</h1>
        <p className="text-sm text-muted-foreground">
          SKU {product.sku}
          {item?.supplierName ? ` · ${item.supplierName}` : ""}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Saldo atual" value={`${quantity} un.`} highlight={quantity <= 0} />
        <Stat label="Venda/dia (30d)" value={velocity > 0 ? velocity.toFixed(1) : "—"} />
        <Stat
          label="Cobertura"
          value={coverage.daysOfCover === null ? "—" : `${Math.floor(coverage.daysOfCover)} dias`}
        />
        <Stat
          label="Ruptura prevista"
          value={stockoutAt ? stockoutAt.toLocaleDateString("pt-BR") : "—"}
          highlight={coverage.needsReorder}
        />
      </div>

      <div className="flex gap-2">
        <ReorderSettingsDialog
          productId={product.id}
          productName={product.name}
          supplierName={item?.supplierName ?? null}
          leadTimeDays={item?.leadTimeDays ?? 0}
          safetyDays={item?.safetyDays ?? 0}
        />
        <StockEntryDialog
          productId={product.id}
          productName={product.name}
          sku={product.sku}
          currentQuantity={quantity}
        />
      </div>

      {movements.length === 0 ? (
        <EmptyState
          icon={History}
          title="Nenhuma movimentação registrada"
          description="As saídas aparecem sozinhas conforme os pedidos são sincronizados. Registre uma entrada para começar o histórico."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Data</th>
                  <th className="px-4 py-3 text-left font-medium">Movimento</th>
                  <th className="px-4 py-3 text-right font-medium">Qtd.</th>
                  <th className="px-4 py-3 text-right font-medium">Saldo após</th>
                  <th className="px-4 py-3 text-left font-medium">Observação</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                      {m.occurredAt.toLocaleDateString("pt-BR")}{" "}
                      <span className="text-xs">
                        {m.occurredAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <MovementBadge type={m.type} />
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums font-medium ${
                        m.quantity > 0 ? "text-success" : "text-destructive"
                      }`}
                    >
                      {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{m.balanceAfter}</td>
                    <td className="px-4 py-3 text-muted-foreground">{m.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {movements.length === PAGE_SIZE && (
        <p className="text-xs text-muted-foreground">
          Mostrando as {PAGE_SIZE} movimentações mais recentes.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${highlight ? "text-warning" : ""}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

const MOVEMENT_LABELS: Record<StockMovementType, { label: string; variant: "success" | "destructive" | "outline" }> = {
  PURCHASE_IN: { label: "Entrada", variant: "success" },
  SALE_OUT: { label: "Venda", variant: "destructive" },
  RETURN_IN: { label: "Devolução", variant: "outline" },
  CANCELLATION_IN: { label: "Cancelamento", variant: "outline" },
  ADJUSTMENT: { label: "Ajuste", variant: "outline" },
};

function MovementBadge({ type }: { type: StockMovementType }) {
  const config = MOVEMENT_LABELS[type];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

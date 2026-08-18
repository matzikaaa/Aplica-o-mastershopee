import Link from "next/link";
import { prisma } from "@mastershopee/database";
import { resolveDateRange, type DateRangePreset } from "@mastershopee/shared";
import { financialEngine } from "@mastershopee/financial-engine";
import Decimal from "decimal.js";
import { requireWorkspace } from "@/lib/session";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableHead, TableHeader, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { ShoppingCart } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  CREATED: "Criado",
  PAID: "Pago",
  SHIPPED: "Enviado",
  DELIVERED: "Entregue",
  CANCELED: "Cancelado",
  REFUNDED: "Reembolsado",
  RETURNED: "Devolvido",
};

export default async function OrdersPage({ searchParams }: { searchParams: { period?: string; page?: string } }) {
  const { workspace } = await requireWorkspace();
  const period = (searchParams.period ?? "last_30_days") as DateRangePreset;
  const range = resolveDateRange(period, workspace.timezone);
  const page = Number(searchParams.page ?? "1");
  const pageSize = 20;

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where: { workspaceId: workspace.id, orderedAt: { gte: range.from, lte: range.to } },
      include: { items: true },
      orderBy: { orderedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.order.count({ where: { workspaceId: workspace.id, orderedAt: { gte: range.from, lte: range.to } } }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pedidos</h1>
          <p className="text-sm text-muted-foreground">{total} pedidos no período selecionado.</p>
        </div>
        <DateRangePicker current={period} />
      </div>

      {orders.length === 0 ? (
        <EmptyState icon={ShoppingCart} title="Nenhum pedido neste período" description="Pedidos sincronizados aparecerão aqui automaticamente." />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pedido</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Marketplace</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Lucro</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => {
                const result = financialEngine.calculateOrder({
                  grossAmount: order.grossAmount,
                  discountAmount: order.discountAmount,
                  commissionAmount: order.commissionAmount,
                  marketplaceFeeAmount: order.marketplaceFeeAmount,
                  shippingSubsidizedByMerchant: order.shippingSubsidizedByMerchant,
                  taxAmount: order.taxAmount,
                  adSpendAttributed: order.adSpendAttributed,
                  items: order.items.map((i) => ({
                    quantity: i.quantity,
                    unitCost: i.unitCostSnapshot ?? new Decimal(0),
                  })),
                });
                return (
                  <TableRow key={order.id}>
                    <TableCell>
                      <Link href={`/orders/${order.id}`} className="font-medium text-primary hover:underline">
                        {order.externalOrderId}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDate(order.orderedAt)}</TableCell>
                    <TableCell>{order.marketplace}</TableCell>
                    <TableCell>{formatCurrency(order.grossAmount.toString())}</TableCell>
                    <TableCell className={result.netProfit.isNegative() ? "text-destructive" : "text-success"}>
                      {formatCurrency(result.netProfit.toFixed())}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{STATUS_LABELS[order.status] ?? order.status}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {total > pageSize && (
        <div className="flex justify-center gap-2 text-sm">
          {page > 1 && (
            <Link href={`?period=${period}&page=${page - 1}`} className="rounded-lg border border-border px-3 py-1.5 hover:bg-muted">
              Anterior
            </Link>
          )}
          <span className="px-3 py-1.5 text-muted-foreground">
            Página {page} de {Math.ceil(total / pageSize)}
          </span>
          {page * pageSize < total && (
            <Link href={`?period=${period}&page=${page + 1}`} className="rounded-lg border border-border px-3 py-1.5 hover:bg-muted">
              Próxima
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

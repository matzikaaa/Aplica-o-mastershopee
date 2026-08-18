import { notFound } from "next/navigation";
import Decimal from "decimal.js";
import { prisma } from "@mastershopee/database";
import { financialEngine } from "@mastershopee/financial-engine";
import { requireWorkspace } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/utils";

export default async function OrderDetailPage({ params }: { params: { id: string } }) {
  const { workspace } = await requireWorkspace();

  const order = await prisma.order.findFirst({
    where: { id: params.id, workspaceId: workspace.id },
    include: { items: true, refunds: true, cancellations: true, returns: true },
  });
  if (!order) notFound();

  const result = financialEngine.calculateOrder({
    grossAmount: order.grossAmount,
    discountAmount: order.discountAmount,
    commissionAmount: order.commissionAmount,
    marketplaceFeeAmount: order.marketplaceFeeAmount,
    shippingSubsidizedByMerchant: order.shippingSubsidizedByMerchant,
    taxAmount: order.taxAmount,
    adSpendAttributed: order.adSpendAttributed,
    refundAmount: order.refunds.reduce((acc, r) => acc.plus(r.amount as unknown as Decimal), new Decimal(0)),
    items: order.items.map((i) => ({ quantity: i.quantity, unitCost: i.unitCostSnapshot ?? new Decimal(0) })),
  });
  const breakdown = financialEngine.explain(result);

  const rows: { label: string; value: string; negative?: boolean }[] = [
    { label: "Venda", value: breakdown.grossRevenue },
    { label: "Descontos", value: breakdown.discounts, negative: true },
    { label: "Comissão", value: breakdown.commission, negative: true },
    { label: "Taxas do marketplace", value: breakdown.marketplaceFees, negative: true },
    { label: "ADS", value: breakdown.adSpend, negative: true },
    { label: "Produto", value: breakdown.productCost, negative: true },
    { label: "Embalagem", value: breakdown.packaging, negative: true },
    { label: "Imposto", value: breakdown.taxes, negative: true },
    { label: "Reembolsos", value: breakdown.refunds, negative: true },
    { label: "Outros custos", value: breakdown.otherCosts, negative: true },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pedido {order.externalOrderId}</h1>
          <p className="text-sm text-muted-foreground">
            {order.marketplace} · {formatDate(order.orderedAt)}
          </p>
        </div>
        <Badge variant="outline">{order.status}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Como calculamos o lucro deste pedido</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between border-b border-border/60 pb-2.5 text-sm last:border-0">
              <span className="text-muted-foreground">{row.label}</span>
              <span className={row.negative ? "font-medium text-destructive" : "font-medium"}>
                {row.negative && Number(row.value) !== 0 ? "-" : ""}
                {formatCurrency(row.value)}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between pt-2">
            <span className="text-base font-semibold">Lucro líquido</span>
            <span className={`text-lg font-semibold ${Number(breakdown.netProfit) < 0 ? "text-destructive" : "text-success"}`}>
              {formatCurrency(breakdown.netProfit)}
            </span>
          </div>
          <p className="pt-1 text-xs text-muted-foreground">Margem: {breakdown.marginPercent}%</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Itens</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {order.items.map((item) => (
            <div key={item.id} className="flex items-center justify-between text-sm">
              <div>
                <p className="font-medium">{item.title}</p>
                <p className="text-xs text-muted-foreground">
                  {item.externalSku} · {item.quantity}x {formatCurrency(item.unitPrice.toString())}
                </p>
              </div>
              <span className="font-medium">{formatCurrency(new Decimal(item.unitPrice).times(item.quantity).toFixed(2))}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

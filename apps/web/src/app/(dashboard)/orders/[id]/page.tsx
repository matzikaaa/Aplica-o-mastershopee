import { ORDER_STATUS_LABELS, costIsUnknown, nomeDoMarketplace } from "@mastershopee/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import Decimal from "decimal.js";
import { calcularPedido, prisma } from "@mastershopee/database";
import { financialEngine } from "@mastershopee/financial-engine";
import { requireWorkspace } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatPercent, formatCurrency, formatDate } from "@/lib/utils";

export default async function OrderDetailPage({ params }: { params: { id: string } }) {
  const { workspace } = await requireWorkspace();

  const order = await prisma.order.findFirst({
    where: { id: params.id, workspaceId: workspace.id },
    include: { items: true, refunds: true, cancellations: true, returns: true },
  });
  if (!order) notFound();

  const result = calcularPedido(order);
  const breakdown = financialEngine.explain(result);
  const itensSemCusto = order.items.filter((i) => costIsUnknown(i.unitCostSnapshot));

  const rows: { label: string; value: string; negative?: boolean }[] = [
    { label: "Venda", value: breakdown.grossRevenue },
    { label: "Descontos", value: breakdown.discounts, negative: true },
    { label: "Comissão", value: breakdown.commission, negative: true },
    { label: "Taxas do marketplace", value: breakdown.marketplaceFees, negative: true },
    // O frete pago pelo vendedor entrava na conta e não aparecia na lista: a
    // soma das linhas não batia com o lucro mostrado logo abaixo, justo na
    // tela que existe para provar o número. Toda parcela que o cálculo usa
    // tem que estar visível aqui, ou a prova vira um enigma.
    { label: "Frete pago por você", value: breakdown.shipping, negative: true },
    { label: "ADS", value: breakdown.adSpend, negative: true },
    { label: "Produto", value: breakdown.productCost, negative: true },
    { label: "Embalagem", value: breakdown.packaging, negative: true },
    { label: "Custo operacional", value: breakdown.operational, negative: true },
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
            {nomeDoMarketplace(order.marketplace)} · {formatDate(order.orderedAt)}
          </p>
        </div>
        <Badge variant="outline">{ORDER_STATUS_LABELS[order.status] ?? order.status}</Badge>
      </div>

      {/* O lucro abaixo trata custo desconhecido como zero e taxa não
          liberada como zero. As duas coisas fazem o número parecer melhor do
          que é — a tela que existe para provar o lucro tem que dizer isso. */}
      {(itensSemCusto.length > 0 || order.feesAreEstimated) && (
        <div className="space-y-1 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
          {itensSemCusto.length > 0 && (
            <p>
              {itensSemCusto.length === 1 ? "1 item sem custo cadastrado" : `${itensSemCusto.length} itens sem custo cadastrado`}
              : o lucro real é menor que o mostrado.{" "}
              <Link href="/costs" className="font-medium text-primary hover:underline">
                Cadastrar custo
              </Link>
            </p>
          )}
          {order.feesAreEstimated && (
            <p>A Shopee ainda não liberou as taxas deste pedido. Comissão e taxas entram quando o repasse sair.</p>
          )}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Como calculamos o lucro deste pedido</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between border-b border-border/60 pb-2.5 text-sm last:border-0">
              <span className="text-muted-foreground">{row.label}</span>
              {/* Zero não é perda: em vermelho, "R$ 0,00" competia por atenção
                  com o que realmente pesou no pedido. */}
              <span
                className={
                  Number(row.value) === 0
                    ? "font-medium text-muted-foreground"
                    : row.negative
                      ? "font-medium text-destructive"
                      : "font-medium"
                }
              >
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
          <p className="pt-1 text-xs text-muted-foreground">Margem: {formatPercent(breakdown.marginPercent, 2, false)}</p>
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
                  {costIsUnknown(item.unitCostSnapshot) ? (
                    <span className="text-warning"> · custo não cadastrado</span>
                  ) : (
                    <> · custo {formatCurrency(new Decimal(item.unitCostSnapshot!.toString()).toFixed(2))}/un</>
                  )}
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

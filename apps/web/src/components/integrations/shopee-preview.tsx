"use client";

import { useState } from "react";
import { Eye, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PreviewOrder {
  externalOrderId: string;
  status: string;
  orderedAt: string;
  feesFromEscrow: boolean;
  calculado: {
    grossAmount: string;
    discountAmount: string;
    shippingChargedToBuyer: string;
    shippingSubsidizedByMerchant: string;
    commissionAmount: string;
    marketplaceFeeAmount: string;
  };
  itens: { sku: string; title: string; quantity: number; unitPrice: string }[];
  shopee: unknown;
}

interface Preview {
  ok?: boolean;
  error?: string;
  windowDays?: number;
  orderCount?: number;
  ordersWithoutConfirmedFees?: number;
  hasMore?: boolean;
  orders?: PreviewOrder[];
}

const brl = (v: string) =>
  Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Conferência antes de gravar.
 *
 * O mapeamento dos campos financeiros da Shopee foi escrito contra a
 * documentação, não contra os dados desta loja. Esta tela puxa pedidos reais e
 * põe o cálculo ao lado do payload cru, para o vendedor comparar com o extrato
 * da Shopee. Nada aqui entra no banco.
 */
export function ShopeePreview() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Preview | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setResult(null);
    const res = await fetch("/api/integrations/shopee/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: 15 }),
    });
    setResult((await res.json()) as Preview);
    setLoading(false);
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">Prévia dos pedidos da Shopee</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Puxa os pedidos dos últimos 15 dias e mostra o cálculo ao lado do que a Shopee respondeu. Não grava nada.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={run} disabled={loading} className="shrink-0 gap-2">
          <Eye className="h-4 w-4" />
          {loading ? "Consultando..." : "Ver prévia"}
        </Button>
      </div>

      {result?.error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs">{result.error}</p>
      )}

      {result?.ok && (
        <div className="space-y-2 text-xs">
          <p className="rounded-lg bg-muted/40 px-3 py-2">
            {result.orderCount} pedido(s) nos últimos {result.windowDays} dias
            {result.hasMore ? " (há mais páginas)" : ""}.
          </p>

          {(result.ordersWithoutConfirmedFees ?? 0) > 0 && (
            <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {result.ordersWithoutConfirmedFees} pedido(s) sem taxa confirmada pela Shopee — o repasse ainda não foi
                liberado. Nesses, a comissão aparece como zero, o que <strong>infla o lucro</strong>. Só considere
                fechados os pedidos com taxa confirmada.
              </span>
            </p>
          )}

          {result.orderCount === 0 && (
            <p className="rounded-lg bg-muted/40 px-3 py-2">
              Nenhum pedido nessa janela. Se sua loja teve vendas nos últimos 15 dias, isso indica um problema de
              permissão ou de loja autorizada — e não uma loja parada.
            </p>
          )}

          {result.orders?.map((o) => (
            <div key={o.externalOrderId} className="rounded-lg border border-border px-3 py-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-[11px]">{o.externalOrderId}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{o.status}</span>
                <span className="text-muted-foreground">
                  {new Date(o.orderedAt).toLocaleDateString("pt-BR")}
                </span>
                {!o.feesFromEscrow && (
                  <span className="rounded bg-warning/20 px-1.5 py-0.5 text-[11px]">taxa não confirmada</span>
                )}
              </div>

              <div className="mt-2 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                <span>Receita bruta: <strong>{brl(o.calculado.grossAmount)}</strong></span>
                <span>Desconto: {brl(o.calculado.discountAmount)}</span>
                <span>Comissão: {brl(o.calculado.commissionAmount)}</span>
                <span>Taxas Shopee: {brl(o.calculado.marketplaceFeeAmount)}</span>
                <span>Frete pago pelo comprador: {brl(o.calculado.shippingChargedToBuyer)}</span>
                <span>Frete por sua conta: {brl(o.calculado.shippingSubsidizedByMerchant)}</span>
              </div>

              <ul className="mt-2 space-y-0.5 text-muted-foreground">
                {o.itens.map((i, idx) => (
                  <li key={`${i.sku}-${idx}`}>
                    {i.quantity}× <span className="font-mono text-[11px]">{i.sku}</span> — {i.title} a{" "}
                    {brl(i.unitPrice)}
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => setOpen(open === o.externalOrderId ? null : o.externalOrderId)}
                className="mt-2 underline underline-offset-2"
              >
                {open === o.externalOrderId ? "Esconder" : "Ver"} o que a Shopee respondeu
              </button>
              {open === o.externalOrderId && (
                <pre className="mt-2 max-h-72 overflow-auto rounded bg-muted/60 p-2 text-[10px] leading-relaxed">
                  {JSON.stringify(o.shopee, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

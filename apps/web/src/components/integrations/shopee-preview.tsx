"use client";

import { useState } from "react";
import { Download, Eye, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
  camposShopee: Record<string, number>;
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
interface SyncResult {
  ok?: boolean;
  error?: string;
  productsWritten?: number;
  productsWithoutCost?: number;
  ordersWritten?: number;
  ordersWithoutConfirmedFees?: number;
  hasMore?: boolean;
}

export function ShopeePreview() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Preview | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [sync, setSync] = useState<SyncResult | null>(null);

  /**
   * Toda chamada passa por aqui porque o modo de falhar é o mesmo: quando a
   * função serverless estoura o tempo, a resposta volta como HTML de erro, o
   * `res.json()` lança, e sem `finally` o botão fica girando para sempre —
   * escondendo justamente a falha que precisava aparecer.
   */
  async function chamar<T>(url: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        return {
          error: `O servidor respondeu ${res.status} sem JSON. Costuma ser tempo esgotado na função — tente de novo, que ela continua de onde parou.`,
        } as T;
      }
    } catch (err) {
      const abortado = err instanceof DOMException && err.name === "AbortError";
      return {
        error: abortado
          ? "A chamada passou de 2 minutos e foi interrompida. O que já entrou foi gravado — clique de novo para continuar."
          : `Falha de rede: ${err instanceof Error ? err.message : "desconhecida"}`,
      } as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      setResult(await chamar<Preview>("/api/integrations/shopee/preview", { days: 15 }));
    } finally {
      setLoading(false);
    }
  }

  async function importar() {
    setSyncing(true);
    setSync(null);
    let data: SyncResult;
    try {
      data = await chamar<SyncResult>("/api/integrations/shopee/sync-now", { days: 30 });
      setSync(data);
    } finally {
      setSyncing(false);
    }
    // O dashboard é server-rendered: sem isto, os pedidos recém-gravados só
    // apareceriam no próximo carregamento manual.
    if (data.ok) router.refresh();
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">Prévia dos pedidos da Shopee</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <strong>Ver prévia</strong> puxa os últimos 15 dias e mostra o cálculo ao lado da resposta crua da Shopee,
            sem gravar nada. <strong>Importar</strong> grava os últimos 30 dias no seu painel.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" onClick={run} disabled={loading || syncing} className="gap-2">
            <Eye className="h-4 w-4" />
            {loading ? "Consultando..." : "Ver prévia"}
          </Button>
          <Button size="sm" onClick={importar} disabled={loading || syncing} className="gap-2">
            <Download className="h-4 w-4" />
            {syncing ? "Importando..." : "Importar pedidos"}
          </Button>
        </div>
      </div>

      {sync?.error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs">
          {sync.error}
          {sync.ordersWritten ? ` (${sync.ordersWritten} pedido(s) já gravados antes da falha)` : ""}
        </p>
      )}

      {sync?.ok && (
        <div className="space-y-1 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs">
          <p>
            {sync.productsWritten} produto(s) e {sync.ordersWritten} pedido(s) gravados.{" "}
            {sync.hasMore
              ? "Ainda há pedidos na fila — clique em Importar de novo para continuar de onde parou."
              : "Nada mais pendente nessa janela."}
          </p>
          {/* Sem custo cadastrado, o pedido entra com margem igual à receita.
              O painel marca isso como "sem custo", mas dizer aqui é o que
              transforma a importação no próximo passo concreto. */}
          {(sync.productsWithoutCost ?? 0) > 0 && (
            <p>
              <strong>{sync.productsWithoutCost} produto(s) ainda sem custo cadastrado.</strong> Enquanto o custo não
              for preenchido, o lucro deles aparece como se o produto fosse de graça — o painel marca esses como "sem
              custo". Preencha em{" "}
              <Link href="/costs" className="underline underline-offset-2">
                Custos
              </Link>
              .
            </p>
          )}
          {(sync.ordersWithoutConfirmedFees ?? 0) > 0 && (
            <p>
              {sync.ordersWithoutConfirmedFees} deles entraram sem taxa confirmada pela Shopee e aparecem marcados —
              o lucro desses ainda não está fechado.
            </p>
          )}
        </div>
      )}

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

              {Object.keys(o.camposShopee ?? {}).length > 0 && (
                <div className="mt-2 rounded bg-muted/50 p-2">
                  <p className="mb-1 font-medium">Campos financeiros que a Shopee devolveu</p>
                  <div className="grid gap-x-4 sm:grid-cols-2">
                    {Object.entries(o.camposShopee).map(([k, v]) => (
                      <span key={k} className="flex justify-between gap-2 font-mono text-[11px]">
                        <span className="text-muted-foreground">{k}</span>
                        <span className="tabular-nums">{v.toFixed(2)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

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

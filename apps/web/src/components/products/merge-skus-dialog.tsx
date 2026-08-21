"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Merge, TriangleAlert } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";

export interface MergeCandidate {
  sku: string;
  name: string;
  orderItems: number;
  costs: number;
  units: number;
}

/**
 * Fold a duplicated SKU into the one that stays.
 *
 * The operation cannot be undone, so the dialog shows what each side actually
 * holds — orders, cost entries, units — before the button is live. Two
 * explicit selects rather than a "these look similar, merge?" suggestion: the
 * app has no way to know that LAVNDROLL-1 and LAVANDROLL-1 are the same
 * product, only the person selling them does.
 */
export function MergeSkusDialog({ products }: { products: MergeCandidate[] }) {
  const [open, setOpen] = useState(false);
  const [mergeSku, setMergeSku] = useState("");
  const [keepSku, setKeepSku] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const router = useRouter();

  const from = useMemo(() => products.find((p) => p.sku === mergeSku), [products, mergeSku]);
  const to = useMemo(() => products.find((p) => p.sku === keepSku), [products, keepSku]);
  const ready = Boolean(from && to && from.sku !== to.sku);

  async function submit() {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/products/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keepSku, mergeSku }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Não foi possível unificar.");
      return;
    }

    setDone(
      `${data.mergedSku} virou apelido de ${data.keptSku}. Movidos: ${data.orderItemsMoved} itens de pedido, ` +
        `${data.costsMoved} registros de custo, ${data.unitsTransferred} unidades de estoque.`,
    );
    setMergeSku("");
    setKeepSku("");
    router.refresh();
  }

  function close() {
    setOpen(false);
    setError(null);
    setDone(null);
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-2">
        <Merge className="h-4 w-4" /> Unificar SKUs
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title="Unificar SKUs"
        description="Quando o mesmo produto foi cadastrado com dois códigos, junte o histórico dos dois em um só."
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="merge-from">SKU que vai sumir</Label>
              <select
                id="merge-from"
                value={mergeSku}
                onChange={(e) => setMergeSku(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              >
                <option value="">— escolha —</option>
                {products.map((p) => (
                  <option key={p.sku} value={p.sku}>
                    {p.sku} — {p.name.slice(0, 40)}
                  </option>
                ))}
              </select>
              {from && (
                <p className="text-xs text-muted-foreground">
                  {from.orderItems} itens de pedido · {from.costs} custos · {from.units} un. em estoque
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="merge-into">SKU que fica</Label>
              <select
                id="merge-into"
                value={keepSku}
                onChange={(e) => setKeepSku(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              >
                <option value="">— escolha —</option>
                {products
                  .filter((p) => p.sku !== mergeSku)
                  .map((p) => (
                    <option key={p.sku} value={p.sku}>
                      {p.sku} — {p.name.slice(0, 40)}
                    </option>
                  ))}
              </select>
              {to && (
                <p className="text-xs text-muted-foreground">
                  {to.orderItems} itens de pedido · {to.costs} custos · {to.units} un. em estoque
                </p>
              )}
            </div>
          </div>

          {ready && (
            <div className="flex items-center justify-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
              <span className="font-medium">{from!.sku}</span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{to!.sku}</span>
              <span className="text-muted-foreground">
                · {from!.orderItems + to!.orderItems} itens · {from!.units + to!.units} un.
              </span>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p>
              Não dá para desfazer. O histórico não é apagado: pedidos, custos e movimentos de estoque passam para o SKU
              que fica, e o código que sumiu vira apelido — se você reimportar uma planilha antiga com ele, cai no lugar
              certo em vez de recriar a duplicata.
            </p>
          </div>

          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {done && (
            <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm">{done}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={close}>
              Fechar
            </Button>
            <Button size="sm" disabled={!ready || loading} onClick={submit}>
              {loading ? "Unificando..." : "Unificar"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

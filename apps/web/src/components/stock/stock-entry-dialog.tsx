"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus, PackagePlus } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

/**
 * Stock entry — the one thing the operator does by hand. Everything else
 * (sales going out) happens automatically from marketplace syncs, so this
 * stays deliberately single-purpose: a big readable counter, quick +/- steps,
 * and a live preview of the resulting balance so the number is confirmed
 * before it is committed.
 */
export function StockEntryDialog({
  productId,
  productName,
  sku,
  currentQuantity,
}: {
  productId: string;
  productName: string;
  sku: string;
  currentQuantity: number;
}) {
  const [open, setOpen] = useState(false);
  const [units, setUnits] = useState(0);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { push } = useToast();

  function reset() {
    setUnits(0);
    setNote("");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (units <= 0) return;

    setLoading(true);
    const res = await fetch("/api/stock/entry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, units, note: note.trim() || undefined }),
    });
    setLoading(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      push({ type: "error", title: "Não foi possível registrar a entrada.", description: body?.error });
      return;
    }

    const body = (await res.json()) as { balance: number };
    push({
      type: "success",
      title: `+${units} un. em ${productName}`,
      description: `Novo saldo: ${body.balance} unidades.`,
    });
    setOpen(false);
    reset();
    router.refresh();
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <PackagePlus className="mr-1.5 h-4 w-4" />
        Dar entrada
      </Button>

      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          reset();
        }}
        title={`Entrada de estoque — ${productName}`}
        description={`SKU ${sku} · saldo atual ${currentQuantity} un.`}
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Counter display */}
          <div className="rounded-2xl border border-border bg-muted/40 p-6">
            <p className="text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Quantidade recebida
            </p>
            <div className="mt-4 flex items-center justify-center gap-4">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Diminuir"
                onClick={() => setUnits((u) => Math.max(0, u - 1))}
                disabled={units <= 0}
              >
                <Minus className="h-4 w-4" />
              </Button>

              <input
                type="number"
                min={0}
                inputMode="numeric"
                aria-label="Unidades recebidas"
                value={units}
                onChange={(e) => setUnits(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                className="w-32 border-0 bg-transparent text-center text-5xl font-semibold tabular-nums tracking-tight text-foreground outline-none focus:ring-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />

              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Aumentar"
                onClick={() => setUnits((u) => u + 1)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-4 flex justify-center gap-2">
              {[10, 50, 100].map((step) => (
                <button
                  key={step}
                  type="button"
                  onClick={() => setUnits((u) => u + step)}
                  className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition hover:border-primary hover:text-primary"
                >
                  +{step}
                </button>
              ))}
            </div>

            <p className="mt-5 text-center text-sm text-muted-foreground">
              Saldo depois da entrada:{" "}
              <span className="font-semibold tabular-nums text-foreground">{currentQuantity + units} un.</span>
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note">Observação (opcional)</Label>
            <Input
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex.: NF 1234 — fornecedor Alfa"
              maxLength={280}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={loading || units <= 0}>
              {loading ? "Registrando..." : `Registrar ${units} un.`}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

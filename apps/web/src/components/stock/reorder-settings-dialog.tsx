"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Settings2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

/**
 * Reorder rules per product. The two numbers together define when the alert
 * fires: the supplier's lead time plus the slack the operator wants on top,
 * which is the same formula the worker uses (@mastershopee/inventory).
 */
export function ReorderSettingsDialog({
  productId,
  productName,
  supplierName,
  leadTimeDays,
  safetyDays,
}: {
  productId: string;
  productName: string;
  supplierName: string | null;
  leadTimeDays: number;
  safetyDays: number;
}) {
  const [open, setOpen] = useState(false);
  const [supplier, setSupplier] = useState(supplierName ?? "");
  const [lead, setLead] = useState(leadTimeDays);
  const [safety, setSafety] = useState(safetyDays);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { push } = useToast();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    const res = await fetch("/api/stock/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId,
        supplierName: supplier.trim() || null,
        leadTimeDays: lead,
        safetyDays: safety,
      }),
    });
    setLoading(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      push({ type: "error", title: "Não foi possível salvar.", description: body?.error });
      return;
    }

    push({ type: "success", title: "Regra de reposição atualizada", description: productName });
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Settings2 className="mr-1.5 h-4 w-4" />
        Reposição
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Reposição — ${productName}`}
        description="Define quando o aviso de estoque baixo é disparado."
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="supplier">Fornecedor (opcional)</Label>
            <Input
              id="supplier"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              placeholder="Ex.: Distribuidora Alfa"
              maxLength={120}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="lead">Prazo de entrega (dias)</Label>
              <Input
                id="lead"
                type="number"
                min={0}
                max={365}
                value={lead}
                onChange={(e) => setLead(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              />
              <p className="text-xs text-muted-foreground">Quanto o fornecedor demora para entregar.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="safety">Folga desejada (dias)</Label>
              <Input
                id="safety"
                type="number"
                min={0}
                max={365}
                value={safety}
                onChange={(e) => setSafety(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              />
              <p className="text-xs text-muted-foreground">Margem de segurança além do prazo.</p>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
            O aviso dispara quando restarem <strong className="tabular-nums">{lead + safety} dias</strong> de estoque
            no ritmo de venda atual — tempo suficiente para o pedido chegar antes de acabar.
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

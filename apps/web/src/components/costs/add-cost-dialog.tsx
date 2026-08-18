"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export function AddCostDialog({ productId, productName }: { productId: string; productName: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { push } = useToast();

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    const res = await fetch("/api/costs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId,
        unitCost: Number(formData.get("unitCost")),
        packagingCost: Number(formData.get("packagingCost") || 0),
        operationalCost: Number(formData.get("operationalCost") || 0),
        taxPercent: Number(formData.get("taxPercent") || 0),
        otherCosts: Number(formData.get("otherCosts") || 0),
        effectiveFrom: formData.get("effectiveFrom"),
      }),
    });
    setLoading(false);
    if (!res.ok) {
      push({ type: "error", title: "Não foi possível salvar o custo." });
      return;
    }
    push({ type: "success", title: "Custo atualizado", description: `${productName} — histórico preservado.` });
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Editar custo
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Novo custo — ${productName}`}
        description="Um novo registro de custo é criado; pedidos antigos continuam usando o custo vigente na data da venda."
      >
        <form action={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="unitCost">Custo unitário (R$)</Label>
              <Input id="unitCost" name="unitCost" type="number" step="0.01" min="0" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="packagingCost">Embalagem (R$)</Label>
              <Input id="packagingCost" name="packagingCost" type="number" step="0.01" min="0" defaultValue={0} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="operationalCost">Custo operacional (R$)</Label>
              <Input id="operationalCost" name="operationalCost" type="number" step="0.01" min="0" defaultValue={0} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="taxPercent">Imposto (%)</Label>
              <Input id="taxPercent" name="taxPercent" type="number" step="0.01" min="0" max="100" defaultValue={0} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="otherCosts">Outros custos (R$)</Label>
              <Input id="otherCosts" name="otherCosts" type="number" step="0.01" min="0" defaultValue={0} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="effectiveFrom">Vigente a partir de</Label>
              <Input id="effectiveFrom" name="effectiveFrom" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Salvando..." : "Salvar custo"}
          </Button>
        </form>
      </Dialog>
    </>
  );
}

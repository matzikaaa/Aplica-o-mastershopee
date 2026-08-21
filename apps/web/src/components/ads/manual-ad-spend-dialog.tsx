"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, TriangleAlert } from "lucide-react";
import { MARKETPLACE_LABELS, type MarketplaceType } from "@mastershopee/shared";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const MARKETPLACES: MarketplaceType[] = ["SHOPEE", "MERCADO_LIVRE", "SHEIN", "TIKTOK_SHOP"];

/**
 * Manual ad spend entry, for when the marketplace's report is a period total.
 *
 * The dialog is explicit that a period is split evenly and that the daily
 * numbers are a rateio, because the operator is the only one who can judge
 * whether that distortion matters for what they are about to read.
 */
export function ManualAdSpendDialog() {
  const [open, setOpen] = useState(false);
  const [marketplace, setMarketplace] = useState<MarketplaceType>("SHOPEE");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const router = useRouter();

  async function submit(formData: FormData) {
    setError(null);
    setDone(null);
    setLoading(true);

    const res = await fetch("/api/ads/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        marketplace,
        campaignName: formData.get("campaignName"),
        from: formData.get("from"),
        to: formData.get("to"),
        spend: formData.get("spend"),
        attributedRevenue: formData.get("attributedRevenue"),
        orders: formData.get("orders"),
      }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Não foi possível lançar.");
      return;
    }

    setDone(
      data.isEstimated
        ? `${data.campaign}: R$ ${data.perDaySpend.toFixed(2).replace(".", ",")} por dia em ${data.days} dias (rateio), ${data.daysRecomputed} dias recalculados.`
        : `${data.campaign}: lançado no dia, ${data.daysRecomputed} dia recalculado.`,
    );
    router.refresh();
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} className="gap-2">
        <Megaphone className="h-4 w-4" /> Lançar gasto de anúncio
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Lançar gasto de anúncio"
        description="Para marketplaces cuja API de anúncios ainda não está liberada. Reenviar o mesmo período corrige os dias em vez de somar em cima."
      >
        <form action={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Marketplace</Label>
            <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
              {MARKETPLACES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMarketplace(m)}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition",
                    marketplace === m ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {MARKETPLACE_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="campaignName">Campanha</Label>
            <Input id="campaignName" name="campaignName" required placeholder="Ex.: GMV Max — Sacos de lixo" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="from">De</Label>
              <Input id="from" name="from" required placeholder="01/08/2026" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">Até</Label>
              <Input id="to" name="to" placeholder="20/08/2026" />
              <p className="text-xs text-muted-foreground">Deixe vazio para lançar num único dia.</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="spend">Gasto total</Label>
              <Input id="spend" name="spend" required placeholder="234,93" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="attributedRevenue">Receita (opcional)</Label>
              <Input id="attributedRevenue" name="attributedRevenue" placeholder="2222,68" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="orders">Pedidos (opcional)</Label>
              <Input id="orders" name="orders" placeholder="115" />
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p>
              Lançando um período, o valor é dividido igualmente pelos dias. O total é o que você informou e está certo;
              o valor de cada dia é rateio, não medição — fica marcado como estimado para não se passar por número
              medido. Se você tiver o relatório com quebra diária, prefira importar por lá.
            </p>
          </div>

          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {done && <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm">{done}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Fechar
            </Button>
            <Button type="submit" size="sm" disabled={loading}>
              {loading ? "Lançando..." : "Lançar"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

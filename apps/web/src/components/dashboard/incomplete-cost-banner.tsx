"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Says out loud that the profit on screen is higher than the real one.
 *
 * The trap this exists for: a cost registered today does not apply to a sale
 * from May, because costs are date-effective. The catalogue looks complete —
 * every product has a cost — while the historical items still carry no cost
 * snapshot, and the margin comes out flattering and wrong. Counting products
 * without costs would miss it entirely; counting sold items without a cost
 * snapshot is what actually shows the hole.
 */
export function IncompleteCostBanner({ itemsWithoutCost }: { itemsWithoutCost: number }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const router = useRouter();

  async function applyToHistory() {
    setLoading(true);
    const res = await fetch("/api/costs/apply-to-history", { method: "POST" });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setResult(data.error ?? "Não foi possível aplicar.");
      return;
    }

    setResult(
      data.stillMissing > 0
        ? `${data.backdated} produto(s) atualizados, ${data.daysRecomputed} dias recalculados. Ainda restam ${data.stillMissing} itens sem custo — são SKUs vendidos que não têm custo cadastrado.`
        : `Pronto: ${data.backdated} produto(s) atualizados e ${data.daysRecomputed} dias recalculados. Agora o lucro é o real.`,
    );
    router.refresh();
  }

  return (
    <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            <span className="font-medium">O lucro abaixo está maior que o real.</span>{" "}
            {itemsWithoutCost.toLocaleString("pt-BR")} itens vendidos neste período estão sem custo, então entram como
            custo zero. Custo cadastrado hoje não vale para venda de meses atrás — se o preço que você paga hoje já valia
            antes, aplique ao histórico.
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Link href="/costs" className="text-sm font-medium text-primary hover:underline">
            Ver custos
          </Link>
          <Button size="sm" onClick={applyToHistory} disabled={loading}>
            {loading ? "Aplicando..." : "Aplicar ao histórico"}
          </Button>
        </div>
      </div>
      {result && <p className="pl-6 text-xs text-muted-foreground">{result}</p>}
    </div>
  );
}

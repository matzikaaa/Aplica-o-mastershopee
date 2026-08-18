"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PLAN_CATALOG, PLAN_ORDER, type PlanCode } from "@mastershopee/billing";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { cn, formatCurrency } from "@/lib/utils";

export function CreateWorkspaceForm() {
  const router = useRouter();
  const [planCode, setPlanCode] = useState<PlanCode>("PRO");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setError(null);
    setLoading(true);
    const res = await fetch("/api/onboarding/create-workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyName: formData.get("companyName"), planCode }),
    });
    setLoading(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body?.error ?? "Não foi possível criar sua empresa.");
      return;
    }
    router.refresh();
  }

  return (
    <form action={handleSubmit} className="space-y-6">
      <div className="space-y-1.5">
        <Label htmlFor="companyName">Nome da sua empresa/loja</Label>
        <Input id="companyName" name="companyName" placeholder="Ex: Loja do Marcos" required />
      </div>

      <div>
        <Label>Escolha seu plano</Label>
        <p className="mb-3 mt-1 text-xs text-muted-foreground">14 dias grátis em qualquer plano, sem cartão de crédito.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {PLAN_ORDER.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setPlanCode(code)}
              className={cn(
                "rounded-lg border p-3 text-left text-sm transition-colors",
                planCode === code ? "border-primary bg-primary/5" : "border-border hover:bg-muted",
              )}
            >
              <p className="font-semibold">{PLAN_CATALOG[code].name}</p>
              <p className="text-xs text-muted-foreground">{formatCurrency(PLAN_CATALOG[code].priceMonthly)}/mês</p>
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Criando..." : "Começar teste grátis"}
      </Button>
    </form>
  );
}

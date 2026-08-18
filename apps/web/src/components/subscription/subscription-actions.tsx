"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PLAN_CATALOG, PLAN_ORDER, type PlanCode } from "@mastershopee/billing";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

export function SubscriptionActions({ currentPlan }: { currentPlan: PlanCode }) {
  const [changeOpen, setChangeOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const router = useRouter();
  const { push } = useToast();

  async function changePlan(planCode: PlanCode) {
    const res = await fetch("/api/subscription/change-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planCode }),
    });
    if (!res.ok) {
      push({ type: "error", title: "Não foi possível alterar o plano." });
      return;
    }
    push({ type: "success", title: `Plano alterado para ${PLAN_CATALOG[planCode].name}` });
    setChangeOpen(false);
    router.refresh();
  }

  async function cancel() {
    const res = await fetch("/api/subscription/cancel", { method: "POST" });
    if (!res.ok) {
      push({ type: "error", title: "Não foi possível cancelar." });
      return;
    }
    push({ type: "info", title: "Assinatura será cancelada ao fim do período atual." });
    router.refresh();
  }

  return (
    <div className="flex flex-wrap gap-2 border-t border-border pt-4">
      <Button size="sm" onClick={() => setChangeOpen(true)}>
        Alterar plano
      </Button>
      <Button size="sm" variant="outline" disabled>
        Gerenciar cobrança
      </Button>
      <Button size="sm" variant="destructive" onClick={() => setCancelOpen(true)}>
        Cancelar assinatura
      </Button>

      <Dialog open={changeOpen} onClose={() => setChangeOpen(false)} title="Alterar plano">
        <div className="space-y-2">
          {PLAN_ORDER.map((code) => (
            <button
              key={code}
              onClick={() => changePlan(code)}
              disabled={code === currentPlan}
              className="flex w-full items-center justify-between rounded-lg border border-border p-3 text-left text-sm hover:bg-muted disabled:opacity-50"
            >
              <span>{PLAN_CATALOG[code].name}</span>
              <span className="text-muted-foreground">{code === currentPlan ? "Plano atual" : "Selecionar"}</span>
            </button>
          ))}
        </div>
      </Dialog>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={cancel}
        title="Cancelar assinatura?"
        description="Você continuará com acesso até o fim do período já pago."
        confirmLabel="Cancelar assinatura"
        destructive
      />
    </div>
  );
}

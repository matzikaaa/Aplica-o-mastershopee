"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PLAN_CATALOG, PLAN_ORDER, type PlanCode } from "@mastershopee/billing";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

export function SubscriptionActions({
  currentPlan,
  temCobranca,
  cancelamentoAgendado,
}: {
  currentPlan: PlanCode;
  /** Há cliente no Stripe: só então existe portal para abrir. */
  temCobranca: boolean;
  cancelamentoAgendado: boolean;
}) {
  const [changeOpen, setChangeOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const router = useRouter();
  const { push } = useToast();

  async function changePlan(planCode: PlanCode) {
    setEnviando(true);
    const res = await fetch("/api/subscription/change-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planCode }),
    });
    const dados = (await res.json().catch(() => ({}))) as { url?: string; mode?: string; error?: string };
    if (!res.ok) {
      setEnviando(false);
      push({ type: "error", title: "Não foi possível alterar o plano.", description: dados.error });
      return;
    }
    // Com o Stripe, a rota devolve o endereço do Checkout e o pagamento
    // acontece lá. Antes este retorno era ignorado e a tela dizia "Plano
    // alterado" sem ninguém ter pago — ninguém conseguia assinar.
    if (dados.url) {
      window.location.href = dados.url;
      return;
    }
    setEnviando(false);
    push({
      type: "success",
      title: `Plano alterado para ${PLAN_CATALOG[planCode].name}`,
      description: dados.mode === "updated" ? "A diferença proporcional entra na próxima fatura." : undefined,
    });
    setChangeOpen(false);
    router.refresh();
  }

  async function openPortal() {
    setEnviando(true);
    const res = await fetch("/api/subscription/portal", { method: "POST" });
    const dados = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !dados.url) {
      setEnviando(false);
      push({ type: "error", title: "Não foi possível abrir a cobrança.", description: dados.error });
      return;
    }
    window.location.href = dados.url;
  }

  async function cancel() {
    const res = await fetch("/api/subscription/cancel", { method: "POST" });
    const dados = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      push({ type: "error", title: "Não foi possível cancelar.", description: dados.error });
      return;
    }
    push({ type: "info", title: "Assinatura será cancelada ao fim do período atual." });
    router.refresh();
  }

  return (
    <div className="flex flex-wrap gap-2 border-t border-border pt-4">
      <Button size="sm" onClick={() => setChangeOpen(true)} disabled={enviando}>
        Alterar plano
      </Button>
      {/* Sem cliente no Stripe não há o que gerenciar; um botão sempre
          desativado só deixava a dúvida de onde trocar o cartão. */}
      {temCobranca && (
        <Button size="sm" variant="outline" onClick={openPortal} disabled={enviando}>
          Gerenciar cobrança
        </Button>
      )}
      {!cancelamentoAgendado && (
        <Button size="sm" variant="destructive" onClick={() => setCancelOpen(true)}>
          Cancelar assinatura
        </Button>
      )}

      <Dialog open={changeOpen} onClose={() => setChangeOpen(false)} title="Alterar plano">
        <div className="space-y-2">
          {PLAN_ORDER.map((code) => (
            <button
              key={code}
              onClick={() => changePlan(code)}
              disabled={code === currentPlan || enviando}
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
        description={
          temCobranca
            ? "Você continuará com acesso até o fim do período já pago, e não haverá nova cobrança."
            : "Você continua com acesso até o fim do teste grátis. Nada será cobrado."
        }
        confirmLabel="Cancelar assinatura"
        cancelLabel="Manter assinatura"
        destructive
      />
    </div>
  );
}

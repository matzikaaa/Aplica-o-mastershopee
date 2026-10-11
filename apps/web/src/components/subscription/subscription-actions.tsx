"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { PLAN_CATALOG, PLAN_ORDER, type PlanCode } from "@mastershopee/billing";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { PLAN_HIGHLIGHTS, PLAN_TAGLINES, mesesGratisNoAnual } from "@/lib/plan-highlights";
import { cn, formatCurrency } from "@/lib/utils";

type Intervalo = "monthly" | "yearly";

export function SubscriptionActions({
  temCobranca,
  cancelamentoAgendado,
}: {
  /** Há cliente no Stripe: só então existe portal para abrir. */
  temCobranca: boolean;
  cancelamentoAgendado: boolean;
}) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const router = useRouter();
  const { push } = useToast();

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

  if (!temCobranca && cancelamentoAgendado) return null;

  return (
    <div className="flex flex-wrap gap-2 border-t border-border pt-4">
      {/* Sem cliente no Stripe não há o que gerenciar; um botão sempre
          desativado só deixava a dúvida de onde trocar o cartão. */}
      {temCobranca && (
        <Button size="sm" variant="outline" onClick={openPortal} disabled={enviando}>
          Gerenciar cobrança
        </Button>
      )}
      {!cancelamentoAgendado && (
        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setCancelOpen(true)}>
          Cancelar assinatura
        </Button>
      )}

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

/**
 * Os planos lado a lado, com o que cada um inclui e o botão de escolher.
 *
 * Antes eram três caixas com nome e preço, e a troca ficava num diálogo que
 * listava só os nomes: quem ia decidir um upgrade não via o que ganhava.
 */
export function PlanPicker({
  currentPlan,
  intervaloAtual,
  semAssinaturaPaga,
}: {
  currentPlan: PlanCode;
  intervaloAtual: Intervalo;
  /**
   * Teste, teste vencido ou assinatura cancelada: escolher qualquer plano,
   * inclusive o atual, é assinar — quem foi bloqueado precisa poder pagar o
   * mesmo plano que já usava.
   */
  semAssinaturaPaga: boolean;
}) {
  const [intervalo, setIntervalo] = useState<Intervalo>(intervaloAtual);
  const [enviando, setEnviando] = useState<PlanCode | null>(null);
  const router = useRouter();
  const { push } = useToast();
  const meses = mesesGratisNoAnual(PLAN_CATALOG.PRO.priceMonthly, PLAN_CATALOG.PRO.priceYearly);

  async function escolher(planCode: PlanCode) {
    setEnviando(planCode);
    const res = await fetch("/api/subscription/change-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planCode, interval: intervalo }),
    });
    const dados = (await res.json().catch(() => ({}))) as { url?: string; mode?: string; error?: string };
    if (!res.ok) {
      setEnviando(null);
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
    setEnviando(null);
    push({
      type: "success",
      title: `Plano alterado para ${PLAN_CATALOG[planCode].name}`,
      description: dados.mode === "updated" ? "A diferença proporcional entra na próxima fatura." : undefined,
    });
    router.refresh();
  }

  return (
    <section className="space-y-3" aria-labelledby="titulo-planos">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="titulo-planos" className="text-base font-semibold">
          {semAssinaturaPaga ? "Escolha seu plano" : "Planos"}
        </h2>
        <div role="group" aria-label="Forma de cobrança" className="inline-flex rounded-lg bg-muted p-1 text-xs font-medium">
          {(["monthly", "yearly"] as const).map((i) => (
            <button
              key={i}
              type="button"
              aria-pressed={intervalo === i}
              onClick={() => setIntervalo(i)}
              className={cn(
                "rounded-md px-3 py-1.5 transition-colors",
                intervalo === i ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {i === "monthly" ? "Mensal" : `Anual · ${meses} meses grátis`}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {PLAN_ORDER.map((code) => {
          const plano = PLAN_CATALOG[code];
          const ehOAtual = code === currentPlan && intervalo === intervaloAtual && !semAssinaturaPaga;
          const rotulo = ehOAtual
            ? "Plano atual"
            : semAssinaturaPaga
              ? `Assinar ${plano.name}`
              : code === currentPlan
                ? `Mudar para ${intervalo === "yearly" ? "anual" : "mensal"}`
                : `Mudar para ${plano.name}`;
          return (
            <div
              key={code}
              className={cn(
                "flex flex-col rounded-xl border p-4 text-sm",
                code === currentPlan ? "border-primary bg-primary/5" : "border-border bg-card",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">{plano.name}</p>
                {code === currentPlan && <span className="text-xs font-medium text-primary">Seu plano</span>}
              </div>
              <p className="text-xs text-muted-foreground">{PLAN_TAGLINES[code]}</p>
              <p className="mt-3 text-xl font-semibold tabular-nums">
                {formatCurrency(intervalo === "yearly" ? plano.priceYearly : plano.priceMonthly)}
                <span className="text-sm font-normal text-muted-foreground">/{intervalo === "yearly" ? "ano" : "mês"}</span>
              </p>
              <ul className="mt-3 flex-1 space-y-2">
                {PLAN_HIGHLIGHTS[code].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <Button
                size="sm"
                className="mt-4 w-full"
                variant={code === currentPlan ? "primary" : "outline"}
                disabled={ehOAtual || enviando !== null}
                onClick={() => escolher(code)}
              >
                {enviando === code ? "Abrindo..." : rotulo}
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

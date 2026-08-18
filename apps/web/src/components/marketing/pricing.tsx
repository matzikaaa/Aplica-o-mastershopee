import Link from "next/link";
import { Check } from "lucide-react";
import { PLAN_CATALOG, PLAN_ORDER } from "@mastershopee/billing";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";

const PLAN_TAGLINES: Record<string, string> = {
  STARTER: "Para vendedores iniciantes.",
  PRO: "Para operações em crescimento.",
  SCALE: "Para alto volume e times.",
};

const PLAN_HIGHLIGHTS: Record<string, string[]> = {
  STARTER: [
    "1 conta por marketplace (Shopee, ML, SHEIN, TikTok Shop)",
    "Dashboard completo de lucro líquido",
    "Gestão de custos com histórico",
    "Relatórios básicos",
    "Resumo diário (sem WhatsApp)",
  ],
  PRO: [
    "Até 3 contas por marketplace",
    "Painel de Publicidade (ROAS, ACOS)",
    "Resumo diário via WhatsApp",
    "Alertas configuráveis",
    "Relatórios avançados e exportação",
  ],
  SCALE: [
    "Até 10 contas por marketplace",
    "Volume de pedidos ilimitado",
    "Múltiplos usuários e permissões",
    "Suporte prioritário",
    "Recursos e integrações premium",
  ],
};

export function Pricing() {
  return (
    <section id="planos" className="px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto mb-14 max-w-2xl text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-primary">Planos</p>
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Escolha o plano do tamanho da sua operação
          </h2>
          <p className="mt-4 text-muted-foreground">14 dias de teste grátis em qualquer plano. Cancele quando quiser.</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {PLAN_ORDER.map((code) => {
            const plan = PLAN_CATALOG[code];
            const isFeatured = code === "PRO";
            return (
              <div
                key={code}
                className={cn(
                  "relative flex flex-col rounded-2xl border p-6",
                  isFeatured ? "border-primary bg-primary/5 shadow-lg shadow-primary/10" : "border-border bg-card",
                )}
              >
                {isFeatured && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                    Mais popular
                  </span>
                )}
                <h3 className="text-lg font-semibold">{plan.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{PLAN_TAGLINES[code]}</p>
                <p className="mt-6 text-3xl font-semibold">
                  {formatCurrency(plan.priceMonthly)}
                  <span className="text-base font-normal text-muted-foreground">/mês</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  ou {formatCurrency(plan.priceYearly)}/ano
                </p>
                <ul className="mt-6 flex-1 space-y-3 text-sm">
                  {PLAN_HIGHLIGHTS[code]?.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/register?plan=${code.toLowerCase()}`}
                  className={buttonVariants({ variant: isFeatured ? "primary" : "outline", className: "mt-8 w-full" })}
                >
                  Começar com {plan.name}
                </Link>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

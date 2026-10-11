import type { PlanCode } from "@mastershopee/billing";

/**
 * O que cada plano inclui, em palavras de vendedor.
 *
 * Um lugar só para o site e para a tela de Assinatura: a página de preços
 * dizia o que cada plano tinha e a Assinatura mostrava só nome e preço —
 * quem ia decidir um upgrade dentro do app não tinha o que comparar.
 */
export const PLAN_TAGLINES: Record<PlanCode, string> = {
  STARTER: "Para vendedores iniciantes.",
  PRO: "Para operações em crescimento.",
  SCALE: "Para alto volume e times.",
};

export const PLAN_HIGHLIGHTS: Record<PlanCode, string[]> = {
  STARTER: [
    "1 conta Shopee (Mercado Livre, SHEIN e TikTok Shop em breve)",
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
    "Múltiplos usuários e permissões (em breve)",
    "Suporte prioritário",
    "Histórico de relatórios de 36 meses",
  ],
};

/** Quantos meses o plano anual economiza em relação a pagar mês a mês. */
export function mesesGratisNoAnual(priceMonthly: number, priceYearly: number): number {
  return Math.round((priceMonthly * 12 - priceYearly) / priceMonthly);
}

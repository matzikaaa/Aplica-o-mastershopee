export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "expired"
  | "incomplete";

/**
 * Backend-enforced access rules for the subscription state machine (§31).
 * The frontend never independently decides whether premium features are
 * unlocked — every gated route/action re-checks this against the
 * workspace's current Subscription row.
 */
export const FULL_ACCESS_STATUSES: SubscriptionStatus[] = ["trialing", "active"];
/** Grace period: user keeps read access so they don't lose visibility while fixing payment, but cannot create new resources. */
export const GRACE_ACCESS_STATUSES: SubscriptionStatus[] = ["past_due"];
export const BLOCKED_STATUSES: SubscriptionStatus[] = ["canceled", "expired", "incomplete"];

export function hasDashboardAccess(status: SubscriptionStatus): boolean {
  return FULL_ACCESS_STATUSES.includes(status) || GRACE_ACCESS_STATUSES.includes(status);
}

export function hasFullAccess(status: SubscriptionStatus): boolean {
  return FULL_ACCESS_STATUSES.includes(status);
}

export function isInGracePeriod(status: SubscriptionStatus): boolean {
  return GRACE_ACCESS_STATUSES.includes(status);
}

/**
 * O status que vale agora, não o que está gravado.
 *
 * O teste grátis nasce como `trialing` com `trialEndsAt`, e nada voltava para
 * encerrá-lo: o único caminho até `expired` era o webhook do Stripe, que um
 * usuário em teste nunca tocou. O resultado era acesso completo para sempre,
 * de graça — o vazamento de receita mais direto que um produto vendido por
 * assinatura pode ter, e invisível, porque nada quebra: o cliente só não paga.
 *
 * Derivado na leitura em vez de gravado por um agendador. Um cron que vira o
 * status pode falhar, atrasar ou não existir (o plano gratuito da Vercel roda
 * um por dia); a comparação de datas na hora da leitura não pode.
 *
 * Só se aplica a teste sem assinatura no provedor de pagamento. Quando há
 * `providerSubscriptionId`, quem manda é o Stripe — inclusive num teste que
 * ele mesmo administra — e o webhook é a fonte da verdade.
 */
export function statusEfetivo(
  sub: { status: SubscriptionStatus; trialEndsAt: Date | null; providerSubscriptionId?: string | null },
  agora: Date = new Date(),
): SubscriptionStatus {
  if (sub.status !== "trialing") return sub.status;
  if (sub.providerSubscriptionId) return sub.status;
  if (sub.trialEndsAt && sub.trialEndsAt.getTime() <= agora.getTime()) return "expired";
  return sub.status;
}

/** Dias inteiros que faltam no teste, ou null fora de teste. Nunca negativo. */
export function diasRestantesDeTeste(
  sub: { status: SubscriptionStatus; trialEndsAt: Date | null; providerSubscriptionId?: string | null },
  agora: Date = new Date(),
): number | null {
  if (statusEfetivo(sub, agora) !== "trialing" || !sub.trialEndsAt) return null;
  const ms = sub.trialEndsAt.getTime() - agora.getTime();
  return Math.max(0, Math.ceil(ms / (24 * 3600 * 1000)));
}

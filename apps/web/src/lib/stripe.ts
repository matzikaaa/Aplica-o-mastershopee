import Stripe from "stripe";
import type { SubscriptionStatus } from "@mastershopee/database";

/**
 * Cliente do Stripe, construído no primeiro uso.
 *
 * Nunca no escopo do módulo: o Next importa todas as rotas para coletar
 * dados de página no build, e um construtor que exige a chave transformaria
 * "Stripe não configurado" em falha de build de uma rota qualquer — o mesmo
 * problema que o ioredis já causou aqui.
 */
let client: Stripe | null = null;

export class StripeNotConfiguredError extends Error {
  constructor() {
    super("Pagamento não configurado (STRIPE_SECRET_KEY ausente).");
    this.name = "StripeNotConfiguredError";
  }
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeNotConfiguredError();
  client ??= new Stripe(key, { apiVersion: "2024-06-20" as Stripe.LatestApiVersion });
  return client;
}

/**
 * Status do Stripe → status desta aplicação.
 *
 * Explícito, sem `default: "active"`: um status novo do Stripe caindo em
 * "ativo" daria acesso pago a quem parou de pagar. O desconhecido vira
 * `incomplete`, que bloqueia sem apagar a assinatura.
 */
export function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "canceled":
      return "canceled";
    case "unpaid":
      return "expired";
    case "incomplete":
    case "incomplete_expired":
    case "paused":
      return "incomplete";
    default:
      return "incomplete";
  }
}

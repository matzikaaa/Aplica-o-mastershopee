import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@mastershopee/database";
import { getStripe, isStripeConfigured, mapStripeStatus } from "@/lib/stripe";
import { captureError } from "@/lib/observability";

/**
 * Receptor de webhooks do Stripe (§30, §35).
 *
 * O Stripe é a única fonte de verdade sobre o que o cliente pagou. Esta rota
 * é o que traz essa verdade para dentro — e por isso é também a superfície
 * mais sensível da aplicação: quem conseguir forjar uma chamada aqui se
 * concede plano pago.
 *
 * Daí a ordem ser obrigatória: verificar a assinatura sobre o corpo **cru**
 * antes de qualquer parse. O `constructEvent` do Stripe recalcula o HMAC do
 * byte a byte recebido; ler como JSON primeiro e reserializar muda os bytes
 * e quebra a verificação — quando não quebra, é porque alguém a removeu.
 */
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!isStripeConfigured() || !secret) {
    return NextResponse.json({ error: "Stripe não configurado." }, { status: 501 });
  }
  if (!signature) {
    return NextResponse.json({ error: "Assinatura ausente." }, { status: 400 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    // Não registrar como erro de aplicação: assinatura inválida é o
    // comportamento esperado para uma chamada forjada, e encher o
    // monitoramento com isso esconderia falhas reais.
    return NextResponse.json(
      { error: `Assinatura inválida: ${err instanceof Error ? err.message : "desconhecido"}` },
      { status: 400 },
    );
  }

  // Idempotência (§35, §87): o Stripe reenvia a mesma entrega quando não
  // recebe 2xx rápido o bastante. A chave primária faz a segunda entrega
  // falhar na inserção em vez de reprocessar — reaplicar "assinatura
  // cancelada" muda o acesso de um cliente pagante.
  try {
    await prisma.stripeEvent.create({ data: { id: event.id, type: event.type } });
  } catch {
    return NextResponse.json({ received: true, duplicated: true });
  }

  try {
    await handle(event);
  } catch (err) {
    captureError(err, { route: "webhooks.stripe", eventId: event.id, type: event.type });
    // Devolve 500 de propósito: o Stripe reenvia, e o registro do evento é
    // apagado logo abaixo para que o reenvio não caia como duplicado.
    await prisma.stripeEvent.delete({ where: { id: event.id } }).catch(() => undefined);
    return NextResponse.json({ error: "Falha ao processar o evento." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handle(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const workspaceId = session.metadata?.workspaceId;
      const planId = session.metadata?.planId;
      if (!workspaceId || !planId) return;

      await prisma.subscription.update({
        where: { workspaceId },
        data: {
          planId,
          status: "active",
          providerCustomerId: typeof session.customer === "string" ? session.customer : undefined,
          providerSubscriptionId:
            typeof session.subscription === "string" ? session.subscription : undefined,
          cancelAtPeriodEnd: false,
        },
      });
      await prisma.auditLog.create({
        data: { workspaceId, action: "subscription.activated", metadata: { sessionId: session.id } },
      });
      return;
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      // Localizado pelo id da assinatura, não pelo workspace no metadata: o
      // metadata pode não ter viajado em eventos gerados no painel do Stripe.
      const existing = await prisma.subscription.findFirst({
        where: { providerSubscriptionId: sub.id },
      });
      if (!existing) return;

      // O período vive nos itens da assinatura desde a v18 do SDK, não mais
      // no topo. Como nossos planos têm um item só, o do primeiro item é o
      // período da assinatura.
      const item = sub.items?.data?.[0];

      await prisma.subscription.update({
        where: { id: existing.id },
        data: {
          status: event.type === "customer.subscription.deleted" ? "canceled" : mapStripeStatus(sub.status),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          currentPeriodStart: item ? new Date(item.current_period_start * 1000) : undefined,
          currentPeriodEnd: item ? new Date(item.current_period_end * 1000) : undefined,
          canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
        },
      });
      return;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      // A fatura aponta para a assinatura por `parent.subscription_details`
      // desde a v18; o campo `subscription` de topo não existe mais.
      const detalhes = invoice.parent?.subscription_details?.subscription;
      const subscriptionId = typeof detalhes === "string" ? detalhes : detalhes?.id;
      if (!subscriptionId) return;

      const existing = await prisma.subscription.findFirst({
        where: { providerSubscriptionId: subscriptionId },
      });
      if (!existing) return;

      await prisma.subscription.update({ where: { id: existing.id }, data: { status: "past_due" } });
      await prisma.notification.create({
        data: {
          workspaceId: existing.workspaceId,
          title: "Pagamento recusado",
          body: "Não conseguimos cobrar sua assinatura. Atualize a forma de pagamento para não perder o acesso.",
        },
      });
      return;
    }

    default:
      // Eventos que não afetam acesso são aceitos e ignorados: responder erro
      // faria o Stripe reenviar para sempre.
      return;
  }
}

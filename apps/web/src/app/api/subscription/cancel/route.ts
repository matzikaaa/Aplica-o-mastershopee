import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";
import { getStripe, isStripeConfigured } from "@/lib/stripe";

/**
 * Cancela ao fim do período já pago.
 *
 * Marcava só o banco daqui: a tela dizia "será cancelada" e o Stripe seguia
 * cobrando o cartão todo mês — e o próximo webhook ainda desfazia a marca,
 * porque para o Stripe nada tinha mudado. Quem cobra é o Stripe, então é
 * nele que o cancelamento tem que acontecer primeiro.
 */
export async function POST() {
  const { workspace, role } = await requireWorkspace();
  if (role !== "OWNER") {
    return NextResponse.json({ error: "Apenas o proprietário pode cancelar a assinatura." }, { status: 403 });
  }

  const subscription = await prisma.subscription.findUnique({ where: { workspaceId: workspace.id } });
  if (subscription?.providerSubscriptionId) {
    if (!isStripeConfigured()) {
      return NextResponse.json({ error: "Integração de pagamento não configurada." }, { status: 501 });
    }
    try {
      await getStripe().subscriptions.update(subscription.providerSubscriptionId, { cancel_at_period_end: true });
    } catch {
      // Sem a confirmação do Stripe não dá para dizer que cancelou: a
      // cobrança continuaria e o cliente acreditaria no contrário.
      return NextResponse.json(
        { error: "Não foi possível cancelar no sistema de pagamento. Tente de novo em instantes." },
        { status: 502 },
      );
    }
  }

  await prisma.subscription.update({
    where: { workspaceId: workspace.id },
    data: { cancelAtPeriodEnd: true, canceledAt: new Date() },
  });

  await prisma.auditLog.create({ data: { workspaceId: workspace.id, action: "subscription.canceled" } });

  return NextResponse.json({ ok: true });
}

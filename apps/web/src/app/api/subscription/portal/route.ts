import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";
import { getStripe, isStripeConfigured } from "@/lib/stripe";

/**
 * Abre o portal de cobrança do Stripe.
 *
 * É onde o cliente troca o cartão, baixa recibos e cancela. Construir essas
 * telas aqui significaria reimplementar — com menos cuidado — algo que o
 * Stripe já mantém, e ainda passar dados de cartão pela nossa aplicação.
 *
 * Cancelar tem que ser tão fácil quanto assinar; esconder o cancelamento é
 * prática abusiva pelo CDC, além de gerar chargeback.
 */
export async function POST(request: Request) {
  const { workspace, role } = await requireWorkspace();
  if (role !== "OWNER") {
    return NextResponse.json({ error: "Apenas o proprietário pode gerenciar a assinatura." }, { status: 403 });
  }
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Integração de pagamento não configurada." }, { status: 501 });
  }

  const subscription = await prisma.subscription.findUnique({ where: { workspaceId: workspace.id } });
  if (!subscription?.providerCustomerId) {
    return NextResponse.json(
      { error: "Nenhuma assinatura paga encontrada para este workspace." },
      { status: 404 },
    );
  }

  const baseUrl = process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? new URL(request.url).origin;
  const session = await getStripe().billingPortal.sessions.create({
    customer: subscription.providerCustomerId,
    return_url: `${baseUrl}/subscription`,
    locale: "pt-BR",
  });

  return NextResponse.json({ ok: true, url: session.url });
}

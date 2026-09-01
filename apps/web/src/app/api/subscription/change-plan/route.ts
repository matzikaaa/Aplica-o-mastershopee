import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";
import { getStripe, isStripeConfigured } from "@/lib/stripe";

const PLAN_CODES = ["STARTER", "PRO", "SCALE"] as const;

/**
 * §30-32: plan changes. In production this should be driven by Stripe
 * Checkout/Billing Portal + webhooks (STRIPE_SECRET_KEY, pending — see
 * .env.example and app/api/webhooks/stripe/route.ts), which is the only
 * source of truth for what the customer actually paid for. Without Stripe
 * keys configured, this route updates the Subscription record directly so
 * plan gating can be exercised in development/demo — it must NOT be
 * treated as a real payment flow.
 */
export async function POST(request: Request) {
  const { workspace, user, role } = await requireWorkspace();
  if (role !== "OWNER") {
    return NextResponse.json({ error: "Apenas o proprietário pode alterar o plano." }, { status: 403 });
  }

  const body = (await request.json()) as { planCode?: string; interval?: "monthly" | "yearly" };
  // Validado contra o enum antes de virar consulta: `planCode` chega do
  // cliente, e o tipo do Prisma existe justamente para não aceitar qualquer
  // string aqui.
  const planCode = PLAN_CODES.find((c) => c === body.planCode);
  const plan = planCode ? await prisma.plan.findUnique({ where: { code: planCode } }) : null;
  if (!plan) {
    return NextResponse.json({ error: "Plano inválido." }, { status: 400 });
  }

  // Guarded by NODE_ENV, not just the Stripe key: if this ever ran in a
  // deployed production environment where Stripe setup was simply
  // forgotten, any workspace owner could grant themselves the top plan
  // for free indefinitely. The dev-mode escape hatch must be structurally
  // impossible to reach in production, not just conditional on configuration.
  if (!process.env.STRIPE_SECRET_KEY && process.env.NODE_ENV !== "production") {
    await prisma.subscription.update({
      where: { workspaceId: workspace.id },
      data: { planId: plan.id, status: "active" },
    });
    await prisma.auditLog.create({
      data: { workspaceId: workspace.id, action: "subscription.plan_changed_dev_mode", metadata: { planCode } },
    });
    return NextResponse.json({ ok: true, mode: "dev" });
  }

  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Integração de pagamento não configurada." }, { status: 501 });
  }

  const interval: "monthly" | "yearly" = body.interval === "yearly" ? "yearly" : "monthly";
  const priceId = interval === "yearly" ? plan.stripePriceIdYearly : plan.stripePriceIdMonthly;
  if (!priceId) {
    return NextResponse.json(
      { error: `O plano ${plan.name} não tem preço ${interval === "yearly" ? "anual" : "mensal"} configurado no Stripe.` },
      { status: 409 },
    );
  }

  const stripe = getStripe();
  const subscription = await prisma.subscription.findUnique({ where: { workspaceId: workspace.id } });
  const baseUrl = process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? new URL(request.url).origin;

  // Checkout, não alteração direta: quem decide o que foi pago é o Stripe, e
  // esta rota nunca escreve o plano. Quem escreve é o webhook, depois que o
  // pagamento aconteceu de verdade — senão bastaria chamar este endpoint para
  // se conceder o plano mais caro.
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    customer: subscription?.providerCustomerId ?? undefined,
    customer_email: subscription?.providerCustomerId ? undefined : user.email,
    client_reference_id: workspace.id,
    // Viaja de volta no webhook: é como o evento sabe qual workspace ativar.
    metadata: { workspaceId: workspace.id, planId: plan.id },
    subscription_data: { metadata: { workspaceId: workspace.id, planId: plan.id } },
    success_url: `${baseUrl}/subscription?checkout=sucesso`,
    cancel_url: `${baseUrl}/subscription?checkout=cancelado`,
    locale: "pt-BR",
  });

  await prisma.auditLog.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      action: "subscription.checkout_started",
      metadata: { planCode, interval, sessionId: session.id },
    },
  });

  return NextResponse.json({ ok: true, url: session.url });
}

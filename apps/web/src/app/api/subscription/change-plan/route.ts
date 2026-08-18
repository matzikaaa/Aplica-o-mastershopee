import { NextResponse } from "next/server";
import { prisma } from "@mastershopee/database";
import { requireWorkspace } from "@/lib/session";

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
  const { workspace, role } = await requireWorkspace();
  if (role !== "OWNER") {
    return NextResponse.json({ error: "Apenas o proprietário pode alterar o plano." }, { status: 403 });
  }

  const { planCode } = await request.json();
  const plan = await prisma.plan.findUnique({ where: { code: planCode } });
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

  // TODO: redirect to Stripe Checkout / update the Stripe subscription's price
  // and let the `customer.subscription.updated` webhook update this record.
  return NextResponse.json({ error: "Integração de pagamento não configurada." }, { status: 501 });
}

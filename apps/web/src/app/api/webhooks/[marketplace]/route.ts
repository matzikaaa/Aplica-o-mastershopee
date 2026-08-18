import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma, Prisma } from "@mastershopee/database";
import { createProvider } from "@mastershopee/integrations";
import { getIntegrationEnv } from "@/lib/integration-env";
import { SLUG_TO_MARKETPLACE } from "@/lib/marketplace-slug";
import { webhookProcessingQueue } from "@/lib/queue";
import { getClientIp, isAllowed } from "@/lib/rate-limit";

/**
 * Generic marketplace webhook receiver (§35). Validates signature where the
 * provider supports it, stores the event idempotently (unique on
 * [marketplace, externalEventId] — §87), and enqueues background
 * processing — never does real work inline, so the marketplace always
 * gets a fast response regardless of downstream load.
 */
export async function POST(request: Request, { params }: { params: { marketplace: string } }) {
  const marketplace = SLUG_TO_MARKETPLACE[params.marketplace];
  if (!marketplace) {
    return NextResponse.json({ error: "Unknown marketplace" }, { status: 404 });
  }

  // Not every provider can verify a signature (only Shopee implements
  // verifyWebhookSignature today — see packages/integrations/README.md).
  // For the rest, `externalShopId` values (e.g. Mercado Livre's user_id)
  // are guessable, so an unauthenticated caller could otherwise trigger
  // real sync jobs against a real merchant's account by guessing IDs.
  // Rate limit per marketplace+IP as defense in depth regardless of
  // whether this specific delivery turns out to carry a valid signature.
  if (!(await isAllowed(`webhook:${marketplace}:${getClientIp(request)}`, 60, 60))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const rawBody = await request.text();
  const headers = Object.fromEntries(request.headers.entries());

  const provider = createProvider(marketplace, getIntegrationEnv());
  let signatureValid = true;
  if (provider.verifyWebhookSignature) {
    signatureValid = provider.verifyWebhookSignature(rawBody, headers);
    if (!signatureValid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const externalEventId = extractEventId(payload, rawBody);
  const externalShopId = extractShopId(marketplace, payload);

  const account = externalShopId
    ? await prisma.marketplaceAccount.findFirst({ where: { marketplace, externalShopId } })
    : null;

  // Idempotent by construction: a duplicate delivery hits the unique
  // constraint and this becomes a no-op read instead of double-processing.
  const existing = await prisma.webhookEvent.findUnique({
    where: { marketplace_externalEventId: { marketplace, externalEventId } },
  });
  if (existing) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  const event = await prisma.webhookEvent.create({
    data: {
      workspaceId: account?.workspaceId,
      marketplaceAccountId: account?.id,
      marketplace,
      externalEventId,
      eventType: typeof payload.topic === "string" ? payload.topic : typeof payload.type === "string" ? payload.type : "unknown",
      payload: payload as Prisma.InputJsonValue,
      signatureValid,
    },
  });

  await webhookProcessingQueue.add("process", { webhookEventId: event.id });

  return NextResponse.json({ received: true });
}

function extractEventId(payload: Record<string, unknown>, rawBody: string): string {
  const candidate = payload._id ?? payload.id ?? payload.event_id ?? payload.notification_id;
  if (typeof candidate === "string" || typeof candidate === "number") return String(candidate);
  // No stable id in the payload — hash the body so at least exact-duplicate
  // deliveries (common with at-least-once webhook delivery) are deduped.
  return createHash("sha256").update(rawBody).digest("hex");
}

function extractShopId(marketplace: string, payload: Record<string, unknown>): string | null {
  if (marketplace === "MERCADO_LIVRE" && typeof payload.user_id !== "undefined") return String(payload.user_id);
  if (marketplace === "SHOPEE" && typeof payload.shop_id !== "undefined") return String(payload.shop_id);
  return null;
}

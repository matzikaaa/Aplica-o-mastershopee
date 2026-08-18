import { prisma } from "@mastershopee/database";
import { marketplaceSyncQueue } from "../queues.js";
import type { WebhookProcessingJobData } from "../queues.js";

/**
 * Processes a queued WebhookEvent (§35). The HTTP receiver (apps/web's
 * `/api/webhooks/[marketplace]` routes — see integrations README) only
 * validates signature/idempotency and enqueues; all real work happens
 * here, off the request path, so marketplaces get a fast 200 regardless
 * of how long processing takes.
 */
export async function processWebhookEvent(data: WebhookProcessingJobData): Promise<void> {
  const event = await prisma.webhookEvent.findUnique({ where: { id: data.webhookEventId } });
  if (!event || event.processedAt) return; // already processed — idempotent no-op

  try {
    if (event.marketplaceAccountId) {
      // Most marketplace webhooks (order updated, item changed) are best
      // handled by triggering a targeted incremental sync rather than
      // parsing every possible payload shape by hand.
      await marketplaceSyncQueue.add("incremental-sync", {
        marketplaceAccountId: event.marketplaceAccountId,
        type: "INCREMENTAL",
      });
    }

    await prisma.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
  } catch (err) {
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { processingError: err instanceof Error ? err.message : "Erro desconhecido." },
    });
    throw err;
  }
}

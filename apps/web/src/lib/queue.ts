import { Queue } from "bullmq";
import IORedis from "ioredis";

/**
 * Thin producer-side queue client — apps/web only ever enqueues jobs here,
 * it never processes them (that's apps/worker's job, see
 * apps/worker/src/index.ts). Queue name must match exactly so both
 * processes address the same Redis-backed queue.
 */
const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export const webhookProcessingQueue = new Queue<{ webhookEventId: string }>("webhook-processing", { connection });

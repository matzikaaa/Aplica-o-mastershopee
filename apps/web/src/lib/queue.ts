import { Queue } from "bullmq";
import IORedis from "ioredis";
import { getRedisUrl, redisUnavailableReason } from "./redis-url";

/**
 * Thin producer-side queue client — apps/web only ever enqueues jobs here,
 * it never processes them (that's apps/worker's job, see
 * apps/worker/src/index.ts). Queue names must match exactly so both
 * processes address the same Redis-backed queue.
 *
 * Everything is created on first enqueue rather than at import. ioredis
 * parses the URL in its constructor, and Next.js imports every route module
 * while collecting page data, so a malformed REDIS_URL used to fail the whole
 * build — reported against an unrelated route.
 *
 * Unlike the rate limiter, this cannot degrade quietly: a job that was never
 * enqueued is work that will never happen. The caller gets a real error
 * naming what to fix.
 */
export class QueueUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueueUnavailableError";
  }
}

let connection: IORedis | null = null;
const queues = new Map<string, Queue>();

function getQueue<T>(name: string): Queue<T> {
  const url = getRedisUrl();
  if (!url) {
    throw new QueueUnavailableError(
      `Não foi possível agendar a sincronização: ${redisUnavailableReason()}`,
    );
  }

  connection ??= new IORedis(url, { maxRetriesPerRequest: null });

  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection });
    queues.set(name, queue);
  }
  return queue as Queue<T>;
}

export interface MarketplaceSyncJob {
  marketplaceAccountId: string;
  type: "FULL" | "INCREMENTAL" | "PRODUCTS" | "ORDERS" | "ADS" | "FEES";
}

export const marketplaceSyncQueue = {
  add: (jobName: string, data: MarketplaceSyncJob) =>
    getQueue<MarketplaceSyncJob>("marketplace-sync").add(jobName, data),
};

export const webhookProcessingQueue = {
  add: (jobName: string, data: { webhookEventId: string }) =>
    getQueue<{ webhookEventId: string }>("webhook-processing").add(jobName, data),
};

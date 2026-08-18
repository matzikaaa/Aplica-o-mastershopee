import IORedis from "ioredis";

/** Shared Redis connection for all queues/workers (§34, §54) — BullMQ requires maxRetriesPerRequest: null. */
export const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

import IORedis from "ioredis";

const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: 1,
  connectTimeout: 2000,
  enableOfflineQueue: false,
  lazyConnect: true,
});
redis.on("error", () => {
  // Swallow connection errors — rate limiting degrades to "allow" rather than
  // taking the whole app down if Redis is briefly unavailable (see isAllowed below).
});

/**
 * Fixed-window rate limiter backed by Redis (§38 — brute-force protection).
 * Used on login/register/password-reset so credential-stuffing and
 * enumeration attempts get throttled per IP+identifier, not per request.
 *
 * Fails open (allows the request) if Redis is unreachable — an auth outage
 * from a rate-limiter dependency failure would be worse than a temporarily
 * unthrottled endpoint.
 */
export async function isAllowed(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const redisKey = `ratelimit:${key}`;
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.expire(redisKey, windowSeconds);
    }
    return count <= limit;
  } catch {
    return true;
  }
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() ?? "unknown";
}

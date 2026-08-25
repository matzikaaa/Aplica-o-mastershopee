/**
 * Reads REDIS_URL and refuses to hand back something that cannot be parsed.
 *
 * A malformed value here used to be fatal at *build* time: both the queue
 * client and the rate limiter constructed an ioredis instance at module
 * scope, ioredis parses the URL in its constructor, and Next.js imports every
 * route module while collecting page data. One bad character in an
 * environment variable and the whole deploy failed with "Invalid URL",
 * pointing at whichever route happened to be first.
 *
 * Returning null lets each caller decide what that means for it — the rate
 * limiter allows the request, enqueueing refuses it — instead of the decision
 * being "nothing works".
 */
export function getRedisUrl(): string | null {
  // Trimmed because a value pasted from a dashboard often carries a trailing
  // newline, which is invisible in the UI and breaks the parse.
  const raw = process.env.REDIS_URL?.trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") return null;
    return raw;
  } catch {
    return null;
  }
}

/** Why Redis is unavailable, in words that name the fix. */
export function redisUnavailableReason(): string {
  const raw = process.env.REDIS_URL?.trim();
  if (!raw) return "REDIS_URL não configurado.";
  return "REDIS_URL está malformado — precisa ser redis://... ou rediss://... (confira se não há espaço ou quebra de linha colada junto).";
}

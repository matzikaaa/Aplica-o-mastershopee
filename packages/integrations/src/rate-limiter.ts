/**
 * Every marketplace API enforces rate limits (§2, §34). Sync jobs must
 * throttle themselves instead of hammering the API and getting banned —
 * this is a minimal token-bucket abstraction; apps/worker wires it to
 * Redis (`RedisTokenBucket`) so limits are respected across concurrent
 * worker processes, not just within one.
 */
export interface RateLimiter {
  /** Resolves once a slot is available, waiting if necessary. */
  acquire(key: string): Promise<void>;
}

export class InMemoryTokenBucket implements RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; lastRefill: number }>();

  constructor(
    private readonly maxTokens: number,
    private readonly refillPerSecond: number,
  ) {}

  async acquire(key: string): Promise<void> {
    for (;;) {
      const now = Date.now();
      const bucket = this.buckets.get(key) ?? { tokens: this.maxTokens, lastRefill: now };
      const elapsedSeconds = (now - bucket.lastRefill) / 1000;
      bucket.tokens = Math.min(this.maxTokens, bucket.tokens + elapsedSeconds * this.refillPerSecond);
      bucket.lastRefill = now;

      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        this.buckets.set(key, bucket);
        return;
      }
      this.buckets.set(key, bucket);
      const waitMs = ((1 - bucket.tokens) / this.refillPerSecond) * 1000;
      await new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 25)));
    }
  }
}

/** Minimal surface of an ioredis-compatible client — kept generic so this package has no hard Redis dependency. */
export interface RedisLike {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

const LUA_TOKEN_BUCKET = `
local key = KEYS[1]
local max_tokens = tonumber(ARGV[1])
local refill_per_second = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local bucket = redis.call("HMGET", key, "tokens", "ts")
local tokens = tonumber(bucket[1]) or max_tokens
local ts = tonumber(bucket[2]) or now

local elapsed = math.max(0, now - ts) / 1000
tokens = math.min(max_tokens, tokens + elapsed * refill_per_second)

if tokens >= 1 then
  tokens = tokens - 1
  redis.call("HMSET", key, "tokens", tokens, "ts", now)
  redis.call("EXPIRE", key, 3600)
  return 1
else
  redis.call("HMSET", key, "tokens", tokens, "ts", now)
  redis.call("EXPIRE", key, 3600)
  return 0
end
`;

/** Distributed token bucket shared across all worker processes (used in apps/worker). */
export class RedisTokenBucket implements RateLimiter {
  constructor(
    private readonly redis: RedisLike,
    private readonly maxTokens: number,
    private readonly refillPerSecond: number,
  ) {}

  async acquire(key: string): Promise<void> {
    for (;;) {
      const allowed = await this.redis.eval(
        LUA_TOKEN_BUCKET,
        1,
        `ratelimit:${key}`,
        this.maxTokens,
        this.refillPerSecond,
        Date.now(),
      );
      if (allowed === 1) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

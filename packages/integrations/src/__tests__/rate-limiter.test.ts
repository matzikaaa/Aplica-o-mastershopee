import { describe, expect, it } from "vitest";
import { InMemoryTokenBucket } from "../rate-limiter";

describe("InMemoryTokenBucket (§34 — respect marketplace rate limits)", () => {
  it("allows bursts up to the bucket size immediately", async () => {
    const bucket = new InMemoryTokenBucket(3, 1);
    const start = Date.now();
    await bucket.acquire("shop-1");
    await bucket.acquire("shop-1");
    await bucket.acquire("shop-1");
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("throttles once the bucket is exhausted", async () => {
    const bucket = new InMemoryTokenBucket(1, 10); // 1 token, refills at 10/s
    await bucket.acquire("shop-2");
    const start = Date.now();
    await bucket.acquire("shop-2");
    expect(Date.now() - start).toBeGreaterThanOrEqual(50);
  });

  it("tracks separate buckets per key so one shop cannot starve another", async () => {
    const bucket = new InMemoryTokenBucket(1, 0.1);
    await bucket.acquire("shop-a");
    const start = Date.now();
    await bucket.acquire("shop-b");
    expect(Date.now() - start).toBeLessThan(50);
  });
});

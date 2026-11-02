import { describe, expect, it } from "vitest";
import { createMemoryLimiter, limit } from "@/lib/rate-limit";

describe("memory token bucket", () => {
  it("allows a burst up to capacity, then refuses with retryAfter", () => {
    let t = 0;
    const l = createMemoryLimiter({ now: () => t });
    const o = { capacity: 3, refillPerSec: 1 };
    expect([1, 2, 3].map(() => l.limit("k", o).ok)).toEqual([true, true, true]);
    const r = l.limit("k", o);
    expect(r.ok).toBe(false);
    expect(r.retryAfter).toBe(1);
    t += 1000;
    expect(l.limit("k", o).ok).toBe(true);
    expect(l.limit("k", o).ok).toBe(false);
  });

  it("refills continuously and never above capacity", () => {
    let t = 0;
    const l = createMemoryLimiter({ now: () => t });
    const o = { capacity: 5, refillPerSec: 2 };
    for (let i = 0; i < 5; i++) l.limit("k", o);
    t += 60_000;
    expect(l.limit("k", o).remaining).toBe(4);
  });

  it("computes retryAfter for slow refill rates", () => {
    let t = 0;
    const l = createMemoryLimiter({ now: () => t });
    const o = { capacity: 1, refillPerSec: 0.1 };
    l.limit("k", o);
    expect(l.limit("k", o).retryAfter).toBe(10);
  });

  it("keys are independent", () => {
    const l = createMemoryLimiter({ now: () => 0 });
    const o = { capacity: 1, refillPerSec: 1 };
    expect(l.limit("a", o).ok).toBe(true);
    expect(l.limit("a", o).ok).toBe(false);
    expect(l.limit("b", o).ok).toBe(true);
  });

  it("evicts least recently used keys beyond maxKeys", () => {
    const l = createMemoryLimiter({ now: () => 0, maxKeys: 3 });
    const o = { capacity: 1, refillPerSec: 1 };
    for (const k of ["a", "b", "c", "d"]) l.limit(k, o);
    expect(l.size()).toBe(3);
    expect(l.limit("a", o).ok).toBe(true); // "a" was evicted, so it starts full again
  });

  it("sweeps fully refilled buckets", () => {
    let t = 0;
    const l = createMemoryLimiter({ now: () => t });
    for (let i = 0; i < 100; i++) l.limit(`k${i}`, { capacity: 2, refillPerSec: 1 });
    t += 120_000;
    l.limit("fresh", { capacity: 2, refillPerSec: 1 });
    expect(l.size()).toBe(1);
  });

  it("exported limit() works without Redis", async () => {
    delete process.env.REDIS_URL;
    const key = `test:${Math.random()}`;
    const o = { capacity: 2, refillPerSec: 0.01 };
    expect((await limit(key, o)).ok).toBe(true);
    expect((await limit(key, o)).ok).toBe(true);
    const r = await limit(key, o);
    expect(r.ok).toBe(false);
    expect(r.retryAfter).toBeGreaterThan(0);
  });
});

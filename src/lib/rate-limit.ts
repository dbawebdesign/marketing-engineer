/**
 * Token-bucket rate limiting.
 *
 * - With REDIS_URL set, buckets live in Redis and are updated atomically by a Lua script,
 *   so limits hold across every app instance.
 * - Otherwise (or if Redis is unreachable) buckets live in an in-process LRU map. That is
 *   correct for single-box deployments and a best-effort guard everywhere else.
 *
 * A bucket holds up to `capacity` tokens and refills continuously at `refillPerSec`.
 * Each call takes one token (or `cost`). When empty, `retryAfter` says how many seconds
 * until enough tokens are back.
 */
import type { Redis as RedisClient } from "ioredis";

export type LimitOpts = { capacity: number; refillPerSec: number; cost?: number };
export type LimitResult = { ok: boolean; retryAfter: number; remaining: number };

type Bucket = { tokens: number; ts: number };

function take(b: Bucket | undefined, now: number, o: LimitOpts): { bucket: Bucket; res: LimitResult } {
  const cost = o.cost ?? 1;
  const elapsed = b ? Math.max(0, now - b.ts) / 1000 : 0;
  const tokens = b ? Math.min(o.capacity, b.tokens + elapsed * o.refillPerSec) : o.capacity;
  if (tokens >= cost) {
    const left = tokens - cost;
    return { bucket: { tokens: left, ts: now }, res: { ok: true, retryAfter: 0, remaining: Math.floor(left) } };
  }
  const retryAfter = o.refillPerSec > 0 ? Math.ceil((cost - tokens) / o.refillPerSec) : Number.POSITIVE_INFINITY;
  return { bucket: { tokens, ts: now }, res: { ok: false, retryAfter, remaining: 0 } };
}

/** In-memory limiter with LRU eviction. `now` is injectable for tests. */
export function createMemoryLimiter(opts: { maxKeys?: number; now?: () => number } = {}) {
  const maxKeys = opts.maxKeys ?? 50_000;
  const now = opts.now ?? Date.now;
  const map = new Map<string, Bucket & { full: number }>();
  let lastSweep = now();

  function sweep(t: number) {
    // Drop buckets that have refilled completely: they carry no information.
    for (const [k, b] of map) if (t >= b.full) map.delete(k);
    lastSweep = t;
  }

  return {
    limit(key: string, o: LimitOpts): LimitResult {
      const t = now();
      if (t - lastSweep > 60_000) sweep(t);
      const prev = map.get(key);
      const { bucket, res } = take(prev, t, o);
      map.delete(key); // re-insert to mark most-recently-used
      const full = o.refillPerSec > 0 ? t + ((o.capacity - bucket.tokens) / o.refillPerSec) * 1000 : Number.POSITIVE_INFINITY;
      map.set(key, { ...bucket, full });
      while (map.size > maxKeys) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
      return res;
    },
    size: () => map.size,
  };
}

// Returns {allowed, tokens*1000, retryAfterMs}. Uses server time for consistency across instances.
const LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local b = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(b[1])
local ts = tonumber(b[2])
if tokens == nil then tokens = capacity; ts = now end
tokens = math.min(capacity, tokens + math.max(0, now - ts) / 1000 * rate)
local allowed = 0
local retry = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retry = math.ceil((cost - tokens) / rate * 1000)
end
redis.call('HSET', key, 'tokens', tostring(tokens), 'ts', tostring(now))
redis.call('PEXPIRE', key, math.ceil(capacity / rate * 1000) + 1000)
return {allowed, math.floor(tokens), retry}
`;

const g = globalThis as unknown as { __meLimiter?: ReturnType<typeof createMemoryLimiter>; __meRedis?: Promise<RedisClient | null> };
const memory = () => (g.__meLimiter ??= createMemoryLimiter());

function redis(): Promise<RedisClient | null> {
  const url = process.env.REDIS_URL;
  if (!url) return Promise.resolve(null);
  g.__meRedis ??= import("ioredis")
    .then(({ Redis }) => {
      const c = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false, connectTimeout: 2000 });
      c.on("error", () => {}); // errors surface per command; we fall back to memory
      return c;
    })
    .catch(() => null);
  return g.__meRedis;
}

/** Take a token from the bucket named `key`. */
export async function limit(key: string, o: LimitOpts): Promise<LimitResult> {
  if (!(o.capacity > 0) || !(o.refillPerSec > 0)) throw new Error("capacity and refillPerSec must be positive");
  const r = await redis();
  if (r && r.status === "ready") {
    try {
      const out = (await r.eval(LUA, 1, `me:rl:${key}`, o.capacity, o.refillPerSec, o.cost ?? 1)) as [number, number, number];
      return { ok: out[0] === 1, remaining: out[1], retryAfter: Math.ceil(out[2] / 1000) };
    } catch {
      /* fall through to memory */
    }
  }
  return memory().limit(key, o);
}

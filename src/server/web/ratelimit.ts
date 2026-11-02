/** Fixed-window limiter for auth endpoints (per process). The API layer has a distributed limiter. */
const hits = new Map<string, { n: number; reset: number }>();

export function limit(key: string, max: number, windowSec: number): boolean {
  const now = Date.now();
  if (hits.size > 50_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  const cur = hits.get(key);
  if (!cur || cur.reset < now) {
    hits.set(key, { n: 1, reset: now + windowSec * 1000 });
    return true;
  }
  cur.n++;
  return cur.n <= max;
}

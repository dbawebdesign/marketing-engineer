/**
 * The client IP for rate limiting. X-Forwarded-For is client-controlled except for the
 * entries appended by our own proxies, so we take the entry TRUSTED_PROXY_COUNT hops from
 * the right (default 1: one load balancer in front of the app). With 0, forwarding headers
 * are ignored entirely. Used for rate limiting only, never for authentication.
 */
export function trustedIp(h: { get(name: string): string | null }): string {
  const hops = Math.max(0, Number(process.env.TRUSTED_PROXY_COUNT ?? "1") || 0);
  if (hops > 0) {
    const chain = (h.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const ip = chain[chain.length - hops];
    if (ip) return ip.slice(0, 64);
    const real = h.get("x-real-ip");
    if (real) return real.trim().slice(0, 64);
  }
  return "direct";
}

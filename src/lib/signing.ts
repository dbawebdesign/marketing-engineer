/**
 * HMAC-SHA256 request signing for inbound webhooks.
 *
 *   x-me-timestamp: <unix seconds>
 *   x-me-signature: sha256=<hex of HMAC-SHA256(secret, `${timestamp}.${rawBody}`)>
 *
 * The timestamp is part of the signed payload, so it can't be swapped, and anything
 * older (or newer) than the tolerance is refused, which bounds replays to 5 minutes.
 * Signal ingestion is also idempotent on content, so a replay inside the window is a no-op.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_TOLERANCE_SEC = 300;

export function signPayload(secret: string, timestamp: string | number, rawBody: string): string {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export type SignatureCheck = { ok: true } | { ok: false; reason: "missing" | "malformed" | "stale" | "mismatch" };

export function verifySignature(
  secret: string,
  rawBody: string,
  headers: { signature: string | null | undefined; timestamp: string | null | undefined },
  opts: { now?: number; toleranceSec?: number } = {},
): SignatureCheck {
  const { signature, timestamp } = headers;
  if (!signature || !timestamp) return { ok: false, reason: "missing" };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "malformed" };
  const m = /^sha256=([0-9a-f]{64})$/i.exec(signature.trim());
  if (!m) return { ok: false, reason: "malformed" };
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  if (Math.abs(nowSec - Number(timestamp)) > (opts.toleranceSec ?? SIGNATURE_TOLERANCE_SEC)) return { ok: false, reason: "stale" };
  const expected = Buffer.from(signPayload(secret, timestamp, rawBody).slice(7), "hex");
  const given = Buffer.from(m[1]!.toLowerCase(), "hex");
  return expected.length === given.length && timingSafeEqual(expected, given) ? { ok: true } : { ok: false, reason: "mismatch" };
}

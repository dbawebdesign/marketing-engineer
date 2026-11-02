import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { signPayload, verifySignature } from "@/lib/signing";

const SECRET = "whsec-test-secret";
const body = JSON.stringify({ source: "support_ticket", content: "Customer asked for SSO" });
const ts = () => String(Math.floor(Date.now() / 1000));

describe("webhook signatures", () => {
  it("matches the documented construction", () => {
    const t = "1700000000";
    expect(signPayload(SECRET, t, body)).toBe("sha256=" + createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex"));
  });

  it("accepts a valid signature", () => {
    const t = ts();
    expect(verifySignature(SECRET, body, { signature: signPayload(SECRET, t, body), timestamp: t })).toEqual({ ok: true });
  });

  it("accepts uppercase hex", () => {
    const t = ts();
    const sig = "sha256=" + signPayload(SECRET, t, body).slice(7).toUpperCase();
    expect(verifySignature(SECRET, body, { signature: sig, timestamp: t }).ok).toBe(true);
  });

  it("rejects a tampered body, wrong secret or swapped timestamp", () => {
    const t = ts();
    const sig = signPayload(SECRET, t, body);
    expect(verifySignature(SECRET, body + " ", { signature: sig, timestamp: t })).toEqual({ ok: false, reason: "mismatch" });
    expect(verifySignature("other", body, { signature: sig, timestamp: t })).toEqual({ ok: false, reason: "mismatch" });
    expect(verifySignature(SECRET, body, { signature: sig, timestamp: String(Number(t) - 1) })).toEqual({ ok: false, reason: "mismatch" });
  });

  it("enforces the 5 minute tolerance both ways", () => {
    const old = String(Math.floor(Date.now() / 1000) - 301);
    expect(verifySignature(SECRET, body, { signature: signPayload(SECRET, old, body), timestamp: old })).toEqual({ ok: false, reason: "stale" });
    const future = String(Math.floor(Date.now() / 1000) + 301);
    expect(verifySignature(SECRET, body, { signature: signPayload(SECRET, future, body), timestamp: future })).toEqual({ ok: false, reason: "stale" });
    const edge = String(Math.floor(Date.now() / 1000) - 290);
    expect(verifySignature(SECRET, body, { signature: signPayload(SECRET, edge, body), timestamp: edge }).ok).toBe(true);
  });

  it("rejects missing and malformed headers", () => {
    const t = ts();
    expect(verifySignature(SECRET, body, { signature: null, timestamp: t })).toEqual({ ok: false, reason: "missing" });
    expect(verifySignature(SECRET, body, { signature: "sha256=abc", timestamp: t })).toEqual({ ok: false, reason: "malformed" });
    expect(verifySignature(SECRET, body, { signature: signPayload(SECRET, t, body).slice(7), timestamp: t })).toEqual({ ok: false, reason: "malformed" });
    expect(verifySignature(SECRET, body, { signature: signPayload(SECRET, t, body), timestamp: "12.5" })).toEqual({ ok: false, reason: "malformed" });
  });
});

import { describe, expect, it } from "vitest";
import { SignJWT, UnsecuredJWT } from "jose";
import { checkEmbedOrigin, EmbedTokenError, safeEmbedPath, verifyEmbedJwt } from "@/lib/embed";

const SECRET = "test-embed-secret-0123456789abcdefghijklmnop";
const ISS = "dispatchly";
const key = (s = SECRET) => new TextEncoder().encode(s);
const now = () => Math.floor(Date.now() / 1000);

async function mint(claims: Record<string, unknown> = {}, o: { secret?: string; alg?: string; iat?: number; exp?: number | null; jti?: string | null; sub?: string | null } = {}) {
  const iat = o.iat ?? now();
  let j = new SignJWT({ email: "jane@host.com", name: "Jane", ...claims }).setProtectedHeader({ alg: o.alg ?? "HS256" }).setIssuer(ISS).setIssuedAt(iat);
  if (o.sub !== null) j = j.setSubject(o.sub ?? "user-1");
  if (o.jti !== null) j = j.setJti(o.jti ?? crypto.randomUUID());
  if (o.exp !== null) j = j.setExpirationTime(o.exp ?? iat + 600);
  return j.sign(key(o.secret));
}

async function reason(p: Promise<unknown>) {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof EmbedTokenError) return e.reason;
    throw e;
  }
}

describe("verifyEmbedJwt", () => {
  it("accepts a good token and defaults the role to editor", async () => {
    const c = await verifyEmbedJwt(await mint(), SECRET, { issuer: ISS });
    expect(c).toMatchObject({ iss: ISS, sub: "user-1", email: "jane@host.com", name: "Jane", role: "editor", origin: null });
  });

  it("keeps viewer/editor/admin roles", async () => {
    for (const role of ["viewer", "editor", "admin"]) {
      expect((await verifyEmbedJwt(await mint({ role }), SECRET, { issuer: ISS })).role).toBe(role);
    }
  });

  it("downgrades owner to admin", async () => {
    expect((await verifyEmbedJwt(await mint({ role: "owner" }), SECRET, { issuer: ISS })).role).toBe("admin");
  });

  it("rejects unknown roles", async () => {
    expect(await reason(verifyEmbedJwt(await mint({ role: "superuser" }), SECRET, { issuer: ISS }))).toBe("bad_claim");
  });

  it("rejects expired tokens", async () => {
    const t = await mint({}, { iat: now() - 1200, exp: now() - 600 });
    expect(await reason(verifyEmbedJwt(t, SECRET, { issuer: ISS }))).toBe("expired");
  });

  it("rejects a token signed with the wrong secret", async () => {
    const t = await mint({}, { secret: "some-other-secret-that-is-long-enough-1234" });
    expect(await reason(verifyEmbedJwt(t, SECRET, { issuer: ISS }))).toBe("bad_signature");
  });

  it("rejects alg none", async () => {
    const t = new UnsecuredJWT({ sub: "user-1", jti: "abcdefgh12" }).setIssuer(ISS).setIssuedAt().setExpirationTime("5m").encode();
    expect(await reason(verifyEmbedJwt(t, SECRET, { issuer: ISS }))).toBe("bad_algorithm");
  });

  it("rejects other algorithms (HS512)", async () => {
    const t = await mint({}, { alg: "HS512" });
    expect(await reason(verifyEmbedJwt(t, SECRET, { issuer: ISS }))).toBe("bad_algorithm");
  });

  it("rejects a forged header claiming HS256 over a different alg's signature", async () => {
    const good = await mint();
    const [, p, s] = good.split(".");
    const h = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
    expect(await reason(verifyEmbedJwt(`${h}.${p}.${s}`, SECRET, { issuer: ISS }))).toBe("bad_algorithm");
  });

  it("rejects TTL over 1 hour", async () => {
    const iat = now();
    expect(await reason(verifyEmbedJwt(await mint({}, { iat, exp: iat + 3601 }), SECRET, { issuer: ISS }))).toBe("ttl_too_long");
    expect(await reason(verifyEmbedJwt(await mint({}, { iat, exp: iat + 3600 }), SECRET, { issuer: ISS }))).toBe("ok");
  });

  it("rejects missing exp, sub or jti", async () => {
    expect(await reason(verifyEmbedJwt(await mint({}, { exp: null }), SECRET, { issuer: ISS }))).toBe("missing_claim");
    expect(await reason(verifyEmbedJwt(await mint({}, { sub: null }), SECRET, { issuer: ISS }))).toBe("missing_claim");
    expect(await reason(verifyEmbedJwt(await mint({}, { jti: null }), SECRET, { issuer: ISS }))).toBe("missing_claim");
  });

  it("rejects a token for another tenant", async () => {
    expect(await reason(verifyEmbedJwt(await mint(), SECRET, { issuer: "other-tenant" }))).toBe("bad_claim");
  });

  it("rejects iat in the future and garbage", async () => {
    expect(await reason(verifyEmbedJwt(await mint({}, { iat: now() + 600, exp: now() + 900 }), SECRET, { issuer: ISS }))).toBe("not_yet_valid");
    expect(await reason(verifyEmbedJwt("not.a.jwt", SECRET, { issuer: ISS }))).toBe("malformed");
    expect(await reason(verifyEmbedJwt("abc", SECRET, { issuer: ISS }))).toBe("malformed");
  });

  it("validates the origin claim", async () => {
    expect((await verifyEmbedJwt(await mint({ origin: "https://App.Host.com" }), SECRET, { issuer: ISS })).origin).toBe("https://app.host.com");
    expect(await reason(verifyEmbedJwt(await mint({ origin: "javascript:alert(1)" }), SECRET, { issuer: ISS }))).toBe("bad_claim");
  });
});

describe("checkEmbedOrigin", () => {
  const allowed = ["https://app.host.com"];
  const run = (fn: () => void) => {
    try {
      fn();
      return "ok";
    } catch (e) {
      return (e as EmbedTokenError).reason;
    }
  };
  it("allows anything when no origins are configured", () => {
    expect(run(() => checkEmbedOrigin([], { origin: null }, {}))).toBe("ok");
  });
  it("requires an allowed origin claim when configured", () => {
    expect(run(() => checkEmbedOrigin(allowed, { origin: null }, {}))).toBe("origin_not_allowed");
    expect(run(() => checkEmbedOrigin(allowed, { origin: "https://evil.com" }, {}))).toBe("origin_not_allowed");
    expect(run(() => checkEmbedOrigin(allowed, { origin: "https://app.host.com" }, {}))).toBe("ok");
  });
  it("cross-checks Referer and Sec-Fetch-Dest", () => {
    const c = { origin: "https://app.host.com" };
    expect(run(() => checkEmbedOrigin(allowed, c, { referer: "https://app.host.com/page", secFetchDest: "iframe" }))).toBe("ok");
    expect(run(() => checkEmbedOrigin(allowed, c, { referer: "https://evil.com/" }))).toBe("origin_not_allowed");
    expect(run(() => checkEmbedOrigin(allowed, c, { secFetchDest: "document" }))).toBe("must_be_framed");
  });
});

describe("safeEmbedPath", () => {
  it("accepts plain paths and rejects tricks", () => {
    expect(safeEmbedPath(null)).toBe("");
    expect(safeEmbedPath("/")).toBe("");
    expect(safeEmbedPath("/drafts/abc-123")).toBe("/drafts/abc-123");
    for (const bad of ["drafts", "//evil.com", "/a/../b", "/..", "/a\\b", "/a?x=1", "/a#x", "https://evil.com", "/a b"]) {
      expect(safeEmbedPath(bad)).toBeNull();
    }
  });
});

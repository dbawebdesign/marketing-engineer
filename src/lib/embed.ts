/**
 * Embedding Marketing Engineer inside a host business's product.
 *
 * The host's backend mints a short-lived HS256 JWT signed with the tenant's embed secret
 * (Settings → Embed). Its browser loads /embed/start?token=... in an iframe (see
 * embed/sdk.ts); we verify the token, provision the user, and start an embed session.
 *
 * Token claims:
 *   iss    tenant slug                         (required)
 *   sub    the host's stable user id           (required, ≤ 200 chars)
 *   exp    expiry, at most 1 hour after iat    (required)
 *   iat    issued at                           (required)
 *   jti    unique token id, single use         (required, 8-200 chars)
 *   email  user's email                        (optional, display only)
 *   name   user's display name                 (optional)
 *   role   viewer | editor | admin             (optional, default editor; "owner" is capped to admin)
 *   origin the host page origin, e.g. https://app.host.com
 *          (required when the tenant has allowed origins configured)
 *
 * The HMAC key is the UTF-8 bytes of the embed secret string.
 */
import { decodeJwt, decodeProtectedHeader, errors as joseErrors, jwtVerify } from "jose";
import { sys, sysTx, withTenant } from "./db";
import { decrypt, sha256 } from "./crypto";
import type { Role } from "./rbac";
import { createSession } from "./auth";

export const EMBED_MAX_TTL_SEC = 3600;
const CLOCK_SKEW_SEC = 60;

export type EmbedClaims = {
  iss: string;
  sub: string;
  jti: string;
  exp: number;
  iat: number;
  email: string | null;
  name: string | null;
  role: Exclude<Role, "owner">;
  origin: string | null;
};

export type EmbedErrorReason =
  | "malformed"
  | "bad_algorithm"
  | "bad_signature"
  | "expired"
  | "not_yet_valid"
  | "missing_claim"
  | "ttl_too_long"
  | "bad_claim"
  | "unknown_tenant"
  | "origin_not_allowed"
  | "must_be_framed"
  | "already_used";

export class EmbedTokenError extends Error {
  constructor(public reason: EmbedErrorReason, message?: string) {
    super(message ?? reason);
  }
}

/** Safe, human-readable messages for host developers. They reveal nothing secret. */
export const EMBED_ERROR_MESSAGES: Record<EmbedErrorReason, string> = {
  malformed: "The embed token is not a valid JWT.",
  bad_algorithm: "Embed tokens must be signed with HS256.",
  bad_signature: "The embed token signature is invalid. Check the embed secret.",
  expired: "The embed token has expired. Mint a fresh one for each page load.",
  not_yet_valid: "The embed token is not valid yet (check your server clock).",
  missing_claim: "The embed token is missing a required claim (iss, sub, exp, iat, jti).",
  ttl_too_long: "Embed tokens may live at most 1 hour.",
  bad_claim: "The embed token has an invalid claim.",
  unknown_tenant: "The embed token signature is invalid. Check the embed secret.",
  origin_not_allowed: "This page's origin is not in the workspace's allowed origins.",
  must_be_framed: "This link only works inside an embedded frame.",
  already_used: "This embed token was already used. Mint a fresh one for each page load.",
};

const ORIGIN_RE = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;

const optStr = (v: unknown, max: number): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || v.length > max) throw new EmbedTokenError("bad_claim");
  const t = v.trim();
  return t ? t : null;
};

/**
 * Verify an embed JWT against a secret. Pure (no DB), so it is unit-tested directly.
 * `issuer` is the tenant slug the token must claim.
 */
export async function verifyEmbedJwt(token: string, secret: string, opts: { issuer: string; now?: Date }): Promise<EmbedClaims> {
  if (typeof token !== "string" || token.length > 4096 || token.split(".").length !== 3) throw new EmbedTokenError("malformed");
  let alg: unknown;
  try {
    alg = decodeProtectedHeader(token).alg;
  } catch {
    throw new EmbedTokenError("malformed");
  }
  if (alg !== "HS256") throw new EmbedTokenError("bad_algorithm");

  const now = opts.now ?? new Date();
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ["HS256"],
      issuer: opts.issuer,
      requiredClaims: ["exp", "iat", "sub", "jti"],
      clockTolerance: CLOCK_SKEW_SEC,
      currentDate: now,
    }));
  } catch (e) {
    if (e instanceof joseErrors.JWTExpired) throw new EmbedTokenError("expired");
    if (e instanceof joseErrors.JWSSignatureVerificationFailed) throw new EmbedTokenError("bad_signature");
    if (e instanceof joseErrors.JOSEAlgNotAllowed) throw new EmbedTokenError("bad_algorithm");
    if (e instanceof joseErrors.JWTClaimValidationFailed) {
      if (e.reason === "missing") throw new EmbedTokenError("missing_claim");
      if (e.claim === "iat" || e.claim === "nbf") throw new EmbedTokenError("not_yet_valid");
      throw new EmbedTokenError("bad_claim", `invalid ${e.claim}`);
    }
    throw new EmbedTokenError("malformed");
  }

  const exp = payload.exp as number;
  const iat = payload.iat as number;
  const nowSec = Math.floor(now.getTime() / 1000);
  if (!Number.isFinite(exp) || !Number.isFinite(iat)) throw new EmbedTokenError("missing_claim");
  if (exp - iat > EMBED_MAX_TTL_SEC || exp - nowSec > EMBED_MAX_TTL_SEC + CLOCK_SKEW_SEC) throw new EmbedTokenError("ttl_too_long");
  if (iat > nowSec + CLOCK_SKEW_SEC) throw new EmbedTokenError("not_yet_valid");

  const sub = payload.sub;
  if (typeof sub !== "string" || sub.length < 1 || sub.length > 200 || /[\u0000-\u001f]/.test(sub)) throw new EmbedTokenError("bad_claim", "invalid sub");
  const jti = payload.jti;
  if (typeof jti !== "string" || jti.length < 8 || jti.length > 200) throw new EmbedTokenError("bad_claim", "invalid jti");

  const email = optStr(payload.email, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new EmbedTokenError("bad_claim", "invalid email");
  const name = optStr(payload.name, 120);
  const origin = optStr(payload.origin, 300);
  if (origin && !ORIGIN_RE.test(origin)) throw new EmbedTokenError("bad_claim", "invalid origin");

  const rawRole = payload.role ?? "editor";
  let role: EmbedClaims["role"];
  if (rawRole === "viewer" || rawRole === "editor" || rawRole === "admin") role = rawRole;
  else if (rawRole === "owner") role = "admin"; // embed users can never own a workspace
  else throw new EmbedTokenError("bad_claim", "invalid role");

  return { iss: opts.issuer, sub, jti, exp, iat, email, name, role, origin: origin ? origin.toLowerCase() : null };
}

/**
 * Server-side framing check, complementing the CSP frame-ancestors header set in
 * middleware (which can't read per-tenant settings from the edge; see src/middleware.ts).
 *
 * When the tenant has allowed origins:
 *  - the token must carry an `origin` claim that is in the list (the host's backend signs it,
 *    so a leaked token can't be re-pointed at another site),
 *  - if the browser sent Sec-Fetch-Dest, it must be "iframe" (a token opened as a top-level
 *    page is refused),
 *  - if the browser sent a Referer, its origin must equal the claimed origin. Referer may be
 *    absent (Referrer-Policy: no-referrer), so it is a consistency check, not the gate.
 * With no allowed origins configured (local development), any origin is accepted.
 */
export function checkEmbedOrigin(
  allowedOrigins: readonly string[],
  claims: Pick<EmbedClaims, "origin">,
  headers: { referer?: string | null; secFetchDest?: string | null },
): void {
  if (!allowedOrigins.length) return;
  const allowed = allowedOrigins.map((o) => o.toLowerCase().replace(/\/+$/, ""));
  if (!claims.origin || !allowed.includes(claims.origin)) throw new EmbedTokenError("origin_not_allowed");
  if (headers.secFetchDest && headers.secFetchDest !== "iframe") throw new EmbedTokenError("must_be_framed");
  if (headers.referer) {
    let refOrigin: string;
    try {
      refOrigin = new URL(headers.referer).origin.toLowerCase();
    } catch {
      throw new EmbedTokenError("origin_not_allowed");
    }
    if (refOrigin !== claims.origin) throw new EmbedTokenError("origin_not_allowed");
  }
}

// Only plain path characters; no "..", no "//", no scheme, no backslashes, no query.
const SAFE_PATH = /^\/[A-Za-z0-9\-._~/]{0,200}$/;

/** Validate the `path` an embed should open. "" for the embed home, null if unsafe. */
export function safeEmbedPath(p: string | null | undefined): string | null {
  if (!p || p === "/") return "";
  if (!SAFE_PATH.test(p) || p.includes("//") || /(^|\/)\.\.?(\/|$)/.test(p)) return null;
  return p;
}

/** Synthetic, non-routable address: embed users are never matched to real accounts by email. */
export function embedUserEmail(externalRef: string) {
  return `embed-${sha256(externalRef).slice(0, 24)}@embed.invalid`;
}

export type EmbedStart = { tenantId: string; slug: string; userId: string; role: EmbedClaims["role"]; allowedOrigins: string[] };

/**
 * Verify a token end to end and create an embed session cookie.
 * Throws EmbedTokenError for anything the caller should show as a 401.
 */
export async function verifyEmbedToken(
  token: string,
  headers: { referer?: string | null; secFetchDest?: string | null } = {},
): Promise<EmbedStart> {
  // 1. Which tenant? (unverified read of iss, only used to pick the key)
  let iss: unknown;
  try {
    iss = decodeJwt(token).iss;
  } catch {
    throw new EmbedTokenError("malformed");
  }
  if (typeof iss !== "string") throw new EmbedTokenError("missing_claim");
  if (!SLUG_RE.test(iss)) throw new EmbedTokenError("unknown_tenant");
  const t = await sys<{ id: string; slug: string; embed_secret_enc: string | null; allowed_origins: string[] }>(
    `select id, slug, embed_secret_enc, allowed_origins from tenants where slug = $1`,
    [iss],
  );
  const tenant = t.rows[0];
  if (!tenant?.embed_secret_enc) throw new EmbedTokenError("unknown_tenant");

  // 2. Signature, algorithm, lifetime and claims.
  const claims = await verifyEmbedJwt(token, decrypt(tenant.embed_secret_enc), { issuer: tenant.slug });

  // 3. Where is it being framed?
  checkEmbedOrigin(tenant.allowed_origins, claims, headers);

  // 4. One-time use, then provision user + membership atomically.
  const externalRef = `${tenant.id}:${claims.sub}`;
  const userId = await sysTx(async (tx) => {
    if (Math.random() < 0.01) await tx.query(`delete from embed_token_uses where used_at < now() - interval '2 hours'`);
    const used = await tx.query(`insert into embed_token_uses(tenant_id, jti) values ($1,$2) on conflict do nothing`, [tenant.id, claims.jti]);
    if (!used.rowCount) throw new EmbedTokenError("already_used");
    const displayName = (claims.name ?? claims.email ?? "Guest").slice(0, 120);
    const u = await tx.query<{ id: string }>(
      `insert into users(email, name, external_ref) values ($1,$2,$3)
       on conflict (external_ref) where external_ref is not null do update set name = excluded.name
       returning id`,
      [embedUserEmail(externalRef), displayName, externalRef],
    );
    const id = u.rows[0]!.id;
    await tx.query(
      `insert into memberships(tenant_id, user_id, role) values ($1,$2,$3)
       on conflict (tenant_id, user_id) do update set role = excluded.role where memberships.role <> 'owner'`,
      [tenant.id, id, claims.role],
    );
    return id;
  });

  await createSession(userId, tenant.id, "embed");
  await withTenant(tenant.id, (tx) =>
    tx.query(
      `insert into audit_log(tenant_id, actor_type, actor_id, action, target_type, target_id, metadata) values ($1,'embed',$2,'embed.session.start','user',$2,$3)`,
      [tenant.id, userId, { role: claims.role, origin: claims.origin, jti: claims.jti }],
    ),
  ).catch(() => {});
  return { tenantId: tenant.id, slug: tenant.slug, userId, role: claims.role, allowedOrigins: tenant.allowed_origins };
}

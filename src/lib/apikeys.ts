/**
 * Tenant API keys.
 *
 * Format: me_live_<prefix:12 base62>_<secret:32 base62>  (~190 bits of secret entropy)
 * Storage: only the public prefix (for lookup) and sha256(full key). A fast hash is fine
 * here because the key is high-entropy random data, not a human password.
 * The full key is returned exactly once, from createApiKey.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { sys, withTenant, isUuid } from "./db";
import { sha256, safeEqual } from "./crypto";
import { assertCan, type Ctx } from "./ctx";
import type { Role } from "./rbac";
import { forbidden, notFound } from "./errors";
import { audit } from "@/server/services/audit";

export const API_KEY_SCOPES = ["read", "write", "admin"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const KEY_RE = /^me_live_([A-Za-z0-9]{12})_([A-Za-z0-9]{32})$/;

/** Uniform random base62 string (rejection sampling, no modulo bias). */
function base62(len: number): string {
  let out = "";
  while (out.length < len) {
    for (const b of randomBytes(len * 2)) {
      if (b < 248) out += ALPHABET[b % 62]; // 248 = 62*4
      if (out.length === len) break;
    }
  }
  return out;
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const prefix = base62(12);
  const key = `me_live_${prefix}_${base62(32)}`;
  return { key, prefix, hash: hashApiKey(key) };
}

export function parseApiKey(key: string): { prefix: string; secret: string } | null {
  const m = KEY_RE.exec(key);
  return m ? { prefix: m[1]!, secret: m[2]! } : null;
}

export const hashApiKey = (key: string) => sha256(key);

/** Constant-time check of a presented key against a stored hash. */
export function verifyApiKeyHash(key: string, storedHash: string): boolean {
  return safeEqual(hashApiKey(key), storedHash);
}

/** Highest scope wins: admin → admin, write → editor, read → viewer. Never owner. */
export function roleFromScopes(scopes: readonly string[]): Role | null {
  if (scopes.includes("admin")) return "admin";
  if (scopes.includes("write")) return "editor";
  if (scopes.includes("read")) return "viewer";
  return null;
}

/** Pull a key out of an Authorization header value ("Bearer me_live_..."). */
export function keyFromAuthHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m ? m[1]! : null;
}

// ---------- management (service layer) ----------

export const CreateApiKeyInput = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).max(3).default(["read", "write"]),
});

export type ApiKeyRow = { id: string; name: string; prefix: string; scopes: string[]; last_used_at: string | null; revoked_at: string | null; created_at: string };

export async function createApiKey(ctx: Ctx, raw: unknown): Promise<ApiKeyRow & { key: string }> {
  assertCan(ctx, "keys:manage");
  const input = CreateApiKeyInput.parse(raw);
  // An API key can never act with more power than the person who made it.
  if (input.scopes.includes("admin") && ctx.role !== "owner" && ctx.role !== "admin") throw forbidden();
  if (ctx.actor.type === "api_key" || ctx.actor.type === "embed") throw forbidden("API keys can only be created from the app");
  const { key, prefix, hash } = generateApiKey();
  const scopes = [...new Set(input.scopes)];
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query<ApiKeyRow>(
      `insert into api_keys(tenant_id, name, prefix, key_hash, scopes, created_by) values ($1,$2,$3,$4,$5,$6)
       returning id, name, prefix, scopes, last_used_at, revoked_at, created_at`,
      [ctx.tenantId, input.name, prefix, hash, scopes, ctx.userId],
    );
    await audit(tx, ctx, "api_key.create", { type: "api_key", id: r.rows[0]!.id }, { scopes, prefix });
    return { ...r.rows[0]!, key };
  });
}

export async function listApiKeys(ctx: Ctx): Promise<ApiKeyRow[]> {
  assertCan(ctx, "keys:manage");
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query<ApiKeyRow>(`select id, name, prefix, scopes, last_used_at, revoked_at, created_at from api_keys order by created_at desc`);
    return r.rows;
  });
}

export async function revokeApiKey(ctx: Ctx, id: string) {
  assertCan(ctx, "keys:manage");
  if (!isUuid(id)) throw notFound("API key");
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query(`update api_keys set revoked_at = now() where id = $1 and revoked_at is null`, [id]);
    if (!r.rowCount) throw notFound("API key");
    await audit(tx, ctx, "api_key.revoke", { type: "api_key", id });
  });
}

// ---------- authentication ----------

const g = globalThis as unknown as { __meKeyTouch?: Map<string, number> };
const touched = (g.__meKeyTouch ??= new Map());

/**
 * Resolve an Authorization header to a Ctx, or null if the key is missing, malformed,
 * unknown, revoked or doesn't match. Lookup goes through the `sys` pool because the
 * tenant isn't known yet (api_keys is RLS-protected).
 */
export async function authenticateApiKey(header: string | null | undefined): Promise<Ctx | null> {
  const key = keyFromAuthHeader(header);
  if (!key || key.length > 100) return null;
  const parsed = parseApiKey(key);
  if (!parsed) return null;
  const r = await sys<{ id: string; tenant_id: string; key_hash: string; scopes: string[]; revoked_at: string | null }>(
    `select id, tenant_id, key_hash, scopes, revoked_at from api_keys where prefix = $1`,
    [parsed.prefix],
  );
  const row = r.rows[0];
  if (!row || row.revoked_at || !verifyApiKeyHash(key, row.key_hash)) return null;
  const role = roleFromScopes(row.scopes);
  if (!role) return null;

  // Record usage at most once a minute per key (per instance, and enforced again in SQL).
  const now = Date.now();
  if ((touched.get(row.id) ?? 0) < now - 60_000) {
    touched.set(row.id, now);
    if (touched.size > 10_000) touched.clear();
    void sys(`update api_keys set last_used_at = now() where id = $1 and (last_used_at is null or last_used_at < now() - interval '1 minute')`, [row.id]).catch(() => {});
  }
  return { tenantId: row.tenant_id, role, actor: { type: "api_key", id: row.id }, userId: null };
}


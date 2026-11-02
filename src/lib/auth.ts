import { trustedIp } from "./client-ip";
import "server-only";
import { cookies, headers } from "next/headers";
export { hashPassword, verifyPassword } from "./password";
import { sys } from "./db";
import { sha256, token } from "./crypto";
import type { Ctx } from "./ctx";
import { isRole, type Role } from "./rbac";

export const SESSION_COOKIE = "me_session";
const WEB_TTL_DAYS = 30;
const EMBED_TTL_HOURS = 8;


export async function createSession(userId: string, tenantId: string | null, kind: "web" | "embed" = "web") {
  const t = token();
  const ttlMs = kind === "web" ? WEB_TTL_DAYS * 864e5 : EMBED_TTL_HOURS * 36e5;
  const h = await headers();
  const tip = trustedIp(h);
  const ip = /^[0-9a-f.:]+$/i.test(tip) ? tip : null;
  await sys(
    `insert into sessions(id_hash, user_id, tenant_id, kind, expires_at, ip, user_agent) values ($1,$2,$3,$4,$5,$6,$7)`,
    [sha256(t), userId, tenantId, kind, new Date(Date.now() + ttlMs), ip && /^[0-9a-f.:]+$/i.test(ip) ? ip : null, h.get("user-agent")?.slice(0, 400) ?? null],
  );
  const jar = await cookies();
  jar.set(SESSION_COOKIE, t, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || kind === "embed",
    // Embedded iframes are third-party contexts: they need SameSite=None + Partitioned (CHIPS).
    sameSite: kind === "embed" ? "none" : "lax",
    partitioned: kind === "embed" ? true : undefined,
    path: "/",
    maxAge: Math.floor(ttlMs / 1000),
  });
}

export async function destroySession() {
  const jar = await cookies();
  const t = jar.get(SESSION_COOKIE)?.value;
  if (t) await sys("delete from sessions where id_hash = $1", [sha256(t)]);
  jar.delete(SESSION_COOKIE);
}

export type SessionInfo = {
  userId: string;
  email: string;
  name: string;
  kind: "web" | "embed";
  tenant: { id: string; name: string; slug: string; role: Role } | null;
};

export async function getSession(): Promise<SessionInfo | null> {
  const jar = await cookies();
  const t = jar.get(SESSION_COOKIE)?.value;
  if (!t || t.length > 100) return null;
  const r = await sys<{
    user_id: string; email: string; name: string; kind: "web" | "embed";
    tenant_id: string | null; tname: string | null; slug: string | null; role: string | null;
  }>(
    `select s.user_id, u.email, u.name, s.kind, s.tenant_id, t.name as tname, t.slug, m.role
       from sessions s
       join users u on u.id = s.user_id
       left join tenants t on t.id = s.tenant_id
       left join memberships m on m.tenant_id = s.tenant_id and m.user_id = s.user_id
      where s.id_hash = $1 and s.expires_at > now()`,
    [sha256(t)],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    userId: row.user_id,
    email: row.email,
    name: row.name,
    kind: row.kind,
    tenant: row.tenant_id && row.slug && isRole(row.role) ? { id: row.tenant_id, name: row.tname ?? "", slug: row.slug, role: row.role } : null,
  };
}

export function ctxFromSession(s: SessionInfo): Ctx | null {
  if (!s.tenant) return null;
  return { tenantId: s.tenant.id, role: s.tenant.role, actor: { type: s.kind === "embed" ? "embed" : "user", id: s.userId }, userId: s.userId };
}

export async function switchTenant(tenantId: string) {
  const jar = await cookies();
  const t = jar.get(SESSION_COOKIE)?.value;
  if (!t) return false;
  const r = await sys(
    `update sessions s set tenant_id = $2
       where s.id_hash = $1 and s.kind = 'web'
         and exists (select 1 from memberships m where m.user_id = s.user_id and m.tenant_id = $2)`,
    [sha256(t), tenantId],
  );
  return (r.rowCount ?? 0) > 0;
}

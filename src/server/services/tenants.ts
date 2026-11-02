import { z } from "zod";
import { sys, sysTx, withTenant } from "@/lib/db";
import { assertCan, canDo, systemCtx, type Ctx } from "@/lib/ctx";
import { audit } from "./audit";
import { badRequest } from "@/lib/errors";
import { encrypt, decrypt, token } from "@/lib/crypto";
import { hashPassword, verifyPassword } from "@/lib/password";
import { ensureDefaultAgentsTx } from "./agents";
import { GROWTH_OS, writeDocTx } from "./memory";

export const SignupInput = z.object({
  name: z.string().trim().min(1, "Tell us your name").max(120),
  email: z.string().trim().toLowerCase().email("That email doesn't look right").max(254),
  password: z.string().min(10, "Use at least 10 characters").max(200),
  company: z.string().trim().min(1, "Company name is required").max(120),
});

export function slugify(s: string) {
  const base = s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base.length >= 2 ? base : `team-${token(4).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

async function uniqueSlug(base: string) {
  for (let i = 0; i < 20; i++) {
    const s = i === 0 ? base : `${base}-${token(3).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 4)}`;
    const r = await sys(`select 1 from tenants where slug = $1`, [s]);
    if (!r.rowCount) return s;
  }
  throw new Error("could not allocate slug");
}

/** Create the tenant, its Growth OS skeleton and its default agents. */
export async function provisionTenant(name: string, ownerUserId: string) {
  const slug = await uniqueSlug(slugify(name));
  const tenantId = await sysTx(async (tx) => {
    const t = await tx.query<{ id: string }>(`insert into tenants(name, slug, embed_secret_enc) values ($1,$2,$3) returning id`, [name, slug, encrypt(token(32))]);
    const id = t.rows[0]!.id;
    await tx.query(`insert into memberships(tenant_id, user_id, role) values ($1,$2,'owner')`, [id, ownerUserId]);
    return id;
  });
  const ctx: Ctx = { ...systemCtx(tenantId), userId: ownerUserId };
  await withTenant(tenantId, async (tx) => {
    for (const g of GROWTH_OS) await writeDocTx(tx, ctx, g.key, "", { authorKind: "system", note: "Created" });
    await ensureDefaultAgentsTx(tx, ctx);
  });
  return { tenantId, slug };
}

export async function signup(raw: unknown) {
  const input = SignupInput.parse(raw);
  const exists = await sys(`select 1 from users where email = $1`, [input.email]);
  if (exists.rowCount) throw badRequest("An account with that email already exists. Sign in instead.");
  const ph = await hashPassword(input.password);
  const u = await sys<{ id: string }>(`insert into users(email, name, password_hash) values ($1,$2,$3) returning id`, [input.email, input.name, ph]);
  const userId = u.rows[0]!.id;
  const { tenantId } = await provisionTenant(input.company, userId);
  return { userId, tenantId };
}

// Constant-time-ish login: always run a hash verification, even for unknown emails.
const DUMMY_HASH = "$argon2id$v=19$m=19456,t=2,p=1$S4lewNYFp2oOLfmJO76sIw$FEdoOGlxaV3a8RIzHGQnxpRl9/iGHaA0svqIJTaSfxA";

export async function login(email: string, password: string) {
  const r = await sys<{ id: string; password_hash: string | null }>(`select id, password_hash from users where email = $1`, [email.trim().toLowerCase()]);
  const u = r.rows[0];
  const ok = await verifyPassword(u?.password_hash ?? DUMMY_HASH, password);
  if (!u || !u.password_hash || !ok) return null;
  const m = await sys<{ tenant_id: string }>(`select tenant_id from memberships where user_id = $1 order by created_at limit 1`, [u.id]);
  return { userId: u.id, tenantId: m.rows[0]?.tenant_id ?? null };
}

export async function userTenants(userId: string) {
  const r = await sys<{ id: string; name: string; slug: string; role: string }>(
    `select t.id, t.name, t.slug, m.role from memberships m join tenants t on t.id = m.tenant_id where m.user_id = $1 order by t.name`,
    [userId],
  );
  return r.rows;
}

export async function getEmbedSecret(ctx: Ctx) {
  assertCan(ctx, "settings:manage");
  const r = await sys<{ embed_secret_enc: string | null }>(`select embed_secret_enc from tenants where id = $1`, [ctx.tenantId]);
  await withTenant(ctx.tenantId, (tx) => audit(tx, ctx, "embed_secret.reveal"));
  return r.rows[0]?.embed_secret_enc ? decrypt(r.rows[0].embed_secret_enc) : null;
}

export async function rotateEmbedSecret(ctx: Ctx) {
  assertCan(ctx, "settings:manage");
  const secret = token(32);
  await sys(`update tenants set embed_secret_enc = $2 where id = $1`, [ctx.tenantId, encrypt(secret)]);
  // Rotating the secret ends every embed session minted with the old one.
  await sys(`delete from sessions where tenant_id = $1 and kind = 'embed'`, [ctx.tenantId]);
  await withTenant(ctx.tenantId, (tx) => audit(tx, ctx, "embed_secret.rotate"));
  return secret;
}

export async function tenantSettings(ctx: Ctx) {
  assertCan(ctx, "read");
  const r = await sys<{ id: string; name: string; slug: string; allowed_origins: string[]; plan: string }>(
    `select id, name, slug, allowed_origins, plan from tenants where id = $1`,
    [ctx.tenantId],
  );
  return r.rows[0]!;
}

export async function updateTenant(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "settings:manage");
  const u = z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      allowed_origins: z
        .array(z.string().trim().regex(/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i, "Origins look like https://app.example.com"))
        .max(20)
        .optional(),
    })
    .parse(raw);
  await sys(`update tenants set name = coalesce($2, name), allowed_origins = coalesce($3, allowed_origins) where id = $1`, [ctx.tenantId, u.name ?? null, u.allowed_origins ?? null]);
  await withTenant(ctx.tenantId, (tx) => audit(tx, ctx, "workspace.update", { type: "tenant", id: ctx.tenantId }, { name: u.name, allowed_origins: u.allowed_origins }));
}

/** Members with emails: admins only, never inside an embed. Others get an empty list. */
export async function listMembers(ctx: Ctx) {
  if (!canDo(ctx, "members:manage")) return [];
  const r = await sys<{ id: string; name: string; email: string; role: string; external: boolean; created_at: string }>(
    `select u.id, u.name, u.email, m.role, (u.external_ref is not null) external, m.created_at
       from memberships m join users u on u.id = m.user_id where m.tenant_id = $1 order by m.created_at`,
    [ctx.tenantId],
  );
  return r.rows;
}

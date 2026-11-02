import { sys, withTenant } from "@/lib/db";
import { assertCan, type Ctx } from "@/lib/ctx";
import { forbidden } from "@/lib/errors";
import { audit } from "./audit";

/**
 * Data portability and erasure for a workspace.
 *  - exportTenant: everything the workspace owns, as JSON (secrets and credential hashes excluded).
 *  - deleteTenant: removes children in batches, then the tenant, then embed users that
 *    belonged only to it. Batched so a large workspace never holds long locks.
 */
const EXPORT_TABLES = [
  ["signals", "id, source, title, content, url, author, account, occurred_at, metadata, created_at"],
  ["memory_docs", "*"],
  ["memory_doc_versions", "*"],
  ["agents", "*"],
  ["agent_rules", "*"],
  ["runs", "id, agent_id, trigger, status, summary, model, input_tokens, output_tokens, cost_usd, created_at, started_at, finished_at"],
  ["drafts", "*"],
  ["experiments", "*"],
  ["metric_events", "*"],
  ["audit_log", "*"],
] as const;

export async function exportTenant(ctx: Ctx) {
  assertCan(ctx, "settings:manage");
  const t = await sys<{ id: string; name: string; slug: string; plan: string; allowed_origins: string[]; created_at: string }>(
    `select id, name, slug, plan, allowed_origins, created_at from tenants where id = $1`,
    [ctx.tenantId],
  );
  const members = await sys(
    `select u.name, u.email, m.role, (u.external_ref is not null) external, m.created_at from memberships m join users u on u.id = m.user_id where m.tenant_id = $1`,
    [ctx.tenantId],
  );
  const data: Record<string, unknown[]> = {};
  await withTenant(ctx.tenantId, async (tx) => {
    for (const [table, cols] of EXPORT_TABLES) data[table] = (await tx.query(`select ${cols} from ${table}`)).rows;
    await audit(tx, ctx, "workspace.export");
  });
  return { exported_at: new Date().toISOString(), workspace: t.rows[0], members: members.rows, ...data };
}

const DELETE_ORDER = ["metric_events", "experiments", "drafts", "runs", "agent_rules", "agents", "memory_doc_versions", "memory_docs", "signals", "api_keys", "audit_log", "embed_token_uses", "jobs", "sessions"];

/** Owner-only, never from an embed or API key. Irreversible. */
export async function deleteTenant(ctx: Ctx, confirmSlug: string) {
  if (ctx.role !== "owner" || ctx.actor.type !== "user") throw forbidden();
  const t = await sys<{ slug: string }>(`select slug from tenants where id = $1`, [ctx.tenantId]);
  if (!t.rows[0] || t.rows[0].slug !== confirmSlug) throw forbidden();
  return deleteTenantById(ctx.tenantId);
}

/** Operator path (scripts/delete-tenant.ts) and the owner action above. */
export async function deleteTenantById(tenantId: string) {
  const users = await sys<{ user_id: string }>(`select user_id from memberships where tenant_id = $1`, [tenantId]);
  for (const table of DELETE_ORDER) {
    for (;;) {
      const r = await sys(`delete from ${table} where ctid in (select ctid from ${table} where tenant_id = $1 limit 5000)`, [tenantId]);
      if ((r.rowCount ?? 0) < 5000) break;
    }
  }
  await sys(`delete from tenants where id = $1`, [tenantId]);
  // People who belonged only to this workspace (including its embed users) go too.
  const ids = users.rows.map((u) => u.user_id);
  if (ids.length) await sys(`delete from users where id = any($1) and not exists (select 1 from memberships m where m.user_id = users.id)`, [ids]);
  return { deleted: true };
}

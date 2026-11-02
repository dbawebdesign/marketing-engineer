import type { Tx } from "@/lib/db";
import type { Ctx } from "@/lib/ctx";

export async function audit(tx: Tx, ctx: Ctx, action: string, target?: { type: string; id: string }, metadata: Record<string, unknown> = {}) {
  await tx.query(
    `insert into audit_log(tenant_id, actor_type, actor_id, action, target_type, target_id, metadata) values ($1,$2,$3,$4,$5,$6,$7)`,
    [ctx.tenantId, ctx.actor.type, ctx.actor.id, action, target?.type ?? null, target?.id ?? null, metadata],
  );
}

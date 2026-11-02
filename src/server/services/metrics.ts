import { z } from "zod";
import { withTenant } from "@/lib/db";
import { assertCan, type Ctx } from "@/lib/ctx";
import { badRequest } from "@/lib/errors";
import { audit } from "./audit";

export const MAX_METRIC_BATCH = 1000;

export const MetricEventInput = z.object({
  kind: z.string().regex(/^[a-z_]{2,40}$/, "kind is 2-40 lowercase letters or underscores (e.g. demo_request)"),
  value: z.number().finite().min(-1e12).max(1e12).optional().default(1),
  angle: z.string().trim().max(300).optional().nullable(),
  experiment_id: z.string().uuid().optional().nullable(),
  variant: z.string().trim().max(100).optional().nullable(),
  draft_id: z.string().uuid().optional().nullable(),
  source: z.string().trim().max(100).optional().nullable(),
  occurred_at: z.coerce
    .date()
    .refine((d) => d.getTime() <= Date.now() + 5 * 60_000, "occurred_at can't be in the future")
    .refine((d) => d.getTime() >= Date.now() - 5 * 365 * 864e5, "occurred_at is too far in the past")
    .optional(),
  metadata: z
    .record(z.string(), z.unknown())
    .optional()
    .default({})
    .refine((m) => JSON.stringify(m).length <= 10_000, "metadata is larger than 10 KB"),
});
export type MetricEventInputT = z.input<typeof MetricEventInput>;

export const MetricBatch = z.array(MetricEventInput).min(1, "No events to record").max(MAX_METRIC_BATCH, `Send at most ${MAX_METRIC_BATCH} events per request`);

/** Record a batch of metric events (conversions, replies, demo requests...) for experiments and the cockpit. */
export async function recordMetricEvents(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "experiments:write");
  const events = MetricBatch.parse(raw);
  return withTenant(ctx.tenantId, async (tx) => {
    // Foreign keys are checked without RLS, so verify referenced rows belong to this tenant
    // (via RLS-scoped selects) instead of letting a guessed id from another tenant through.
    const expIds = [...new Set(events.map((e) => e.experiment_id).filter((x): x is string => !!x))];
    const draftIds = [...new Set(events.map((e) => e.draft_id).filter((x): x is string => !!x))];
    if (expIds.length) {
      const r = await tx.query<{ id: string }>(`select id from experiments where id = any($1::uuid[])`, [expIds]);
      const found = new Set(r.rows.map((x) => x.id));
      const missing = expIds.filter((id) => !found.has(id));
      if (missing.length) throw badRequest("Unknown experiment_id", { experiment_ids: missing });
    }
    if (draftIds.length) {
      const r = await tx.query<{ id: string }>(`select id from drafts where id = any($1::uuid[])`, [draftIds]);
      const found = new Set(r.rows.map((x) => x.id));
      const missing = draftIds.filter((id) => !found.has(id));
      if (missing.length) throw badRequest("Unknown draft_id", { draft_ids: missing });
    }
    const rows = events.map((e) => ({
      kind: e.kind,
      value: e.value,
      angle: e.angle ?? null,
      experiment_id: e.experiment_id ?? null,
      variant: e.variant ?? null,
      draft_id: e.draft_id ?? null,
      source: e.source ?? null,
      occurred_at: e.occurred_at?.toISOString() ?? null,
      metadata: e.metadata,
    }));
    const r = await tx.query(
      `insert into metric_events(tenant_id, kind, value, angle, experiment_id, variant, draft_id, source, occurred_at, metadata)
       select $1, x.kind, x.value, x.angle, x.experiment_id, x.variant, x.draft_id, x.source, coalesce(x.occurred_at, now()), coalesce(x.metadata, '{}'::jsonb)
         from jsonb_to_recordset($2::jsonb) as x(kind text, value numeric, angle text, experiment_id uuid, variant text, draft_id uuid, source text, occurred_at timestamptz, metadata jsonb)`,
      [ctx.tenantId, JSON.stringify(rows)],
    );
    await audit(tx, ctx, "metrics.record", undefined, { count: r.rowCount ?? 0 });
    return { recorded: r.rowCount ?? 0 };
  });
}

import { withTenant } from "@/lib/db";
import { assertCan, type Ctx } from "@/lib/ctx";

export type Experiment = {
  id: string;
  name: string;
  hypothesis: string;
  channel: string;
  metric: string;
  status: string;
  variants: { id: string; label: string; content?: string; angle?: string }[];
  created_at: string;
  started_at: string | null;
};

export async function listExperiments(ctx: Ctx, limit = 20) {
  assertCan(ctx, "read");
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query<Experiment>(
      `select id, name, hypothesis, channel, metric, status, variants, created_at, started_at from experiments order by created_at desc limit $1`,
      [limit],
    );
    return r.rows;
  });
}

/** Metric totals per angle over the last `days` days. Untagged events are left out. */
export async function angleMetrics(ctx: Ctx, days = 7) {
  assertCan(ctx, "read");
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query<{ angle: string; kind: string; v: number }>(
      `select angle, kind, sum(value)::float v from metric_events
        where occurred_at > now() - make_interval(days => $1) and nullif(trim(angle), '') is not null group by 1, 2`,
      [days],
    );
    const by = new Map<string, Record<string, number>>();
    for (const row of r.rows) {
      const m = by.get(row.angle) ?? {};
      m[row.kind] = row.v;
      by.set(row.angle, m);
    }
    return [...by.entries()].map(([angle, m]) => ({ angle, ...m })) as ({ angle: string } & Record<string, number>)[];
  });
}

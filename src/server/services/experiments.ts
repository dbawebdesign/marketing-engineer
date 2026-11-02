import { withTenant } from "@/lib/db";
import { assertCan, type Ctx } from "@/lib/ctx";
import { badRequest, notFound } from "@/lib/errors";
import { audit } from "./audit";

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

export type ExperimentMove = "start" | "won" | "lost";

/** Which status each move needs to come from, and lands on. */
const MOVES: Record<ExperimentMove, { from: string[]; to: string }> = {
  start: { from: ["draft"], to: "running" },
  won: { from: ["running"], to: "won" },
  lost: { from: ["running"], to: "lost" },
};

/** Start a queued test, or call a running one. Each move is audited. */
export async function moveExperiment(ctx: Ctx, id: string, move: ExperimentMove) {
  assertCan(ctx, "experiments:write");
  const m = MOVES[move];
  if (!m) throw badRequest("Unknown move");
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query<{ status: string; name: string }>(`select status, name from experiments where id = $1 for update`, [id]);
    const e = r.rows[0];
    if (!e) throw notFound("Experiment");
    if (!m.from.includes(e.status)) throw badRequest(move === "start" ? "This test already started." : "Only a running test can be called.");
    await tx.query(
      move === "start"
        ? `update experiments set status = $2, started_at = now() where id = $1`
        : `update experiments set status = $2, ended_at = now() where id = $1`,
      [id, m.to],
    );
    await audit(tx, ctx, `experiment.${move === "start" ? "start" : "end"}`, { type: "experiment", id }, { from: e.status, to: m.to });
    return { id, status: m.to, name: e.name };
  });
}

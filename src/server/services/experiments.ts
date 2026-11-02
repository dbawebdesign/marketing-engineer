import { withTenant, type Tx } from "@/lib/db";
import { assertCan, type Ctx } from "@/lib/ctx";
import { badRequest, notFound } from "@/lib/errors";
import { computeResults, fmtScore, verdictLine, type Results, type TaggedEvent } from "@/lib/experiment-results";
import { audit } from "./audit";
import { writeDocTx } from "./memory";

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
  ended_at: string | null;
  /** Per-arm deciding metric over the test's window. Not computed for a test that hasn't started. */
  results: Results | null;
};

const COLS = `id, name, hypothesis, channel, metric, status, variants, created_at, started_at, ended_at`;

/** Metric events in the test's window tagged with one of its angles, or with the test itself. */
async function eventsFor(tx: Tx, e: Omit<Experiment, "results">): Promise<TaggedEvent[]> {
  if (!e.started_at) return [];
  const angles = [...new Set(e.variants.map((v) => (v.angle ?? v.label).trim().toLowerCase()).filter(Boolean))];
  const r = await tx.query<TaggedEvent>(
    `select kind, sum(value)::float as value, angle, variant, experiment_id from metric_events
      where occurred_at >= $2 and ($3::timestamptz is null or occurred_at <= $3)
        and (experiment_id = $1 or lower(trim(angle)) = any($4::text[]))
      group by kind, angle, variant, experiment_id`,
    [e.id, e.started_at, e.ended_at, angles],
  );
  return r.rows;
}

export async function listExperiments(ctx: Ctx, limit = 20): Promise<Experiment[]> {
  assertCan(ctx, "read");
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query<Omit<Experiment, "results">>(`select ${COLS} from experiments order by created_at desc limit $1`, [limit]);
    const out: Experiment[] = [];
    for (const e of r.rows) out.push({ ...e, results: e.started_at ? computeResults(e, await eventsFor(tx, e)) : null });
    return out;
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

const WINNING_HOOKS = "content/winning-hooks";

/** The section a won test appends to "Winning hooks": the winning arm, its lines, and the number behind it. */
export function winnerSection(e: { name: string }, r: Results, on = new Date()) {
  const w = r.leader!;
  // Hooks are one line each; an ad concept contributes its headline only.
  const lines = w.variants.map((v) => (v.content ?? v.label).split("\n")[0]!.replace(/\s+/g, " ").trim()).filter(Boolean);
  const date = on.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return [
    `## ${w.label}`,
    `Won “${e.name}” on ${date}: ${fmtScore(w.score, r.kind)} ${r.unit} over ${w.clicks} clicks${r.runnerUp ? `, vs ${fmtScore(r.runnerUp.score, r.kind)} for ${r.runnerUp.label}` : ""}.`,
    "",
    ...(lines.length ? lines.map((l) => `- ${l}`) : [`- ${w.label}`]),
  ].join("\n");
}

/** Start a queued test, or call a running one. Each move is audited; a win lands in "Winning hooks". */
export async function moveExperiment(ctx: Ctx, id: string, move: ExperimentMove) {
  assertCan(ctx, "experiments:write");
  const m = MOVES[move];
  if (!m) throw badRequest("Unknown move");
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query<Omit<Experiment, "results">>(`select ${COLS} from experiments where id = $1 for update`, [id]);
    const e = r.rows[0];
    if (!e) throw notFound("Experiment");
    if (!m.from.includes(e.status)) throw badRequest(move === "start" ? "This test already started." : "Only a running test can be called.");
    if (move === "start" && e.variants.length < 2) throw badRequest("A test needs at least two variants. Write hooks for it first.");
    let verdict: string | null = null;
    let winner: string | null = null;
    if (move !== "start") {
      const results = computeResults(e, await eventsFor(tx, e));
      verdict = verdictLine(results);
      if (move === "won") {
        if (!results.leader) throw badRequest("No results yet. A test is won on its numbers.");
        assertCan(ctx, "memory:write");
        winner = results.leader.label;
        const cur = await tx.query<{ content: string }>(`select content from memory_docs where key = $1`, [WINNING_HOOKS]);
        const prev = (cur.rows[0]?.content ?? "").trimEnd();
        await writeDocTx(tx, ctx, WINNING_HOOKS, `${prev ? `${prev}\n\n` : ""}${winnerSection(e, results)}\n`, { note: `Won: ${e.name}`, authorKind: "user" });
      }
    }
    await tx.query(
      move === "start"
        ? `update experiments set status = $2, started_at = now() where id = $1`
        : `update experiments set status = $2, ended_at = now(), learnings = coalesce(learnings, $3) where id = $1`,
      move === "start" ? [id, m.to] : [id, m.to, verdict],
    );
    await audit(tx, ctx, `experiment.${move === "start" ? "start" : "end"}`, { type: "experiment", id }, { from: e.status, to: m.to, verdict, winner });
    return { id, status: m.to, name: e.name, verdict, winner };
  });
}

import { withTenant, sys, type Tx } from "@/lib/db";
import { systemCtx } from "@/lib/ctx";
import { aiEnabled, generate, MODELS, AiRefusal } from "@/lib/ai/provider";
import { getTemplate } from "./registry";
import type { AgentTemplate, JobSpec, MetricsDigest, RunContext } from "./types";
import { dedupeEvidence, type SignalLite } from "./evidence";
import { audit } from "../services/audit";
import { readinessOf } from "./readiness";

type AgentRow = { id: string; tenant_id: string; template: string; system: string; name: string; spec: JobSpec; model: string };

async function gather(tx: Tx, agent: AgentRow, tpl: AgentTemplate, input: Record<string, unknown>): Promise<RunContext> {
  const spec = { ...tpl.spec, ...agent.spec };
  const days = Math.min(Math.max(Number(input.lookbackDays ?? spec.lookbackDays) || 7, 1), 365);
  const tenant = await tx.query<{ name: string }>(`select name from tenants limit 1`);
  const sigQ = await tx.query<SignalLite & { metadata: Record<string, unknown> }>(
    `select id, source, content, title, url, account, occurred_at::text, metadata
       from signals
      where occurred_at > now() - make_interval(days => $1)
        and ($2::text[] is null or source = any($2))
      order by occurred_at desc
      limit 400`,
    [days, tpl.signalSources ?? null],
  );
  const signals = sigQ.rows.map((s) => ({ ...s, outcome: typeof s.metadata?.outcome === "string" ? (s.metadata.outcome as string) : null }));
  const docs = await tx.query<{ key: string; title: string; content: string; version: number }>(
    `select key, title, content, version from memory_docs where key = any($1)`,
    [tpl.reads],
  );
  const rules = await tx.query<{ rule: string }>(`select rule from agent_rules where agent_id = $1 and active order by created_at`, [agent.id]);
  const fb = await tx.query<{ title: string; status: string; feedback: string | null }>(
    `select title, status, feedback from drafts where agent_id = $1 and status in ('approved','rejected') and feedback is not null order by reviewed_at desc nulls last limit 8`,
    [agent.id],
  );
  let metrics: MetricsDigest | undefined;
  if (tpl.needsMetrics) metrics = await metricsDigest(tx, days);
  return {
    tenantName: tenant.rows[0]?.name ?? "the company",
    agentName: agent.name,
    spec: { ...spec, lookbackDays: days },
    signals,
    signalMap: new Map(signals.map((s) => [s.id, s])),
    docs: Object.fromEntries(docs.rows.map((d) => [d.key, d])),
    rules: rules.rows.map((r) => r.rule),
    recentFeedback: fb.rows,
    metrics,
    input,
    now: new Date(),
  };
}

export async function metricsDigest(tx: Tx, days: number): Promise<MetricsDigest> {
  const totals = await tx.query<{ kind: string; v: string }>(
    `select kind, sum(value)::text v from metric_events where occurred_at > now() - make_interval(days => $1) group by kind`,
    [days],
  );
  const byAngle = await tx.query<{ angle: string; kind: string; v: string }>(
    `select coalesce(angle,'(none)') angle, kind, sum(value)::text v from metric_events
      where occurred_at > now() - make_interval(days => $1) group by 1,2 order by 3 desc limit 60`,
    [days],
  );
  const ex = await tx.query<{ id: string; name: string; status: string; metric: string; variants: { label: string; impressions?: number; conversions?: number }[] }>(
    `select id, name, status, metric, variants from experiments where created_at > now() - interval '60 days' order by created_at desc limit 20`,
  );
  const ap = await tx.query<{ system: string; approved: string; rejected: string; pending: string }>(
    `select system, count(*) filter (where status in ('approved','published'))::text approved, count(*) filter (where status='rejected')::text rejected,
            count(*) filter (where status='pending')::text pending
       from drafts where created_at > now() - make_interval(days => $1) group by system`,
    [days],
  );
  const to = new Date();
  return {
    window: { from: new Date(to.getTime() - days * 864e5).toISOString(), to: to.toISOString() },
    totals: Object.fromEntries(totals.rows.map((r) => [r.kind, Number(r.v)])),
    byAngle: byAngle.rows.map((r) => ({ angle: r.angle, kind: r.kind, value: Number(r.v) })),
    experiments: ex.rows,
    approvals: ap.rows.map((r) => ({ system: r.system, approved: +r.approved, rejected: +r.rejected, pending: +r.pending })),
  };
}

/** Execute one queued run end to end. Idempotent: a run that is no longer queued is skipped. */
export async function executeRun(tenantId: string, runId: string): Promise<void> {
  const ctx = systemCtx(tenantId);
  const claimed = await withTenant(tenantId, async (tx) => {
    const r = await tx.query<{ agent_id: string; input: Record<string, unknown> }>(
      `update runs set status = 'running', started_at = now() where id = $1 and status = 'queued' returning agent_id, input`,
      [runId],
    );
    if (!r.rows[0]) return null;
    const a = await tx.query<AgentRow>(`select id, tenant_id, template, system, name, spec, model from agents where id = $1`, [r.rows[0].agent_id]);
    if (!a.rows[0]) return null;
    const tpl = getTemplate(a.rows[0].template);
    if (!tpl) throw new Error(`Unknown agent template ${a.rows[0].template}`);
    const rc = await gather(tx, a.rows[0], tpl, r.rows[0].input ?? {});
    return { agent: a.rows[0], tpl, rc };
  });
  if (!claimed) return;
  const { agent, tpl, rc } = claimed;

  // Never draft from no input: finish quietly and say what's missing.
  const ready = readinessOf(tpl, rc.signals.length, Object.values(rc.metrics?.totals ?? {}).reduce((a, b) => a + b, 0), rc.spec.lookbackDays);
  if (!ready.ready) {
    await withTenant(tenantId, async (tx) => {
      const stats = { nothing: 1, signals: ready.signals, drafts: 0 };
      await tx.query(
        `update runs set status='succeeded', finished_at=now(), summary=$2, model='offline', input = input || jsonb_build_object('stats', $3::jsonb) where id=$1`,
        [runId, ready.reason, JSON.stringify(stats)],
      );
      await audit(tx, { ...ctx, actor: { type: "agent", id: agent.id } }, "run.succeeded", { type: "run", id: runId }, stats);
    });
    return;
  }

  try {
    let data: unknown;
    let usage = { model: "offline", inputTokens: 0, outputTokens: 0, costUsd: 0 };
    if (aiEnabled() && rc.signals.length + Object.keys(rc.docs).length > 0) {
      const res = await generate({
        model: agent.model || MODELS[tpl.tier],
        system: tpl.systemPrompt,
        prompt: tpl.prompt(rc),
        schema: tpl.schema,
        effort: tpl.tier === "deep" ? "high" : "medium",
      });
      data = res.data;
      usage = res.usage;
    } else {
      data = tpl.offline(rc);
    }
    const result = tpl.finalize(data as never, rc);
    await withTenant(tenantId, async (tx) => {
      for (const d of result.drafts) {
        await tx.query(
          `insert into drafts(tenant_id, run_id, agent_id, system, type, title, body, payload, evidence) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [tenantId, runId, agent.id, agent.system, d.type, d.title.slice(0, 300), d.body, d.payload ?? {}, JSON.stringify(dedupeEvidence(d.evidence))],
        );
      }
      await tx.query(
        `update runs set status='succeeded', finished_at=now(), summary=$2, model=$3, input_tokens=$4, output_tokens=$5, cost_usd=$6,
                input = input || jsonb_build_object('stats', $7::jsonb)
          where id=$1`,
        [runId, result.summary.slice(0, 1000), usage.model, usage.inputTokens, usage.outputTokens, usage.costUsd, JSON.stringify(result.stats)],
      );
      await audit(tx, { ...ctx, actor: { type: "agent", id: agent.id } }, "run.succeeded", { type: "run", id: runId }, { drafts: result.drafts.length, ...result.stats });
    });
  } catch (e) {
    const message = e instanceof AiRefusal ? e.message : e instanceof Error ? e.message : "Unknown error";
    console.error(`[run ${runId}] failed`, e);
    await withTenant(tenantId, (tx) =>
      tx.query(`update runs set status='failed', finished_at=now(), error=$2 where id=$1`, [runId, message.slice(0, 2000)]),
    );
    throw e;
  }
}

/** Fail runs that have been "running" too long (crashed worker). */
export async function reapStuckRuns() {
  await sys(`update runs set status='failed', error='Timed out', finished_at=now() where status='running' and started_at < now() - interval '30 minutes'`);
}

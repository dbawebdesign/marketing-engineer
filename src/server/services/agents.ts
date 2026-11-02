import { z } from "zod";
import { withTenant, type Tx } from "@/lib/db";
import { assertCan, type Ctx } from "@/lib/ctx";
import { AppError, badRequest, notFound } from "@/lib/errors";
import { MODELS } from "@/lib/ai/provider";
import { getTemplate, TEMPLATES } from "../agents/registry";
import type { JobSpec, System } from "../agents/types";
import { DAILY_RUN_LIMIT, enqueue, nextRun, scheduleProblem } from "../jobs";
import { audit } from "./audit";
import { countInputs, readinessOf, type Readiness } from "../agents/readiness";

export type Agent = {
  id: string;
  template: string;
  system: System;
  name: string;
  spec: JobSpec;
  model: string;
  schedule_cron: string | null;
  timezone: string;
  enabled: boolean;
  next_run_at: string | null;
  last_run: { id: string; status: string; created_at: string; summary: string | null } | null;
  rules_count: number;
  approval_rate: number | null;
  /** Whether the agent's window has enough input to draft from. */
  readiness: Readiness | null;
};

/** Attach readiness using the same window and sources the runner reads. */
async function withReadiness(tx: Tx, rows: Omit<Agent, "readiness">[]): Promise<Agent[]> {
  const out: Agent[] = [];
  for (const a of rows) {
    const tpl = getTemplate(a.template);
    if (!tpl) {
      out.push({ ...a, readiness: null });
      continue;
    }
    const days = Math.min(Math.max(Number(a.spec?.lookbackDays ?? tpl.spec.lookbackDays) || 7, 1), 365);
    const c = await countInputs(tx, tpl, days);
    out.push({ ...a, readiness: readinessOf(tpl, c.signals, c.metrics, days) });
  }
  return out;
}

/** `readiness` counts each agent's input window; pages that show Run ask for it. */
export async function listAgents(ctx: Ctx, opts: { readiness?: boolean } = {}): Promise<Agent[]> {
  assertCan(ctx, "read");
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query<Omit<Agent, "readiness">>(
      `select a.id, a.template, a.system, a.name, a.spec, a.model, a.schedule_cron, a.timezone, a.enabled, a.next_run_at,
              (select row_to_json(x) from (select id, status, created_at, summary from runs where agent_id = a.id order by created_at desc limit 1) x) as last_run,
              (select count(*)::int from agent_rules where agent_id = a.id and active) as rules_count,
              (select case when count(*) filter (where status <> 'pending') = 0 then null
                      else round(100.0 * count(*) filter (where status in ('approved','published')) / count(*) filter (where status <> 'pending'))::int end
                 from drafts where agent_id = a.id) as approval_rate
         from agents a order by a.created_at`,
    );
    return opts.readiness ? withReadiness(tx, r.rows) : r.rows.map((a) => ({ ...a, readiness: null }));
  });
}

export async function getAgent(ctx: Ctx, id: string) {
  assertCan(ctx, "read");
  return withTenant(ctx.tenantId, async (tx) => {
    const a = await tx.query<Omit<Agent, "readiness">>(`select id, template, system, name, spec, model, schedule_cron, timezone, enabled, next_run_at, null as last_run, 0 as rules_count, null as approval_rate from agents where id = $1`, [id]);
    if (!a.rows[0]) throw notFound("Agent");
    const [agent] = await withReadiness(tx, [a.rows[0]]);
    const rules = await tx.query<{ id: string; rule: string; source: string; created_at: string }>(
      `select id, rule, source, created_at from agent_rules where agent_id = $1 and active order by created_at desc`,
      [id],
    );
    const runs = await tx.query<{ id: string; status: string; trigger: string; summary: string | null; error: string | null; created_at: string; finished_at: string | null; cost_usd: string; model: string | null; input: Record<string, unknown> }>(
      `select id, status, trigger, summary, error, created_at, finished_at, cost_usd, model, input from runs where agent_id = $1 order by created_at desc limit 20`,
      [id],
    );
    return { agent: agent!, rules: rules.rows, runs: runs.rows };
  });
}

export async function createAgentTx(tx: Tx, ctx: Ctx, templateId: string, overrides: { name?: string; schedule_cron?: string | null } = {}) {
  const tpl = getTemplate(templateId);
  if (!tpl) throw badRequest("Unknown agent template");
  const cron = overrides.schedule_cron === undefined ? tpl.defaultCron : overrides.schedule_cron;
  const r = await tx.query<{ id: string }>(
    `insert into agents(tenant_id, template, system, name, spec, model, schedule_cron, next_run_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [ctx.tenantId, tpl.id, tpl.system, overrides.name ?? tpl.name, tpl.spec, MODELS[tpl.tier], cron, cron ? nextRun(cron) : null],
  );
  await audit(tx, ctx, "agent.create", { type: "agent", id: r.rows[0]!.id }, { template: tpl.id });
  return r.rows[0]!.id;
}

export async function createAgent(ctx: Ctx, templateId: string) {
  assertCan(ctx, "agents:manage");
  return withTenant(ctx.tenantId, (tx) => createAgentTx(tx, ctx, templateId));
}

/** Make sure every template has one agent. Used at signup and when new templates ship. */
export async function ensureDefaultAgentsTx(tx: Tx, ctx: Ctx) {
  const have = await tx.query<{ template: string }>(`select distinct template from agents`);
  const set = new Set(have.rows.map((r) => r.template));
  for (const t of TEMPLATES) if (!set.has(t.id)) await createAgentTx(tx, ctx, t.id);
}

export const AgentUpdate = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
  schedule_cron: z.string().trim().max(100).nullable().optional(),
  model: z.enum([MODELS.deep, MODELS.fast]).optional(),
  spec: z
    .object({
      mission: z.string().max(1000),
      filters: z.array(z.string().max(300)).max(20),
      output: z.string().max(1000),
      goodLooksLike: z.array(z.string().max(300)).max(20),
      approval: z.string().max(500),
      metric: z.string().max(300),
      lookbackDays: z.number().int().min(1).max(365),
    })
    .partial()
    .optional(),
});

export async function updateAgent(ctx: Ctx, id: string, raw: unknown) {
  assertCan(ctx, "agents:manage");
  const u = AgentUpdate.parse(raw);
  const problem = u.schedule_cron ? scheduleProblem(u.schedule_cron) : null;
  if (problem) throw badRequest(problem);
  return withTenant(ctx.tenantId, async (tx) => {
    const cur = await tx.query<{ spec: JobSpec; schedule_cron: string | null; timezone: string }>(`select spec, schedule_cron, timezone from agents where id = $1 for update`, [id]);
    if (!cur.rows[0]) throw notFound("Agent");
    const spec = { ...cur.rows[0].spec, ...(u.spec ?? {}) };
    const cron = u.schedule_cron === undefined ? cur.rows[0].schedule_cron : u.schedule_cron;
    await tx.query(
      `update agents set name = coalesce($2, name), enabled = coalesce($3, enabled), schedule_cron = $4, model = coalesce($5, model), spec = $6,
              next_run_at = $7, updated_at = now() where id = $1`,
      [id, u.name ?? null, u.enabled ?? null, cron, u.model ?? null, spec, cron ? nextRun(cron, cur.rows[0].timezone) : null],
    );
    await audit(tx, ctx, "agent.update", { type: "agent", id }, { fields: Object.keys(u) });
  });
}

export async function addRule(ctx: Ctx, agentId: string, rule: string, source: "manual" | "correction" = "manual") {
  // Standing rules reprogram the agent, so they need the same permission as removing them.
  assertCan(ctx, "agents:manage");
  const text = rule.trim();
  if (text.length < 3 || text.length > 2000) throw badRequest("A rule should be between 3 and 2,000 characters");
  return withTenant(ctx.tenantId, async (tx) => addRuleTx(tx, ctx, agentId, text, source));
}

export async function addRuleTx(tx: Tx, ctx: Ctx, agentId: string, rule: string, source: "manual" | "correction") {
  const r = await tx.query<{ id: string }>(
    `insert into agent_rules(tenant_id, agent_id, rule, source, created_by) values ($1,$2,$3,$4,$5) returning id`,
    [ctx.tenantId, agentId, rule, source, ctx.userId],
  );
  await audit(tx, ctx, "agent.rule.add", { type: "agent", id: agentId }, { source });
  return r.rows[0]!.id;
}

export async function removeRule(ctx: Ctx, ruleId: string) {
  assertCan(ctx, "agents:manage");
  return withTenant(ctx.tenantId, async (tx) => {
    await tx.query(`update agent_rules set active = false where id = $1`, [ruleId]);
    await audit(tx, ctx, "agent.rule.remove", { type: "agent_rule", id: ruleId });
  });
}

/** Queue a run. Returns the run id; the worker (or inline drain) executes it. */
export async function runAgent(ctx: Ctx, agentId: string, input: Record<string, unknown> = {}, trigger: "manual" | "api" = "manual") {
  assertCan(ctx, "agents:run");
  return withTenant(ctx.tenantId, async (tx) => {
    // Serialise run creation per workspace so concurrent requests can't both pass the checks below.
    await tx.query(`select pg_advisory_xact_lock(hashtext('runs:' || $1))`, [ctx.tenantId]);
    const a = await tx.query<{ id: string }>(`select id from agents where id = $1`, [agentId]);
    if (!a.rows[0]) throw notFound("Agent");
    const active = await tx.query(`select 1 from runs where agent_id = $1 and status in ('queued','running') and created_at > now() - interval '30 minutes'`, [agentId]);
    if (active.rowCount) throw badRequest("This agent is already working. Give it a moment.");
    const today = await tx.query<{ n: number }>(`select count(*)::int n from runs where created_at > now() - interval '24 hours'`);
    if ((today.rows[0]?.n ?? 0) >= DAILY_RUN_LIMIT) throw new AppError(429, "run_limit", `This workspace has used its ${DAILY_RUN_LIMIT} agent runs for the day. Try again tomorrow.`);
    const r = await tx.query<{ id: string }>(
      `insert into runs(tenant_id, agent_id, trigger, requested_by, input) values ($1,$2,$3,$4,$5) returning id`,
      [ctx.tenantId, agentId, trigger, ctx.userId, input],
    );
    const runId = r.rows[0]!.id;
    await enqueue(tx, { tenantId: ctx.tenantId, type: "agent.run", payload: { runId } });
    await audit(tx, ctx, "agent.run", { type: "run", id: runId }, { agentId, trigger });
    return runId;
  });
}

export async function getRun(ctx: Ctx, runId: string) {
  assertCan(ctx, "read");
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query<{ id: string; agent_id: string; status: string; summary: string | null; error: string | null; created_at: string; finished_at: string | null }>(
      `select id, agent_id, status, summary, error, created_at, finished_at from runs where id = $1`,
      [runId],
    );
    if (!r.rows[0]) throw notFound("Run");
    return r.rows[0];
  });
}

export async function listRuns(ctx: Ctx, limit = 30) {
  assertCan(ctx, "read");
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query<{ id: string; agent_id: string; agent_name: string; system: string; status: string; trigger: string; summary: string | null; error: string | null; created_at: string; finished_at: string | null; cost_usd: string }>(
      `select r.id, r.agent_id, a.name agent_name, a.system, r.status, r.trigger, r.summary, r.error, r.created_at, r.finished_at, r.cost_usd
         from runs r join agents a on a.id = r.agent_id order by r.created_at desc limit $1`,
      [Math.min(limit, 100)],
    );
    return r.rows;
  });
}

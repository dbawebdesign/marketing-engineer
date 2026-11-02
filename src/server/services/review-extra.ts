import { withTenant } from "@/lib/db";
import { assertCan, type Ctx } from "@/lib/ctx";
import { badRequest, notFound } from "@/lib/errors";
import { getTemplate } from "../agents/registry";
import { audit } from "./audit";

/** Draft types whose approval has no side effect, so a review can be taken back. */
export const UNDOABLE_TYPES = ["post", "outbound_message", "asset_idea", "ai_answer_pack"] as const;
export const isUndoable = (type: string) => (UNDOABLE_TYPES as readonly string[]).includes(type);

export type RecentReason = { text: string; isRule: boolean };

/** The last few distinct reasons drafts from this agent were rejected, newest first. */
export async function recentRejectionReasons(ctx: Ctx, agentId: string, limit = 4): Promise<RecentReason[]> {
  assertCan(ctx, "read");
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query<{ text: string; is_rule: boolean }>(
      `select f.text, exists(select 1 from agent_rules ar where ar.agent_id = $1 and ar.active and ar.rule = f.text) as is_rule
         from (select trim(feedback) as text, max(reviewed_at) as at from drafts
                where agent_id = $1 and status = 'rejected' and feedback is not null and length(trim(feedback)) between 3 and 2000
                group by trim(feedback)) f
        order by f.at desc nulls last limit $2`,
      [agentId, limit],
    );
    return r.rows.map((x) => ({ text: x.text, isRule: x.is_rule }));
  });
}

/**
 * Put a just-reviewed draft back in the queue. Only the same reviewer, only within
 * two minutes, and only for types whose approval had no effect to unwind. A rule
 * learned from the rejection in that window is retired too.
 */
export async function undoReview(ctx: Ctx, draftId: string) {
  assertCan(ctx, "drafts:review");
  if (!ctx.userId) throw badRequest("Only a person can undo a review.");
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query<{ id: string; type: string; status: string; agent_id: string | null; feedback: string | null; recent: boolean; same: boolean }>(
      `select id, type, status, agent_id, feedback,
              reviewed_at > now() - interval '2 minutes' as recent,
              reviewer_id is not distinct from $2::uuid as same
         from drafts where id = $1 for update`,
      [draftId, ctx.userId],
    );
    const d = r.rows[0];
    if (!d) throw notFound("Draft");
    if (d.status !== "approved" && d.status !== "rejected") throw badRequest("This draft is already back in review.");
    if (!isUndoable(d.type)) throw badRequest("This approval already took effect and can't be undone.");
    if (!d.same || !d.recent) throw badRequest("Too late to undo. Reviews can be undone for two minutes.");
    if (d.status === "rejected" && d.feedback && d.agent_id) {
      await tx.query(
        `update agent_rules set active = false
          where agent_id = $1 and rule = $2 and source = 'correction' and created_by = $3 and active and created_at > now() - interval '2 minutes'`,
        [d.agent_id, d.feedback.trim(), ctx.userId],
      );
    }
    await tx.query(`update drafts set status = 'pending', feedback = null, reviewer_id = null, reviewed_at = null where id = $1`, [draftId]);
    await audit(tx, ctx, "draft.undo", { type: "draft", id: draftId }, { from: d.status });
    return { id: draftId };
  });
}

/** The first draft a run produced, if any. */
export async function firstDraftOfRun(ctx: Ctx, runId: string) {
  assertCan(ctx, "read");
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query<{ id: string }>(`select id from drafts where run_id = $1 order by created_at, id limit 1`, [runId]);
    return r.rows[0]?.id ?? null;
  });
}

export type ActiveRun = { id: string; agent_id: string; agent_name: string; system: string; status: string; signals: number };

/** What Today needs to decide which state to show. */
export async function todayState(ctx: Ctx) {
  assertCan(ctx, "read");
  return withTenant(ctx.tenantId, async (tx) => {
    const runs = await tx.query<{ id: string; agent_id: string; agent_name: string; system: string; template: string; status: string; spec: Record<string, unknown>; input: Record<string, unknown> }>(
      `select r.id, r.agent_id, a.name agent_name, a.system, a.template, r.status, a.spec, r.input
         from runs r join agents a on a.id = r.agent_id
        where r.status in ('queued','running') and r.created_at > now() - interval '30 minutes'
        order by r.created_at`,
    );
    const active: ActiveRun[] = [];
    for (const run of runs.rows) {
      const tpl = getTemplate(run.template);
      const days = Math.min(Math.max(Number(run.input?.lookbackDays ?? run.spec?.lookbackDays ?? tpl?.spec.lookbackDays) || 7, 1), 365);
      const n = await tx.query<{ n: number }>(
        `select least(count(*), 400)::int n from signals where occurred_at > now() - make_interval(days => $1) and ($2::text[] is null or source = any($2))`,
        [days, tpl?.signalSources ?? null],
      );
      active.push({ id: run.id, agent_id: run.agent_id, agent_name: run.agent_name, system: run.system, status: run.status, signals: n.rows[0]?.n ?? 0 });
    }
    const facts = await tx.query<{ finished_run: boolean; approved_memo: boolean; content_drafts: number; pending_memo: string | null }>(
      `select exists(select 1 from runs where status in ('succeeded','failed','canceled')) as finished_run,
              exists(select 1 from drafts where type = 'market_memo' and status in ('approved','published')) as approved_memo,
              (select count(*)::int from drafts where system in ('founder_content','outbound_signal')) as content_drafts,
              (select id::text from drafts where type = 'market_memo' and status = 'pending' order by created_at desc limit 1) as pending_memo`,
    );
    const f = facts.rows[0]!;
    return { active, finishedRun: f.finished_run, approvedMemo: f.approved_memo, contentDrafts: f.content_drafts, pendingMemoId: f.pending_memo };
  });
}

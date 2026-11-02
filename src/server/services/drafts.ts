import { z } from "zod";
import { withTenant, type Tx } from "@/lib/db";
import { assertCan, type Ctx } from "@/lib/ctx";
import { badRequest, notFound } from "@/lib/errors";
import type { VerifiedEvidence } from "../agents/evidence";
import { audit } from "./audit";
import { writeDocTx } from "./memory";
import { markLatestVersionSampleTx } from "./sample";
import { addRuleTx } from "./agents";

export type Draft = {
  id: string;
  run_id: string | null;
  agent_id: string | null;
  agent_name: string | null;
  system: string;
  type: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  evidence: VerifiedEvidence[];
  status: "pending" | "approved" | "rejected" | "published";
  feedback: string | null;
  reviewed_at: string | null;
  created_at: string;
  is_sample?: boolean;
};

const COLS = `d.id, d.run_id, d.agent_id, a.name agent_name, d.system, d.type, d.title, d.body, d.payload, d.evidence, d.status, d.feedback, d.reviewed_at, d.created_at, d.is_sample`;

/**
 * Upstream first: the market memo feeds every other system, so a review queue reads
 * in dependency order. Pending drafts sort by this, then newest.
 */
export const SYSTEM_ORDER = ["customer_truth", "growth_cockpit", "ai_search", "founder_content", "outbound_signal", "creative_testing"];

export async function listDrafts(ctx: Ctx, opts: { status?: string; system?: string; limit?: number } = {}) {
  assertCan(ctx, "read");
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query<Draft>(
      `select ${COLS} from drafts d left join agents a on a.id = d.agent_id
        where ($1::text is null or d.status = $1) and ($2::text is null or d.system = $2)
        order by case when $1 = 'pending' then coalesce(array_position($4::text[], d.system), 99) else 0 end, d.created_at desc, d.id limit $3`,
      [opts.status ?? null, opts.system ?? null, Math.min(opts.limit ?? 50, 200), SYSTEM_ORDER],
    );
    return r.rows;
  });
}

export async function getDraft(ctx: Ctx, id: string) {
  assertCan(ctx, "read");
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query<Draft>(`select ${COLS} from drafts d left join agents a on a.id = d.agent_id where d.id = $1`, [id]);
    if (!r.rows[0]) throw notFound("Draft");
    return r.rows[0];
  });
}

export async function pendingCount(ctx: Ctx) {
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query<{ n: number }>(`select count(*)::int n from drafts where status = 'pending'`);
    return r.rows[0]?.n ?? 0;
  });
}

export const ReviewInput = z.object({
  decision: z.enum(["approve", "reject"]),
  feedback: z.string().trim().max(4000).optional().nullable(),
  /** Turn the feedback into a standing rule for the agent (how agents get trained). */
  remember: z.boolean().optional().default(false),
  /** Optional edited body; the edit is what gets approved. */
  body: z.string().max(200_000).optional(),
});

/** Approve or reject a draft. Approval applies the draft's effect (e.g. updates the truth file). */
export async function reviewDraft(ctx: Ctx, id: string, raw: unknown) {
  assertCan(ctx, "drafts:review");
  const input = ReviewInput.parse(raw);
  if (input.decision === "reject" && input.remember && !input.feedback) throw badRequest("Say what was wrong so the agent can learn it.");
  // Reviewers teach agents through rejections only: a correction becomes a standing rule.
  if (input.remember && input.decision === "reject" && (input.feedback?.length ?? 0) > 2000) throw badRequest("Keep the reason under 2,000 characters so it works as a rule.");
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query<Draft>(`select ${COLS} from drafts d left join agents a on a.id = d.agent_id where d.id = $1 for update of d`, [id]);
    const d = r.rows[0];
    if (!d) throw notFound("Draft");
    if (d.status !== "pending") throw badRequest(`This draft was already ${d.status}.`);
    const body = input.body ?? d.body;
    const status = input.decision === "approve" ? "approved" : "rejected";
    await tx.query(`update drafts set status=$2, body=$3, feedback=$4, reviewer_id=$5, reviewed_at=now() where id=$1`, [id, status, body, input.feedback ?? null, ctx.userId]);
    if (input.decision === "reject" && input.remember && input.feedback && d.agent_id) await addRuleTx(tx, ctx, d.agent_id, input.feedback, "correction");
    let effect: string | null = null;
    if (status === "approved") effect = await applyApproval(tx, ctx, { ...d, body });
    await audit(tx, ctx, `draft.${status}`, { type: "draft", id }, { edited: input.body !== undefined && input.body !== d.body, remembered: input.remember, effect });
    return { status, effect };
  });
}

async function applyApproval(tx: Tx, ctx: Ctx, d: Draft): Promise<string | null> {
  switch (d.type) {
    case "market_memo": {
      await writeDocTx(tx, ctx, "customer-truth/what-the-market-is-telling-us", d.body, { note: `Approved: ${d.title}`, authorKind: "agent" });
      if (d.is_sample) await markLatestVersionSampleTx(tx, "customer-truth/what-the-market-is-telling-us");
      const t = d.payload.recommended_test as { name?: string; hypothesis?: string; channel?: string; metric?: string; angle?: string } | undefined;
      const dupe = t?.name ? await tx.query(`select 1 from experiments where lower(name) = lower($1) and status in ('draft','running')`, [t.name]) : null;
      if (t?.name && !dupe?.rowCount) {
        await tx.query(
          `insert into experiments(tenant_id, draft_id, name, hypothesis, channel, metric, variants, is_sample) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [ctx.tenantId, d.id, t.name.slice(0, 200), t.hypothesis ?? "", t.channel ?? "other", t.metric ?? "qualified_reply", JSON.stringify(t.angle ? [{ id: "a", label: t.angle }] : []), !!d.is_sample],
        );
      }
      return "Updated the truth file and queued the recommended test.";
    }
    case "cockpit_memo":
      await writeDocTx(tx, ctx, "cockpit/weekly-brief", d.body, { note: `Approved: ${d.title}`, authorKind: "agent" });
      if (d.is_sample) await markLatestVersionSampleTx(tx, "cockpit/weekly-brief");
      return "Published the weekly brief.";
    case "creative_batch": {
      const variants = (d.payload.variants as { id: string; label: string; content?: string }[] | undefined) ?? [];
      // Hooks written for a queued test fill that test and start it, instead of opening a second one.
      const forTest = d.run_id
        ? await tx.query<{ id: string; name: string }>(
            `select e.id, e.name from runs r join experiments e on e.id::text = r.input->>'experiment_id' where r.id = $1 and e.status = 'draft' for update of e`,
            [d.run_id],
          )
        : null;
      const queued = forTest?.rows[0];
      if (queued && variants.length) {
        await tx.query(
          `update experiments set variants = variants || $2::jsonb, metric = $3, channel = $4, status = 'running', started_at = now() where id = $1`,
          [queued.id, JSON.stringify(variants), String(d.payload.metric ?? "demo_request"), String(d.payload.channel ?? "paid_social")],
        );
        return `Added ${variants.length} variants to “${queued.name}” and started it.`;
      }
      await tx.query(
        `insert into experiments(tenant_id, draft_id, name, hypothesis, channel, metric, status, variants, started_at, is_sample) values ($1,$2,$3,$4,$5,$6,'running',$7, now(), $8)`,
        [ctx.tenantId, d.id, d.title.slice(0, 200), String(d.payload.hypothesis ?? ""), String(d.payload.channel ?? "paid_social"), String(d.payload.metric ?? "demo_request"), JSON.stringify(variants), !!d.is_sample],
      );
      return "Started an experiment with these variants.";
    }
    default:
      return null;
  }
}

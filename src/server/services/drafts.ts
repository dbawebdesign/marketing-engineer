import { z } from "zod";
import { withTenant, type Tx } from "@/lib/db";
import { assertCan, type Ctx } from "@/lib/ctx";
import { badRequest, notFound } from "@/lib/errors";
import type { VerifiedEvidence } from "../agents/evidence";
import { audit } from "./audit";
import { writeDocTx } from "./memory";
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
};

const COLS = `d.id, d.run_id, d.agent_id, a.name agent_name, d.system, d.type, d.title, d.body, d.payload, d.evidence, d.status, d.feedback, d.reviewed_at, d.created_at`;

export async function listDrafts(ctx: Ctx, opts: { status?: string; system?: string; limit?: number } = {}) {
  assertCan(ctx, "read");
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query<Draft>(
      `select ${COLS} from drafts d left join agents a on a.id = d.agent_id
        where ($1::text is null or d.status = $1) and ($2::text is null or d.system = $2)
        order by d.created_at desc limit $3`,
      [opts.status ?? null, opts.system ?? null, Math.min(opts.limit ?? 50, 200)],
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
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query<Draft>(`select ${COLS} from drafts d left join agents a on a.id = d.agent_id where d.id = $1 for update of d`, [id]);
    const d = r.rows[0];
    if (!d) throw notFound("Draft");
    if (d.status !== "pending") throw badRequest(`This draft was already ${d.status}.`);
    const body = input.body ?? d.body;
    const status = input.decision === "approve" ? "approved" : "rejected";
    await tx.query(`update drafts set status=$2, body=$3, feedback=$4, reviewer_id=$5, reviewed_at=now() where id=$1`, [id, status, body, input.feedback ?? null, ctx.userId]);
    if (input.remember && input.feedback && d.agent_id) await addRuleTx(tx, ctx, d.agent_id, input.feedback, "correction");
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
      const t = d.payload.recommended_test as { name?: string; hypothesis?: string; channel?: string; metric?: string; angle?: string } | undefined;
      if (t?.name) {
        await tx.query(
          `insert into experiments(tenant_id, draft_id, name, hypothesis, channel, metric, variants) values ($1,$2,$3,$4,$5,$6,$7)`,
          [ctx.tenantId, d.id, t.name.slice(0, 200), t.hypothesis ?? "", t.channel ?? "other", t.metric ?? "qualified_reply", JSON.stringify(t.angle ? [{ id: "a", label: t.angle }] : [])],
        );
      }
      return "Updated the truth file and queued the recommended test.";
    }
    case "cockpit_memo":
      await writeDocTx(tx, ctx, "cockpit/weekly-brief", d.body, { note: `Approved: ${d.title}`, authorKind: "agent" });
      return "Published the weekly brief.";
    case "creative_batch": {
      const variants = (d.payload.variants as { id: string; label: string; content?: string }[] | undefined) ?? [];
      await tx.query(
        `insert into experiments(tenant_id, draft_id, name, hypothesis, channel, metric, status, variants, started_at) values ($1,$2,$3,$4,$5,$6,'running',$7, now())`,
        [ctx.tenantId, d.id, d.title.slice(0, 200), String(d.payload.hypothesis ?? ""), String(d.payload.channel ?? "paid_social"), String(d.payload.metric ?? "demo_request"), JSON.stringify(variants)],
      );
      return "Started an experiment with these variants.";
    }
    default:
      return null;
  }
}

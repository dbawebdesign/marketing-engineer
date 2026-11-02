import { withTenant, type Tx } from "@/lib/db";
import { assertCan, type Ctx } from "@/lib/ctx";
import { audit } from "./audit";
import { writeDocTx } from "./memory";

/**
 * Sample data is marked with server-only `is_sample` columns (migration 010): set when the
 * sample loads, carried from signals to the runs that read them, to their drafts, to the
 * experiments those drafts start, and to memory versions written from them. Ingest can
 * never set it, so clearing the sample can never remove the workspace's own data.
 */
export async function hasSampleDataTx(tx: Tx) {
  const r = await tx.query<{ yes: boolean }>(
    `select exists(select 1 from signals where is_sample) or exists(select 1 from metric_events where is_sample) as yes`,
  );
  return !!r.rows[0]?.yes;
}

export async function hasSampleData(ctx: Ctx) {
  assertCan(ctx, "read");
  return withTenant(ctx.tenantId, hasSampleDataTx);
}

/** Mark the newest version of a memory doc as written from sample data. */
export async function markLatestVersionSampleTx(tx: Tx, key: string) {
  await tx.query(
    `update memory_doc_versions v set is_sample = true from memory_docs d
      where d.key = $1 and v.doc_id = d.id and v.version = d.version`,
    [key],
  );
}

export type SampleClearPlan = { signals: number; metricEvents: number; drafts: number; experiments: number; docs: { key: string; title: string }[] };

async function planTx(tx: Tx): Promise<SampleClearPlan> {
  const c = await tx.query<{ signals: number; metric_events: number; drafts: number; experiments: number }>(
    `select (select count(*)::int from signals where is_sample) signals,
            (select count(*)::int from metric_events where is_sample) metric_events,
            (select count(*)::int from drafts where is_sample and status = 'pending') drafts,
            (select count(*)::int from experiments where is_sample) experiments`,
  );
  const docs = await tx.query<{ key: string; title: string }>(
    `select d.key, d.title from memory_docs d join memory_doc_versions v on v.doc_id = d.id and v.version = d.version where v.is_sample order by d.title`,
  );
  const x = c.rows[0]!;
  return { signals: x.signals, metricEvents: x.metric_events, drafts: x.drafts, experiments: x.experiments, docs: docs.rows };
}

/** What "Clear sample data" will remove, for the confirmation. */
export async function previewSampleClear(ctx: Ctx) {
  assertCan(ctx, "read");
  return withTenant(ctx.tenantId, planTx);
}

/**
 * Remove everything that came from the sample: its signals and metric events, pending drafts
 * built from it, experiments those drafts started, and memory written from it (each such doc
 * goes back to its last version not written from the sample). Reviewed drafts stay as part of
 * the record (marked sample), and so does the audit log.
 */
export async function clearSampleData(ctx: Ctx) {
  assertCan(ctx, "settings:manage");
  return withTenant(ctx.tenantId, async (tx) => {
    const plan = await planTx(tx);
    for (const d of plan.docs) {
      const prev = await tx.query<{ content: string }>(
        `select v.content from memory_doc_versions v join memory_docs d on d.id = v.doc_id
          where d.key = $1 and not v.is_sample order by v.version desc limit 1`,
        [d.key],
      );
      await writeDocTx(tx, ctx, d.key, prev.rows[0]?.content ?? "", { note: "Cleared sample data", authorKind: "system" });
    }
    const drafts = await tx.query<{ run_id: string | null }>(`delete from drafts where is_sample and status = 'pending' returning run_id`);
    const experiments = await tx.query(`delete from experiments where is_sample`);
    const runs = await tx.query(`delete from runs r where r.is_sample and r.status in ('succeeded','failed','canceled') and not exists (select 1 from drafts d where d.run_id = r.id)`);
    const signals = await tx.query(`delete from signals where is_sample`);
    const metrics = await tx.query(`delete from metric_events where is_sample`);
    const out = {
      docs: plan.docs.length,
      signals: signals.rowCount ?? 0,
      metricEvents: metrics.rowCount ?? 0,
      drafts: drafts.rowCount ?? 0,
      experiments: experiments.rowCount ?? 0,
      runs: runs.rowCount ?? 0,
    };
    await audit(tx, ctx, "demo.clear", undefined, out);
    return out;
  });
}

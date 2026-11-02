import { withTenant, type Tx } from "@/lib/db";
import { assertCan, type Ctx } from "@/lib/ctx";
import { audit } from "./audit";
import { writeDocTx } from "./memory";

/**
 * Sample data is tagged where it lands, so it can never pass for the workspace's own:
 * signals and metric events carry metadata.sample = true. Drafts are "derived" when
 * their receipts cite a sample signal.
 */
export const SAMPLE_TAG = { sample: true } as const;

const SAMPLE_SIGNAL = `metadata->>'sample' = 'true'`;
const SAMPLE_METRIC = `(metadata->>'sample' = 'true' or source = 'sample')`;

export async function hasSampleDataTx(tx: Tx) {
  const r = await tx.query<{ yes: boolean }>(
    `select exists(select 1 from signals where ${SAMPLE_SIGNAL}) or exists(select 1 from metric_events where ${SAMPLE_METRIC}) as yes`,
  );
  return !!r.rows[0]?.yes;
}

export async function hasSampleData(ctx: Ctx) {
  assertCan(ctx, "read");
  return withTenant(ctx.tenantId, hasSampleDataTx);
}

/**
 * Remove sample signals and metric events, plus the pending drafts built from them and
 * any run left with nothing to show. Reviewed drafts stay (they're part of the record),
 * and so does the audit log.
 */
export async function clearSampleData(ctx: Ctx) {
  assertCan(ctx, "settings:manage");
  return withTenant(ctx.tenantId, async (tx) => {
    // Derived = cites a sample signal, or came from a run after the sample was loaded and cites
    // nothing real (every run in that window read the sample).
    const drafts = await tx.query<{ id: string; run_id: string | null }>(
      `with loaded as (
              select min(created_at) at from audit_log
               where action = 'demo.load'
                 and created_at > coalesce((select max(created_at) from audit_log where action = 'demo.clear'), '-infinity'::timestamptz)),
            cited as (
              select d.id,
                     bool_or(s.${SAMPLE_SIGNAL}) filter (where s.id is not null) as sample,
                     bool_or(not coalesce(s.${SAMPLE_SIGNAL}, false)) filter (where s.id is not null) as real
                from drafts d
                left join lateral jsonb_array_elements(case when jsonb_typeof(d.evidence) = 'array' then d.evidence else '[]'::jsonb end) e on true
                left join signals s on s.id::text = e->>'signal_id'
               where d.status = 'pending'
               group by d.id)
       delete from drafts d using cited c
        where d.id = c.id
          and (coalesce(c.sample, false)
               or (not coalesce(c.real, false) and d.created_at >= coalesce((select at from loaded), 'infinity'::timestamptz)))
        returning d.id, d.run_id`,
    );
    // An approved memo built on the sample must not stay as the workspace's truth file or brief:
    // add an empty version (history keeps the old one).
    const docs = await tx.query<{ key: string }>(
      `with loaded as (
              select min(created_at) at from audit_log
               where action = 'demo.load'
                 and created_at > coalesce((select max(created_at) from audit_log where action = 'demo.clear'), '-infinity'::timestamptz))
       select md.key from memory_docs md
        where md.key in ('customer-truth/what-the-market-is-telling-us', 'cockpit/weekly-brief')
          and length(trim(md.content)) > 0
          and exists (
            select 1 from memory_doc_versions v join drafts dr on v.note = 'Approved: ' || dr.title
             where v.doc_id = md.id and v.version = md.version and v.author_kind = 'agent'
               and dr.type in ('market_memo', 'cockpit_memo') and dr.status in ('approved', 'published')
               and (dr.created_at >= coalesce((select at from loaded), 'infinity'::timestamptz)
                    or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(dr.evidence) = 'array' then dr.evidence else '[]'::jsonb end) e
                                 join signals s on s.id::text = e->>'signal_id' and s.${SAMPLE_SIGNAL})))`,
    );
    for (const d of docs.rows) await writeDocTx(tx, ctx, d.key, "", { note: "Cleared sample data", authorKind: "system" });
    const runIds = [...new Set(drafts.rows.flatMap((d) => (d.run_id ? [d.run_id] : [])))];
    const runs = runIds.length
      ? await tx.query(`delete from runs r where r.id = any($1::uuid[]) and r.status in ('succeeded','failed','canceled') and not exists (select 1 from drafts d where d.run_id = r.id)`, [runIds])
      : { rowCount: 0 };
    const signals = await tx.query(`delete from signals where ${SAMPLE_SIGNAL}`);
    const metrics = await tx.query(`delete from metric_events where ${SAMPLE_METRIC}`);
    const out = { docs: docs.rowCount ?? 0, signals: signals.rowCount ?? 0, metricEvents: metrics.rowCount ?? 0, drafts: drafts.rowCount ?? 0, runs: runs.rowCount ?? 0 };
    await audit(tx, ctx, "demo.clear", undefined, out);
    return out;
  });
}

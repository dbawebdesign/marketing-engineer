import { withTenant } from "@/lib/db";
import { assertCan, type Ctx } from "@/lib/ctx";
import { dedupeReceipts } from "@/lib/receipts";

/** Agent-kept docs, and the draft type whose approval writes each one. */
const SOURCE_TYPE: Record<string, string> = {
  "customer-truth/what-the-market-is-telling-us": "market_memo",
  "cockpit/weekly-brief": "cockpit_memo",
};

export type DocReceipt = { signal_id: string; quote: string };

/**
 * The receipts behind an agent-kept doc: the evidence of the approved draft that produced its
 * latest version (matched by the version's "Approved: <title>" note), else the most recently
 * approved draft of that type. Empty for docs no agent writes.
 */
export async function docReceipts(ctx: Ctx, key: string): Promise<DocReceipt[]> {
  assertCan(ctx, "read");
  const type = SOURCE_TYPE[key];
  if (!type) return [];
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query<{ evidence: { signal_id?: string; quote?: string }[] | null }>(
      `with v as (
         select substr(v.note, length('Approved: ') + 1) as title
           from memory_doc_versions v join memory_docs d on d.id = v.doc_id
          where d.key = $2 and v.author_kind = 'agent' and v.note like 'Approved: %'
          order by v.version desc limit 1)
       select evidence from drafts
        where type = $1 and status in ('approved','published')
        order by (title = (select title from v)) desc nulls last, reviewed_at desc nulls last, created_at desc
        limit 1`,
      [type, key],
    );
    const list = (r.rows[0]?.evidence ?? []).flatMap((e) => (e?.signal_id && e.quote ? [{ signal_id: e.signal_id, quote: e.quote }] : []));
    return dedupeReceipts(list);
  });
}

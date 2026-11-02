import { z } from "zod";
import { withTenant } from "@/lib/db";
import { assertCan, type Ctx } from "@/lib/ctx";
import { sha256 } from "@/lib/crypto";
import { badRequest } from "@/lib/errors";
import { audit } from "./audit";

import { SIGNAL_SOURCES, SOURCE_LABEL } from "@/lib/signal-sources";
export { SIGNAL_SOURCES, SOURCE_LABEL };

export const SignalInput = z.object({
  source: z.enum(SIGNAL_SOURCES),
  content: z.string().trim().min(1).max(100_000),
  title: z.string().trim().max(300).optional().default(""),
  url: z
    .string()
    .trim()
    .url()
    .max(2000)
    .refine((u) => /^https?:\/\//i.test(u), "URL must be http(s)")
    .optional()
    .nullable(),
  author: z.string().trim().max(200).optional().nullable(),
  account: z.string().trim().max(200).optional().nullable(),
  occurred_at: z.coerce.date().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});
export type SignalInputT = z.input<typeof SignalInput>;

export type Signal = {
  id: string;
  source: (typeof SIGNAL_SOURCES)[number];
  title: string;
  content: string;
  url: string | null;
  author: string | null;
  account: string | null;
  occurred_at: string;
  metadata: Record<string, unknown>;
};

/** Ingest up to 1,000 signals. Idempotent on content: re-sending the same note is a no-op. */
export async function ingestSignals(ctx: Ctx, raw: SignalInputT[]) {
  assertCan(ctx, "signals:write");
  if (!Array.isArray(raw) || raw.length === 0) throw badRequest("No signals to add");
  if (raw.length > 1000) throw badRequest("Send at most 1,000 signals per request");
  const parsed = raw.map((r, i) => {
    const p = SignalInput.safeParse(r);
    if (!p.success) throw badRequest(`Signal ${i + 1}: ${p.error.issues[0]?.message ?? "invalid"}`, p.error.issues);
    return p.data;
  });
  if (JSON.stringify(parsed.map((p) => p.metadata)).length > 2_000_000) throw badRequest("Metadata too large");
  return withTenant(ctx.tenantId, async (tx) => {
    // One statement for the whole batch. Rows without a time get now() minus their position in
    // milliseconds, so a batch keeps its order and pages cleanly by (occurred_at, id).
    const rows = parsed.map((s, i) => ({
      source: s.source,
      title: s.title,
      content: s.content,
      url: s.url ?? null,
      author: s.author ?? null,
      account: s.account ?? null,
      occurred_at: s.occurred_at ?? null,
      ord: i,
      metadata: s.metadata,
      content_hash: sha256(`${s.source}\n${s.content.replace(/\s+/g, " ").trim().toLowerCase()}`),
    }));
    const r = await tx.query<{ id: string }>(
      `insert into signals(tenant_id, source, title, content, url, author, account, occurred_at, metadata, content_hash)
       select $1, x.source, x.title, x.content, x.url, x.author, x.account,
              coalesce(x.occurred_at, now() - make_interval(secs => x.ord / 1000.0)), coalesce(x.metadata, '{}'::jsonb), x.content_hash
         from jsonb_to_recordset($2::jsonb) as x(source text, title text, content text, url text, author text, account text,
                                                occurred_at timestamptz, ord int, metadata jsonb, content_hash text)
       on conflict (tenant_id, content_hash) do nothing
       returning id`,
      [ctx.tenantId, JSON.stringify(rows)],
    );
    const ids = r.rows.map((x) => x.id);
    const inserted = ids.length;
    await audit(tx, ctx, "signals.ingest", undefined, { received: parsed.length, inserted });
    return { received: parsed.length, inserted, duplicates: parsed.length - inserted, ids };
  });
}

/**
 * Newest first. Page with `cursor` (opaque, from the previous page's `next_cursor`): it encodes
 * (occurred_at, id), so rows sharing a timestamp are never skipped. `before` (a timestamp) is
 * kept for older clients. Text search uses the trigram index (most recent 1,000 matches).
 */
export async function listSignals(ctx: Ctx, opts: { source?: string; q?: string; limit?: number; before?: string; cursor?: string } = {}) {
  assertCan(ctx, "read");
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const cur = decodeCursor(opts.cursor);
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query<Signal>(
      `select id, source, title, content, url, author, account, occurred_at, metadata from signals
        where ($1::text is null or source = $1)
          and ($2::text is null or id in (select id from search_signal_ids('%' || $2 || '%', 1000)))
          and ($3::timestamptz is null or occurred_at < $3)
          and ($5::timestamptz is null or (occurred_at, id) < ($5, $6::uuid))
        order by occurred_at desc, id desc limit $4`,
      [opts.source || null, opts.q ? opts.q.replace(/[%_\\]/g, (m) => "\\" + m).slice(0, 200) : null, opts.before ?? null, limit, cur?.t ?? null, cur?.id ?? null],
    );
    return r.rows;
  });
}

export function encodeCursor(s: { occurred_at: string | Date; id: string }) {
  return Buffer.from(`${new Date(s.occurred_at).toISOString()}|${s.id}`).toString("base64url");
}

function decodeCursor(c?: string): { t: string; id: string } | null {
  if (!c) return null;
  const [t, id] = Buffer.from(c, "base64url").toString().split("|");
  if (!t || !id || Number.isNaN(Date.parse(t)) || !/^[0-9a-f-]{36}$/i.test(id)) throw badRequest("Invalid cursor");
  return { t, id };
}

export async function signalStats(ctx: Ctx) {
  assertCan(ctx, "read");
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query<{ source: string; total: string; week: string }>(
      `select source, count(*)::text total, count(*) filter (where occurred_at > now() - interval '7 days')::text week from signals group by source order by 2 desc`,
    );
    return r.rows.map((x) => ({ source: x.source, total: +x.total, week: +x.week }));
  });
}

export async function deleteSignal(ctx: Ctx, id: string) {
  assertCan(ctx, "signals:write");
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query(`delete from signals where id = $1`, [id]);
    await audit(tx, ctx, "signals.delete", { type: "signal", id });
    return (r.rowCount ?? 0) > 0;
  });
}

export type SignalUse = { id: string; title: string; system: string; status: string; created_at: string; quotes: string[] };

/** One signal in full, plus every draft whose receipts cite it (newest first). */
export async function getSignalDetail(ctx: Ctx, id: string) {
  assertCan(ctx, "read");
  return withTenant(ctx.tenantId, async (tx) => {
    const s = await tx.query<Signal>(`select id, source, title, content, url, author, account, occurred_at, metadata from signals where id = $1`, [id]);
    if (!s.rows[0]) return null;
    const u = await tx.query<SignalUse>(
      `select d.id, d.title, d.system, d.status, d.created_at,
              coalesce((select array_agg(distinct e->>'quote') from jsonb_array_elements(d.evidence) e where e->>'signal_id' = $1), '{}') as quotes
         from drafts d
        where d.evidence @> jsonb_build_array(jsonb_build_object('signal_id', $1::text))
        order by d.created_at desc, d.id limit 50`,
      [id],
    );
    return { signal: s.rows[0], usedIn: u.rows };
  });
}

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
    let inserted = 0;
    const ids: string[] = [];
    for (const s of parsed) {
      const hash = sha256(`${s.source}\n${s.content.replace(/\s+/g, " ").trim().toLowerCase()}`);
      const r = await tx.query<{ id: string }>(
        `insert into signals(tenant_id, source, title, content, url, author, account, occurred_at, metadata, content_hash)
         values ($1,$2,$3,$4,$5,$6,$7,coalesce($8, now()),$9,$10)
         on conflict (tenant_id, content_hash) do nothing returning id`,
        [ctx.tenantId, s.source, s.title, s.content, s.url ?? null, s.author ?? null, s.account ?? null, s.occurred_at ?? null, s.metadata, hash],
      );
      if (r.rows[0]) {
        inserted++;
        ids.push(r.rows[0].id);
      }
    }
    await audit(tx, ctx, "signals.ingest", undefined, { received: parsed.length, inserted });
    return { received: parsed.length, inserted, duplicates: parsed.length - inserted, ids };
  });
}

export async function listSignals(ctx: Ctx, opts: { source?: string; q?: string; limit?: number; before?: string } = {}) {
  assertCan(ctx, "read");
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query<Signal>(
      `select id, source, title, content, url, author, account, occurred_at, metadata from signals
        where ($1::text is null or source = $1)
          and ($2::text is null or content ilike '%' || $2 || '%' or title ilike '%' || $2 || '%' or account ilike '%' || $2 || '%')
          and ($3::timestamptz is null or occurred_at < $3)
        order by occurred_at desc limit $4`,
      [opts.source || null, opts.q ? opts.q.replace(/[%_\\]/g, (m) => "\\" + m).slice(0, 200) : null, opts.before ?? null, limit],
    );
    return r.rows;
  });
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

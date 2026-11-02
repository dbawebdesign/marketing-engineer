import { withTenant } from "@/lib/db";
import { assertCan, type Ctx } from "@/lib/ctx";

export type SearchResults = {
  /** `snippet` is set when the match is in the body, not the title: ~150 characters around the first hit. */
  drafts: { id: string; title: string; status: string; system: string; snippet: string | null }[];
  signals: { id: string; title: string; content: string; source: string; account: string | null }[];
  docs: { key: string; title: string; folder: string }[];
  agents: { id: string; name: string; system: string }[];
  experiments: { id: string; name: string; status: string }[];
};

const EMPTY: SearchResults = { drafts: [], signals: [], docs: [], agents: [], experiments: [] };

/** Escape LIKE wildcards so "50%" or "a_b" match literally. */
export const likeEscape = (s: string) => s.replace(/[%_\\]/g, (m) => "\\" + m);

/** Markdown and line breaks out, so a snippet reads as one plain line. */
export function plainSnippet(raw: string, atStart: boolean, atEnd: boolean) {
  const s = raw
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*_`>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${atStart ? "" : "…"}${s}${atEnd ? "" : "…"}`;
}

const PER_GROUP = 5;

/** Command palette search across the current tenant. Read-only, at most 5 results per group. */
export async function searchAll(ctx: Ctx, raw: string): Promise<SearchResults> {
  assertCan(ctx, "read");
  const q = raw.trim().slice(0, 120);
  if (!q) return EMPTY;
  const p = `%${likeEscape(q)}%`;
  return withTenant(ctx.tenantId, async (tx) => {
    // One connection per transaction: queries run in sequence.
    // Title hits rank first; a body hit carries ~150 characters around the first match.
    const drafts = await tx.query<{ id: string; title: string; status: string; system: string; title_hit: boolean; pos: number; len: number; chunk: string | null }>(
      `select id, title, status, system, title_hit, pos, len,
              case when title_hit then null else substr(body, greatest(pos - 40, 1), 150) end as chunk
         from (select id, title, status, system, body, created_at, title ilike $1 as title_hit,
                      strpos(lower(body), lower($2)) as pos, length(body) as len
                 from drafts where title ilike $1 or body ilike $1) m
        order by title_hit desc, (status = 'pending') desc, created_at desc limit $3`,
      [p, q, PER_GROUP],
    );
    const signals = await tx.query<SearchResults["signals"][number]>(
      // Indexed search (trigram) through a tenant-filtered function; see migration 009.
      `select s.id, s.title, left(s.content, 400) as content, s.source, s.account
         from search_signal_ids($1, $2) f join signals s on s.id = f.id order by s.occurred_at desc`,
      [p, PER_GROUP],
    );
    const docs = await tx.query<SearchResults["docs"][number]>(`select key, title, folder from memory_docs where title ilike $1 order by title limit $2`, [p, PER_GROUP]);
    const agents = await tx.query<SearchResults["agents"][number]>(`select id, name, system from agents where name ilike $1 order by created_at limit $2`, [p, PER_GROUP]);
    const experiments = await tx.query<SearchResults["experiments"][number]>(
      `select id, name, status from experiments where name ilike $1 order by (status in ('running','draft')) desc, created_at desc limit $2`,
      [p, PER_GROUP],
    );
    return {
      drafts: drafts.rows.map((d) => ({
        id: d.id,
        title: d.title,
        status: d.status,
        system: d.system,
        snippet: d.chunk ? plainSnippet(d.chunk, d.pos <= 41, Math.max(d.pos - 40, 1) + 150 > d.len) : null,
      })),
      signals: signals.rows,
      docs: docs.rows,
      agents: agents.rows,
      experiments: experiments.rows,
    };
  });
}

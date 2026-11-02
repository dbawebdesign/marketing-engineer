import { withTenant } from "@/lib/db";
import { assertCan, type Ctx } from "@/lib/ctx";

export type SearchResults = {
  drafts: { id: string; title: string; status: string; system: string }[];
  signals: { id: string; title: string; content: string; source: string; account: string | null }[];
  docs: { key: string; title: string; folder: string }[];
  agents: { id: string; name: string; system: string }[];
};

const EMPTY: SearchResults = { drafts: [], signals: [], docs: [], agents: [] };

/** Escape LIKE wildcards so "50%" or "a_b" match literally. */
const likeEscape = (s: string) => s.replace(/[%_\\]/g, (m) => "\\" + m);

/** Command palette search across the current tenant. Read-only, 5 results per group. */
export async function searchAll(ctx: Ctx, raw: string): Promise<SearchResults> {
  assertCan(ctx, "read");
  const q = raw.trim().slice(0, 120);
  if (!q) return EMPTY;
  const p = `%${likeEscape(q)}%`;
  return withTenant(ctx.tenantId, async (tx) => {
    // One connection per transaction: queries run in sequence.
    const drafts = await tx.query<SearchResults["drafts"][number]>(
      `select id, title, status, system from drafts where title ilike $1 order by (status = 'pending') desc, created_at desc limit 5`,
      [p],
    );
    const signals = await tx.query<SearchResults["signals"][number]>(
      // Indexed search (trigram) through a tenant-filtered function; see migration 009.
      `select s.id, s.title, left(s.content, 400) as content, s.source, s.account
         from search_signal_ids($1, 5) f join signals s on s.id = f.id order by s.occurred_at desc`,
      [p],
    );
    const docs = await tx.query<SearchResults["docs"][number]>(`select key, title, folder from memory_docs where title ilike $1 order by title limit 5`, [p]);
    const agents = await tx.query<SearchResults["agents"][number]>(`select id, name, system from agents where name ilike $1 order by created_at limit 5`, [p]);
    return { drafts: drafts.rows, signals: signals.rows, docs: docs.rows, agents: agents.rows };
  });
}

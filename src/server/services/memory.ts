import { sys, withTenant, type Tx } from "@/lib/db";
import { assertCan, type Ctx } from "@/lib/ctx";
import { badRequest, notFound } from "@/lib/errors";
import { audit } from "./audit";

/** The Growth OS: the company's marketing memory, as versioned markdown documents in folders. */
export const GROWTH_OS: { key: string; title: string; folder: string; hint: string }[] = [
  { key: "customer-truth/what-the-market-is-telling-us", title: "What the market is telling us", folder: "Customer truth", hint: "Written by the Market pulse agent. Approve a memo to update it." },
  { key: "content/founder-voice", title: "Founder voice", folder: "Content engine", hint: "How the founder sounds. Paste 3 posts you love and 3 you hate, and the words you never use." },
  { key: "content/winning-hooks", title: "Winning hooks", folder: "Content engine", hint: "Hooks that drove qualified replies or demos. Winners from experiments land here." },
  { key: "outbound/icp", title: "Ideal customer profile", folder: "Outbound engine", hint: "Who buys, who doesn't, and the triggers that make this week the right week." },
  { key: "outbound/approved-angles", title: "Approved angles", folder: "Outbound engine", hint: "Angles you're happy for agents to use in outreach." },
  { key: "outbound/banned-language", title: "Banned language", folder: "Outbound engine", hint: "Phrases agents must never write. AI outbound gets weird fast." },
  { key: "creative/offers", title: "Offers", folder: "Creative testing", hint: "The offers and lead magnets you want to test angles for." },
  { key: "ai-search/company-facts", title: "Company facts", folder: "AI search", hint: "Plain facts an AI assistant should know: what you do, for whom, pricing model, proof." },
  { key: "ai-search/buyer-questions", title: "Buyer questions", folder: "AI search", hint: "Questions buyers ask ChatGPT, Claude, Perplexity and Google before they find you. One per line." },
  { key: "cockpit/weekly-brief", title: "Weekly brief", folder: "Growth cockpit", hint: "Written by the Weekly cockpit agent." },
];

export type MemoryDoc = { id: string; key: string; title: string; folder: string; content: string; version: number; updated_at: string };

export async function listDocs(ctx: Ctx): Promise<MemoryDoc[]> {
  assertCan(ctx, "read");
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query<MemoryDoc>(`select id, key, title, folder, content, version, updated_at from memory_docs order by folder, title`);
    return r.rows;
  });
}

export async function getDoc(ctx: Ctx, key: string) {
  assertCan(ctx, "read");
  return withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query<MemoryDoc>(`select id, key, title, folder, content, version, updated_at from memory_docs where key = $1`, [key]);
    return r.rows[0] ?? null;
  });
}

export type DocVersion = {
  version: number;
  author_kind: string;
  note: string | null;
  created_at: string;
  content: string;
  /** The person behind the version: the editor, or for an agent's doc, whoever approved it. */
  person: string | null;
  /** For an approved agent draft, the agent that wrote it. */
  agent: string | null;
};

export async function docHistory(ctx: Ctx, key: string): Promise<DocVersion[]> {
  assertCan(ctx, "read");
  const rows = await withTenant(ctx.tenantId, async (tx) => {
    const r = await tx.query<Omit<DocVersion, "person"> & { author_id: string | null }>(
      `select v.version, v.author_kind, v.author_id, v.note, v.created_at, v.content,
              (select a.name from drafts dr left join agents a on a.id = dr.agent_id
                where v.author_kind = 'agent' and v.note = 'Approved: ' || dr.title and dr.status in ('approved','published')
                order by dr.reviewed_at desc nulls last limit 1) as agent
         from memory_doc_versions v join memory_docs d on d.id = v.doc_id where d.key = $1 order by v.version desc limit 50`,
      [key],
    );
    return r.rows;
  });
  // Names live outside the tenant schema; read only members of this workspace.
  const ids = [...new Set(rows.flatMap((r) => (r.author_id ? [r.author_id] : [])))];
  const names = new Map<string, string>();
  if (ids.length) {
    const u = await sys<{ id: string; name: string; email: string }>(
      `select u.id, u.name, u.email from users u join memberships m on m.user_id = u.id and m.tenant_id = $1 where u.id = any($2::uuid[])`,
      [ctx.tenantId, ids],
    );
    for (const x of u.rows) names.set(x.id, (x.name.trim().split(/\s+/)[0] || x.email.split("@")[0]) ?? "");
  }
  return rows.map(({ author_id, ...r }) => ({ ...r, person: author_id ? (names.get(author_id) ?? null) : null }));
}

/** Insert or update a memory doc and record a version. Runs inside an existing tenant tx. */
export async function writeDocTx(
  tx: Tx,
  ctx: Ctx,
  key: string,
  content: string,
  opts: { title?: string; folder?: string; note?: string; expectedVersion?: number; authorKind?: "user" | "agent" | "system" } = {},
) {
  if (content.length > 200_000) throw badRequest("Document is too long (200k characters max)");
  const preset = GROWTH_OS.find((g) => g.key === key);
  const title = opts.title ?? preset?.title ?? key.split("/").at(-1)!;
  const folder = opts.folder ?? preset?.folder ?? "Notes";
  const existing = await tx.query<{ id: string; version: number }>(`select id, version from memory_docs where key = $1 for update`, [key]);
  let id: string;
  let version: number;
  if (existing.rows[0]) {
    const cur = existing.rows[0];
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== cur.version)
      throw badRequest("This document changed since you opened it. Reload to see the latest version.");
    version = cur.version + 1;
    id = cur.id;
    await tx.query(`update memory_docs set content = $2, version = $3, updated_by = $4, updated_at = now() where id = $1`, [id, content, version, ctx.userId]);
  } else {
    version = 1;
    const r = await tx.query<{ id: string }>(
      `insert into memory_docs(tenant_id, key, title, folder, content, version, updated_by) values ($1,$2,$3,$4,$5,1,$6) returning id`,
      [ctx.tenantId, key, title, folder, content, ctx.userId],
    );
    id = r.rows[0]!.id;
  }
  await tx.query(
    `insert into memory_doc_versions(tenant_id, doc_id, version, content, author_kind, author_id, note) values ($1,$2,$3,$4,$5,$6,$7)`,
    [ctx.tenantId, id, version, content, opts.authorKind ?? (ctx.userId ? "user" : "system"), ctx.userId, opts.note ?? null],
  );
  await audit(tx, ctx, "memory.write", { type: "memory_doc", id }, { key, version });
  return { id, version };
}

export async function saveDoc(ctx: Ctx, key: string, content: string, expectedVersion?: number) {
  assertCan(ctx, "memory:write");
  if (!/^[a-z0-9][a-z0-9/_-]{1,120}$/.test(key)) throw badRequest("Invalid document key");
  return withTenant(ctx.tenantId, (tx) => writeDocTx(tx, ctx, key, content, { expectedVersion }));
}

export async function requireDoc(ctx: Ctx, key: string) {
  const d = await getDoc(ctx, key);
  if (!d) throw notFound("Document");
  return d;
}

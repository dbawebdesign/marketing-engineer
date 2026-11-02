import { requireCtx } from "@/server/web/session";
import { listDocs, docHistory, GROWTH_OS } from "@/server/services/memory";
import { can } from "@/lib/rbac";
import { L } from "@/components/nav";
import { Markdown } from "@/components/markdown";
import { DocEditor } from "@/components/doc-editor";
import { Dot, cx, timeAgo } from "@/components/ui";

export const metadata = { title: "Memory" };

export default async function MemoryPage({ searchParams }: { searchParams: Promise<{ doc?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const docs = await listDocs(ctx);
  const byKey = new Map(docs.map((d) => [d.key, d]));
  const keys = [...GROWTH_OS.map((g) => g.key), ...docs.filter((d) => !GROWTH_OS.some((g) => g.key === d.key)).map((d) => d.key)];
  const current = keys.includes(sp.doc ?? "") ? sp.doc! : keys[0]!;
  const doc = byKey.get(current);
  const preset = GROWTH_OS.find((g) => g.key === current);
  const history = doc ? await docHistory(ctx, current) : [];
  const folders = new Map<string, string[]>();
  for (const k of keys) {
    const f = byKey.get(k)?.folder ?? GROWTH_OS.find((g) => g.key === k)?.folder ?? "Notes";
    folders.set(f, [...(folders.get(f) ?? []), k]);
  }

  return (
    <div className="animate-in">
      <header className="mb-8">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Memory</h1>
        <p className="mt-1 max-w-2xl text-ink-2">Your Growth OS. The marketing memory every agent reads before it works, so nothing starts from scratch next week. Every change is versioned.</p>
      </header>
      <div className="grid gap-10 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav className="space-y-5 lg:sticky lg:top-6 lg:self-start" aria-label="Documents">
          {[...folders.entries()].map(([folder, ks]) => (
            <div key={folder}>
              <p className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">{folder}</p>
              <ul>
                {ks.map((k) => {
                  const d = byKey.get(k);
                  const empty = !d?.content.trim();
                  return (
                    <li key={k}>
                      <L
                        href={`/memory?doc=${encodeURIComponent(k)}`}
                        className={cx("flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13.5px]", k === current ? "bg-surface font-medium text-ink shadow-soft ring-1 ring-line" : "text-ink-2 hover:bg-subtle")}
                      >
                        <span className="flex-1 truncate">{d?.title ?? GROWTH_OS.find((g) => g.key === k)?.title}</span>
                        {empty ? <Dot tone="warn" /> : null}
                      </L>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <p className="px-2.5 text-xs text-ink-3">
            <Dot tone="warn" /> <span className="ml-1">Empty: agents work better once it's filled in.</span>
          </p>
        </nav>
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">{doc?.title ?? preset?.title}</h2>
              <p className="mt-0.5 font-mono text-xs text-ink-3">{current}.md</p>
            </div>
            {doc ? <span className="text-xs text-ink-3">v{doc.version} · {timeAgo(doc.updated_at)}</span> : null}
          </div>
          <DocEditor
            docKey={current}
            content={doc?.content ?? ""}
            version={doc?.version ?? 0}
            hint={preset?.hint}
            canEdit={can(ctx.role, "memory:write")}
            preview={doc?.content.trim() ? <Markdown>{doc.content}</Markdown> : <p className="text-ink-3">{preset?.hint ?? "Empty."}</p>}
          />
          {history.length > 1 ? (
            <section className="mt-10">
              <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.07em] text-ink-3">History</h3>
              <ol className="space-y-2 text-sm">
                {history.slice(0, 12).map((h) => (
                  <li key={h.version} className="flex gap-3 text-ink-2">
                    <span className="w-8 shrink-0 text-ink-3 tnum">v{h.version}</span>
                    <span className="flex-1 truncate">{h.note ?? (h.author_kind === "agent" ? "Agent update" : "Edited")}</span>
                    <span className="text-ink-3">
                      {h.author_kind} · {timeAgo(h.created_at)}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

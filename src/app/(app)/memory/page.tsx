import { requireCtx } from "@/server/web/session";
import { listDocs, docHistory, GROWTH_OS } from "@/server/services/memory";
import { can } from "@/lib/rbac";
import { DOC_TEMPLATES } from "@/lib/memory-templates";
import { L } from "@/components/nav";
import { Markdown } from "@/components/markdown";
import { DocEditor } from "@/components/doc-editor";
import { ChipScroller } from "@/components/chip-scroller";
import { cx, timeAgo } from "@/components/ui";
import { creditFor } from "@/lib/doc-credit";
import { INTRO_FIELDS } from "@/lib/intro-fields";

export const metadata = { title: "Memory" };

/** Folder names follow the system names used everywhere else. */
const FOLDER: Record<string, string> = { "Content engine": "Founder content", "Outbound engine": "Outbound signals" };
const AGENT_WRITTEN = new Set(["customer-truth/what-the-market-is-telling-us", "cockpit/weekly-brief"]);

export default async function MemoryPage({ searchParams }: { searchParams: Promise<{ doc?: string; edit?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const docs = await listDocs(ctx);
  const byKey = new Map(docs.map((d) => [d.key, d]));
  const keys = [...GROWTH_OS.map((g) => g.key), ...docs.filter((d) => !GROWTH_OS.some((g) => g.key === d.key)).map((d) => d.key)];
  // With no doc asked for, open on the first one that has something in it.
  const current = keys.includes(sp.doc ?? "") ? sp.doc! : (keys.find((k) => byKey.get(k)?.content.trim()) ?? keys[0]!);
  const doc = byKey.get(current);
  const preset = GROWTH_OS.find((g) => g.key === current);
  const history = doc ? await docHistory(ctx, current) : [];
  const folders = new Map<string, string[]>();
  for (const k of keys) {
    const raw = byKey.get(k)?.folder ?? GROWTH_OS.find((g) => g.key === k)?.folder ?? "Notes";
    const f = FOLDER[raw] ?? raw;
    folders.set(f, [...(folders.get(f) ?? []), k]);
  }
  const isEmpty = (k: string) => !byKey.get(k)?.content.trim();
  const yours = keys.filter((k) => !AGENT_WRITTEN.has(k));
  const emptyCount = yours.filter(isEmpty).length;
  const hasContent = !!doc?.content.trim();
  const title = doc?.title ?? preset?.title ?? current;
  const canEdit = can(ctx.role, "memory:write");
  const introField = INTRO_FIELDS.find((f) => f.key === current);
  const introGaps = INTRO_FIELDS.filter((f) => isEmpty(f.key)).length;

  return (
    <div className="animate-in">
      <header className="mb-8">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Memory</h1>
        <p className="mt-1 max-w-2xl text-[15px] text-ink-2">The marketing memory every agent reads before it works. Every change is versioned.</p>
      </header>
      {emptyCount > yours.length / 2 ? (
        <p className="mb-8 rounded-xl bg-subtle px-4 py-3 text-[14px] text-ink-2">
          {emptyCount} docs are still empty. Agents work better once{" "}
          <L href="/memory?doc=content%2Ffounder-voice" className="font-medium text-ink underline-offset-2 hover:underline">Founder voice</L>,{" "}
          <L href="/memory?doc=outbound%2Ficp" className="font-medium text-ink underline-offset-2 hover:underline">ICP</L> and{" "}
          <L href="/memory?doc=outbound%2Fbanned-language" className="font-medium text-ink underline-offset-2 hover:underline">Banned language</L> are filled in.
        </p>
      ) : null}
      <div className="grid gap-8 lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-10">
        <nav className="min-w-0 lg:sticky lg:top-6 lg:self-start" aria-label="Documents">
          {/* Small screens: one compact picker instead of a long list. */}
          <ChipScroller className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-10 sm:px-10 lg:hidden">
            {keys.map((k) => (
              <L
                key={k}
                href={`/memory?doc=${encodeURIComponent(k)}`}
                aria-current={k === current ? "page" : undefined}
                className={cx("flex h-8 shrink-0 items-center rounded-lg px-3 text-[13px]", k === current ? "bg-ink font-medium text-bg" : "text-ink-2 ring-1 ring-line hover:bg-subtle", isEmpty(k) && k !== current && "text-ink-3")}
              >
                {byKey.get(k)?.title ?? GROWTH_OS.find((g) => g.key === k)?.title}
              </L>
            ))}
          </ChipScroller>
          <div className="hidden space-y-5 lg:block">
            {[...folders.entries()].map(([folder, ks]) => (
              <div key={folder}>
                <p className="mb-1 px-2.5 text-[12px] font-medium text-ink-3">{folder}</p>
                <ul>
                  {ks.map((k) => (
                    <li key={k}>
                      <L
                        href={`/memory?doc=${encodeURIComponent(k)}`}
                        aria-current={k === current ? "page" : undefined}
                        className={cx("flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13.5px]", k === current ? "bg-surface font-medium text-ink shadow-soft ring-1 ring-line" : "text-ink-2 hover:bg-subtle")}
                      >
                        <span className="flex-1 truncate">{byKey.get(k)?.title ?? GROWTH_OS.find((g) => g.key === k)?.title}</span>
                        {isEmpty(k) ? <span className="text-[12px] font-normal text-ink-3">empty</span> : null}
                      </L>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>
        <div className="min-w-0">
          {introField && !hasContent && canEdit ? (
            <p className="mb-4 rounded-xl bg-subtle px-4 py-3 text-[14px] text-ink-2">
              Short on time? {introGaps > 1 ? `Answer ${introGaps} quick questions` : `Answer “${introField.label}”`} instead of writing the whole doc.{" "}
              <L href="/today?setup=1" className="font-medium text-ink underline-offset-2 hover:underline">
                Open on Today
              </L>
            </p>
          ) : null}
          <DocEditor
            key={`${current}:${sp.edit === "1" ? "edit" : "view"}`}
            title={title}
            meta={hasContent ? `v${doc!.version} · ${creditFor(history[0]) ? `${creditFor(history[0])} · ` : ""}${timeAgo(doc!.updated_at)}` : null}
            startEditing={sp.edit === "1"}
            docKey={current}
            content={doc?.content ?? ""}
            version={doc?.version ?? 0}
            hint={preset?.hint}
            template={DOC_TEMPLATES[current]}
            agentWritten={AGENT_WRITTEN.has(current)}
            canEdit={canEdit}
            preview={hasContent ? <Markdown>{doc!.content}</Markdown> : <p className="text-[14px] text-ink-3">{preset?.hint ?? "Empty."}</p>}
          />
          {history.length > 1 ? (
            <section className="mt-12">
              <h3 className="mb-3 text-[15px] font-semibold tracking-[-0.01em]">History</h3>
              <ol className="space-y-2 text-[14px]">
                {history.slice(0, 12).map((h) => (
                  <li key={h.version} className="flex gap-3 text-ink-2">
                    <span className="w-8 shrink-0 text-ink-3 tnum">v{h.version}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {h.author_kind === "agent" && h.note?.startsWith("Approved: ") ? (current === "cockpit/weekly-brief" ? "Brief approved" : "Memo approved") : h.author_kind === "system" ? (h.note === "Sample data" ? "Sample content" : h.note && h.note !== "Created" ? h.note : "Created") : (h.note ?? "Edited")}
                    </span>
                    <span className="shrink-0 text-[13px] text-ink-3">
                      {creditFor(h)} · {timeAgo(h.created_at)}
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

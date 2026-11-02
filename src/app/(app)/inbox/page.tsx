import { Inbox as InboxIcon } from "lucide-react";
import { requireCtx } from "@/server/web/session";
import { listDrafts, getDraft } from "@/server/services/drafts";
import { SYSTEM_META, type System } from "@/server/agents/types";
import { isUuid } from "@/lib/db";
import { L } from "@/components/nav";
import { Markdown } from "@/components/markdown";
import { ReviewPane, InboxKeys } from "@/components/review-pane";
import { Empty, Kbd, cx, plural, timeAgo } from "@/components/ui";
import { isUndoable, recentRejectionReasons } from "@/server/services/review-extra";

export const metadata = { title: "Inbox" };

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Drop a leading "# Title" when the page header already shows that title. Render-time only. */
function withoutTitleH1(body: string, title: string) {
  const m = body.match(/^\s*#\s+(.+?)\s*#*\s*(?:\r?\n|$)/);
  if (!m) return body;
  const h = norm(m[1]!);
  const t = norm(title);
  if (!h || !t || !(h === t || t.startsWith(h) || h.startsWith(t))) return body;
  return body.slice(m[0].length).replace(/^\s*\n/, "");
}

const TABS = [
  { key: "pending", label: "To review" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
] as const;

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ d?: string; tab?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "pending";
  const drafts = await listDrafts(ctx, { status: tab, limit: 100 });
  const selectedId = isUuid(sp.d) ? sp.d : drafts[0]?.id;
  const selected = selectedId ? (drafts.find((d) => d.id === selectedId) ?? (await getDraft(ctx, selectedId).catch(() => null))) : null;
  const idx = selected ? drafts.findIndex((d) => d.id === selected.id) : -1;
  const nextId = drafts[idx + 1]?.id ?? (idx > 0 ? drafts[idx - 1]?.id : null) ?? null;
  const q = (extra: string) => `/inbox?tab=${tab}${extra}`;
  const reasons = selected?.agent_id && selected.status === "pending" ? await recentRejectionReasons(ctx, selected.agent_id).catch(() => []) : [];

  return (
    <div className="animate-in">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Inbox</h1>
          <p className="mt-1 text-ink-2">Nothing ships without you. Approve, edit, or reject with a reason the agent will remember.</p>
        </div>
        <div className="flex rounded-lg bg-subtle p-0.5 text-sm">
          {TABS.map((t) => (
            <L
              key={t.key}
              href={`/inbox?tab=${t.key}`}
              className={cx("rounded-md px-3 py-1.5", t.key === tab ? "bg-surface font-medium text-ink shadow-soft" : "text-ink-2 hover:text-ink")}
            >
              {t.label}
            </L>
          ))}
        </div>
      </div>

      {!drafts.length && !selected ? (
        <Empty icon={<InboxIcon size={22} />} title={tab === "pending" ? "Inbox zero" : `Nothing ${tab} yet`}>
          {tab === "pending" ? "When an agent finishes a run, its drafts land here for your approval." : null}
        </Empty>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
          <InboxKeys ids={drafts.map((d) => d.id)} current={selected?.id ?? null} tab={tab} />
          <ul className="space-y-1 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto">
            {drafts.map((d) => (
              <li key={d.id} data-draft={d.id}>
                <L
                  href={q(`&d=${d.id}`)}
                  scroll={false}
                  className={cx("block rounded-xl px-3.5 py-3 transition-colors", d.id === selected?.id ? "bg-surface shadow-soft ring-1 ring-line" : "hover:bg-subtle")}
                >
                  <p className="line-clamp-2 text-[14px] font-medium leading-snug">{d.title}</p>
                  <p className="mt-1 text-xs text-ink-3">
                    {SYSTEM_META[d.system as System]?.short ?? d.system} · {timeAgo(d.created_at)}
                    {d.evidence?.length ? ` · ${plural(d.evidence.length, "receipt")}` : ""}
                  </p>
                </L>
              </li>
            ))}
            {tab === "pending" && drafts.length > 1 ? (
              <li className="px-3.5 pt-3 text-xs text-ink-3">
                <Kbd>J</Kbd> <Kbd>K</Kbd> to move
              </li>
            ) : null}
          </ul>
          <div className="min-w-0">
            {selected ? (
              <ReviewPane
                nextId={nextId}
                reasons={reasons}
                draft={{
                  id: selected.id,
                  title: selected.title,
                  body: selected.body,
                  status: selected.status,
                  feedback: selected.feedback,
                  system_label: SYSTEM_META[selected.system as System]?.label ?? selected.system,
                  agent_name: selected.agent_name,
                  created_at: selected.created_at,
                  undoable: isUndoable(selected.type),
                  evidence: selected.evidence ?? [],
                  html: <Markdown>{withoutTitleH1(selected.body, selected.title)}</Markdown>,
                }}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

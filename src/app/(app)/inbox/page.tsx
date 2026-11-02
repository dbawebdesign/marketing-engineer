import { Inbox as InboxIcon } from "lucide-react";
import { requireCtx } from "@/server/web/session";
import { listDrafts, getDraft } from "@/server/services/drafts";
import { SYSTEM_META, type System } from "@/server/agents/types";
import { isUuid } from "@/lib/db";
import { slugForSystem } from "@/lib/systems";
import { L } from "@/components/nav";
import { Markdown } from "@/components/markdown";
import { ReviewPane, InboxKeys } from "@/components/review-pane";
import { InboxList } from "@/components/inbox-list";
import { Empty, cx } from "@/components/ui";
import { effectHref, isUndoable, oldestPendingMemo, recentRejectionReasons } from "@/server/services/review-extra";
import { InboxNextStep } from "./next-step";

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

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ d?: string; tab?: string; done?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "pending";
  const drafts = await listDrafts(ctx, { status: tab, limit: 100 });
  const selectedId = isUuid(sp.d) ? sp.d : drafts[0]?.id;
  const selected = selectedId ? (drafts.find((d) => d.id === selectedId) ?? (await getDraft(ctx, selectedId).catch(() => null))) : null;
  const idx = selected ? drafts.findIndex((d) => d.id === selected.id) : -1;
  const nextId = drafts[idx + 1]?.id ?? (idx > 0 ? drafts[idx - 1]?.id : null) ?? null;
  const reasons = selected?.agent_id && selected.status === "pending" ? await recentRejectionReasons(ctx, selected.agent_id).catch(() => []) : [];
  const memo = selected?.status === "pending" && selected.system !== "customer_truth" ? await oldestPendingMemo(ctx) : null;
  const builtBeforeMemo = memo && selected && new Date(selected.created_at) >= new Date(memo.created_at) ? memo.id : null;

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
        tab === "pending" ? (
          <InboxNextStep doneId={isUuid(sp.done) ? sp.done : null} />
        ) : (
          <Empty icon={<InboxIcon size={22} />} title={`Nothing ${tab} yet`} />
        )
      ) : (
        <div className="grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
          <InboxKeys ids={drafts.map((d) => d.id)} current={selected?.id ?? null} tab={tab} />
          <InboxList
            tab={tab}
            selectedId={selected?.id ?? null}
            rows={drafts.map((d) => ({
              id: d.id,
              title: d.title,
              system: d.system,
              systemShort: SYSTEM_META[d.system as System]?.short ?? d.system,
              systemHref: `/s/${slugForSystem(d.system)}`,
              created_at: d.created_at,
              receipts: d.evidence?.length ?? 0,
            }))}
          />
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
                  effect_href: effectHref(selected.type, selected.system),
                  pending_memo_id: builtBeforeMemo,
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

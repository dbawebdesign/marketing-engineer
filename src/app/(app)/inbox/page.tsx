import { ArrowLeft, ArrowRight, Inbox as InboxIcon } from "lucide-react";
import { requireCtx } from "@/server/web/session";
import { listDrafts, getDraft, pendingCount } from "@/server/services/drafts";
import { SYSTEM_META, type System } from "@/server/agents/types";
import { isUuid } from "@/lib/db";
import { SYSTEM_SLUGS, slugForSystem, type SystemSlug } from "@/lib/systems";
import { dedupeReceipts } from "@/lib/receipts";
import { metaOf } from "@/lib/draft-meta";
import { L } from "@/components/nav";
import { Markdown } from "@/components/markdown";
import { ReviewPane, InboxKeys, UndoShortcut } from "@/components/review-pane";
import { InboxList } from "@/components/inbox-list";
import { Empty, cx, plural } from "@/components/ui";
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

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ d?: string; tab?: string; done?: string; system?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "pending";
  const slug = sp.system && sp.system in SYSTEM_SLUGS ? (sp.system as SystemSlug) : null;
  const system = slug ? SYSTEM_SLUGS[slug] : undefined;
  // Every link out of this page keeps the tab and the filter.
  const scopeQuery = slug ? `system=${slug}&` : "";
  const listQuery = `${tab !== "pending" ? `tab=${tab}&` : ""}${scopeQuery}`;
  const drafts = await listDrafts(ctx, { status: tab, system, limit: 100 });
  const selectedId = isUuid(sp.d) ? sp.d : drafts[0]?.id;
  const selected = selectedId ? (drafts.find((d) => d.id === selectedId) ?? (await getDraft(ctx, selectedId).catch(() => null))) : null;
  const idx = selected ? drafts.findIndex((d) => d.id === selected.id) : -1;
  const nextId = drafts[idx + 1]?.id ?? (idx > 0 ? drafts[idx - 1]?.id : null) ?? null;
  const reasons = selected?.agent_id && selected.status === "pending" ? await recentRejectionReasons(ctx, selected.agent_id).catch(() => []) : [];
  const memo = selected?.status === "pending" && selected.system !== "customer_truth" ? await oldestPendingMemo(ctx) : null;
  const builtBeforeMemo = memo && selected && new Date(selected.created_at) >= new Date(memo.created_at) ? memo.id : null;
  const empty = !drafts.length && !selected;
  // A filtered queue can be empty while other systems still wait.
  const elsewhere = empty && tab === "pending" && system ? await pendingCount(ctx) : 0;
  const filterLabel = system ? (SYSTEM_META[system as System]?.label ?? system) : null;
  const filter = filterLabel ? { label: filterLabel, clearHref: `/inbox${tab !== "pending" ? `?tab=${tab}` : ""}` } : null;

  return (
    <div className="animate-in">
      <UndoShortcut />
      {/* With a draft open on a phone, the draft is the page: no title, blurb or tabs above it. */}
      <div className={cx("mb-6 flex flex-wrap items-end justify-between gap-4", sp.d && !empty && "hidden lg:flex")}>
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Inbox</h1>
          <p className="mt-1 text-ink-2">Nothing ships without you. Approve, edit, or reject with a reason the agent will remember.</p>
        </div>
        <div className="flex rounded-lg bg-subtle p-0.5 text-sm">
          {TABS.map((t) => (
            <L
              key={t.key}
              href={`/inbox?tab=${t.key}${slug ? `&system=${slug}` : ""}`}
              className={cx("rounded-md px-3 py-1.5", t.key === tab ? "bg-surface font-medium text-ink shadow-soft" : "text-ink-2 hover:text-ink")}
            >
              {t.label}
            </L>
          ))}
        </div>
      </div>

      {empty ? (
        elsewhere ? (
          <section className="max-w-2xl rounded-2xl bg-surface p-6 ring-1 ring-line">
            <p className="font-medium text-ink">Nothing from {filterLabel} waiting</p>
            <p className="mt-1 text-[14px] text-ink-2">{plural(elsewhere, "draft")} from other systems still need you.</p>
            <L href="/inbox" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink">
              Show all <ArrowRight size={13} />
            </L>
          </section>
        ) : tab === "pending" ? (
          <InboxNextStep doneId={isUuid(sp.done) ? sp.done : null} />
        ) : (
          <Empty icon={<InboxIcon size={22} />} title={`Nothing ${tab} ${filterLabel ? `in ${filterLabel} ` : ""}yet`} action={filter ? <L href={filter.clearHref} className="text-sm text-ink-2 hover:text-ink">Show all systems</L> : undefined} />
        )
      ) : (
        <div className="grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
          <InboxKeys ids={drafts.map((d) => d.id)} current={selected?.id ?? null} listQuery={listQuery} />
          {/* Small screens show the list or the open draft, never both stacked. */}
          <div className={cx("min-w-0", sp.d && "hidden lg:block")}>
          <InboxList
            tab={tab}
            listQuery={listQuery}
            filter={filter}
            selectedId={selected?.id ?? null}
            rows={drafts.map((d) => ({
              id: d.id,
              title: d.title,
              system: d.system,
              systemShort: SYSTEM_META[d.system as System]?.short ?? d.system,
              systemHref: `/s/${slugForSystem(d.system)}`,
              created_at: d.created_at,
              receipts: dedupeReceipts(d.evidence ?? []).length,
            }))}
          />
          </div>
          <div className={cx("min-w-0", !sp.d && "hidden lg:block")}>
            <L href={`/inbox${listQuery ? `?${listQuery.slice(0, -1)}` : ""}`} className="mb-4 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink lg:hidden">
              <ArrowLeft size={14} /> All drafts
            </L>
            {selected ? (
              <ReviewPane
                nextId={nextId}
                listQuery={listQuery}
                scopeQuery={scopeQuery}
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
                  meta: metaOf(selected.payload),
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

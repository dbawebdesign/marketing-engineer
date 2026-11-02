import { ArrowRight, Inbox as InboxIcon } from "lucide-react";
import { requireCtx } from "@/server/web/session";
import { listDrafts, getDraft, pendingCount } from "@/server/services/drafts";
import { SYSTEM_META, type System } from "@/server/agents/types";
import { isUuid } from "@/lib/db";
import { SYSTEM_SLUGS, slugForSystem, type SystemSlug } from "@/lib/systems";
import { dedupeReceipts } from "@/lib/receipts";
import { metaOf } from "@/lib/draft-meta";
import { L } from "@/components/nav";
import { UndoShortcut, type RecentReason, type ReviewDraft } from "@/components/review-pane";
import type { Draft } from "@/server/services/drafts";
import { Empty, cx, plural } from "@/components/ui";
import { effectHref, isUndoable, oldestPendingMemo, recentRejectionReasons } from "@/server/services/review-extra";
import { InboxNextStep } from "./next-step";
import { InboxView } from "./inbox-view";

export const metadata = { title: "Inbox" };

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
  // Everything the pane needs for every draft in the list ships now, so moving through it never waits on the server.
  const all = selected && !drafts.some((d) => d.id === selected.id) ? [...drafts, selected] : drafts;
  const agentIds = [...new Set(all.flatMap((d) => (d.status === "pending" && d.agent_id ? [d.agent_id] : [])))];
  const [reasonList, memo] = await Promise.all([
    Promise.all(agentIds.map((id) => recentRejectionReasons(ctx, id).catch(() => [] as RecentReason[]))),
    all.some((d) => d.status === "pending" && d.system !== "customer_truth") ? oldestPendingMemo(ctx) : null,
  ]);
  const reasons = Object.fromEntries(agentIds.map((id, i) => [id, reasonList[i] ?? []]));
  const toPane = (d: Draft): ReviewDraft => ({
    id: d.id,
    title: d.title,
    body: d.body,
    status: d.status,
    feedback: d.feedback,
    system_label: SYSTEM_META[d.system as System]?.label ?? d.system,
    agent_name: d.agent_name,
    agent_id: d.agent_id,
    created_at: d.created_at,
    undoable: isUndoable(d.type),
    effect_href: effectHref(d.type, d.system),
    pending_memo_id: memo && d.status === "pending" && d.system !== "customer_truth" && new Date(d.created_at) >= new Date(memo.created_at) ? memo.id : null,
    evidence: d.evidence ?? [],
    meta: metaOf(d.payload),
  });
  const empty = !drafts.length && !selected;
  // A filtered queue can be empty while other systems still wait.
  const elsewhere = empty && tab === "pending" && system ? await pendingCount(ctx) : 0;
  const filterLabel = system ? (SYSTEM_META[system as System]?.label ?? system) : null;
  const filter = filterLabel ? { label: filterLabel, clearHref: `/inbox${tab !== "pending" ? `?tab=${tab}` : ""}` } : null;

  const header = (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
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
  );

  return (
    <div className="animate-in">
      <UndoShortcut />
      {empty ? (
        <>
          {header}
          {elsewhere ? (
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
          )}
        </>
      ) : (
        <InboxView
          header={header}
          drafts={all.map(toPane)}
          initialId={selected?.id ?? null}
          reasons={reasons}
          tab={tab}
          listQuery={listQuery}
          scopeQuery={scopeQuery}
          filter={filter}
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
      )}
    </div>
  );
}

"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { L, useBase } from "@/components/nav";
import { InboxList, type InboxRow } from "@/components/inbox-list";
import { ReviewPane, isTypingTarget, overlayOpen, type PaneApi, type PaneSnapshot, type RecentReason, type ReviewDraft } from "@/components/review-pane";
import { cx } from "@/components/ui";
import { warmMarkdown } from "@/components/markdown";
import { withoutTitleH1 } from "@/lib/draft-body";
import { dedupeReceipts } from "@/lib/receipts";

/**
 * The inbox's list and open draft, driven from data already on the client: J/K and clicks
 * change the selection in one render and rewrite the URL in place, no server round trip.
 * The server catches up on refresh after a decision.
 */
export function InboxView({
  header,
  drafts,
  rows,
  initialId,
  reasons,
  tab,
  listQuery,
  scopeQuery,
  filter,
}: {
  /** Title and tabs; hidden on a phone while a draft is open. */
  header: React.ReactNode;
  /** Every draft the list shows, plus the open one if it isn't in the list. */
  drafts: ReviewDraft[];
  rows: InboxRow[];
  initialId: string | null;
  /** Recent rejection reasons, by agent. */
  reasons: Record<string, RecentReason[]>;
  tab: string;
  listQuery: string;
  scopeQuery: string;
  filter: { label: string; clearHref: string } | null;
}) {
  const base = useBase();
  const sp = useSearchParams();
  const [sel, setSel] = useState<string | null>(initialId);
  /** Decided here, not yet gone from the server's list. */
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  /** A draft whose decision failed, and the state to bring it back in. */
  const [restored, setRestored] = useState<{ id: string; snap: PaneSnapshot } | null>(null);
  const api = useRef<PaneApi | null>(null);
  const urlWrite = useRef<{ url: string; push: boolean } | null>(null);
  const urlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const byId = useMemo(() => new Map(drafts.map((d) => [d.id, d])), [drafts]);
  const visibleRows = useMemo(() => rows.filter((r) => !removed.has(r.id)), [rows, removed]);
  const ids = useMemo(() => visibleRows.map((r) => r.id), [visibleRows]);
  const current = (sel && byId.get(sel) && !removed.has(sel) ? byId.get(sel) : byId.get(ids[0] ?? "")) ?? null;

  // The server has caught up once a decided draft is gone from its list.
  useEffect(() => {
    setRemoved((prev) => {
      const live = new Set(rows.map((r) => r.id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  const urlFor = useCallback((id: string) => `${base}/inbox?${listQuery}d=${id}`, [base, listQuery]);

  const select = useCallback(
    (id: string, how: "replace" | "push" = "replace") => {
      setSel(id);
      setRestored(null);
      // The URL follows after the frame is painted: Next re-renders its router on every history
      // write, and that work shouldn't sit between the key press and the new draft on screen.
      // Quick J/K presses collapse into one write.
      urlWrite.current = { url: urlFor(id), push: how === "push" || urlWrite.current?.push === true };
      if (urlTimer.current) return;
      urlTimer.current = setTimeout(() => {
        urlTimer.current = null;
        const w = urlWrite.current;
        urlWrite.current = null;
        if (!w) return;
        if (w.push) window.history.pushState(null, "", w.url);
        else window.history.replaceState(null, "", w.url);
      }, 90);
    },
    [urlFor],
  );

  // Back/forward, undo, or any navigation that names a draft: follow the URL, but only when it
  // is the URL right now (a late sync from an earlier replaceState must not pull us back).
  const urlD = sp.get("d");
  useEffect(() => {
    if (!urlD || urlD === sel) return;
    if (new URLSearchParams(window.location.search).get("d") !== urlD) return;
    setSel(urlD);
    setRemoved((prev) => {
      if (!prev.has(urlD)) return prev;
      const next = new Set(prev);
      next.delete(urlD);
      return next;
    });
  }, [urlD]);

  // J/K here; every other key goes to the open pane through `api`, which it registers at commit.
  const keyState = useRef({ ids, current, select });
  keyState.current = { ids, current, select };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((k === "j" || k === "k") && !e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target) && !overlayOpen()) {
        if (document.querySelector("[data-review-editing], [data-discard-confirm]")) return; // an open edit stays put
        const { ids, current, select } = keyState.current;
        const i = current ? ids.indexOf(current.id) : -1;
        const next = k === "j" ? ids[i + 1] : i > 0 ? ids[i - 1] : undefined;
        if (!next) return;
        e.preventDefault();
        // A typed reject reason isn't dropped silently: the pane asks first.
        if (api.current) api.current.leave(() => select(next));
        else select(next);
        return;
      }
      api.current?.key(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (current) document.querySelector(`[data-draft="${current.id}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  // Parse the neighbours while idle, so J/K only has to swap trees in.
  const currentId = current?.id ?? null;
  useEffect(() => {
    if (!currentId) return;
    const i = ids.indexOf(currentId);
    const near = [ids[i + 1], ids[i - 1], ids[i + 2]].filter((x): x is string => !!x);
    const warm = () =>
      near.forEach((id) => {
        const d = byId.get(id);
        if (d) warmMarkdown(`draft:${id}`, { children: withoutTitleH1(d.body, d.title), receipts: dedupeReceipts(d.evidence) });
      });
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    if (w.requestIdleCallback) {
      const h = w.requestIdleCallback(warm, { timeout: 300 });
      return () => w.cancelIdleCallback?.(h);
    }
    const t = setTimeout(warm, 60);
    return () => clearTimeout(t);
  }, [currentId, ids, byId]);

  /** After a decision on the open draft: drop it and open its neighbour. False when it was the last. */
  const advance = useCallback(() => {
    const { ids, current } = keyState.current;
    if (!current) return false;
    const i = ids.indexOf(current.id);
    const next = ids[i + 1] ?? (i > 0 ? ids[i - 1] : undefined);
    if (!next) return false;
    setRemoved((prev) => new Set(prev).add(current.id));
    select(next);
    return true;
  }, [select]);

  const restore = useCallback(
    (id: string, snap: PaneSnapshot) => {
      setRemoved((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      select(id);
      setRestored({ id, snap });
    },
    [select],
  );

  const open = useCallback(
    (id: string) => {
      const go = () => select(id, "push");
      if (api.current) api.current.leave(go);
      else go();
    },
    [select],
  );

  // On a phone the list and the open draft are separate screens.
  const showDraft = !!urlD;
  const backHref = `${base}/inbox${listQuery ? `?${listQuery.slice(0, -1)}` : ""}`;

  return (
    <>
      <div className={cx(showDraft && "hidden lg:block")}>{header}</div>
      <div className="grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className={cx("min-w-0", showDraft && "hidden lg:block")}>
          <InboxList tab={tab} listQuery={listQuery} filter={filter} selectedId={current?.id ?? null} rows={visibleRows} onOpen={open} />
        </div>
        <div className={cx("min-w-0", !showDraft && "hidden lg:block")}>
          <L href={backHref} className="mb-4 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink lg:hidden">
            <ArrowLeft size={14} /> All drafts
          </L>
          {current ? (
            <ReviewPane
              key={current.id}
              draft={current}
              reasons={current.agent_id && current.status === "pending" ? (reasons[current.agent_id] ?? []) : []}
              scopeQuery={scopeQuery}
              api={api}
              advance={advance}
              restore={restore}
              initial={restored?.id === current.id ? restored.snap : null}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}

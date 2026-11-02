"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, LoaderCircle, X } from "lucide-react";
import { signalDetailAction } from "@/app/(app)/actions-extra";
import type { Signal, SignalUse } from "@/server/services/signals";
import { sourceLabel } from "@/lib/signal-sources";
import { L, useBase } from "./nav";
import { useRouter } from "next/navigation";
import { Badge, Dot, buttonClass } from "./ui";

export type SignalDetail = { signal: Signal; usedIn: SignalUse[] };

const SYSTEM_SHORT: Record<string, string> = {
  customer_truth: "Truth",
  founder_content: "Content",
  outbound_signal: "Outbound",
  creative_testing: "Creative",
  ai_search: "AI search",
  growth_cockpit: "Cockpit",
};
const STATUS_LABEL: Record<string, string> = { pending: "To review", approved: "Approved", published: "Published", rejected: "Rejected" };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A loose matcher for a quote: same words in order, any punctuation or spacing between them. */
function quoteRegex(q: string) {
  // Quotes print inner double quotes as ‘…’; those marks are punctuation, not apostrophes, so they don't have to match.
  const words = q
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .match(/[a-z0-9$%']+/g)
    ?.map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
  if (!words || words.length < 2) return null;
  return new RegExp(words.map(esc).join("[^a-z0-9$%]+"), "i");
}

/** The signal's text with each cited quote marked. */
function Highlighted({ text, quotes }: { text: string; quotes: string[] }) {
  const ranges: [number, number][] = [];
  for (const q of quotes) {
    const re = quoteRegex(q);
    const m = re ? re.exec(text.replace(/[‘’]/g, "'")) : null;
    if (m) ranges.push([m.index, m.index + m[0].length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  const parts: React.ReactNode[] = [];
  let at = 0;
  merged.forEach(([a, b], i) => {
    if (a > at) parts.push(<Fragment key={`t${i}`}>{text.slice(at, a)}</Fragment>);
    parts.push(
      <mark key={`m${i}`} data-quote className="rounded-[3px] bg-warn-soft px-0.5 text-ink [box-decoration-break:clone]">
        {text.slice(a, b)}
      </mark>,
    );
    at = b;
  });
  if (at < text.length) parts.push(<Fragment key="end">{text.slice(at)}</Fragment>);
  return <>{parts}</>;
}

export const inboxHrefFor = (d: { id: string; status: string }) => `/inbox?tab=${d.status === "published" ? "approved" : d.status}&d=${d.id}`;

/**
 * The full signal behind a receipt, in a side sheet: what was said, by whom, when,
 * with the cited quote marked, and every draft that leans on it.
 */
export function SignalSheet({ id, quote, initial, onClose }: { id: string; quote?: string | null; initial?: SignalDetail | null; onClose: () => void }) {
  const [data, setData] = useState<SignalDetail | null | undefined>(initial ?? undefined);
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (initial && initial.signal.id === id) return setData(initial);
    let live = true;
    setData(undefined);
    signalDetailAction(id).then((r) => live && setData(r.ok ? (r.data ?? null) : null)).catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, [id, initial]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prev?.focus?.({ preventScroll: true });
    };
  }, []);

  // Bring the marked quote into view once the text is in.
  useEffect(() => {
    if (data) requestAnimationFrame(() => bodyRef.current?.querySelector("[data-quote]")?.scrollIntoView({ block: "center" }));
  }, [data]);

  if (!mounted) return null;
  const s = data?.signal;
  const quotes = quote ? [quote] : [...new Set((data?.usedIn ?? []).flatMap((u) => u.quotes))];
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20 backdrop-blur-[2px]" onMouseDown={() => close.current()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="signal-sheet-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="animate-in flex h-dvh w-full max-w-[560px] flex-col bg-bg shadow-pop ring-1 ring-line"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5 sm:px-6">
          <h2 id="signal-sheet-title" className="min-w-0 truncate font-semibold">
            {s ? s.title.trim() || `${sourceLabel(s.source)}${s.account ? ` · ${s.account}` : ""}` : "Signal"}
          </h2>
          <button ref={closeRef} type="button" className={buttonClass("ghost", "sm")} onClick={() => close.current()} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div ref={bodyRef} className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {data === undefined ? (
            <p className="flex items-center gap-2 text-sm text-ink-3">
              <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> Loading signal…
            </p>
          ) : !s ? (
            <p className="text-sm text-ink-2">This signal is gone. It may have been deleted.</p>
          ) : (
            <>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-3">
                <Badge>{sourceLabel(s.source)}</Badge>
                {s.account ? <span className="font-medium text-ink-2">{s.account}</span> : null}
                {s.author ? <span>· {s.author}</span> : null}
                <span title={new Date(s.occurred_at).toLocaleString()}>
                  · {new Date(s.occurred_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                </span>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="ml-auto inline-flex items-center gap-0.5 hover:text-ink">
                    Source <ArrowUpRight size={12} />
                  </a>
                ) : null}
              </p>
              <div className="mt-4 whitespace-pre-wrap break-words text-[15px] leading-[1.7] text-ink">
                <Highlighted text={s.content} quotes={quotes} />
              </div>
              <section className="mt-8 border-t border-line pt-5">
                <h3 className="mb-2 text-[13px] font-medium text-ink-3">Used in</h3>
                {data!.usedIn.length ? (
                  <ul className="-mx-2">
                    {data!.usedIn.map((u) => (
                      <li key={u.id}>
                        <L href={inboxHrefFor(u)} onClick={() => close.current()} className="flex items-center gap-3 rounded-lg px-2 py-2 text-[14px] hover:bg-subtle">
                          <Dot tone={u.status === "pending" ? "warn" : u.status === "rejected" ? "neutral" : "accent"} />
                          <span className="min-w-0 flex-1 truncate">{u.title}</span>
                          <span className="shrink-0 text-[12.5px] text-ink-3">
                            {SYSTEM_SHORT[u.system] ?? u.system} · {STATUS_LABEL[u.status] ?? u.status}
                          </span>
                        </L>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[14px] text-ink-3">No draft cites this signal yet.</p>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The sheet as /signals?id=… shows it: closing drops the id and keeps the filters. */
export function SignalSheetRoute({ id, initial, closeHref }: { id: string; initial: SignalDetail | null; closeHref: string }) {
  const [open, setOpen] = useState(true);
  const router = useRouter();
  const base = useBase();
  if (!open) return null;
  return (
    <SignalSheet
      id={id}
      initial={initial}
      onClose={() => {
        setOpen(false);
        router.replace(base + closeHref, { scroll: false });
      }}
    />
  );
}

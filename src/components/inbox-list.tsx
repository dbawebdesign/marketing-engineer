"use client";
import { memo, useEffect, useState } from "react";
import { X } from "lucide-react";
import { L, NAV_ITEMS } from "./nav";
import { Kbd, cx, plural, timeAgo } from "./ui";
import { openShortcuts } from "./shortcuts";
import { SampleTag } from "./draft-meta";

export type InboxRow = { id: string; title: string; system: string; systemShort: string; systemHref: string; created_at: string; receipts: number; sample?: boolean };

const SEEN_KEY = "me:seen-drafts";
const readSeen = (): Set<string> => {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
};
const writeSeen = (s: Set<string>) => {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-500)));
  } catch {
    /* storage blocked: unread dots just won't persist */
  }
};

const VISIT_KEY = "me:inbox-visit";
/** When the inbox was last opened (before now), and mark this visit. First visit: now, so nothing reads as new. */
let lastRead: { at: number; since: number } | null = null;
const readVisit = (): number => {
  const now = Date.now();
  // Coming back within half an hour in the same tab (a remount, a filter change, a trip to Today) is the same visit.
  if (lastRead && now - lastRead.at < 30 * 60_000) {
    lastRead.at = now;
    try {
      localStorage.setItem(VISIT_KEY, String(now));
    } catch {
      /* ignore */
    }
    return lastRead.since;
  }
  const since = readStoredVisit(now);
  lastRead = { at: now, since };
  return since;
};
const readStoredVisit = (now: number): number => {
  try {
    const prev = Number(localStorage.getItem(VISIT_KEY));
    localStorage.setItem(VISIT_KEY, String(now));
    return Number.isFinite(prev) && prev > 0 ? prev : now;
  } catch {
    return now;
  }
};

/** An empty inbox is still a visit: drafts that arrive after it read as new next time. */
export function InboxVisit() {
  useEffect(() => void readVisit(), []);
  return null;
}

const iconFor = (href: string) => NAV_ITEMS.find((n) => n.href === href)?.icon;

/** The inbox's left column: system glyph, unread dot, strong selected state. */
export function InboxList({
  rows,
  selectedId,
  tab,
  listQuery,
  filter,
  onOpen,
  leaving,
}: {
  rows: InboxRow[];
  /** Rows on their way out after a decision: shown collapsing, not counted. */
  leaving?: Set<string>;
  /** Open a draft in place (no navigation). Modified clicks still open the link. */
  onOpen?: (id: string) => void;
  selectedId: string | null;
  tab: string;
  /** Tab and filter, with a trailing "&". */
  listQuery: string;
  /** The system the list is narrowed to, removable. */
  filter?: { label: string; clearHref: string } | null;
}) {
  // null until mounted, so server and first client render agree (no dots yet).
  const [seen, setSeen] = useState<Set<string> | null>(null);
  // Drafts are "new" only if they arrived since the last visit. A first visit counts everything as seen.
  const [since, setSince] = useState<number | null>(null);
  useEffect(() => setSince(readVisit()), []);
  useEffect(() => {
    const s = readSeen();
    if (selectedId && !s.has(selectedId)) {
      s.add(selectedId);
      writeSeen(s);
    }
    setSeen(new Set(s));
  }, [selectedId]);
  const isUnread = (r: InboxRow) => !!seen && since !== null && !seen.has(r.id) && +new Date(r.created_at) > since;

  const live = leaving?.size ? rows.filter((r) => !leaving.has(r.id)) : rows;
  // One tag per row only when sample and real drafts mix; an all-sample queue says it once, in the header.
  const allSample = live.length > 0 && live.every((r) => r.sample);
  const unread = tab === "pending" ? live.filter(isUnread).length : 0;
  return (
    <div className="lg:sticky lg:top-6 lg:flex lg:max-h-[calc(100dvh-3rem)] lg:flex-col">
      {filter ? (
        <div className="mb-2 px-3">
          <L
            href={filter.clearHref}
            data-inbox-filter
            aria-label={`Remove filter: ${filter.label}`}
            className="group inline-flex h-7 items-center gap-1.5 rounded-md bg-subtle pl-2.5 pr-2 text-[12.5px] text-ink-2 ring-1 ring-line hover:text-ink"
          >
            <span className="text-ink-3">System</span> {filter.label}
            <X size={12} aria-hidden className="text-ink-3 group-hover:text-ink" />
          </L>
        </div>
      ) : null}
      <div className="mb-2 flex h-6 items-center justify-between gap-3 px-3.5 text-xs text-ink-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 whitespace-nowrap tnum" title={unread ? `${unread} not opened yet` : undefined}>
            {tab === "pending" ? `${live.length} to review` : plural(live.length, "draft")}
          </span>
          {allSample ? <SampleTag /> : null}
        </span>
        {live.length > 1 ? (
          <button type="button" onClick={openShortcuts} className="hidden shrink-0 items-center gap-1 whitespace-nowrap hover:text-ink-2 lg:inline-flex" aria-label="Keyboard shortcuts">
            <Kbd>J</Kbd>
            <Kbd>K</Kbd> {allSample ? "" : "to move "}· <Kbd>?</Kbd> shortcuts
          </button>
        ) : null}
      </div>
      <ul className="space-y-0.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {rows.map((d) => {
          const on = d.id === selectedId;
          const out = !!leaving?.has(d.id);
          return <Row key={d.id} d={d} on={on && !out} out={out} isNew={tab === "pending" && !on && !out && isUnread(d)} tagSample={!allSample && !!d.sample} href={`/inbox?${listQuery}d=${d.id}`} onOpen={onOpen} />;
        })}
      </ul>
    </div>
  );
}

/** One row. Memoized so moving the selection re-renders two rows, not the whole list. */
const Row = memo(function Row({ d, on, out, isNew, tagSample, href, onOpen }: { d: InboxRow; on: boolean; out: boolean; isNew: boolean; tagSample: boolean; href: string; onOpen?: (id: string) => void }) {
  const Icon = iconFor(d.systemHref);
  return (
    <li
      data-draft={out ? undefined : d.id}
      aria-hidden={out || undefined}
      className={cx(
        "grid transition-[grid-template-rows,opacity] duration-150 ease-out motion-reduce:transition-none",
        out ? "pointer-events-none grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]",
      )}
    >
      <div className={cx("min-h-0", out && "overflow-hidden")}>
      <L
        tabIndex={out ? -1 : undefined}
        href={href}
        scroll={false}
        prefetch={false}
        onClick={(e) => {
          if (!onOpen || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          onOpen(d.id);
        }}
        aria-current={on ? "true" : undefined}
        className={cx("relative flex gap-3 rounded-xl px-3.5 py-3 transition-colors", on ? "bg-ink/[0.08] ring-1 ring-line-strong" : "hover:bg-ink/[0.035]")}
      >
        <span className={cx("mt-0.5 grid size-6 shrink-0 place-items-center rounded-md", on ? "bg-surface text-ink shadow-soft" : "bg-subtle text-ink-3")}>
          {Icon ? <Icon size={13} /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cx("line-clamp-2 text-[14px] leading-snug", "text-ink", (isNew || on) && "font-medium")}>{d.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-ink-3">
            <span>
              {d.systemShort} · {timeAgo(d.created_at)}
              {d.receipts ? ` · ${plural(d.receipts, "receipt")}` : ""}
            </span>
            {tagSample ? <SampleTag className="ml-1" /> : null}
          </span>
        </span>
        {isNew ? <span aria-label="New" className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" /> : null}
      </L>
      </div>
    </li>
  );
});

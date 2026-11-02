"use client";
import { memo, useEffect, useState } from "react";
import { X } from "lucide-react";
import { L, NAV_ITEMS } from "./nav";
import { Kbd, cx, plural, timeAgo } from "./ui";
import { openShortcuts } from "./shortcuts";

export type InboxRow = { id: string; title: string; system: string; systemShort: string; systemHref: string; created_at: string; receipts: number };

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

const iconFor = (href: string) => NAV_ITEMS.find((n) => n.href === href)?.icon;

/** The inbox's left column: system glyph, unread dot, strong selected state. */
export function InboxList({
  rows,
  selectedId,
  tab,
  listQuery,
  filter,
  onOpen,
}: {
  rows: InboxRow[];
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
  useEffect(() => {
    const s = readSeen();
    if (selectedId && !s.has(selectedId)) {
      s.add(selectedId);
      writeSeen(s);
    }
    setSeen(new Set(s));
  }, [selectedId]);

  const unread = tab === "pending" && seen ? rows.filter((r) => !seen.has(r.id)).length : 0;
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
        <span className="truncate tnum" title={unread ? `${unread} not opened yet` : undefined}>
          {tab === "pending" ? `${rows.length} to review` : plural(rows.length, "draft")}
        </span>
        {rows.length > 1 ? (
          <button type="button" onClick={openShortcuts} className="hidden shrink-0 items-center gap-1 whitespace-nowrap hover:text-ink-2 lg:inline-flex" aria-label="Keyboard shortcuts">
            <Kbd>J</Kbd>
            <Kbd>K</Kbd> to move · <Kbd>?</Kbd> shortcuts
          </button>
        ) : null}
      </div>
      <ul className="space-y-0.5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {rows.map((d) => {
          const on = d.id === selectedId;
          return <Row key={d.id} d={d} on={on} isNew={tab === "pending" && !!seen && !on && !seen.has(d.id)} href={`/inbox?${listQuery}d=${d.id}`} onOpen={onOpen} />;
        })}
      </ul>
    </div>
  );
}

/** One row. Memoized so moving the selection re-renders two rows, not the whole list. */
const Row = memo(function Row({ d, on, isNew, href, onOpen }: { d: InboxRow; on: boolean; isNew: boolean; href: string; onOpen?: (id: string) => void }) {
  const Icon = iconFor(d.systemHref);
  return (
    <li data-draft={d.id}>
      <L
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
          <span className="mt-1 block text-xs text-ink-3">
            {d.systemShort} · {timeAgo(d.created_at)}
            {d.receipts ? ` · ${plural(d.receipts, "receipt")}` : ""}
          </span>
        </span>
        {isNew ? <span aria-label="New" className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" /> : null}
      </L>
    </li>
  );
});

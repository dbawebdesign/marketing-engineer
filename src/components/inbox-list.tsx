"use client";
import { useEffect, useState } from "react";
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
export function InboxList({ rows, selectedId, tab }: { rows: InboxRow[]; selectedId: string | null; tab: string }) {
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
          const Icon = iconFor(d.systemHref);
          const isNew = tab === "pending" && !!seen && !on && !seen.has(d.id);
          return (
            <li key={d.id} data-draft={d.id}>
              <L
                href={`/inbox?tab=${tab}&d=${d.id}`}
                scroll={false}
                aria-current={on ? "true" : undefined}
                className={cx(
                  "relative flex gap-3 rounded-xl px-3.5 py-3 transition-colors",
                  on ? "bg-ink/[0.08] ring-1 ring-line-strong" : "hover:bg-ink/[0.035]",
                )}
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
        })}
      </ul>
    </div>
  );
}

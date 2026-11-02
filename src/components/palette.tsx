"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Bot, FileText, Inbox, LoaderCircle, MessageSquareQuote, Play, Plus, Search } from "lucide-react";
import { NAV_ITEMS, useBase } from "./nav";
import { runAgentAction } from "@/app/(app)/actions";
import { searchAction } from "@/app/(app)/actions-extra";
import type { SearchResults } from "@/server/services/search";
import { toast } from "./toast";
import { cx, Kbd } from "./ui";

type Icon = React.ComponentType<{ size?: number; className?: string }>;
type Cmd = { id: string; label: string; hint?: string; icon: Icon; run: () => void };
type Group = { name: string; items: Cmd[] };

const SOURCE: Record<string, string> = {
  sales_call: "Sales call",
  support_ticket: "Support ticket",
  churn_note: "Churn note",
  crm_note: "CRM note",
  review: "Review",
  social: "Social",
  interview: "Interview",
  product_event: "Product event",
  survey: "Survey",
  other: "Other",
};

/** A signal's display title, and a phrase from it that /signals?q= will find again. */
function signalLabel(s: { title: string; content: string }) {
  if (s.title?.trim()) return s.title.trim();
  const line = s.content.split("\n").find((l) => l.trim())?.trim() ?? "";
  return line.length > 70 ? line.slice(0, 70).replace(/\s+\S*$/, "") : line;
}

export function CommandPalette({ agents }: { agents: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const [res, setRes] = useState<{ q: string; data: SearchResults } | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const base = useBase();
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("me:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("me:palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      restore.current = document.activeElement as HTMLElement | null;
      setQ("");
      setI(0);
      setRes(null);
      requestAnimationFrame(() => input.current?.focus());
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
        restore.current?.focus?.();
      };
    }
  }, [open]);

  // Debounced server search; stale responses are dropped.
  const term = q.trim();
  useEffect(() => {
    if (!open || !term) {
      setLoading(false);
      return;
    }
    const n = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await searchAction(term);
      if (n !== seq.current) return;
      setLoading(false);
      if (r.ok && r.data) setRes({ q: term, data: r.data });
    }, 150);
    return () => clearTimeout(t);
  }, [term, open]);

  const go = (href: string) => router.push(base + href);

  const groups: Group[] = useMemo(() => {
    const match = (s: string) => !term || s.toLowerCase().includes(term.toLowerCase());
    const actions: Cmd[] = [
      { id: "add", label: "Add signals", hint: "Paste notes or upload a CSV", icon: Plus, run: () => {
          window.dispatchEvent(new Event("me:add-signals")); // opens the sheet if we're already on Signals
          if (!window.location.pathname.endsWith("/signals")) go("/signals?add=1");
        } },
      ...agents.map((a) => ({
        id: `run:${a.id}`,
        label: `Run ${a.name}`,
        icon: Play,
        run: async () => {
          const r = await runAgentAction(a.id);
          if (r.ok) {
            toast.ok(`${a.name} is working. Drafts land in your inbox.`);
            router.refresh();
          } else toast.error(r.error);
        },
      })),
    ].filter((c) => match(c.label));
    const nav: Cmd[] = NAV_ITEMS.filter((n) => match(n.label)).map((n) => ({ id: `nav:${n.href}`, label: n.label, hint: "Go to", icon: n.icon, run: () => go(n.href) }));
    const data = term && res ? res.data : null; // keep the last results on screen while the next search runs
    const out: Group[] = [{ name: "Actions", items: actions }];
    if (term && data) {
      out.push({
        name: "Drafts",
        items: data.drafts.map((d) => ({
          id: `d:${d.id}`,
          label: d.title,
          hint: d.status === "pending" ? "To review" : d.status,
          icon: Inbox,
          run: () => go(`/inbox?${["approved", "rejected"].includes(d.status) ? `tab=${d.status}&` : ""}d=${d.id}`),
        })),
      });
      out.push({
        name: "Signals",
        items: data.signals.map((s) => {
          const label = signalLabel(s);
          return {
            id: `s:${s.id}`,
            label,
            hint: [SOURCE[s.source] ?? s.source, s.account].filter(Boolean).join(" · "),
            icon: MessageSquareQuote,
            run: () => go(`/signals?q=${encodeURIComponent(label)}`),
          };
        }),
      });
      out.push({ name: "Docs", items: data.docs.map((d) => ({ id: `m:${d.key}`, label: d.title, hint: d.folder, icon: FileText, run: () => go(`/memory?doc=${encodeURIComponent(d.key)}`) })) });
      nav.push(...data.agents.map((a) => ({ id: `a:${a.id}`, label: a.name, hint: "Agent", icon: Bot, run: () => go(`/agents/${a.id}`) })));
    }
    out.push({ name: "Navigate", items: nav });
    return out.filter((g) => g.items.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, term, res, base]);

  const flat = groups.flatMap((g) => g.items);
  const sel = Math.min(i, Math.max(flat.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const choose = (c: Cmd | undefined) => {
    if (!c) return;
    setOpen(false);
    c.run();
  };

  if (!open || typeof document === "undefined") return null;
  let idx = -1;
  const searching = loading && (!res || res.q !== term);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 px-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command menu"
        className="animate-in w-full max-w-[560px] overflow-hidden rounded-2xl bg-surface shadow-pop ring-1 ring-line"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          } else if (e.key === "Tab") e.preventDefault(); // the input is the only stop; arrows move the selection
        }}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          {searching ? <LoaderCircle size={16} className="shrink-0 animate-spin text-ink-3 motion-reduce:animate-none" /> : <Search size={16} className="shrink-0 text-ink-3" />}
          <input
            ref={input}
            value={q}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={flat[sel] ? `palette-opt-${sel}` : undefined}
            aria-label="Search or run a command"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setQ(e.target.value);
              setI(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setI(Math.min(sel + 1, flat.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setI(Math.max(sel - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(flat[sel]);
              }
            }}
            placeholder="Search drafts, signals, docs, or run an agent…"
            style={{ outline: "none", boxShadow: "none" }}
            className="h-12 w-full min-w-0 border-0 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3 focus:outline-none focus-visible:outline-none"
          />
          <span className="hidden sm:inline-flex">
            <Kbd>esc</Kbd>
          </span>
        </div>
        <ul id="palette-list" ref={listRef} className="max-h-[min(420px,60vh)] overflow-y-auto overscroll-contain p-1.5" role="listbox" aria-label="Results">
          {groups.map((g) => (
            <li key={g.name} role="presentation">
              <p className="px-3 pb-1 pt-2.5 text-[12px] font-medium text-ink-3">{g.name}</p>
              <ul role="group" aria-label={g.name}>
                {g.items.map((c) => {
                  idx++;
                  const me = idx;
                  return (
                    <li
                      key={c.id}
                      id={`palette-opt-${me}`}
                      data-idx={me}
                      role="option"
                      aria-selected={me === sel}
                      onMouseMove={() => me !== sel && setI(me)}
                      onClick={() => choose(c)}
                      className={cx("flex h-10 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm", me === sel ? "bg-subtle text-ink" : "text-ink-2")}
                    >
                      <c.icon size={15} className="shrink-0 text-ink-3" />
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      {c.hint ? <span className="max-w-[40%] shrink-0 truncate text-xs text-ink-3">{c.hint}</span> : null}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
          {term && !flat.length && !searching ? (
            <li className="px-3 py-8 text-center text-sm text-ink-3" role="presentation">
              No results for “{term}”
            </li>
          ) : null}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bot, Check, ChevronRight, Copy, Database, FileText, FlaskConical, Inbox, Keyboard, LoaderCircle, MessageSquareQuote, Pencil, Play, Plus, Search, Trash2, X } from "lucide-react";
import { NAV_ITEMS, useBase } from "./nav";
import { clearSampleAction, loadDemoAction, runAgentAction } from "@/app/(app)/actions";
import { paletteContextAction, searchAction } from "@/app/(app)/actions-extra";
import type { SearchResults } from "@/server/services/search";
import { toast } from "./toast";
import { cx, Kbd, plural } from "./ui";
import { GO_CHORDS, ShortcutsSheet, draftCommands, openShortcuts, type DraftCommands } from "./shortcuts";

type Icon = React.ComponentType<{ size?: number; className?: string }>;
/** `keepOpen`: choosing it changes the palette (e.g. drills into a sub-list) instead of closing it. */
type Cmd = { id: string; label: string; hint?: string; keys?: string[]; snippet?: string; icon: Icon; run: () => void; keepOpen?: boolean; chevron?: boolean; danger?: boolean };
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

/** A signal's display title: its own, or its first line. */
function signalLabel(s: { title: string; content: string }) {
  if (s.title?.trim()) return s.title.trim();
  const line = s.content.split("\n").find((l) => l.trim())?.trim() ?? "";
  return line.length > 70 ? line.slice(0, 70).replace(/\s+\S*$/, "") : line;
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `text` with each case-insensitive occurrence of `term` marked. */
function Hl({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escRe(term)})`, "i"));
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <mark key={i} className="rounded-[3px] bg-accent/15 px-px text-ink">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  );
}

const STATUS: Record<string, string> = { pending: "To review", approved: "Approved", rejected: "Rejected", published: "Published", draft: "Queued", running: "Running", won: "Won", lost: "Lost" };

export function CommandPalette({ agents }: { agents: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const [res, setRes] = useState<{ q: string; data: SearchResults } | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState<"root" | "run" | "clear">("root");
  /** Sample-data commands depend on role and on what's loaded; fetched each time the palette opens. */
  const [ctx, setCtx] = useState<{ canManage: boolean; hasSample: boolean } | null>(null);
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
      setPage("root");
      requestAnimationFrame(() => input.current?.focus());
      void paletteContextAction().then((r) => r.ok && r.data && setCtx(r.data));
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
    if (!open || !term || page !== "root") {
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
  }, [term, open, page]);

  const go = (href: string) => router.push(base + href);
  // Snapshot on open: the draft open in the inbox, if that's where we are.
  const draft: DraftCommands | null = useMemo(
    () => (open && typeof window !== "undefined" && /\/inbox\/?$/.test(window.location.pathname) ? draftCommands.get() : null),
    [open],
  );

  const groups: Group[] = useMemo(() => {
    const match = (s: string) => !term || s.toLowerCase().includes(term.toLowerCase());
    const runCmd = (a: { id: string; name: string }, label: string): Cmd => ({
      id: `run:${a.id}`,
      label,
      icon: Play,
      run: async () => {
        const r = await runAgentAction(a.id);
        if (r.ok) {
          toast.ok(`${a.name} is running · drafts land in your inbox`, { key: `run:${a.id}` });
          router.refresh();
        } else toast.error(r.error);
      },
    });
    if (page === "run") {
      return [{ name: "Run an agent", items: agents.filter((a) => match(a.name)).map((a) => runCmd(a, a.name)) }].filter((g) => g.items.length);
    }
    if (page === "clear") {
      return [
        {
          name: "Clear sample data?",
          items: [
            {
              id: "clear:yes",
              label: "Clear sample data",
              hint: "Removes sample signals and what was built from them",
              icon: Trash2,
              danger: true,
              run: async () => {
                const r = await clearSampleAction();
                if (!r.ok) return void toast.error(r.error, { key: "sample" });
                const d = r.data!;
                toast.ok(`Cleared ${plural(d.signals, "sample signal")}${d.drafts ? ` and ${plural(d.drafts, "draft")}` : ""}`, { key: "sample" });
                router.refresh();
              },
            },
            { id: "clear:no", label: "Keep it", icon: ArrowLeft, keepOpen: true, run: () => { setPage("root"); setQ(""); setI(0); } },
          ],
        },
      ];
    }
    const out: Group[] = [];
    if (draft) {
      const items: Cmd[] = [
        { id: "draft:approve", label: "Approve", hint: "A", icon: Check, run: draft.approve },
        { id: "draft:edit", label: "Edit", hint: "E", icon: Pencil, run: draft.edit },
        { id: "draft:reject", label: "Reject with a reason", hint: "R", icon: X, run: draft.reject },
        { id: "draft:copy", label: "Copy text", icon: Copy, run: draft.copy },
      ].filter((c) => match(c.label));
      out.push({ name: "This draft", items });
    }
    const actions: Cmd[] = [
      { id: "add", label: "Add signals", hint: "Paste notes or upload a CSV", icon: Plus, run: () => {
          window.dispatchEvent(new Event("me:add-signals")); // opens the sheet if we're already on Signals
          if (!window.location.pathname.endsWith("/signals")) go("/signals?add=1");
        } },
      ...(agents.length
        ? [{ id: "run", label: "Run an agent…", hint: `${agents.length} agents`, icon: Play, keepOpen: true, chevron: true, run: () => { setPage("run"); setQ(""); setI(0); } }]
        : []),
      ...(ctx?.canManage && !ctx.hasSample
        ? [{ id: "sample:load", label: "Load sample data", hint: "Dispatchly, a made-up HVAC company", icon: Database, run: async () => {
              const r = await loadDemoAction();
              if (!r.ok) return void toast.error(r.error, { key: "sample" });
              toast.ok("Loaded sample data from Dispatchly", { key: "sample" });
              router.refresh();
            } }]
        : []),
      ...(ctx?.canManage && ctx.hasSample
        ? [{ id: "sample:clear", label: "Clear sample data…", icon: Trash2, keepOpen: true, chevron: true, run: () => { setPage("clear"); setQ(""); setI(0); } }]
        : []),
      { id: "shortcuts", label: "Keyboard shortcuts", keys: ["?"], icon: Keyboard, run: () => setTimeout(openShortcuts, 0) },
    ].filter((c) => match(c.label));
    // Typing an agent's name at the top level still finds "Run X" directly.
    if (term) actions.push(...agents.filter((a) => match(`Run ${a.name}`)).map((a) => runCmd(a, `Run ${a.name}`)));
    const nav: Cmd[] = NAV_ITEMS.filter((n) => match(n.label) || (term.length > 2 && match(`Go to ${n.label}`))).map((n) => {
      const chord = GO_CHORDS.find((c) => c.href === n.href);
      return { id: `nav:${n.href}`, label: n.label, keys: chord ? ["G", chord.key] : undefined, icon: n.icon, run: () => go(n.href) };
    });
    const data = term && res ? res.data : null; // keep the last results on screen while the next search runs
    out.push({ name: "Actions", items: actions });
    if (term && data) {
      out.push({
        name: "Drafts",
        items: data.drafts.map((d) => ({
          id: `d:${d.id}`,
          label: d.title,
          snippet: d.snippet ?? undefined,
          hint: STATUS[d.status] ?? d.status,
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
            run: () => go(`/signals?id=${s.id}`),
          };
        }),
      });
      out.push({
        name: "Experiments",
        items: data.experiments.map((x) => ({ id: `x:${x.id}`, label: x.name, hint: STATUS[x.status] ?? x.status, icon: FlaskConical, run: () => go("/s/creative") })),
      });
      out.push({ name: "Docs", items: data.docs.map((d) => ({ id: `m:${d.key}`, label: d.title, hint: d.folder, icon: FileText, run: () => go(`/memory?doc=${encodeURIComponent(d.key)}`) })) });
      nav.push(...data.agents.map((a) => ({ id: `a:${a.id}`, label: a.name, hint: "Agent", icon: Bot, run: () => go(`/agents/${a.id}`) })));
    }
    out.push({ name: "Go to", items: nav });
    return out.filter((g) => g.items.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, term, res, base, page, draft, ctx]);

  const flat = groups.flatMap((g) => g.items);
  const sel = Math.min(i, Math.max(flat.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const choose = (c: Cmd | undefined) => {
    if (!c) return;
    if (!c.keepOpen) setOpen(false);
    c.run();
  };

  const sheet = <ShortcutsSheet />;
  if (!open || typeof document === "undefined") return <>{sheet}</>;
  let idx = -1;
  const searching = loading && (!res || res.q !== term);
  return (<>{sheet}{createPortal(
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
          {page !== "root" ? (
            <button
              type="button"
              onClick={() => { setPage("root"); setQ(""); setI(0); input.current?.focus(); }}
              className="-ml-1 flex h-7 shrink-0 items-center gap-1 rounded-md bg-subtle px-2 text-[12.5px] font-medium text-ink-2 hover:text-ink"
              aria-label="Back to all commands"
            >
              <ArrowLeft size={13} /> {page === "run" ? "Run" : "Back"}
            </button>
          ) : searching ? <LoaderCircle size={16} className="shrink-0 animate-spin text-ink-3 motion-reduce:animate-none" /> : <Search size={16} className="shrink-0 text-ink-3" />}
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
              } else if (e.key === "Backspace" && !q && page !== "root") {
                e.preventDefault();
                setPage("root");
                setI(0);
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(flat[sel]);
              }
            }}
            placeholder={page === "run" ? "Which agent?" : page === "clear" ? "Clear the sample data?" : "Search drafts, signals, experiments, or type a command…"}
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
                      className={cx(
                        "flex cursor-pointer items-center gap-3 rounded-lg px-3 text-sm",
                        c.snippet ? "min-h-10 py-2" : "h-10",
                        me === sel ? "bg-subtle text-ink" : "text-ink-2",
                        c.danger && "text-danger",
                      )}
                    >
                      <c.icon size={15} className={cx("shrink-0", c.snippet && "mt-0.5 self-start", c.danger ? "text-danger" : "text-ink-3")} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{term && !c.id.startsWith("nav:") ? <Hl text={c.label} term={term} /> : c.label}</span>
                        {c.snippet ? (
                          <span className="mt-0.5 block truncate text-[12.5px] text-ink-3">
                            <Hl text={c.snippet} term={term} />
                          </span>
                        ) : null}
                      </span>
                      {c.hint ? <span className={cx("max-w-[40%] shrink-0 truncate text-xs text-ink-3", c.snippet && "self-start pt-0.5")}>{c.hint}</span> : null}
                      {c.keys ? (
                        <span className="flex shrink-0 gap-0.5" aria-label={`Shortcut ${c.keys.join(" then ")}`}>
                          {c.keys.map((k) => (
                            <Kbd key={k}>{k}</Kbd>
                          ))}
                        </span>
                      ) : null}
                      {c.chevron ? <ChevronRight size={14} className="-mr-1 shrink-0 text-ink-3" /> : null}
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
  )}</>);
}

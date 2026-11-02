"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Plus, Search } from "lucide-react";
import { NAV_ITEMS, useBase } from "./nav";
import { runAgentAction } from "@/app/(app)/actions";
import { toast } from "./toast";
import { cx, Kbd } from "./ui";

type Cmd = { id: string; label: string; hint?: string; icon: React.ComponentType<{ size?: number; className?: string }>; run: () => void };

export function CommandPalette({ agents }: { agents: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const router = useRouter();
  const base = useBase();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
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
      setQ("");
      setI(0);
      setTimeout(() => input.current?.focus(), 10);
    }
  }, [open]);

  const cmds: Cmd[] = useMemo(
    () => [
      { id: "add", label: "Add signals", hint: "Paste call notes, tickets, reviews", icon: Plus, run: () => router.push(`${base}/signals?add=1`) },
      ...NAV_ITEMS.map((n) => ({ id: n.href, label: n.label, hint: "Go to", icon: n.icon, run: () => router.push(base + n.href) })),
      ...agents.map((a) => ({
        id: `run:${a.id}`,
        label: `Run ${a.name}`,
        hint: "Agent",
        icon: Play,
        run: async () => {
          const r = await runAgentAction(a.id);
          if (r.ok) toast.ok(`${a.name} is working. Results land in your inbox.`);
          else toast.error(r.error);
        },
      })),
    ],
    [agents, router, base],
  );
  const list = cmds.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())).slice(0, 12);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-4 pt-[14vh] backdrop-blur-[2px]" onMouseDown={() => setOpen(false)}>
      <div role="dialog" aria-label="Command menu" className="animate-in w-full max-w-lg overflow-hidden rounded-2xl bg-surface shadow-pop ring-1 ring-line" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={16} className="text-ink-3" />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setI(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setI((x) => Math.min(x + 1, list.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setI((x) => Math.max(x - 1, 0));
              } else if (e.key === "Enter" && list[i]) {
                list[i].run();
                setOpen(false);
              }
            }}
            placeholder="Search or jump to…"
            className="h-12 w-full bg-transparent text-[15px] outline-none placeholder:text-ink-3"
          />
          <Kbd>esc</Kbd>
        </div>
        <ul className="max-h-[360px] overflow-y-auto p-1.5" role="listbox">
          {list.map((c, idx) => (
            <li key={c.id} role="option" aria-selected={idx === i}>
              <button
                onMouseEnter={() => setI(idx)}
                onClick={() => {
                  c.run();
                  setOpen(false);
                }}
                className={cx("flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm", idx === i ? "bg-subtle text-ink" : "text-ink-2")}
              >
                <c.icon size={15} className="text-ink-3" />
                <span className="flex-1 truncate">{c.label}</span>
                {c.hint ? <span className="text-xs text-ink-3">{c.hint}</span> : null}
              </button>
            </li>
          ))}
          {!list.length ? <li className="px-3 py-6 text-center text-sm text-ink-3">Nothing matches.</li> : null}
        </ul>
      </div>
    </div>
  );
}

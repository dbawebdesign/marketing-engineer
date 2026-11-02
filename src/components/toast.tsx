"use client";
import { useEffect, useRef, useState } from "react";
import { CircleCheck, CircleX } from "lucide-react";

type Action = { label: string; run: () => void };
/** `key` names what a toast is about: a new toast with the same key replaces the old one. Defaults to the text. */
type Opts = { action?: Action; duration?: number; key?: string };
type T = { id: number; key: string; text: string; tone: "ok" | "error"; action?: Action; duration: number };

let push: ((t: Omit<T, "id">) => void) | null = null;
let drop: ((key: string) => void) | null = null;
export const toast = {
  ok: (text: string, opts: Opts = {}) => push?.({ key: opts.key ?? text, text, tone: "ok", action: opts.action, duration: opts.duration ?? (opts.action ? 6000 : 3200) }),
  error: (text: string, opts: Opts = {}) => push?.({ key: opts.key ?? text, text, tone: "error", action: opts.action, duration: opts.duration ?? 6000 }),
  dismiss: (key: string) => drop?.(key),
};

/** At most this many toasts on screen; the oldest goes first. */
const MAX_VISIBLE = 2;

const isTyping = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  if (!t) return false;
  if (t.isContentEditable || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return true;
  return t.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes((t as HTMLInputElement).type);
};

export function Toaster() {
  const [items, setItems] = useState<T[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = (id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setItems((xs) => xs.filter((x) => x.id !== id));
  };

  useEffect(() => {
    let n = 0;
    const clear = (gone: T[]) =>
      gone.forEach((x) => {
        clearTimeout(timers.current.get(x.id));
        timers.current.delete(x.id);
      });
    push = (t) => {
      const id = ++n;
      setItems((xs) => {
        const kept = xs.filter((x) => x.key !== t.key);
        const next = [...kept, { ...t, id }];
        const over = next.slice(0, Math.max(next.length - MAX_VISIBLE, 0));
        clear([...xs.filter((x) => x.key === t.key), ...over]);
        return next.slice(-MAX_VISIBLE);
      });
      timers.current.set(id, setTimeout(() => dismiss(id), t.duration));
    };
    drop = (key) =>
      setItems((xs) => {
        clear(xs.filter((x) => x.key === key));
        return xs.filter((x) => x.key !== key);
      });
    const all = timers.current;
    return () => {
      push = null;
      drop = null;
      all.forEach(clearTimeout);
    };
  }, []);

  // ⌘Z / Ctrl+Z runs the newest Undo while it's on screen (never another kind of action).
  const latest = [...items].reverse().find((t) => t.action && /^undo$/i.test(t.action.label));
  useEffect(() => {
    if (!latest?.action) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== "z" || isTyping(e.target)) return;
      e.preventDefault();
      latest.action!.run();
      dismiss(latest.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [latest]);

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+76px)] z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-5 lg:items-start lg:px-5">
      {items.map((t) => (
        <div key={t.id} role={t.tone === "error" ? "alert" : "status"} className="animate-in flex max-w-full items-center gap-2 rounded-xl bg-ink py-2 pl-3.5 pr-2 text-sm text-bg shadow-pop">
          {t.tone === "ok" ? <CircleCheck size={15} className="shrink-0 text-accent" /> : <CircleX size={15} className="shrink-0 text-danger" />}
          <span className={t.action ? "min-w-0 truncate" : "min-w-0 pr-1.5"}>{t.text}</span>
          {t.action ? (
            <button
              type="button"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
              className="pointer-events-auto ml-1 h-7 shrink-0 rounded-md px-2.5 text-[13px] font-medium text-bg/90 ring-1 ring-bg/20 transition-colors hover:bg-bg/10 hover:text-bg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bg/50"
            >
              {t.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

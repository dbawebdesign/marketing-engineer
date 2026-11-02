"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Kbd, cx } from "./ui";
import { useBase } from "./nav";

/** What ⌘Z can actually take back (matches UNDOABLE_TYPES and the two-minute window on the server). */
const UNDO = "Undo the last approve or reject";
const HINT: Record<string, string> = {
  [UNDO]: "Posts, emails and answer packs, within 2 minutes. Memos, briefs and test batches are final.",
};

/** What the command palette can do to the draft open in the inbox right now. */
export type DraftCommands = { title: string; approve: () => void; edit: () => void; reject: () => void; copy: () => void };
let current: DraftCommands | null = null;
export const draftCommands = {
  /** Register; returns an unregister that only clears its own entry (an outgoing pane may unmount after the next one mounts). */
  set: (c: DraftCommands) => {
    current = c;
    return () => void (current === c && (current = null));
  },
  get: () => current,
};

const isTyping = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  if (!t || !t.tagName) return false;
  if (t.isContentEditable || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return true;
  return t.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes((t as HTMLInputElement).type);
};

/** G, then a letter: jump to a page. Shown in the palette and the shortcuts sheet. */
export const GO_CHORDS: { key: string; href: string; label: string }[] = [
  { key: "T", href: "/today", label: "Today" },
  { key: "I", href: "/inbox", label: "Inbox" },
  { key: "S", href: "/signals", label: "Signals" },
  { key: "M", href: "/memory", label: "Memory" },
  { key: "A", href: "/agents", label: "Agents" },
];
const CHORD_MS = 1200;

/** G-then-letter navigation, anywhere outside text fields and dialogs. Runs in the capture phase so the second key never reaches page shortcuts (A would approve). */
function useGoChords() {
  const router = useRouter();
  const base = useBase();
  useEffect(() => {
    let armed = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTyping(e.target) || document.querySelector('[aria-modal="true"]')) {
        armed = 0;
        return;
      }
      const k = e.key.toLowerCase();
      if (armed && Date.now() - armed < CHORD_MS) {
        armed = 0;
        const hit = GO_CHORDS.find((c) => c.key.toLowerCase() === k);
        if (!hit) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        router.push(base + hit.href);
        return;
      }
      armed = k === "g" && !e.shiftKey ? Date.now() : 0;
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [router, base]);
}

export const openShortcuts = () => window.dispatchEvent(new Event("me:shortcuts"));

/** `?` anywhere (outside text fields) opens a small sheet of keyboard shortcuts. */
export function ShortcutsSheet() {
  const [open, setOpen] = useState(false);
  const [mod, setMod] = useState("⌘");
  const panel = useRef<HTMLDivElement>(null);
  useGoChords();

  useEffect(() => {
    if (!/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)) setMod("Ctrl");
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector('[aria-modal="true"]:not([data-shortcuts])')) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("me:shortcuts", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("me:shortcuts", onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => panel.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  const groups: { name: string; rows: [React.ReactNode, string][] }[] = [
    {
      name: "Inbox",
      rows: [
        [<><Kbd>J</Kbd><Kbd>K</Kbd></>, "Next / previous draft"],
        [<Kbd key="a">A</Kbd>, "Approve"],
        [<Kbd key="e">E</Kbd>, "Edit"],
        [<Kbd key="r">R</Kbd>, "Reject with a reason"],
        [<Kbd key="m">{mod}↵</Kbd>, "Approve edit / confirm reject"],
        [<Kbd key="esc">esc</Kbd>, "Cancel (asks before discarding edits)"],
      ],
    },
    {
      name: "Go to",
      rows: GO_CHORDS.map((c) => [<><Kbd>G</Kbd><Kbd>{c.key}</Kbd></>, c.label] as [React.ReactNode, string]),
    },
    {
      name: "Anywhere",
      rows: [
        [<Kbd key="z">{mod}Z</Kbd>, UNDO],
        [<Kbd key="k">{mod}K</Kbd>, "Search and commands"],
        [<Kbd key="q">?</Kbd>, "This sheet"],
      ],
    },
  ];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 px-4 pt-[14vh] backdrop-blur-[2px]" onMouseDown={() => setOpen(false)}>
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        data-shortcuts
        aria-label="Keyboard shortcuts"
        className="animate-in w-full max-w-[380px] rounded-2xl bg-surface p-2 shadow-pop ring-1 ring-line"
        // The container takes focus so Esc and Tab work, but it isn't a control: no ring on it.
        // Inline because the global :focus-visible rule sits outside Tailwind's layers and beats utilities.
        style={{ outline: "none" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3 pb-1 pt-2">
          <h2 className="text-[14px] font-semibold tracking-tight">Keyboard shortcuts</h2>
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="grid size-7 place-items-center rounded-md text-ink-3 hover:bg-subtle hover:text-ink focus-visible:bg-subtle">
            <X size={14} />
          </button>
        </div>
        {groups.map((g) => (
          <section key={g.name} className="px-3 pb-2 pt-2">
            <h3 className="mb-1 text-[12px] font-medium text-ink-3">{g.name}</h3>
            <dl>
              {g.rows.map(([keys, label]) => (
                <div key={label} className={cx("flex items-center justify-between gap-4 text-[13.5px]", HINT[label] ? "py-1.5" : "h-8")}>
                  <dt className="text-ink-2">
                    {label}
                    {HINT[label] ? <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">{HINT[label]}</span> : null}
                  </dt>
                  <dd className="flex shrink-0 gap-1">{keys}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>,
    document.body,
  );
}

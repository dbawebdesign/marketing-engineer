"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, ChevronDown, Copy, Cpu, FlaskConical, Info, Pencil, X } from "lucide-react";
import { reviewAction } from "@/app/(app)/actions";
import { undoReviewAction } from "@/app/(app)/actions-extra";
import { Badge, Button, Kbd, Textarea, cx, plural, timeAgo } from "./ui";
import { AutoTextarea } from "./auto-textarea";
import { Markdown } from "./markdown";
import { DraftMetaRow } from "./draft-meta";
import { draftCommands } from "./shortcuts";
import { L } from "./nav";
import { toast } from "./toast";
import { useBase } from "./nav";
import { emitEmbed } from "./embed-bridge";
import { SignalSheet } from "./signal-sheet";
import { sourceLabel } from "@/lib/signal-sources";
import { dedupeReceipts } from "@/lib/receipts";
import { withoutTitleH1 } from "@/lib/draft-body";
import type { FinalNote } from "@/lib/approval-notes";

export type ReviewDraft = {
  id: string;
  title: string;
  body: string;
  status: string;
  system_label: string;
  agent_name: string | null;
  created_at: string;
  feedback: string | null;
  /** Approvals of this type have no side effect, so they can be undone for a moment. */
  undoable: boolean;
  /** Where an approval's effect shows up, e.g. "/s/truth". */
  effect_href: string;
  /** What approving does that can't be taken back. Null when the review can be undone. */
  final?: FinalNote | null;
  /** Written by the offline engine because no AI provider is configured. */
  offline?: boolean;
  /** Set when this downstream draft was written while a market memo still waits for review. */
  pending_memo_id?: string | null;
  evidence: Receipt[];
  /** Quiet facts about the draft (platform, account, fit…), shown as one row under the title. */
  meta?: { label: string; value: string }[];
  agent_id: string | null;
  /** Built from sample data (server-side `is_sample`). */
  sample?: boolean;
  /** A social post's platform, for the editor's length guide. */
  platform?: "x" | "linkedin" | null;
};

type Receipt = { signal_id: string; quote: string; source?: string; url?: string | null; account?: string | null; occurred_at?: string };

/* ------------------------------------------------------------------ undo */

/**
 * The last undoable decision made on this page, kept for the life of the tab so ⌘Z
 * still works after its toast is gone. The server enforces the real window.
 */
const UNDO_WINDOW_MS = 115_000;
let lastDecision: { id: string; at: number; scope: string } | null = null;
/** The last decision ⌘Z can't take back, so the shortcut can say why instead of doing nothing. */
let lastFinal: { at: number; why: string } | null = null;

async function undoDecision(router: ReturnType<typeof useRouter>, base: string) {
  const d = lastDecision;
  if (!d) return;
  lastDecision = null;
  const u = await undoReviewAction(d.id);
  if (!u.ok) return void toast.error(u.error, { key: "review" });
  toast.ok("Back in your queue", { key: "review" });
  router.push(`${base}/inbox?${d.scope}d=${d.id}`, { scroll: false });
  router.refresh();
}

/** ⌘Z / Ctrl+Z takes back the last approve or reject, while the server still allows it. */
export function UndoShortcut() {
  const router = useRouter();
  const base = useBase();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "z" || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.defaultPrevented || isTypingTarget(e.target) || overlayOpen()) return;
      e.preventDefault();
      if (!lastDecision) {
        const why = lastFinal && Date.now() - lastFinal.at < UNDO_WINDOW_MS ? lastFinal.why : "Nothing to undo";
        return void toast.ok(why, { key: "review" });
      }
      if (Date.now() - lastDecision.at > UNDO_WINDOW_MS) {
        lastDecision = null;
        return void toast.error("Too late to undo. Reviews can be undone for two minutes.", { key: "review" });
      }
      void undoDecision(router, base);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, base]);
  return null;
}

/** Why ⌘Z can't take this decision back, in one sentence. */
function finalWhy(d: ReviewDraft, decision: "approve" | "reject") {
  if (decision === "reject") return "This rejection can't be undone from here";
  if (d.final) return d.final.why;
  return "This approval can't be undone from here";
}

export type RecentReason = { text: string; isRule: boolean };

/** True when keystrokes belong to a text field, not to page shortcuts. */
export function isTypingTarget(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  if (!t || !t.tagName) return false;
  if (t.isContentEditable || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return true;
  return t.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes((t as HTMLInputElement).type);
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.ok("Copied", { key: "copy" });
  } catch {
    toast.error("Couldn't copy. Select the text and copy it instead.", { key: "copy" });
  }
}

/** Shortcuts are off while a dialog (command palette, sheet) is open on top of the page. */
export const overlayOpen = () => !!document.querySelector('[aria-modal="true"]');

function useModKey() {
  const [mod, setMod] = useState("⌘");
  useEffect(() => {
    if (!/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)) setMod("Ctrl");
  }, []);
  return mod;
}

/** What the inbox can ask of the open pane: handle a key, or leave (asking first if there are unsaved edits). */
export type PaneApi = { key: (e: KeyboardEvent) => void; leave: (then: () => void) => void };
export type PaneSnapshot = { mode: "view" | "edit" | "reject"; body: string; feedback: string };

export function ReviewPane({
  draft,
  reasons = [],
  scopeQuery = "",
  api,
  advance,
  restore,
  initial,
}: {
  draft: ReviewDraft;
  reasons?: RecentReason[];
  /** Just the filter part, for coming back to the pending queue. */
  scopeQuery?: string;
  /** The inbox reads keys through this, so a key pressed right after J lands on the new draft. */
  api: React.MutableRefObject<PaneApi | null>;
  /** Move on optimistically after a decision. False when there's nothing to move on to. */
  advance: () => boolean;
  /** The decision failed after moving on: bring this draft back, as it was. */
  restore: (id: string, snap: PaneSnapshot) => void;
  /** State to come back to after a failed decision. */
  initial?: PaneSnapshot | null;
}) {
  const router = useRouter();
  const base = useBase();
  const mod = useModKey();
  const [mode, setMode] = useState<"view" | "edit" | "reject">(initial?.mode ?? "view");
  const [preview, setPreview] = useState(false);
  const [body, setBody] = useState(initial?.body ?? draft.body);
  const [feedback, setFeedback] = useState(initial?.feedback ?? "");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  /** "Discard edits?" is showing; `then` runs if the person confirms. */
  const [confirm, setConfirm] = useState<{ then: () => void } | null>(null);
  const [sheet, setSheet] = useState<Receipt | null>(null);
  const focusField = () => document.querySelector<HTMLTextAreaElement>("[data-review-field]")?.focus();
  const editable = draft.status === "pending";
  const agent = draft.agent_name ?? "this agent";
  const fb = feedback.trim();
  const alreadyRule = reasons.some((r) => r.isRule && r.text === fb);
  const teach = remember && !alreadyRule && !!fb;
  const canReject = !busy && (!remember || alreadyRule || !!fb);
  const dirty = (mode === "edit" && body !== draft.body) || (mode === "reject" && !!fb);
  const receipts = useMemo(() => dedupeReceipts(draft.evidence), [draft.evidence]);
  const openReceipt = useCallback((i: number) => setSheet(receipts[i] ?? null), [receipts]);
  const rendered = useMemo(
    () => (
      <Markdown cacheKey={`draft:${draft.id}`} receipts={receipts} onReceipt={openReceipt}>
        {withoutTitleH1(body, draft.title)}
      </Markdown>
    ),
    [body, draft.id, draft.title, receipts, openReceipt],
  );

  const decide = (decision: "approve" | "reject") => {
    if (busy) return;
    if (decision === "reject" && !canReject) return;
    const snap: PaneSnapshot = { mode, body, feedback };
    const input = { decision, feedback: fb || undefined, remember: decision === "reject" && teach, body: body !== draft.body ? body : undefined };
    const d = draft;
    // Move on now; the server catches up. If it refuses, the draft comes back as it was.
    const moved = advance();
    if (!moved) setBusy(true);
    void (async () => {
      const r = await reviewAction(d.id, input);
      if (!r.ok) {
        setBusy(false);
        if (moved) restore(d.id, snap);
        return void toast.error(r.error, { key: "review" });
      }
      emitEmbed(decision === "approve" ? "draft.approved" : "draft.rejected", { id: d.id, title: d.title });
      // One line, same shape every time: the decision, then what happened because of it.
      const effect = r.data?.effect?.replace(/\.$/, "");
      const text =
        decision === "approve"
          ? effect ? `Approved · ${effect}` : `Approved · saved to ${d.system_label}`
          : input.remember ? `Rejected · ${agent} will remember why` : "Rejected";
      lastDecision = d.undoable ? { id: d.id, at: Date.now(), scope: scopeQuery } : null;
      lastFinal = d.undoable ? null : { at: Date.now(), why: finalWhy(d, decision) };
      // Undo when the review can be taken back; otherwise a way to see where the approval went.
      toast.ok(text, {
        key: "review",
        action: d.undoable
          ? { label: "Undo", run: () => undoDecision(router, base) }
          : decision === "approve"
            ? { label: "View", run: () => router.push(base + d.effect_href) }
            : undefined,
      });
      if (!moved) router.push(`${base}/inbox?${scopeQuery}done=${d.id}`, { scroll: false });
      router.refresh();
    })();
  };

  const cancel = () => {
    setConfirm(null);
    if (mode === "edit") setBody(draft.body);
    if (mode === "reject") setFeedback("");
    setMode("view");
  };
  /** Leave edit or reject mode, asking first when there's text that would be lost. */
  const guard = (then: () => void) => {
    if (dirty) setConfirm({ then });
    else then();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || overlayOpen()) return;
    if (confirm) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const then = confirm.then;
        cancel();
        then();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setConfirm(null);
        requestAnimationFrame(focusField);
      }
      return;
    }
    if (!editable) return;
    if (e.key === "Escape" && mode !== "view") {
      e.preventDefault();
      guard(cancel);
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && mode !== "view") {
      e.preventDefault();
      decide(mode === "reject" ? "reject" : "approve");
      return;
    }
    if (mode !== "view" || isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "a") {
      e.preventDefault();
      decide("approve");
    } else if (k === "r" || k === "e") {
      // preventDefault stops the letter from landing in the field we're about to focus.
      e.preventDefault();
      setMode(k === "r" ? "reject" : "edit");
    }
  };
  // Registered at commit (layout), so the very next keystroke after J reaches this draft.
  const latest = useRef({ onKey, guard });
  latest.current = { onKey, guard };
  useLayoutEffect(() => {
    const mine: PaneApi = { key: (e) => latest.current.onKey(e), leave: (then) => latest.current.guard(then) };
    api.current = mine;
    return () => {
      if (api.current === mine) api.current = null;
    };
  }, [api]);

  useEffect(() => {
    if (mode !== "view" && !preview) requestAnimationFrame(focusField);
  }, [mode, preview]);

  // Typing again answers "Discard edits?" with "no".
  useEffect(() => setConfirm(null), [body, feedback]);

  // Let the command palette act on this draft ("This draft" group).
  const cmds = useRef({ decide, setMode, body });
  cmds.current = { decide, setMode, body };
  useEffect(() => {
    if (!editable) return;
    return draftCommands.set({
      title: draft.title,
      approve: () => cmds.current.decide("approve"),
      edit: () => cmds.current.setMode("edit"),
      reject: () => cmds.current.setMode("reject"),
      copy: () => void copyText(cmds.current.body),
    });
  }, [editable, draft.id, draft.title]);

  return (
    <article data-review-pane={draft.id}>
      <header className="mb-5 max-w-[68ch]">
        <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-ink-3">
          <span className="text-ink-2">{draft.system_label}</span>
          <span aria-hidden>·</span>
          <span>{draft.agent_name ?? "Agent"}</span>
          <span aria-hidden>·</span>
          <time dateTime={draft.created_at} title={new Date(draft.created_at).toLocaleString()}>{timeAgo(draft.created_at)}</time>
        </p>
        <h2 className="mt-1.5 text-[21px] font-semibold leading-snug tracking-[-0.015em] text-pretty">{draft.title}</h2>
        <DraftMetaRow meta={draft.meta} className="mt-2" />
        {draft.sample || draft.offline ? (
          <p className="mt-2 flex items-start gap-1.5 text-[13px] leading-snug text-ink-3" data-sample-note={draft.sample || undefined} data-offline-note={draft.offline || undefined}>
            {draft.sample ? <FlaskConical size={13} aria-hidden className="mt-[3px] shrink-0" /> : <Cpu size={13} aria-hidden className="mt-[3px] shrink-0" />}
            <span className="min-w-0">
              {draft.sample ? (draft.offline ? "Sample data (Dispatchly, a made-up HVAC company)" : "Built from sample data — Dispatchly, a made-up HVAC company") : null}
              {draft.sample && draft.offline ? <span aria-hidden> · </span> : null}
              {draft.offline ? (
                <>
                  Written by the offline engine <span aria-hidden>·</span>{" "}
                  <L href="/settings" className="text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink">
                    Connect Claude in Settings
                  </L>{" "}
                  for deeper drafts
                </>
              ) : null}
            </span>
          </p>
        ) : null}
        {draft.pending_memo_id && editable ? (
          <p className="mt-2 flex items-start gap-1.5 text-[13px] leading-snug text-ink-3">
            <Info size={13} className="mt-[3px] shrink-0" />
            <span className="min-w-0">
              This week&rsquo;s market memo is still waiting for review.{" "}
              <L href={`/inbox?d=${draft.pending_memo_id}`} scroll={false} className="whitespace-nowrap text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink">
                Review memo
              </L>
            </span>
          </p>
        ) : null}
        {draft.status !== "pending" ? (
          <div className="mt-2 flex items-center gap-2">
            <Badge tone={draft.status === "rejected" ? "danger" : "accent"}>{draft.status}</Badge>
            {draft.feedback ? <span className="text-sm text-ink-2">“{draft.feedback}”</span> : null}
          </div>
        ) : null}
      </header>

      {mode === "edit" ? (
        <div data-review-editing className="overflow-hidden rounded-xl bg-surface ring-1 ring-line focus-within:ring-2 focus-within:ring-accent">
          <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-1.5">
            <div role="tablist" aria-label="Editor view" className="flex rounded-md bg-subtle p-0.5 text-[12.5px]">
              {(["Write", "Preview"] as const).map((t) => {
                const on = (t === "Preview") === preview;
                return (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setPreview(t === "Preview")}
                    className={cx("rounded px-2.5 py-1", on ? "bg-surface font-medium text-ink shadow-soft" : "text-ink-3 hover:text-ink")}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
            {draft.platform ? <LengthGuide platform={draft.platform} text={body} /> : <span className="hidden text-xs text-ink-3 sm:inline">Markdown works: **bold**, - lists, # headings</span>}
          </div>
          {preview ? (
            <div className="min-h-[240px] p-5 sm:p-6">
              <div className="max-w-[68ch]">
                <Markdown>{body}</Markdown>
              </div>
            </div>
          ) : (
            <AutoTextarea
              bare
              data-review-field
              aria-label="Edit draft"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              spellCheck
              className="min-h-[240px] px-5 py-4 text-[15px] leading-[1.7] sm:px-6 sm:py-5"
            />
          )}
        </div>
      ) : (
        <div className="rounded-xl bg-surface px-5 py-5 ring-1 ring-line sm:px-7 sm:py-6">
          <div className="max-w-[68ch]">{rendered}</div>
        </div>
      )}

      {/* Receipts sit with the content, above the sticky bar, so the bar never covers them. */}
      <Receipts list={receipts} onOpen={setSheet} />

      {editable ? (
        <div data-review-actions className="sticky bottom-[calc(57px+env(safe-area-inset-bottom))] z-10 -mx-1 mt-5 border-t border-line bg-bg/85 px-1 py-3.5 backdrop-blur-md supports-[backdrop-filter]:bg-bg/75 md:bottom-0">
          {confirm ? (
            <div role="alertdialog" aria-label="Discard edits?" data-discard-confirm className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-[14px] font-medium text-ink">Discard edits?</span>
              <Button
                variant="danger"
                onClick={() => {
                  const then = confirm.then;
                  cancel();
                  then();
                }}
              >
                Discard <Kbd>↵</Kbd>
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setConfirm(null);
                  focusField();
                }}
              >
                Keep editing <Kbd>esc</Kbd>
              </Button>
            </div>
          ) : mode === "reject" ? (
            <div className="space-y-3">
              <label htmlFor="reject-reason" className="block text-[13px] font-medium text-ink-2">
                {remember && !alreadyRule ? (
                  <>
                    Why is this wrong? <span className="font-normal text-ink-3">This becomes a rule for {agent}.</span>
                  </>
                ) : (
                  "Why are you rejecting it?"
                )}
              </label>
              <Textarea
                id="reject-reason"
                data-review-field
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={3}
                placeholder={"e.g. Don't open with a question. Lead with the dollar figure from the call."}
              />
              {reasons.length ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-0.5 text-xs text-ink-3">Recent</span>
                  {reasons.map((r) => (
                    <button
                      key={r.text}
                      type="button"
                      title={r.text}
                      aria-pressed={fb === r.text}
                      onClick={() => {
                        setFeedback(r.text);
                        focusField();
                      }}
                      className={cx(
                        "h-7 max-w-[260px] truncate rounded-md px-2.5 text-[12.5px] transition-colors",
                        fb === r.text ? "bg-ink text-bg" : "bg-surface text-ink-2 ring-1 ring-line-strong hover:text-ink",
                      )}
                    >
                      {r.text}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3">
                {alreadyRule ? (
                  <span className="flex items-center gap-2 text-sm text-ink-3">
                    <Check size={14} className="text-accent" /> Already a rule for {agent}
                  </span>
                ) : (
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
                    <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 accent-[var(--accent)]" />
                    Teach {agent} this rule
                  </label>
                )}
                <div className="ml-auto flex gap-2">
                  <Button variant="ghost" onClick={() => guard(cancel)}>
                    Cancel <Kbd>esc</Kbd>
                  </Button>
                  <Button variant="danger" disabled={!canReject} onClick={() => decide("reject")}>
                    <X size={14} /> Reject <span className="hidden sm:inline-flex"><Kbd>{mod}↵</Kbd></span>
                  </Button>
                </div>
              </div>
            </div>
          ) : mode === "edit" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" disabled={busy} onClick={() => decide("approve")}>
                <Check size={14} /> Approve edit <span className="hidden sm:inline-flex"><Kbd>{mod}↵</Kbd></span>
              </Button>
              <Button variant="ghost" onClick={() => guard(cancel)}>
                Discard edit <Kbd>esc</Kbd>
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                disabled={busy}
                aria-busy={busy}
                onClick={() => decide("approve")}
                title={draft.final ? `${draft.final.note}. This can\u2019t be undone from here.` : undefined}
                aria-describedby={draft.final ? "approve-effect" : undefined}
              >
                <Check size={14} /> Approve <span className="hidden sm:inline-flex"><Kbd>A</Kbd></span>
              </Button>
              <Button variant="secondary" onClick={() => setMode("edit")}>
                <Pencil size={13} /> Edit <span className="hidden sm:inline-flex"><Kbd>E</Kbd></span>
              </Button>
              <Button variant="secondary" onClick={() => setMode("reject")}>
                <X size={14} /> Reject <span className="hidden sm:inline-flex"><Kbd>R</Kbd></span>
              </Button>
              <Button variant="ghost" className="ml-auto" aria-label="Copy draft" onClick={() => copyText(body)}>
                <Copy size={13} /> <span className="hidden sm:inline">Copy</span>
              </Button>
              {draft.final ? (
                <p id="approve-effect" data-approve-effect className="basis-full text-[12.5px] text-ink-3">
                  {draft.final.note} &middot; can&rsquo;t be undone
                </p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {sheet ? <SignalSheet id={sheet.signal_id} quote={sheet.quote} onClose={() => setSheet(null)} /> : null}
    </article>
  );
}

const LIMITS = { x: { max: 280, soft: false, name: "X" }, linkedin: { max: 1300, soft: true, name: "LinkedIn" } } as const;

/** Live length for a social post: X is a hard 280; LinkedIn's ~1,300 is where "see more" cuts in. */
function LengthGuide({ platform, text }: { platform: "x" | "linkedin"; text: string }) {
  const { max, soft, name } = LIMITS[platform];
  const n = [...text.trim()].length;
  const over = n > max;
  const near = !over && n > max * 0.9;
  return (
    <span
      data-length-guide
      aria-live="polite"
      title={soft ? `${name} shows about ${max.toLocaleString()} characters before “see more”` : `${name} allows ${max} characters`}
      className={cx("text-xs tnum", over ? (soft ? "font-medium text-warn" : "font-medium text-danger") : near ? "text-warn" : "text-ink-3")}
    >
      {n.toLocaleString()} / {soft ? "~" : ""}
      {max.toLocaleString()}
      <span className="hidden sm:inline"> {over ? (soft ? "· past “see more”" : "· too long for X") : name}</span>
    </span>
  );
}

/** The draft's receipts: one line until asked, each quote opening its signal in a sheet. */
function Receipts({ list, onOpen }: { list: Receipt[]; onOpen: (r: Receipt) => void }) {
  const [open, setOpen] = useState(false);
  if (!list.length) return null;
  const signals = new Set(list.map((e) => e.signal_id)).size;
  return (
    <section className="mt-4" data-receipts>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="receipts-list"
        onClick={() => setOpen((o) => !o)}
        className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-3 hover:text-ink"
      >
        <Check size={13} className="text-accent" aria-hidden />
        {plural(list.length, "receipt")} from {plural(signals, "signal")}
        <ChevronDown size={14} aria-hidden className={cx("transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      {open ? (
        <ul id="receipts-list" className="mt-3 space-y-2">
          {list.map((e, i) => (
            <li key={`${e.signal_id}:${i}`} className="relative rounded-xl bg-surface px-4 py-3 ring-1 ring-line transition-colors hover:ring-line-strong">
              <p className="text-[14px] leading-relaxed text-ink">
                <L
                  href={`/signals?id=${e.signal_id}`}
                  onClick={(ev) => {
                    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
                    ev.preventDefault();
                    onOpen(e);
                  }}
                  className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent"
                >
                  “{e.quote}”
                </L>
              </p>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
                <span>{sourceLabel(e.source)}</span>
                {e.account ? <span>· {e.account}</span> : null}
                {e.occurred_at ? <span>· {timeAgo(e.occurred_at)}</span> : null}
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="relative z-10 ml-auto inline-flex items-center gap-0.5 hover:text-ink">
                    Source <ArrowUpRight size={12} />
                  </a>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

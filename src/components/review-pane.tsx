"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, Copy, Pencil, X } from "lucide-react";
import { reviewAction } from "@/app/(app)/actions";
import { undoReviewAction } from "@/app/(app)/actions-extra";
import { Badge, Button, Kbd, Textarea, cx, plural, timeAgo } from "./ui";
import { toast } from "./toast";
import { useBase } from "./nav";
import { emitEmbed } from "./embed-bridge";

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
  evidence: { signal_id: string; quote: string; source?: string; url?: string | null; account?: string | null; occurred_at?: string }[];
  html: React.ReactNode;
};

export type RecentReason = { text: string; isRule: boolean };

/** True when keystrokes belong to a text field, not to page shortcuts. */
export function isTypingTarget(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  if (!t || !t.tagName) return false;
  if (t.isContentEditable || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return true;
  return t.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes((t as HTMLInputElement).type);
}

/** Shortcuts are off while a dialog (command palette, sheet) is open on top of the page. */
const overlayOpen = () => !!document.querySelector('[aria-modal="true"]');

function useModKey() {
  const [mod, setMod] = useState("⌘");
  useEffect(() => {
    if (!/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)) setMod("Ctrl");
  }, []);
  return mod;
}

export function ReviewPane({ draft, nextId, reasons = [] }: { draft: ReviewDraft; nextId: string | null; reasons?: RecentReason[] }) {
  const router = useRouter();
  const base = useBase();
  const mod = useModKey();
  const [mode, setMode] = useState<"view" | "edit" | "reject">("view");
  const [body, setBody] = useState(draft.body);
  const [feedback, setFeedback] = useState("");
  const [remember, setRemember] = useState(true);
  const [pending, start] = useTransition();
  const focusField = () => document.querySelector<HTMLTextAreaElement>("[data-review-field]")?.focus();
  const editable = draft.status === "pending";
  const agent = draft.agent_name ?? "this agent";
  const fb = feedback.trim();
  const alreadyRule = reasons.some((r) => r.isRule && r.text === fb);
  const teach = remember && !alreadyRule && !!fb;
  const canReject = !pending && (!remember || alreadyRule || !!fb);

  useEffect(() => {
    setMode("view");
    setBody(draft.body);
    setFeedback("");
  }, [draft.id, draft.body]);

  const decide = (decision: "approve" | "reject") => {
    if (pending) return;
    if (decision === "reject" && !canReject) return;
    start(async () => {
      const r = await reviewAction(draft.id, {
        decision,
        feedback: fb || undefined,
        remember: teach,
        body: body !== draft.body ? body : undefined,
      });
      if (!r.ok) return void toast.error(r.error);
      emitEmbed(decision === "approve" ? "draft.approved" : "draft.rejected", { id: draft.id, title: draft.title });
      const text = decision === "approve" ? (r.data?.effect ?? "Approved") : teach ? `Rejected. ${agent} will remember why.` : "Rejected";
      const id = draft.id;
      toast.ok(text, {
        action: draft.undoable
          ? {
              label: "Undo",
              run: async () => {
                const u = await undoReviewAction(id);
                if (!u.ok) return void toast.error(u.error);
                toast.ok("Back in your queue");
                router.push(`${base}/inbox?d=${id}`, { scroll: false });
                router.refresh();
              },
            }
          : undefined,
      });
      router.push(nextId ? `${base}/inbox?d=${nextId}` : `${base}/inbox`, { scroll: false });
      router.refresh();
    });
  };

  const cancel = () => {
    if (mode === "edit") setBody(draft.body);
    setMode("view");
  };

  // Latest-handler ref so the single window listener never sees stale state.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e: KeyboardEvent) => {
    if (!editable || e.defaultPrevented || overlayOpen()) return;
    if (e.key === "Escape" && mode !== "view") {
      e.preventDefault();
      cancel();
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
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  useEffect(() => {
    if (mode !== "view") requestAnimationFrame(focusField);
  }, [mode]);

  return (
    <article className="animate-in" key={draft.id}>
      <header className="mb-6">
        <p className="text-sm text-ink-3">
          {draft.system_label} · {draft.agent_name ?? "Agent"} · {timeAgo(draft.created_at)}
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-pretty">{draft.title}</h2>
        {draft.status !== "pending" ? (
          <div className="mt-2 flex items-center gap-2">
            <Badge tone={draft.status === "rejected" ? "danger" : "accent"}>{draft.status}</Badge>
            {draft.feedback ? <span className="text-sm text-ink-2">“{draft.feedback}”</span> : null}
          </div>
        ) : null}
      </header>

      {mode === "edit" ? (
        <Textarea data-review-field aria-label="Edit draft" value={body} onChange={(e) => setBody(e.target.value)} rows={22} className="font-mono text-[13px]" />
      ) : (
        <div className="rounded-xl bg-surface p-5 ring-1 ring-line sm:p-6">{body === draft.body ? draft.html : <pre className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed">{body}</pre>}</div>
      )}

      {editable ? (
        <div className="sticky bottom-0 -mx-1 mt-5 border-t border-line bg-bg/90 px-1 py-4 backdrop-blur">
          {mode === "reject" ? (
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
                  <Button variant="ghost" onClick={cancel}>
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
              <Button variant="primary" disabled={pending} onClick={() => decide("approve")}>
                <Check size={14} /> Approve edit <span className="hidden sm:inline-flex"><Kbd>{mod}↵</Kbd></span>
              </Button>
              <Button variant="ghost" onClick={cancel}>
                Discard edit <Kbd>esc</Kbd>
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" disabled={pending} onClick={() => decide("approve")}>
                <Check size={14} /> Approve <span className="hidden sm:inline-flex"><Kbd>A</Kbd></span>
              </Button>
              <Button variant="secondary" onClick={() => setMode("edit")}>
                <Pencil size={13} /> Edit <span className="hidden sm:inline-flex"><Kbd>E</Kbd></span>
              </Button>
              <Button variant="secondary" onClick={() => setMode("reject")}>
                <X size={14} /> Reject <span className="hidden sm:inline-flex"><Kbd>R</Kbd></span>
              </Button>
              <Button
                variant="ghost"
                className="ml-auto"
                aria-label="Copy draft"
                onClick={async () => {
                  await navigator.clipboard.writeText(body);
                  toast.ok("Copied");
                }}
              >
                <Copy size={13} /> <span className="hidden sm:inline">Copy</span>
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {draft.evidence.length ? (
        <section className="mt-8">
          <h3 className="mb-3 text-[13px] font-medium text-ink-3">Receipts · {plural(draft.evidence.length, "verified quote")}</h3>
          <ul className="space-y-2">
            {draft.evidence.map((e, i) => (
              <li key={i} className="rounded-xl bg-surface px-4 py-3 ring-1 ring-line">
                <p className="text-[14px] leading-relaxed text-ink">“{e.quote}”</p>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
                  <span className="inline-flex items-center gap-1 text-accent">
                    <Check size={12} /> verified
                  </span>
                  <span>{e.source?.replace(/_/g, " ")}</span>
                  {e.account ? <span>· {e.account}</span> : null}
                  {e.occurred_at ? <span>· {timeAgo(e.occurred_at)}</span> : null}
                  {e.url ? (
                    <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="ml-auto inline-flex items-center gap-0.5 hover:text-ink">
                      Source <ArrowUpRight size={12} />
                    </a>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

/** j/k through the inbox list, anywhere on the page except inside text fields. */
export function InboxKeys({ ids, current, tab }: { ids: string[]; current: string | null; tab: string }) {
  const router = useRouter();
  const base = useBase();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target) || overlayOpen()) return;
      const k = e.key.toLowerCase();
      if (k !== "j" && k !== "k") return;
      const i = current ? ids.indexOf(current) : -1;
      const next = k === "j" ? ids[i + 1] : i > 0 ? ids[i - 1] : undefined;
      if (!next) return;
      e.preventDefault();
      router.push(`${base}/inbox?tab=${tab}&d=${next}`, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ids, current, router, base, tab]);
  useEffect(() => {
    if (current) document.querySelector(`[data-draft="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);
  return null;
}

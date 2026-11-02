"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, Copy, Pencil, X } from "lucide-react";
import { reviewAction } from "@/app/(app)/actions";
import { Badge, Button, Kbd, Textarea, cx, timeAgo } from "./ui";
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
  evidence: { signal_id: string; quote: string; source?: string; url?: string | null; account?: string | null; occurred_at?: string }[];
  html: React.ReactNode;
};

export function ReviewPane({ draft, nextId }: { draft: ReviewDraft; nextId: string | null }) {
  const router = useRouter();
  const base = useBase();
  const [mode, setMode] = useState<"view" | "edit" | "reject">("view");
  const [body, setBody] = useState(draft.body);
  const [feedback, setFeedback] = useState("");
  const [remember, setRemember] = useState(true);
  const [pending, start] = useTransition();
  const editable = draft.status === "pending";

  useEffect(() => {
    setMode("view");
    setBody(draft.body);
    setFeedback("");
  }, [draft.id, draft.body]);

  const decide = (decision: "approve" | "reject") =>
    start(async () => {
      const r = await reviewAction(draft.id, {
        decision,
        feedback: feedback.trim() || undefined,
        remember: decision === "reject" ? remember && !!feedback.trim() : remember && !!feedback.trim(),
        body: body !== draft.body ? body : undefined,
      });
      if (!r.ok) return toast.error(r.error);
      emitEmbed(decision === "approve" ? "draft.approved" : "draft.rejected", { id: draft.id, title: draft.title });
      toast.ok(decision === "approve" ? (r.data?.effect ?? "Approved") : remember && feedback.trim() ? "Rejected. The agent will remember why." : "Rejected");
      router.push(nextId ? `${base}/inbox?d=${nextId}` : `${base}/inbox`);
      router.refresh();
    });

  useEffect(() => {
    if (!editable) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || e.metaKey || e.ctrlKey) return;
      if (e.key === "a" && mode === "view") decide("approve");
      if (e.key === "r" && mode === "view") setMode("reject");
      if (e.key === "e" && mode === "view") setMode("edit");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, editable, draft.id]);

  return (
    <article className="animate-in" key={draft.id}>
      <header className="mb-6">
        <p className="text-sm text-ink-3">
          {draft.system_label} · {draft.agent_name ?? "Agent"} · {timeAgo(draft.created_at)}
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">{draft.title}</h2>
        {draft.status !== "pending" ? (
          <div className="mt-2 flex items-center gap-2">
            <Badge tone={draft.status === "rejected" ? "danger" : "accent"}>{draft.status}</Badge>
            {draft.feedback ? <span className="text-sm text-ink-2">“{draft.feedback}”</span> : null}
          </div>
        ) : null}
      </header>

      {mode === "edit" ? (
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={22} className="font-mono text-[13px]" autoFocus />
      ) : (
        <div className="rounded-xl bg-surface p-6 ring-1 ring-line">{body === draft.body ? draft.html : <pre className="whitespace-pre-wrap text-sm">{body}</pre>}</div>
      )}

      {editable ? (
        <div className="sticky bottom-0 -mx-1 mt-5 border-t border-line bg-bg/90 px-1 py-4 backdrop-blur">
          {mode === "reject" ? (
            <div className="space-y-3">
              <Textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={3}
                autoFocus
                placeholder="What's wrong? Be specific, like you'd coach a new hire. e.g. “Never open with a question. Lead with the number.”"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 accent-[var(--accent)]" />
                  Teach the agent: add this as a standing rule
                </label>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setMode("view")}>
                    Cancel
                  </Button>
                  <Button variant="danger" disabled={pending || (remember && !feedback.trim())} onClick={() => decide("reject")}>
                    <X size={14} /> Reject
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" disabled={pending} onClick={() => decide("approve")}>
                <Check size={14} /> {mode === "edit" ? "Approve edit" : "Approve"} <Kbd>A</Kbd>
              </Button>
              {mode === "edit" ? (
                <Button variant="ghost" onClick={() => { setBody(draft.body); setMode("view"); }}>
                  Discard edit
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setMode("edit")}>
                  <Pencil size={13} /> Edit <Kbd>E</Kbd>
                </Button>
              )}
              <Button variant="secondary" onClick={() => setMode("reject")}>
                <X size={14} /> Reject <Kbd>R</Kbd>
              </Button>
              <Button
                variant="ghost"
                className="ml-auto"
                onClick={async () => {
                  await navigator.clipboard.writeText(body);
                  toast.ok("Copied");
                }}
              >
                <Copy size={13} /> Copy
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {draft.evidence.length ? (
        <section className="mt-8">
          <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.07em] text-ink-3">Receipts · {draft.evidence.length} verified quotes</h3>
          <ul className="space-y-2">
            {draft.evidence.map((e, i) => (
              <li key={i} className="rounded-xl bg-surface px-4 py-3 ring-1 ring-line">
                <p className="text-[14px] leading-relaxed text-ink">“{e.quote}”</p>
                <p className="mt-1.5 flex items-center gap-2 text-xs text-ink-3">
                  <span className={cx("inline-flex items-center gap-1 text-accent")}>
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

/** j/k navigation through the inbox list. */
export function InboxKeys({ ids, current }: { ids: string[]; current: string | null }) {
  const router = useRouter();
  const base = useBase();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || e.metaKey || e.ctrlKey) return;
      const i = current ? ids.indexOf(current) : -1;
      if (e.key === "j" && ids[i + 1]) router.push(`${base}/inbox?d=${ids[i + 1]}`, { scroll: false });
      if (e.key === "k" && i > 0) router.push(`${base}/inbox?d=${ids[i - 1]}`, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ids, current, router, base]);
  return null;
}

"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, LoaderCircle, Plus } from "lucide-react";
import type { Readiness } from "@/server/agents/readiness";
import { runAgentAction, runStatusAction } from "@/app/(app)/actions";
import { runFirstDraftAction } from "@/app/(app)/actions-extra";
import { Button, buttonClass, cx, plural } from "./ui";
import { toast } from "./toast";
import { L, useBase } from "./nav";

/** Runs being followed right now; LiveRefresh holds off so a follower can finish and navigate. */
export const following = { n: 0 };
const followed = new Map<string, Set<(phase: "running" | "done") => void>>();

type Router = ReturnType<typeof useRouter>;

/**
 * Follow a run to the end, independent of any component: the button that started it
 * may unmount when the page re-renders. On success, open its first draft, but only
 * if the person is still on the page where they asked for it.
 */
function follow(runId: string, router: Router, base: string, listener: (phase: "running" | "done") => void) {
  const existing = followed.get(runId);
  if (existing) {
    existing.add(listener);
    return () => void existing.delete(listener);
  }
  const listeners = new Set([listener]);
  followed.set(runId, listeners);
  following.n++;
  const from = window.location.pathname;
  const emit = (p: "running" | "done") => listeners.forEach((l) => l(p));
  const finish = () => {
    followed.delete(runId);
    following.n--;
    emit("done");
  };
  let tries = 0;
  let showedProgress = false;
  const poll = async () => {
    tries++;
    const r = await runStatusAction(runId).catch(() => null);
    const run = r?.ok ? r.data : undefined;
    if (run && (run.status === "succeeded" || run.status === "failed" || run.status === "canceled")) {
      if (run.status === "succeeded") {
        const d = await runFirstDraftAction(runId).catch(() => null);
        if (d?.ok && d.data) {
          toast.ok("Done. Your draft is ready for review.");
          if (window.location.pathname === from) router.push(`${base}/inbox?d=${d.data}`);
        } else toast.ok(run.summary || "Done. Nothing new to review this time.");
      } else toast.error(run.error || "The run failed.");
      finish();
      router.refresh();
      return;
    }
    if (run?.status === "running") emit("running");
    // Still going after the first check: let the page show it (e.g. Today's "reading signals" row).
    if (!showedProgress) {
      showedProgress = true;
      router.refresh();
    }
    if (tries > 400) return finish();
    setTimeout(poll, Math.min(800 + tries * 300, 4000));
  };
  setTimeout(poll, 600);
  return () => void listeners.delete(listener);
}

/** Runs an agent, shows progress in place, then opens the first draft it wrote. */
export function RunButton({
  agentId,
  label = "Run now",
  variant = "primary",
  input,
  size,
  workingLabel = "Reading signals…",
  className,
  activeRunId,
}: {
  agentId: string;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  input?: Record<string, unknown>;
  size?: "sm" | "md";
  workingLabel?: string;
  className?: string;
  /** Resume following a run that's already in flight (e.g. after a reload). */
  activeRunId?: string | null;
}) {
  const [runId, setRunId] = useState<string | null>(activeRunId ?? null);
  const [phase, setPhase] = useState<"queued" | "running">(activeRunId ? "running" : "queued");
  const [pending, start] = useTransition();
  const router = useRouter();
  const base = useBase();

  useEffect(() => {
    if (!runId) return;
    return follow(runId, router, base, (p) => {
      if (p === "running") setPhase("running");
      else setRunId(null);
    });
  }, [runId, router, base]);

  const busy = pending || !!runId;
  const text = !busy ? label : runId && phase === "running" ? workingLabel : "Starting…";
  return (
    <Button
      variant={variant}
      size={size}
      disabled={busy}
      aria-busy={busy}
      className={cx(busy && "disabled:opacity-80", className)}
      onClick={() =>
        start(async () => {
          setPhase("queued");
          const r = await runAgentAction(agentId, input);
          if (!r.ok) toast.error(r.error);
          else if (r.data) setRunId(r.data.runId);
        })
      }
    >
      {busy ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <Play size={13} className="fill-current" />}
      <span aria-live="polite">{text}</span>
    </Button>
  );
}

/**
 * The right next action for an agent: Run when its window has enough to read,
 * otherwise "Add signals" first, with a quiet Run kept only if there's at least one signal.
 */
export function AgentRun({
  agentId,
  readiness,
  size = "sm",
  label = "Run now",
  quiet = false,
  className,
  activeRunId,
}: {
  agentId: string;
  readiness: Readiness | null | undefined;
  size?: "sm" | "md";
  label?: string;
  /** In lists: no black buttons. */
  quiet?: boolean;
  className?: string;
  activeRunId?: string | null;
}) {
  if (!readiness || readiness.ready || activeRunId)
    return <RunButton agentId={agentId} size={size} label={label} variant={quiet ? "secondary" : "primary"} className={className} activeRunId={activeRunId} />;
  return (
    <span className={cx("flex items-center gap-1.5", className)}>
      {readiness.signals > 0 ? <RunButton agentId={agentId} size={size} label="Run" variant="ghost" /> : null}
      <L href="/signals?add=1" className={buttonClass(quiet ? "secondary" : "primary", size)} title={readiness.reason ?? undefined}>
        <Plus size={14} aria-hidden /> Add signals
      </L>
    </span>
  );
}

/** "Run Content drafter and Hook lab": the label names exactly the agents the button starts. */
export function runAllLabel(names: string[]) {
  return `Run ${names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`}`;
}

/**
 * Starts several agents at once (e.g. everything downstream of a newly approved memo).
 * Only agents that are ready (or already working) are started; an agent marked not ready is left out.
 * The page's live refresh shows each one working, and their drafts as they land.
 */
export function RunAllButton({
  agents: all,
  label,
  className,
}: {
  agents: { id: string; name?: string; ready?: boolean; activeRunId?: string | null }[];
  /** Defaults to naming the agents it will start. */
  label?: string;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const agents = all.filter((a) => a.ready !== false || a.activeRunId);
  if (!label) label = runAllLabel(agents.map((a) => a.name ?? "agent"));
  const going = agents.some((a) => a.activeRunId);
  const busy = pending || going;
  return (
    <Button
      variant="primary"
      disabled={busy}
      aria-busy={busy}
      className={cx("max-w-full", busy && "disabled:opacity-80", className)}
      onClick={() =>
        start(async () => {
          const todo = agents.filter((a) => !a.activeRunId);
          const results = await Promise.all(todo.map((a) => runAgentAction(a.id).catch(() => ({ ok: false as const, error: "Couldn't start the run." }))));
          const failed = results.filter((r) => !r.ok);
          if (failed.length === results.length) toast.error(failed[0] && !failed[0].ok ? failed[0].error : "Couldn't start the runs.");
          else toast.ok(`${plural(results.length - failed.length, "agent")} working. Drafts land in your inbox.`);
          router.refresh();
        })
      }
    >
      {busy ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <Play size={13} className="fill-current" />}
      <span aria-live="polite" className="truncate">{busy ? "Agents working…" : label}</span>
    </Button>
  );
}

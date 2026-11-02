import { LoaderCircle } from "lucide-react";
import { cx, plural, timeAgo } from "./ui";

type AgentLike = {
  enabled: boolean;
  schedule_cron: string | null;
  timezone?: string;
  next_run_at: string | null;
  last_run: { status: string; created_at: string; finished_at?: string | null; drafts?: number } | null;
};

export type AgentStatus = {
  kind: "never" | "running" | "failed" | "ran";
  /** "Never run", "Running…", "Failed", "Ran 3m ago" */
  label: string;
  /** Drafts from the last finished run; null when there's no finished run. */
  drafts: number | null;
  /** Quiet secondary text: "Paused" or "Next Tue 7:00 AM"; null when nothing is scheduled. */
  next: string | null;
};

/** The agent's state in plain words: only what actually happened, never a promise. */
export function agentStatus(a: AgentLike): AgentStatus {
  const r = a.last_run;
  const next = !a.enabled
    ? "Paused"
    : a.schedule_cron && a.next_run_at
      ? `Next ${new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: a.timezone || "UTC" }).format(new Date(a.next_run_at))}`
      : null;
  if (!r) return { kind: "never", label: "Never run", drafts: null, next };
  if (r.status === "running" || r.status === "queued") return { kind: "running", label: "Running…", drafts: null, next };
  if (r.status === "failed") return { kind: "failed", label: "Failed", drafts: null, next };
  return { kind: "ran", label: `Ran ${timeAgo(r.finished_at ?? r.created_at)}`, drafts: r.drafts ?? 0, next };
}

export const draftsLabel = (n: number) => (n ? plural(n, "draft") : "no drafts");

/** "Ran 3m ago · 6 drafts", "Running…", "Failed" (danger), "Never run". */
export function AgentStatusText({ status, className, drafts = true }: { status: AgentStatus; className?: string; drafts?: boolean }) {
  return (
    <span className={cx("inline-flex min-w-0 items-center gap-1.5", status.kind === "failed" ? "text-danger" : status.kind === "never" ? "text-ink-3" : "text-ink-2", className)}>
      {status.kind === "running" ? <LoaderCircle size={12} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
      <span className="truncate">
        {status.label}
        {drafts && status.drafts !== null ? ` · ${draftsLabel(status.drafts)}` : null}
      </span>
    </span>
  );
}

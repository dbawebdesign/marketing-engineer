import { Settings2 } from "lucide-react";
import type { Agent } from "@/server/services/agents";
import { L } from "./nav";
import { RunButton } from "./run-button";
import { Badge, Dot, buttonClass, timeAgo } from "./ui";

export function AgentCard({ agent, canRun }: { agent: Agent; canRun: boolean }) {
  const s = agent.spec;
  const running = agent.last_run?.status === "running" || agent.last_run?.status === "queued";
  return (
    <div className="rounded-2xl bg-surface p-6 shadow-soft ring-1 ring-line">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Dot tone={!agent.enabled ? "neutral" : agent.last_run?.status === "failed" ? "danger" : "accent"} pulse={running} />
            <h3 className="font-semibold tracking-tight">{agent.name}</h3>
            {!agent.enabled ? <Badge>paused</Badge> : null}
          </div>
          <p className="mt-1 max-w-xl text-[14px] text-ink-2">{s.mission}</p>
        </div>
        <div className="flex items-center gap-2">
          <L href={`/agents/${agent.id}`} className={buttonClass("ghost", "sm")} aria-label="Configure agent">
            <Settings2 size={14} /> Job spec
          </L>
          {canRun ? <RunButton agentId={agent.id} size="sm" /> : null}
        </div>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4 text-[13px] sm:grid-cols-4">
        <div>
          <dt className="text-ink-3">Schedule</dt>
          <dd className="mt-0.5 text-ink">{agent.schedule_cron && agent.enabled ? s.schedule : "On demand"}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Last run</dt>
          <dd className="mt-0.5 text-ink">{agent.last_run ? `${timeAgo(agent.last_run.created_at)}${agent.last_run.status === "failed" ? " · failed" : ""}` : "Never"}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Approval rate</dt>
          <dd className="mt-0.5 text-ink tnum">{agent.approval_rate === null ? "—" : `${agent.approval_rate}%`}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Metric</dt>
          <dd className="mt-0.5 truncate text-ink" title={s.metric}>
            {s.metric}
          </dd>
        </div>
      </dl>
      {agent.rules_count ? (
        <p className="mt-3 text-xs text-ink-3">
          Trained with {agent.rules_count} correction{agent.rules_count === 1 ? "" : "s"} from your reviews.
        </p>
      ) : null}
    </div>
  );
}

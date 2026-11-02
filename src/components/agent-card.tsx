import { SlidersHorizontal } from "lucide-react";
import type { Agent } from "@/server/services/agents";
import { agentState, scheduleLabel } from "@/lib/schedule";
import { L } from "./nav";
import { RunButton } from "./run-button";
import { Dot, buttonClass, cx, timeAgo } from "./ui";

/** One quiet line about the agent behind a system: state, schedule, last run. */
export function AgentMeta({ agent, className }: { agent: Agent; className?: string }) {
  const st = agentState(agent);
  const last = agent.last_run;
  return (
    <p className={cx("flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-ink-3", className)}>
      <span className="flex items-center gap-2" title={st.label}>
        <Dot tone={st.tone} pulse={st.pulse} />
        <span className="sr-only">{st.label}:</span>
        <L href={`/agents/${agent.id}`} className="font-medium text-ink-2 hover:text-ink">
          {agent.name}
        </L>
      </span>
      <span>
        <span aria-hidden>· </span>
        {scheduleLabel(agent)}
      </span>
      <span className={last?.status === "failed" ? "text-warn" : undefined}>
        <span aria-hidden className="text-ink-3">· </span>
        {st.pulse ? "Running now" : last ? `Last run ${timeAgo(last.created_at)}${last.status === "failed" ? ", failed" : ""}` : "Never run"}
      </span>
    </p>
  );
}

export function AgentActions({ agent, canRun }: { agent: Agent; canRun: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <L href={`/agents/${agent.id}`} className={buttonClass("ghost", "sm")}>
        <SlidersHorizontal size={14} /> Job spec
      </L>
      {canRun ? <RunButton agentId={agent.id} size="sm" /> : null}
    </div>
  );
}

import { SlidersHorizontal } from "lucide-react";
import type { Agent } from "@/server/services/agents";
import { agentState, scheduleLabel } from "@/lib/schedule";
import { L } from "./nav";
import { AgentRun } from "./run-button";
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
      {agent.readiness && !agent.readiness.ready ? (
        <span>
          <span aria-hidden>· </span>
          {agent.readiness.signals ? `${agent.readiness.signals} of ${agent.readiness.need} signals` : "No signals"} in the last {agent.readiness.days} days
        </span>
      ) : null}
    </p>
  );
}

/** Job spec, plus the agent's next action (Run, or Add signals when its window is too thin). `run={false}` when the page body already offers it. */
export function AgentActions({ agent, canRun, run = true, quiet = false }: { agent: Agent; canRun: boolean; run?: boolean; /** Something is waiting for review: that's the primary action, not Run. */ quiet?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <L href={`/agents/${agent.id}`} className={buttonClass("ghost", "sm")}>
        <SlidersHorizontal size={14} /> Job spec
      </L>
      {canRun && run ? <AgentRun agentId={agent.id} readiness={agent.readiness} quiet={quiet} /> : null}
    </div>
  );
}

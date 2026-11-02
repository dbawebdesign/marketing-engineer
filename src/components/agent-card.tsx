import { SlidersHorizontal } from "lucide-react";
import type { Agent } from "@/server/services/agents";
import { L } from "./nav";
import { AgentRun } from "./run-button";
import { AgentStatusText, agentStatus } from "./agent-status";
import { buttonClass, cx } from "./ui";

/** One quiet line about the agent behind a system: name, what actually happened last, what's scheduled. */
export function AgentMeta({ agent, className }: { agent: Agent; className?: string }) {
  const st = agentStatus(agent);
  return (
    <p className={cx("flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-ink-3", className)}>
      <L href={`/agents/${agent.id}`} className="font-medium text-ink-2 hover:text-ink">
        {agent.name}
      </L>
      <span aria-hidden>·</span>
      <AgentStatusText status={st} />
      {st.next ? (
        <span>
          <span aria-hidden>· </span>
          {st.next}
        </span>
      ) : null}
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

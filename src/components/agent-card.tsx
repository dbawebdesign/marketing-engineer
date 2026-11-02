import { SlidersHorizontal } from "lucide-react";
import type { Agent } from "@/server/services/agents";
import { L } from "./nav";
import { AgentRun } from "./run-button";
import { AgentStatusText, agentStatus } from "./agent-status";
import { buttonClass, cx } from "./ui";

/** The readiness reason without the agent's name (the line already starts with it): "Reads sales calls: 3 in the last 7 days. It needs at least 5". */
function readinessLine(name: string, reason: string | null) {
  if (!reason) return "Not enough to draft from yet";
  const r = reason.startsWith(`${name} `) ? reason.slice(name.length + 1) : reason;
  return (r.charAt(0).toUpperCase() + r.slice(1)).replace(/\.$/, "");
}

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
          {readinessLine(agent.name, agent.readiness.reason)}
        </span>
      ) : null}
    </p>
  );
}

/** Job spec, plus the agent's next action (Run, or Add signals when its window is too thin). `run={false}` when the page body already offers it. */
export function AgentActions({
  agent,
  canRun,
  run = true,
  quiet = false,
  activeRunId,
}: {
  agent: Agent;
  canRun: boolean;
  run?: boolean;
  /** Something is waiting for review: that's the primary action, not Run. */
  quiet?: boolean;
  /** A run already in flight: the control shows it working. */
  activeRunId?: string | null;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <L href={`/agents/${agent.id}`} className={buttonClass("ghost", "sm")}>
        <SlidersHorizontal size={14} aria-hidden /> Job spec
      </L>
      {canRun && run ? <AgentRun agentId={agent.id} readiness={agent.readiness} quiet={quiet} activeRunId={activeRunId} /> : null}
    </div>
  );
}

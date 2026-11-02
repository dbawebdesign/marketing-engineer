import { SlidersHorizontal } from "lucide-react";
import type { Agent } from "@/server/services/agents";
import { L } from "./nav";
import { AgentRun } from "./run-button";
import { AgentStatusText, agentStatus } from "./agent-status";
import { needsLine } from "@/lib/next-step";
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
          <span title={agent.readiness.reason ?? undefined}>{needsLine(agent.readiness)}</span>
        </span>
      ) : null}
    </p>
  );
}

/** Job spec, plus Run when the agent's readiness passes. When it doesn't, AgentMeta's quiet "Needs …" line says why: never both. `run={false}` when the page body already offers it. */
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
      {canRun && run && (!agent.readiness || agent.readiness.ready || activeRunId) ? <AgentRun agentId={agent.id} readiness={agent.readiness} quiet={quiet} activeRunId={activeRunId} /> : null}
    </div>
  );
}

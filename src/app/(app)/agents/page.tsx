import { requireCtx } from "@/server/web/session";
import { listAgents } from "@/server/services/agents";
import { SYSTEM_META } from "@/server/agents/types";
import { can } from "@/lib/rbac";
import { agentState, scheduleLabel } from "@/lib/schedule";
import { L } from "@/components/nav";
import { AgentRun } from "@/components/run-button";
import { Dot, PageHeader, cx, plural } from "@/components/ui";

export const metadata = { title: "Agents" };

export default async function AgentsPage() {
  const ctx = await requireCtx();
  const agents = await listAgents(ctx, { readiness: true });
  const canRun = can(ctx.role, "agents:run");
  // A column of dashes says nothing: show Approved once any agent has a reviewed draft.
  const showApproved = agents.some((a) => a.approval_rate !== null);
  const cols = cx(
    "sm:grid sm:items-center sm:gap-6",
    showApproved
      ? canRun
        ? "sm:grid-cols-[minmax(0,1fr)_88px_150px_184px]"
        : "sm:grid-cols-[minmax(0,1fr)_88px_150px]"
      : canRun
        ? "sm:grid-cols-[minmax(0,1fr)_150px_184px]"
        : "sm:grid-cols-[minmax(0,1fr)_150px]",
  );
  // Run shows on hover or focus where there's a pointer; touch screens always see it.
  const reveal =
    "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100 [@media(hover:hover)]:group-focus-within/row:opacity-100 [@media(hover:hover)]:has-[[aria-busy=true]]:opacity-100 transition-opacity duration-150";
  return (
    <div className="animate-in">
      <PageHeader title="Agents" sub="Each agent has a written job spec, like a new hire: what it reads, when it runs, what good looks like, and what needs your approval." />
      <div className="overflow-hidden rounded-xl bg-surface ring-1 ring-line" role="table" aria-label="Agents">
        <div role="row" className={`hidden border-b border-line px-5 py-2.5 text-[13px] text-ink-3 ${cols}`}>
          <span role="columnheader">Agent</span>
          {showApproved ? (
            <span role="columnheader" className="text-right">
              Approved
            </span>
          ) : null}
          <span role="columnheader">Schedule</span>
          {canRun ? (
            <span role="columnheader">
              <span className="sr-only">Run</span>
            </span>
          ) : null}
        </div>
        <div className="divide-y divide-line">
          {agents.map((a) => {
            const st = agentState(a);
            return (
              <div role="row" key={a.id} className={cx("group/row flex items-center gap-4 px-5 py-4 transition-colors hover:bg-subtle/60", cols)}>
                <div role="cell" className="flex min-w-0 flex-1 items-center gap-3">
                  <span title={st.label} className="flex">
                    <Dot tone={st.tone} pulse={st.pulse} />
                    <span className="sr-only">{st.label}</span>
                  </span>
                  <L href={`/agents/${a.id}`} className="group min-w-0">
                    <p className="truncate text-[14px] font-medium underline-offset-2 group-hover:underline">{a.name}</p>
                    <p className="truncate text-[13px] text-ink-3">
                      <span className="hidden sm:inline">{SYSTEM_META[a.system].label}</span>
                      <span className="sm:hidden">
                        {scheduleLabel(a)}
                        {a.approval_rate !== null ? ` · ${a.approval_rate}% approved` : ""}
                      </span>
                      {a.rules_count ? <span className="hidden sm:inline"> · {plural(a.rules_count, "rule")}</span> : null}
                    </p>
                  </L>
                </div>
                {showApproved ? (
                  <span role="cell" className="hidden text-right text-[14px] tnum sm:block">
                    {a.approval_rate === null ? <span className="text-ink-3">—</span> : `${a.approval_rate}%`}
                  </span>
                ) : null}
                <span role="cell" className={`hidden text-[14px] sm:block ${a.enabled && a.schedule_cron ? "text-ink-2" : "text-ink-3"}`}>
                  {scheduleLabel(a)}
                </span>
                {canRun ? (
                  <span role="cell" className={cx("flex shrink-0 justify-end", reveal)}>
                    <AgentRun agentId={a.id} readiness={a.readiness} label="Run" quiet />
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

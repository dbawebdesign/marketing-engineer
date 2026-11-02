import { requireCtx } from "@/server/web/session";
import { listAgents } from "@/server/services/agents";
import { SYSTEM_META } from "@/server/agents/types";
import { can } from "@/lib/rbac";
import { L } from "@/components/nav";
import { AgentRun } from "@/components/run-button";
import { AgentStatusText, agentStatus } from "@/components/agent-status";
import { PageHeader, cx, plural } from "@/components/ui";

export const metadata = { title: "Agents" };

export default async function AgentsPage() {
  const ctx = await requireCtx();
  const agents = await listAgents(ctx, { readiness: true });
  const canRun = can(ctx.role, "agents:run");
  const rows = agents.map((a) => ({ a, st: agentStatus(a) }));
  // A column that is empty for every row says nothing: hide it.
  const showDrafts = rows.some((r) => r.st.drafts !== null);
  const showApproved = agents.some((a) => a.approval_rate !== null);
  const grid = { "--cols": ["minmax(0,1fr)", "180px", showDrafts && "64px", showApproved && "80px", canRun && "120px"].filter(Boolean).join(" ") } as React.CSSProperties;
  const cols = "sm:grid sm:items-center sm:gap-6 sm:grid-cols-[var(--cols)]";
  // Run shows on hover or focus where there's a pointer; touch screens, and agents that never ran, always show it.
  const reveal =
    "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100 [@media(hover:hover)]:group-focus-within/row:opacity-100 [@media(hover:hover)]:has-[[aria-busy=true]]:opacity-100 transition-opacity duration-150";
  return (
    <div className="animate-in">
      <PageHeader title="Agents" sub="Each agent has a written job spec, like a new hire: what it reads, when it runs, what good looks like, and what needs your approval." />
      <div className="overflow-hidden rounded-xl bg-surface ring-1 ring-line" role="table" aria-label="Agents" style={grid}>
        <div role="row" className={`hidden border-b border-line px-5 py-2.5 text-[13px] text-ink-3 ${cols}`}>
          <span role="columnheader">Agent</span>
          <span role="columnheader">Last run</span>
          {showDrafts ? (
            <span role="columnheader" className="text-right">
              Drafts
            </span>
          ) : null}
          {showApproved ? (
            <span role="columnheader" className="text-right">
              Approved
            </span>
          ) : null}
          {canRun ? (
            <span role="columnheader">
              <span className="sr-only">Run</span>
            </span>
          ) : null}
        </div>
        <div className="divide-y divide-line">
          {rows.map(({ a, st }) => (
            <div role="row" key={a.id} className={cx("group/row flex items-center gap-4 px-5 py-4 transition-colors hover:bg-subtle/60", cols)}>
              <div role="cell" className="min-w-0 flex-1">
                <L href={`/agents/${a.id}`} className="group block min-w-0">
                  <p className="truncate text-[14px] font-medium underline-offset-2 group-hover:underline">{a.name}</p>
                  <p className="truncate text-[13px] text-ink-3">
                    {SYSTEM_META[a.system].label}
                    {a.rules_count ? ` · ${plural(a.rules_count, "rule")}` : ""}
                  </p>
                </L>
                {/* Small screens: state under the name. */}
                <p className="mt-0.5 flex min-w-0 text-[13px] sm:hidden">
                  <AgentStatusText status={st} />
                </p>
              </div>
              <div role="cell" className="hidden min-w-0 text-[14px] sm:block">
                <AgentStatusText status={st} drafts={!showDrafts} className="max-w-full" />
                {st.next ? <p className="truncate text-[13px] text-ink-3">{st.next}</p> : null}
              </div>
              {showDrafts ? (
                <span role="cell" className="hidden text-right text-[14px] tnum sm:block">
                  {st.drafts === null ? <span className="text-ink-3">—</span> : st.drafts}
                </span>
              ) : null}
              {showApproved ? (
                <span role="cell" className="hidden text-right text-[14px] tnum sm:block">
                  {a.approval_rate === null ? <span className="text-ink-3">—</span> : `${a.approval_rate}%`}
                </span>
              ) : null}
              {canRun ? (
                <span role="cell" className={cx("flex shrink-0 justify-end", st.kind !== "never" && reveal)}>
                  <AgentRun agentId={a.id} readiness={a.readiness} label="Run" quiet />
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

import { requireCtx } from "@/server/web/session";
import { listAgents } from "@/server/services/agents";
import { SYSTEM_META } from "@/server/agents/types";
import { can } from "@/lib/rbac";
import { L } from "@/components/nav";
import { RunButton } from "@/components/run-button";
import { Badge, Dot, PageHeader, timeAgo } from "@/components/ui";

export const metadata = { title: "Agents" };

export default async function AgentsPage() {
  const ctx = await requireCtx();
  const agents = await listAgents(ctx);
  const canRun = can(ctx.role, "agents:run");
  return (
    <div className="animate-in">
      <PageHeader title="Agents" sub="Each agent has a written job spec, like a new hire: what it reads, when it runs, what good looks like, what needs your approval, and the metric it's judged on." />
      <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface ring-1 ring-line">
        {agents.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
            <Dot tone={!a.enabled ? "neutral" : a.last_run?.status === "failed" ? "danger" : "accent"} pulse={a.last_run?.status === "running" || a.last_run?.status === "queued"} />
            <L href={`/agents/${a.id}`} className="min-w-0 flex-1">
              <p className="font-medium hover:underline">{a.name}</p>
              <p className="truncate text-sm text-ink-3">{SYSTEM_META[a.system].label} · {a.spec.metric}</p>
            </L>
            <div className="flex items-center gap-4 text-sm text-ink-2">
              {a.rules_count ? <Badge>{a.rules_count} rules</Badge> : null}
              <span className="w-24 text-right tnum">{a.approval_rate === null ? "—" : `${a.approval_rate}% approved`}</span>
              <span className="w-28 text-right text-ink-3">{a.enabled && a.next_run_at ? `next ${timeAgo(a.next_run_at)}` : a.enabled ? "on demand" : "paused"}</span>
              {canRun ? <RunButton agentId={a.id} variant="secondary" size="sm" label="Run" /> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

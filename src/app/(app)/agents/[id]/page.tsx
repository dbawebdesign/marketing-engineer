import { notFound } from "next/navigation";
import { requireCtx } from "@/server/web/session";
import { getAgent } from "@/server/services/agents";
import { SYSTEM_META } from "@/server/agents/types";
import { MODELS } from "@/lib/ai/provider";
import { isUuid } from "@/lib/db";
import { can } from "@/lib/rbac";
import { L } from "@/components/nav";
import { AgentEditor, RulesEditor } from "@/components/agent-editor";
import { RunButton } from "@/components/run-button";
import { Badge, Dot, Section, timeAgo } from "@/components/ui";
import { slugForSystem } from "@/lib/systems";

export const metadata = { title: "Agent" };

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCtx();
  const { agent, rules, runs } = await getAgent(ctx, id).catch(() => notFound());
  return (
    <div className="animate-in">
      <p className="text-sm text-ink-3">
        <L href={`/s/${slugForSystem(agent.system)}`} className="hover:text-ink">{SYSTEM_META[agent.system].label}</L> / Agent
      </p>
      <div className="mb-8 mt-1 flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{agent.name}</h1>
        {can(ctx.role, "agents:run") ? <RunButton agentId={agent.id} /> : null}
      </div>
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Section title="Job spec">
          <AgentEditor
            agent={agent}
            canManage={can(ctx.role, "agents:manage")}
            models={[
              { id: MODELS.deep, label: `Deep · ${MODELS.deep}` },
              { id: MODELS.fast, label: `Fast · ${MODELS.fast}` },
            ]}
          />
        </Section>
        <div>
          <Section title="Corrections it has learned">
            <RulesEditor agentId={agent.id} rules={rules} canAdd={can(ctx.role, "agents:run")} canRemove={can(ctx.role, "agents:manage")} />
          </Section>
          <Section title="Runs">
            <ul className="space-y-3">
              {runs.map((r) => {
                const stats = (r.input?.stats ?? {}) as Record<string, number>;
                return (
                  <li key={r.id} className="text-sm">
                    <div className="flex items-center gap-2">
                      <Dot tone={r.status === "failed" ? "danger" : r.status === "succeeded" ? "accent" : "warn"} pulse={r.status === "running" || r.status === "queued"} />
                      <span className="text-ink">{timeAgo(r.created_at)}</span>
                      <span className="text-ink-3">· {r.trigger}</span>
                      {r.model ? <Badge className="ml-auto">{r.model === "offline" ? "offline engine" : r.model}</Badge> : null}
                    </div>
                    {r.error ? <p className="mt-1 pl-3.5 text-danger">{r.error}</p> : null}
                    {stats.dropped_claims ? <p className="mt-1 pl-3.5 text-ink-3">{stats.dropped_claims} unsupported claims dropped</p> : null}
                    {Number(r.cost_usd) > 0 ? <p className="mt-0.5 pl-3.5 text-ink-3 tnum">${Number(r.cost_usd).toFixed(3)}</p> : null}
                  </li>
                );
              })}
              {!runs.length ? <li className="text-sm text-ink-3">No runs yet.</li> : null}
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}

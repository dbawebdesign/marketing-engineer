import { notFound } from "next/navigation";
import { requireCtx } from "@/server/web/session";
import { getAgent } from "@/server/services/agents";
import { GROWTH_OS } from "@/server/services/memory";
import { SYSTEM_META } from "@/server/agents/types";
import { MODELS, aiEnabled } from "@/lib/ai/provider";
import { isUuid } from "@/lib/db";
import { can } from "@/lib/rbac";
import { slugForSystem } from "@/lib/systems";
import { modelTierLabel } from "@/lib/schedule";
import { L } from "@/components/nav";
import { AgentEditor, RulesEditor } from "@/components/agent-editor";
import { AgentRun } from "@/components/run-button";
import { PendingBlock } from "@/components/system-views";
import { listDrafts } from "@/server/services/drafts";
import { Dot, plural, timeAgo } from "@/components/ui";

export const metadata = { title: "Agent" };

/** Memory doc keys in a spec read as their titles. */
const prettyDocs = (s: string) => GROWTH_OS.reduce((t, g) => t.replaceAll(g.key, `“${g.title}”`), s);

const RUN: Record<string, { tone: "neutral" | "accent" | "danger"; label: string }> = {
  succeeded: { tone: "neutral", label: "Succeeded" },
  failed: { tone: "danger", label: "Failed" },
  running: { tone: "accent", label: "Running" },
  queued: { tone: "neutral", label: "Queued" },
};

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-[15px] font-semibold tracking-[-0.01em] text-ink">{children}</h2>;
}

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCtx();
  const { agent, rules, runs } = await getAgent(ctx, id).catch(() => notFound());
  const slug = slugForSystem(agent.system);
  // Drafts from this agent still waiting: reviewing them is the page's primary action, so Run steps back.
  const waiting = (await listDrafts(ctx, { status: "pending", system: agent.system, limit: 100 }).catch(() => [])).filter((d) => d.agent_id === agent.id);
  return (
    <div className="animate-in">
      <p className="text-[13px] text-ink-3">
        <L href={`/s/${slug}`} className="hover:text-ink">
          {SYSTEM_META[agent.system].label}
        </L>
        <span aria-hidden> / </span>Agent
      </p>
      <div className="mb-8 mt-1 flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{agent.name}</h1>
        {can(ctx.role, "agents:run") ? <AgentRun agentId={agent.id} readiness={agent.readiness} size="md" quiet={waiting.length > 0} /> : null}
      </div>
      <PendingBlock drafts={waiting} slug={slug} />
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section>
          <H2>Job spec</H2>
          <AgentEditor
            agent={{ ...agent, spec: { ...agent.spec, writesTo: prettyDocs(agent.spec.writesTo) } }}
            canManage={can(ctx.role, "agents:manage")}
            aiEnabled={aiEnabled()}
            models={[
              { id: MODELS.deep, tier: "deep" },
              { id: MODELS.fast, tier: "fast" },
            ]}
          />
        </section>
        <div className="space-y-12">
          <section>
            <H2>Corrections it has learned</H2>
            <RulesEditor agentId={agent.id} rules={rules} canAdd={can(ctx.role, "agents:manage")} canRemove={can(ctx.role, "agents:manage")} />
          </section>
          <section>
            <H2>Runs</H2>
            <ul className="space-y-3.5">
              {runs.map((r) => {
                const stats = (r.input?.stats ?? {}) as Record<string, number>;
                const st = RUN[r.status] ?? { tone: "neutral" as const, label: r.status };
                const tier = modelTierLabel(r.model, MODELS.deep);
                return (
                  <li key={r.id} className="text-[14px]">
                    <div className="flex items-center gap-2">
                      <span title={st.label} className="flex">
                        <Dot tone={st.tone} pulse={r.status === "running"} />
                        <span className="sr-only">{st.label}</span>
                      </span>
                      <span className="text-ink">{timeAgo(r.created_at)}</span>
                      <span className="text-ink-3">· {r.trigger === "schedule" ? "Scheduled" : r.trigger === "manual" ? "Manual" : r.trigger === "api" ? "Via API" : r.trigger}</span>
                      {r.status === "succeeded" ? <span className="text-ink-3">· {r.drafts ? plural(r.drafts, "draft") : "no drafts"}</span> : null}
                      {tier || Number(r.cost_usd) > 0 ? (
                        <span className="ml-auto text-[13px] text-ink-3 tnum">{[tier, Number(r.cost_usd) > 0 ? `$${Number(r.cost_usd).toFixed(3)}` : null].filter(Boolean).join(" · ")}</span>
                      ) : null}
                    </div>
                    {r.error ? <p className="mt-1 pl-3.5 text-[13px] text-danger">{r.error}</p> : null}
                    {stats.nothing && r.summary ? <p className="mt-0.5 pl-3.5 text-[13px] text-ink-3">{r.summary}</p> : null}
                    {stats.dropped_claims ? <p className="mt-0.5 pl-3.5 text-[13px] text-ink-3">{plural(stats.dropped_claims, "unsupported claim")} dropped</p> : null}
                  </li>
                );
              })}
              {!runs.length ? <li className="text-[14px] text-ink-3">No runs yet.</li> : null}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

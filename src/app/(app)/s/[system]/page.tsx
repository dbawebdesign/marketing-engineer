import { notFound } from "next/navigation";
import { requireCtx } from "@/server/web/session";
import { listAgents } from "@/server/services/agents";
import { listDrafts } from "@/server/services/drafts";
import { getDoc } from "@/server/services/memory";
import { listExperiments, angleMetrics } from "@/server/services/experiments";
import { SYSTEM_META } from "@/server/agents/types";
import { SYSTEM_SLUGS, type SystemSlug } from "@/lib/systems";
import { can } from "@/lib/rbac";
import { AgentActions, AgentMeta } from "@/components/agent-card";
import { AngleChart, Coverage, CreativeBatch, DocView, DraftsList, ExperimentBoard, OutboundQueue, PostsLibrary } from "@/components/system-views";

export async function generateMetadata({ params }: { params: Promise<{ system: string }> }) {
  const s = SYSTEM_SLUGS[(await params).system as SystemSlug];
  return { title: s ? SYSTEM_META[s].label : "System" };
}

export default async function SystemPage({ params }: { params: Promise<{ system: string }> }) {
  const { system: slug } = await params;
  const system = SYSTEM_SLUGS[slug as SystemSlug];
  if (!system) notFound();
  const ctx = await requireCtx();
  const meta = SYSTEM_META[system];
  const [agents, drafts, truth, brief, experiments] = await Promise.all([
    listAgents(ctx),
    listDrafts(ctx, { system, limit: system === "outbound_signal" ? 100 : 60 }),
    system === "customer_truth" ? getDoc(ctx, "customer-truth/what-the-market-is-telling-us") : null,
    system === "growth_cockpit" ? getDoc(ctx, "cockpit/weekly-brief") : null,
    system === "creative_testing" ? listExperiments(ctx, 30) : [],
  ]);
  const mine = agents.filter((a) => a.system === system);
  // The chart reads the same window the cockpit agent reads.
  const days = mine[0]?.spec.lookbackDays || 7;
  const angles = system === "growth_cockpit" ? await angleMetrics(ctx, days) : [];
  const canRun = can(ctx.role, "agents:run");
  const pendingOf = (type: string) => drafts.filter((d) => d.type === type && d.status === "pending");

  return (
    <div className="animate-in">
      <header className="mb-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-ink">{meta.label}</h1>
            <p className="mt-1 max-w-2xl text-[15px] text-ink-2">{meta.blurb}</p>
          </div>
          {mine.length === 1 ? <AgentActions agent={mine[0]!} canRun={canRun} /> : null}
        </div>
        <div className="mt-4 space-y-2">
          {mine.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-2">
              <AgentMeta agent={a} />
              {mine.length > 1 ? <AgentActions agent={a} canRun={canRun} /> : null}
            </div>
          ))}
          {!mine.length ? <p className="text-[13px] text-ink-3">No agent runs this system yet. An admin can add one from Agents.</p> : null}
        </div>
      </header>

      {system === "customer_truth" ? (
        <DocView
          doc={truth}
          title="Current truth file"
          pending={pendingOf("market_memo")}
          noun="memo"
          idle={{ title: "No truth file yet", body: "Run the agent, then approve its memo. The approved memo becomes the source of truth every other agent reads." }}
        />
      ) : null}

      {system === "founder_content" ? <PostsLibrary drafts={drafts} /> : null}

      {system === "outbound_signal" ? <OutboundQueue drafts={drafts} /> : null}

      {system === "creative_testing" ? (
        <>
          <ExperimentBoard experiments={experiments} />
          <CreativeBatch draft={drafts.find((d) => d.type === "creative_batch")} />
        </>
      ) : null}

      {system === "ai_search" ? <Coverage draft={drafts.find((d) => d.type === "ai_answer_pack")} /> : null}

      {system === "growth_cockpit" ? (
        <>
          <AngleChart angles={angles} days={days} />
          <DocView
            doc={brief}
            title="This week's brief"
            pending={pendingOf("cockpit_memo")}
            noun="brief"
            idle={{ title: "No brief yet", body: "Run the agent, then approve its brief. It becomes the weekly read every other agent starts from." }}
          />
        </>
      ) : null}

      {system !== "outbound_signal" ? <DraftsList drafts={drafts} /> : null}
    </div>
  );
}

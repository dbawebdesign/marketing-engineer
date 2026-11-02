import { notFound } from "next/navigation";
import { requireCtx } from "@/server/web/session";
import { listAgents } from "@/server/services/agents";
import { listDrafts } from "@/server/services/drafts";
import { getDoc } from "@/server/services/memory";
import { listExperiments, angleMetrics } from "@/server/services/experiments";
import { signalStats } from "@/server/services/signals";
import { SYSTEM_META } from "@/server/agents/types";
import { SYSTEM_SLUGS, type SystemSlug } from "@/lib/systems";
import { can } from "@/lib/rbac";
import { AgentActions, AgentMeta } from "@/components/agent-card";
import { AngleChart, Coverage, CreativeBatch, DocView, DraftsList, ExperimentBoard, FirstRun, OutboundQueue, PostsLibrary } from "@/components/system-views";
import type { System } from "@/server/agents/types";

/** What each system's agent makes, for its first-run panel. */
const FIRST: Record<System, { noun: string; promise: string }> = {
  customer_truth: {
    noun: "memo",
    promise: "It reads your signals and writes what the market is telling you, with a receipt for every claim.",
  },
  founder_content: {
    noun: "posts",
    promise: "It turns real customer pain from your signals into posts in the founder's voice.",
  },
  outbound_signal: {
    noun: "messages",
    promise: "It spots accounts showing a buying trigger and drafts a message for each.",
  },
  creative_testing: {
    noun: "batch",
    promise: "It turns one offer into angles and hooks worth testing, grounded in what customers say.",
  },
  ai_search: {
    noun: "answer pack",
    promise: "It checks which buyer questions your facts can answer and drafts the missing answers.",
  },
  growth_cockpit: {
    noun: "brief",
    promise: "It reads your metrics and signals and writes the weekly brief: what changed, what won, what to test next.",
  },
};

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
  const [agents, drafts, truth, brief, experiments, stats] = await Promise.all([
    listAgents(ctx, { readiness: true }),
    listDrafts(ctx, { system, limit: system === "outbound_signal" ? 100 : 60 }),
    system === "customer_truth" ? getDoc(ctx, "customer-truth/what-the-market-is-telling-us") : null,
    system === "growth_cockpit" ? getDoc(ctx, "cockpit/weekly-brief") : null,
    system === "creative_testing" ? listExperiments(ctx, 30) : [],
    signalStats(ctx),
  ]);
  const mine = agents.filter((a) => a.system === system);
  // The chart reads the same window the cockpit agent reads.
  const days = mine[0]?.spec.lookbackDays || 7;
  const angles = system === "growth_cockpit" ? await angleMetrics(ctx, days) : [];
  const canRun = can(ctx.role, "agents:run");
  const pendingOf = (type: string) => drafts.filter((d) => d.type === type && d.status === "pending");
  const totalSignals = stats.reduce((a, b) => a + b.total, 0);
  const lead = mine[0];
  const running = lead?.last_run && (lead.last_run.status === "queued" || lead.last_run.status === "running") ? lead.last_run.id : null;
  const hasOutput = drafts.length > 0 || !!truth?.content.trim() || !!brief?.content.trim() || experiments.length > 0;
  // Nothing made yet: one panel with the next step replaces the empty artifact views.
  const firstRun = !!lead && mine.length === 1 && !hasOutput;
  // Drafts the page already shows in full stay out of "Recent drafts".
  const shown = [
    pendingOf("market_memo")[0],
    pendingOf("cockpit_memo")[0],
    ...pendingOf("post"),
    drafts.find((d) => d.type === "creative_batch"),
    drafts.find((d) => d.type === "ai_answer_pack"),
  ].flatMap((d) => (d ? [d.id] : []));

  return (
    <div className="animate-in">
      <header className="mb-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-ink">{meta.label}</h1>
            <p className="mt-1 max-w-2xl text-[15px] text-ink-2">{meta.blurb}</p>
          </div>
          {mine.length === 1 ? <AgentActions agent={mine[0]!} canRun={canRun} run={!firstRun} quiet={drafts.some((d) => d.status === "pending")} /> : null}
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

      {firstRun ? (
        <>
          {system === "growth_cockpit" ? <AngleChart angles={angles} days={days} /> : null}
          <FirstRun
            agentId={lead!.id}
            agentName={lead!.name}
            readiness={lead!.readiness}
            noun={FIRST[system].noun}
            promise={FIRST[system].promise}
            canRun={canRun}
            canLoadSamples={totalSignals === 0 && can(ctx.role, "settings:manage")}
            activeRunId={running}
          />
        </>
      ) : (
        <>
          {system === "customer_truth" ? (
            <DocView
              doc={truth}
              title="Current truth file"
              pending={pendingOf("market_memo")}
              noun="memo"
              idle={{
                title: "No truth file yet",
                body: "Run the agent, then approve its memo. The approved memo becomes the source of truth every other agent reads.",
              }}
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
                idle={{
                  title: "No brief yet",
                  body: "Run the agent, then approve its brief. It becomes the weekly read every other agent starts from.",
                }}
              />
            </>
          ) : null}

          {system !== "outbound_signal" ? <DraftsList drafts={drafts} hide={shown} /> : null}
        </>
      )}
    </div>
  );
}

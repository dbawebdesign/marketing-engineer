import { notFound } from "next/navigation";
import { requireCtx } from "@/server/web/session";
import { listAgents } from "@/server/services/agents";
import { listDrafts } from "@/server/services/drafts";
import { docHistory, getDoc } from "@/server/services/memory";
import { listExperiments, angleMetrics } from "@/server/services/experiments";
import { signalStats } from "@/server/services/signals";
import { SYSTEM_META } from "@/server/agents/types";
import { SYSTEM_SLUGS, type SystemSlug } from "@/lib/systems";
import { updatedLine } from "@/lib/doc-credit";
import { docReceipts } from "@/server/services/doc-receipts";
import { can } from "@/lib/rbac";
import { AgentActions, AgentMeta } from "@/components/agent-card";
import { AngleChart, Coverage, CreativeBatch, DocView, DraftsList, ExperimentBoard, FirstRun, OutboundQueue, PendingBlock, PostsLibrary, primaryTest } from "@/components/system-views";
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
  const docKey = system === "customer_truth" ? "customer-truth/what-the-market-is-telling-us" : system === "growth_cockpit" ? "cockpit/weekly-brief" : null;
  const [agents, drafts, doc, history, experiments, stats, receipts] = await Promise.all([
    listAgents(ctx, { readiness: true }),
    listDrafts(ctx, { system, limit: system === "outbound_signal" ? 100 : 60 }),
    docKey ? getDoc(ctx, docKey) : null,
    docKey ? docHistory(ctx, docKey).catch(() => []) : [],
    system === "creative_testing" ? listExperiments(ctx, 30) : [],
    signalStats(ctx),
    docKey ? docReceipts(ctx, docKey).catch(() => []) : [],
  ]);
  const mine = agents.filter((a) => a.system === system);
  // The chart reads the same window the cockpit agent reads.
  const days = mine[0]?.spec.lookbackDays || 7;
  const angles = system === "growth_cockpit" ? await angleMetrics(ctx, days) : [];
  const canRun = can(ctx.role, "agents:run");
  const pending = drafts.filter((d) => d.status === "pending");
  const pendingOf = (type: string) => pending.filter((d) => d.type === type);
  const totalSignals = stats.reduce((a, b) => a + b.total, 0);
  const lead = mine[0];
  const running = lead?.last_run && (lead.last_run.status === "queued" || lead.last_run.status === "running") ? lead.last_run.id : null;
  const hasOutput = drafts.length > 0 || !!doc?.content.trim() || experiments.length > 0;
  // Nothing made yet: one panel with the next step replaces the empty artifact views.
  const firstRun = !!lead && mine.length === 1 && !hasOutput;
  // One primary action per page. Something waiting for review comes first (the tinted line), then a
  // queued test's next move, and only then Run. Everything else is secondary.
  const testFirst = pending.length ? null : system === "creative_testing" ? primaryTest(experiments, { write: can(ctx.role, "experiments:write"), run: canRun, hookLab: !!lead }) : null;
  const quiet = pending.length > 0 || !!testFirst;
  // Drafts the page already shows in full stay out of "Recent drafts".
  const shown = [
    ...drafts.filter((d) => d.type === "post" && (d.status === "approved" || d.status === "published")),
    // The latest approved memo or brief *is* the document shown above.
    drafts.find((d) => (d.type === "market_memo" || d.type === "cockpit_memo") && (d.status === "approved" || d.status === "published")),
    drafts.find((d) => d.type === "creative_batch"),
    drafts.find((d) => d.type === "ai_answer_pack" && (d.status === "approved" || d.status === "published")) ?? drafts.find((d) => d.type === "ai_answer_pack"),
  ].flatMap((d) => (d ? [d.id] : []));
  // Coverage counts approved packs only; a newer pack waiting for review is shown as pending.
  const approvedPack = drafts.find((d) => d.type === "ai_answer_pack" && (d.status === "approved" || d.status === "published"));
  const pendingPack = drafts.find((d) => d.type === "ai_answer_pack" && d.status === "pending" && (!approvedPack || +new Date(d.created_at) > +new Date(approvedPack.created_at)));
  const docView = (title: string, noun: string, idle: { title: string; body: string }) => (
    <DocView
      doc={doc}
      title={title}
      pending={pendingOf(noun)}
      slug={slug}
      idle={idle}
      updated={doc ? updatedLine(doc.updated_at, history[0]) : null}
      receipts={receipts}
      editHref={docKey && can(ctx.role, "memory:write") ? `/memory?doc=${encodeURIComponent(docKey)}&edit=1` : null}
    />
  );

  return (
    <div className="animate-in">
      <header className="mb-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-ink">{meta.label}</h1>
            <p className="mt-1 max-w-2xl text-[14px] text-ink-2">{meta.blurb}</p>
          </div>
          {/* One Run control, same place on every system page: secondary while something waits for review. */}
          {lead ? <AgentActions agent={lead} canRun={canRun} quiet={quiet} activeRunId={running} /> : null}
        </div>
        <div className="mt-3 space-y-2">
          {mine.map((a, i) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-2">
              <AgentMeta agent={a} />
              {i > 0 ? <AgentActions agent={a} canRun={canRun} quiet /> : null}
            </div>
          ))}
          {!mine.length ? <p className="text-[13px] text-ink-3">No agent runs this system yet. An admin can add one from Agents.</p> : null}
        </div>
      </header>

      {firstRun ? (
        <>
          {system === "growth_cockpit" ? <AngleChart angles={angles} days={days} /> : null}
          <FirstRun
            agentName={lead!.name}
            readiness={lead!.readiness}
            noun={FIRST[system].noun}
            promise={FIRST[system].promise}
            canLoadSamples={totalSignals === 0 && can(ctx.role, "settings:manage")}
          />
        </>
      ) : (
        <>
          {system === "customer_truth"
            ? docView("Current truth file", "market_memo", {
                title: "No truth file yet",
                body: "Run the agent, then approve its memo. It becomes the source of truth every other agent reads.",
              })
            : null}

          {system === "growth_cockpit" ? (
            <>
              {docView("This week's brief", "cockpit_memo", {
                title: "No brief yet",
                body: "Run the agent, then approve its brief. It becomes the weekly read every other agent starts from.",
              })}
              <AngleChart angles={angles} days={days} />
            </>
          ) : null}

          {/* Everything else: one line to the filtered inbox, at most one preview. */}
          {system === "founder_content" || system === "outbound_signal" || system === "creative_testing" || system === "ai_search" ? <PendingBlock drafts={pending} slug={slug} /> : null}

          {system === "founder_content" ? <PostsLibrary drafts={drafts} /> : null}

          {system === "outbound_signal" ? <OutboundQueue drafts={drafts} /> : null}

          {system === "creative_testing" ? (
            <>
              <ExperimentBoard experiments={experiments} primaryId={testFirst} hookLab={lead ? { id: lead.id, name: lead.name } : null} canWrite={can(ctx.role, "experiments:write")} canRun={canRun} />
              <CreativeBatch draft={drafts.find((d) => d.type === "creative_batch")} />
            </>
          ) : null}

          {system === "ai_search" ? <Coverage approved={approvedPack} pending={pendingPack} /> : null}

          {system !== "outbound_signal" ? <DraftsList drafts={drafts} hide={shown} slug={slug} /> : null}
        </>
      )}
    </div>
  );
}

import type { Ctx } from "@/lib/ctx";
import { can } from "@/lib/rbac";
import { nextStep, type NextStep, type StepAgent } from "@/lib/next-step";
import type { System } from "../agents/types";
import { listAgents, type Agent } from "./agents";
import { listDrafts, pendingCount } from "./drafts";
import { listExperiments, type Experiment } from "./experiments";
import { signalStats } from "./signals";
import { todayState } from "./review-extra";

/** The agents that build on the truth file, in the order they're worth running. */
export const DOWNSTREAM: System[] = ["founder_content", "outbound_signal", "creative_testing"];

type State = Awaited<ReturnType<typeof todayState>>;
type Stats = Awaited<ReturnType<typeof signalStats>>;

export function stepAgentOf(a: Agent, state: State): StepAgent {
  return {
    id: a.id,
    name: a.name,
    ready: !a.readiness || a.readiness.ready,
    signals: a.readiness?.signals ?? 0,
    neverRun: !a.last_run,
    activeRunId: state.active.find((r) => r.agent_id === a.id)?.id ?? null,
    need: a.readiness?.need,
    reason: a.readiness?.reason ?? null,
    days: a.readiness?.days,
  };
}

/**
 * The single next step for the workspace, from the readiness of every agent. Today, the Inbox's
 * clear state and /agents all ask this, so they never disagree. Pass what the page already loaded.
 */
export async function resolveNextStep(
  ctx: Ctx,
  pre: { introGaps?: number; agents?: Agent[]; state?: State; stats?: Stats; experiments?: Experiment[]; pendingTotal?: number; pendingMemos?: number } = {},
): Promise<{ step: NextStep; agents: Agent[]; state: State; stats: Stats; experiments: Experiment[] }> {
  const [agents, state, stats, experiments, pendingTotal, pendingMemos] = await Promise.all([
    pre.agents ?? listAgents(ctx, { readiness: true }),
    pre.state ?? todayState(ctx),
    pre.stats ?? signalStats(ctx),
    pre.experiments ?? listExperiments(ctx, 20),
    pre.pendingTotal ?? pendingCount(ctx),
    pre.pendingMemos ?? listDrafts(ctx, { status: "pending", limit: 50 }).then((r) => r.filter((d) => d.type === "market_memo").length),
  ]);
  const bySystem = (sys: System) => agents.find((a) => a.system === sys);
  const pulse = bySystem("customer_truth");
  const hookLab = bySystem("creative_testing");
  const step = nextStep({
    introGaps: pre.introGaps ?? 0,
    totalSignals: stats.reduce((a, b) => a + b.total, 0),
    weekSignals: stats.reduce((a, b) => a + b.week, 0),
    pulse: pulse ? stepAgentOf(pulse, state) : null,
    pendingMemoId: state.pendingMemoId,
    approvedMemo: state.approvedMemo,
    downstream: DOWNSTREAM.flatMap((sys) => {
      const a = bySystem(sys);
      return a && a.enabled !== false ? [stepAgentOf(a, state)] : [];
    }),
    hasHookLab: !!hookLab && (!hookLab.readiness || hookLab.readiness.ready),
    pendingDrafts: Math.max(pendingTotal - pendingMemos, 0),
    experiments: experiments.map((e) => ({
      id: e.id,
      name: e.name,
      status: e.status,
      variants: e.variants.length,
      measured: !!e.results?.measured,
      leader: e.results?.leader?.label ?? null,
    })),
    can: { run: can(ctx.role, "agents:run"), review: can(ctx.role, "drafts:review"), writeExperiments: can(ctx.role, "experiments:write") },
  });
  return { step, agents, state, stats, experiments };
}

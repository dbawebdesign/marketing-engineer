/**
 * The single most useful next step for a workspace, derived from its state.
 * Pure, so Today can render it and tests can pin the priority order.
 */

export type StepAgent = { id: string; name: string; ready: boolean; signals: number; neverRun: boolean; activeRunId: string | null };
export type StepExperiment = {
  id: string;
  name: string;
  status: string;
  variants: number;
  measured: boolean;
  leader: string | null;
};

export type NextStepInput = {
  /** Intro questions still unanswered and not skipped (empty when answered, skipped, or not the viewer's to answer). */
  introGaps: number;
  totalSignals: number;
  weekSignals: number;
  pulse: StepAgent | null;
  pendingMemoId: string | null;
  approvedMemo: boolean;
  /** Content drafter, Signal outreach and Hook lab, in that order, when the workspace has them. */
  downstream: StepAgent[];
  /** The workspace has an agent that writes hooks for a queued test. */
  hasHookLab: boolean;
  /** Pending drafts, excluding a pending memo. */
  pendingDrafts: number;
  experiments: StepExperiment[];
  can: { run: boolean; review: boolean; writeExperiments: boolean };
};

export type NextStep =
  | { kind: "intro" }
  | { kind: "add_signals"; signals: number; need: number; days: number | null }
  | { kind: "run_pulse"; agent: StepAgent }
  | { kind: "review_memo"; draftId: string }
  | { kind: "run_downstream"; agents: StepAgent[] }
  | { kind: "review_drafts"; count: number }
  | { kind: "start_test"; experiment: StepExperiment }
  | { kind: "hooks_for_test"; experiment: StepExperiment }
  | { kind: "call_test"; experiment: StepExperiment }
  | { kind: "fresh_signals" }
  | { kind: "caught_up" };

export function nextStep(s: NextStepInput): NextStep {
  if (s.introGaps > 0) return { kind: "intro" };
  if (s.totalSignals === 0) return { kind: "add_signals", signals: 0, need: 3, days: null };

  const memoExists = s.approvedMemo || !!s.pendingMemoId;
  if (!memoExists && s.pulse && s.can.run) {
    // Market pulse can't draft from a thin window: more signals first, unless it's already going.
    if (!s.pulse.ready && !s.pulse.activeRunId) return { kind: "add_signals", signals: s.pulse.signals, need: 3, days: 7 };
    return { kind: "run_pulse", agent: s.pulse };
  }
  if (s.pendingMemoId && s.can.review) return { kind: "review_memo", draftId: s.pendingMemoId };

  const idle = s.downstream.filter((a) => a.neverRun || a.activeRunId);
  // Stay on this step while those first runs are still going and nothing has landed yet.
  const stillGoing = idle.some((a) => a.activeRunId) && s.pendingDrafts === 0;
  if (s.approvedMemo && s.can.run && (idle.some((a) => a.neverRun) || stillGoing)) return { kind: "run_downstream", agents: idle };

  if (s.pendingDrafts > 0 && s.can.review) return { kind: "review_drafts", count: s.pendingDrafts };

  const queued = s.experiments.find((e) => e.status === "draft");
  if (queued) {
    if (queued.variants >= 2 && s.can.writeExperiments) return { kind: "start_test", experiment: queued };
    if (queued.variants < 2 && s.can.run && s.hasHookLab) return { kind: "hooks_for_test", experiment: queued };
  }
  const callable = s.experiments.find((e) => e.status === "running" && e.measured);
  if (callable && s.can.writeExperiments) return { kind: "call_test", experiment: callable };

  if (s.weekSignals === 0) return { kind: "fresh_signals" };
  return { kind: "caught_up" };
}

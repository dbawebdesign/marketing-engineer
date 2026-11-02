/**
 * The single most useful next step for a workspace, derived from its state.
 * Pure, so Today can render it and tests can pin the priority order.
 */

import { PULSE_MIN } from "@/server/agents/readiness";

export type StepAgent = {
  id: string;
  name: string;
  ready: boolean;
  signals: number;
  neverRun: boolean;
  activeRunId: string | null;
  /** Signals the agent needs (from its readiness); defaults to Market pulse's minimum. */
  need?: number;
  /** Why it can't run yet (from readiness), null when ready. */
  reason?: string | null;
  /** Its readiness window in days. */
  days?: number;
};
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
  /** The workspace has an agent that writes hooks for a queued test, and it has enough to read. */
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
  | { kind: "needs_input"; agent: StepAgent }
  | { kind: "fresh_signals" }
  | { kind: "caught_up" };

export function nextStep(s: NextStepInput): NextStep {
  if (s.introGaps > 0) return { kind: "intro" };
  if (s.totalSignals === 0) return { kind: "add_signals", signals: 0, need: s.pulse?.need ?? PULSE_MIN, days: null };

  const memoExists = s.approvedMemo || !!s.pendingMemoId;
  if (!memoExists && s.pulse && s.can.run) {
    // Market pulse can't draft from a thin window: more signals first, unless it's already going.
    if (!s.pulse.ready && !s.pulse.activeRunId) return { kind: "add_signals", signals: s.pulse.signals, need: s.pulse.need ?? PULSE_MIN, days: 7 };
    return { kind: "run_pulse", agent: s.pulse };
  }
  if (s.pendingMemoId && s.can.review) return { kind: "review_memo", draftId: s.pendingMemoId };

  // Offer only agents that would find something to draft (or are already working): the button names exactly these.
  const idle = s.downstream.filter((a) => a.activeRunId || (a.neverRun && a.ready));
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

  // Downstream agents that have never run and can't yet: say exactly what the first one is missing.
  if (s.approvedMemo && s.can.run && !s.downstream.some((a) => a.neverRun && a.ready)) {
    const blocked = s.downstream.find((a) => a.neverRun && !a.ready && !a.activeRunId);
    if (blocked) return { kind: "needs_input", agent: blocked };
  }

  if (s.weekSignals === 0) return { kind: "fresh_signals" };
  return { kind: "caught_up" };
}

type ReadinessLike = { ready: boolean; reason: string | null | undefined; need: number; days: number; signals?: number; reads?: "signals" | "metrics" };

/**
 * One short line on what an agent is missing, from its readiness: "Needs 1 signal naming a company
 * with a buying trigger from the last 14 days". Null when it's ready. Falls back to the full reason.
 */
export function needsLine(r: ReadinessLike | null | undefined): string | null {
  if (!r || r.ready) return null;
  const reason = (r.reason ?? "").trim();
  const days = `the last ${r.days} ${r.days === 1 ? "day" : "days"}`;
  if (r.reads === "metrics") return `Needs results (clicks, demo requests, replies) from ${days}`;
  if (/still empty/.test(reason)) return reason.replace(/^.*? needs /, "Needs ").replace(/\.$/, "");
  const m = reason.match(/ reads (.+?): (\d+) in the last \d+ days?(?:, (?:none|only \d+) (.+?))?\.(?: It needs.*)?$/);
  if (m) {
    const [, sources, have, noun] = m;
    if (noun) return `Needs ${r.need === 1 ? "a signal" : `${r.need} signals`} ${noun} from ${days}`;
    return `Needs at least ${r.need} ${r.need === 1 ? "signal" : "signals"} from ${sources} in ${days} (has ${have})`;
  }
  return reason ? reason.replace(/\.$/, "") : "Needs more to read first";
}

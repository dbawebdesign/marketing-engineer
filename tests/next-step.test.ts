import { describe, expect, it } from "vitest";
import { nextStep, type NextStepInput, type StepAgent } from "@/lib/next-step";

const agent = (name: string, o: Partial<StepAgent> = {}): StepAgent => ({ id: name, name, ready: true, signals: 10, neverRun: false, activeRunId: null, ...o });
const base: NextStepInput = {
  introGaps: 0,
  totalSignals: 20,
  weekSignals: 5,
  pulse: agent("Market pulse"),
  pendingMemoId: null,
  approvedMemo: true,
  downstream: [agent("Content drafter"), agent("Signal outreach"), agent("Hook lab")],
  hasHookLab: true,
  pendingDrafts: 0,
  experiments: [],
  can: { run: true, review: true, writeExperiments: true },
};
const kind = (o: Partial<NextStepInput>) => nextStep({ ...base, ...o }).kind;

describe("Today's next step", () => {
  it("follows the priority order", () => {
    expect(kind({ introGaps: 2, totalSignals: 0 })).toBe("intro");
    expect(kind({ totalSignals: 0 })).toBe("add_signals");
    expect(kind({ approvedMemo: false, pulse: agent("Market pulse", { ready: false, signals: 1 }) })).toBe("add_signals");
    expect(kind({ approvedMemo: false })).toBe("run_pulse");
    expect(kind({ approvedMemo: false, pendingMemoId: "m1", pendingDrafts: 4 })).toBe("review_memo");
    expect(kind({ downstream: [agent("Content drafter", { neverRun: true }), agent("Signal outreach", { neverRun: true })], pendingDrafts: 3 })).toBe("run_downstream");
    expect(kind({ pendingDrafts: 3 })).toBe("review_drafts");
    expect(kind({ experiments: [{ id: "e", name: "T", status: "draft", variants: 2, measured: false, leader: null }] })).toBe("start_test");
    expect(kind({ experiments: [{ id: "e", name: "T", status: "draft", variants: 1, measured: false, leader: null }] })).toBe("hooks_for_test");
    expect(kind({ experiments: [{ id: "e", name: "T", status: "running", variants: 2, measured: true, leader: "A" }] })).toBe("call_test");
    expect(kind({ weekSignals: 0 })).toBe("fresh_signals");
    expect(kind({})).toBe("caught_up");
  });
  it("runs only the downstream agents that haven't run, and stays put while they work", () => {
    const s = nextStep({ ...base, downstream: [agent("Content drafter", { neverRun: true }), agent("Signal outreach"), agent("Hook lab", { neverRun: true })] });
    expect(s.kind === "run_downstream" && s.agents.map((a) => a.name)).toEqual(["Content drafter", "Hook lab"]);
    expect(kind({ downstream: [agent("Content drafter", { activeRunId: "r1" })] })).toBe("run_downstream");
  });
  it("skips steps the viewer can't take", () => {
    expect(kind({ approvedMemo: false, pendingMemoId: "m1", can: { run: false, review: false, writeExperiments: false } })).toBe("caught_up");
  });
});

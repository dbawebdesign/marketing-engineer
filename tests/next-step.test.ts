import { describe, expect, it } from "vitest";
import { needsLine, nextStep, type NextStepInput, type StepAgent } from "@/lib/next-step";

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
  it("never offers an agent that can't run: names what the first one is missing instead", () => {
    const blocked = [
      agent("Content drafter", { neverRun: true, ready: false, reason: "Content drafter reads all your signals: 5 in the last 14 days, none it can build a post from." }),
      agent("Signal outreach", { neverRun: true, ready: false }),
    ];
    const s = nextStep({ ...base, downstream: blocked });
    expect(s.kind === "needs_input" && s.agent.name).toBe("Content drafter");
    // A queued test with an unready Hook lab doesn't send people to run it.
    expect(kind({ hasHookLab: false, experiments: [{ id: "e", name: "T", status: "draft", variants: 1, measured: false, leader: null }] })).toBe("caught_up");
  });
});

describe("needsLine", () => {
  it("says what an agent is missing in one short line", () => {
    expect(needsLine({ ready: true, reason: null, need: 1, days: 14 })).toBeNull();
    expect(needsLine({ ready: false, reason: "Signal outreach reads social posts and reviews: 0 in the last 14 days. It needs at least 1.", need: 1, days: 14 })).toBe(
      "Needs at least 1 signal from social posts and reviews in the last 14 days (has 0)",
    );
    expect(needsLine({ ready: false, reason: "Hook lab reads all your signals: 5 in the last 14 days, none with a buyer line.", need: 1, days: 14 })).toBe(
      "Needs a signal with a buyer line from the last 14 days",
    );
    expect(needsLine({ ready: false, reason: "x", need: 1, days: 7, reads: "metrics" })).toMatch(/^Needs results/);
  });
});

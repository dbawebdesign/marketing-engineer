import { describe, expect, it } from "vitest";
import type { SignalLite } from "@/server/agents/evidence";
import type { AgentTemplate, RunContext } from "@/server/agents/types";
import { getTemplate } from "@/server/agents/registry";
import { isRealTest, nothingToSay } from "@/server/agents/templates/customer-truth";
import { triggerOf } from "@/server/agents/templates/outbound-signal";
import { inferOutcome } from "@/server/agents/text";
import { nextStep, type NextStepInput, type StepAgent } from "@/lib/next-step";
import { runAllLabel } from "@/components/run-button";

let n = 0;
const sig = (source: string, content: string, o: Partial<SignalLite> = {}): SignalLite => ({
  id: `s${n++}`, source, content, title: "", url: null, account: null, occurred_at: "2026-11-01T09:00:00Z", metadata: {}, outcome: null, ...o,
});

function run(id: string, signals: SignalLite[], docs: Record<string, string> = {}, metrics?: RunContext["metrics"]) {
  const t = getTemplate(id)! as AgentTemplate;
  const rc: RunContext = {
    tenantName: "Fieldbook", agentName: t.name, spec: t.spec, signals, signalMap: new Map(signals.map((s) => [s.id, s])),
    docs: Object.fromEntries(Object.entries(docs).map(([k, c]) => [k, { key: k, title: k, content: c, version: 1 }])),
    rules: [], recentFeedback: [], metrics, input: {}, now: new Date("2026-11-02T09:00:00Z"),
  };
  return t.finalize(t.offline(rc) as never, rc);
}

const brightline = [
  "Talked to Dana, ops manager at Brightline Plumbing. They have 12 techs and schedule everything on a whiteboard. Dana said jobs get double booked at least twice a week.",
  "Second call with Brightline. Dana wants techs to see the day's schedule on their phones. She asked whether we integrate with QuickBooks.",
  "Demo for Dana and the owner Mike. Mike asked about price per tech and said the current tool is cheaper.",
  "Pricing discussion with Mike at Brightline. He thinks per tech pricing is hard to justify. Dana still worried about double booked jobs.",
  "Quick check-in with Dana. They are comparing us with Jobber. Dana said the whiteboard is a mess on Mondays.",
].map((c) => sig("sales_call", c, { account: "Brightline Plumbing" }));

describe("first runs tell the truth", () => {
  it("a memo with nothing changed is skipped with a specific reason, not drafted", () => {
    const r = run("market-pulse", brightline);
    expect(r.substantive).toBe(false);
    expect(r.drafts).toEqual([]);
    expect(r.summary).toBe(
      "Not enough to say what changed yet: 5 sales calls, all about Brightline Plumbing and none with a deal outcome. Add notes from deals you won or lost, or notes from other companies.",
    );
    expect(nothingToSay(brightline.map((s) => ({ ...s, account: null })))).toBe(
      "Not enough to say what changed yet: 5 sales calls, none with a deal outcome. Add notes from deals you won or lost, or more calls, tickets or reviews.",
    );
  });

  it("a memo omits empty sections and never recommends a placeholder test", () => {
    const signals = [
      sig("sales_call", "Sam said customers keep calling to ask when the tech will arrive. He wants automatic arrival texts. They signed today.", { account: "Northwind" }),
      sig("sales_call", "Priya said quotes take two days. She wants arrival texts too. Priya signed the contract.", { account: "Lakeside" }),
      sig("sales_call", "Pine Street went with a cheaper tool because price per tech was too high.", { account: "Pine Street" }),
      sig("support_ticket", "The app logs techs out every morning."),
      sig("review", "Arrival texts cut our calls in half."),
    ].map((s) => ({ ...s, outcome: inferOutcome(s.source, s.content) }));
    const r = run("market-pulse", signals);
    expect(r.substantive).toBe(true);
    const body = r.drafts[0]!.body;
    expect(body).not.toMatch(/##[^\n]*\n\s*(\n|$)/); // no heading followed by nothing
    expect(body).not.toMatch(/none of the 1 /);
    expect(isRealTest(r.drafts[0]!.payload!.recommended_test as never)).toBe(true);
  });

  it("only a real recommended test can be queued", () => {
    expect(isRealTest({ name: "Collect more signal", angle: "" })).toBe(false);
    expect(isRealTest({ name: "Collect more signal", angle: "anything" })).toBe(false);
    expect(isRealTest({ name: "Gather more data first", angle: "x" })).toBe(false);
    expect(isRealTest({ name: "Lead with arrival texts", angle: "" })).toBe(false);
    expect(isRealTest({ name: "Lead with arrival texts", angle: "Open with arrival texts." })).toBe(true);
    expect(isRealTest(null)).toBe(false);
  });

  it("a hook batch with no hooks is skipped, with no placeholder angle", () => {
    const r = run("hook-lab", brightline);
    expect(r.substantive).toBe(false);
    expect(r.drafts).toEqual([]);
    expect(r.summary).toMatch(/^No hook batch this time: 5 sales calls in the last 30 days, none with a buyer line/);
    expect(JSON.stringify(r)).not.toMatch(/the strongest angle/);
  });

  it("no posts means no draft and a reason", () => {
    const r = run("content-drafter", brightline);
    expect(r.substantive).toBe(false);
    expect(r.summary).toMatch(/^No posts this time: 5 sales calls, none with a dollar figure/);
  });

  it("signal outreach writes from a stated trigger and the summary names what's in the queue", () => {
    const hiring = sig("social", "Summit Heating is hiring two dispatchers for our new Denver branch. We are growing fast, now 30 techs.", { account: "Summit Heating" });
    expect(triggerOf(hiring)).toBe("hiring");
    expect(triggerOf(sig("social", "Great week at the trade show."))).toBeNull();
    expect(triggerOf(sig("sales_call", "They are hiring two techs."))).toBeNull();
    const none = run("signal-outreach", [hiring]);
    expect(none.substantive).toBe(false);
    expect(none.summary).toBe("No messages this time. Skipped: Summit Heating (No approved angle to pitch yet. Add one to Approved angles and run again).");
    const r = run("signal-outreach", [hiring], { "outbound/approved-angles": "- Arrival texts stop the where-is-my-tech calls" });
    expect(r.substantive).toBe(true);
    expect(r.summary).toBe("1 message ready for review: Summit Heating (hiring).");
    expect(r.drafts[0]!.body).toContain("Arrival texts stop the where-is-my-tech calls.");
    expect(r.drafts[0]!.body).not.toMatch(/replacement quote|truck/);
  });

  it("an answer pack with no answers is skipped", () => {
    expect(run("ai-visibility", [], { "ai-search/company-facts": "Fieldbook is scheduling software." }).substantive).toBe(false);
    const r = run("ai-visibility", [], { "ai-search/company-facts": "Fieldbook is scheduling software.", "ai-search/buyer-questions": "Does Fieldbook do payroll?" });
    expect(r.substantive).toBe(false);
    expect(r.summary).toMatch(/^No answers this time: your Company facts don't answer any of the 1 buyer question\b/);
  });

  it("a weekly brief with no results is skipped", () => {
    const r = run("weekly-cockpit", brightline, {}, { window: { from: "", to: "" }, totals: {}, byAngle: [], experiments: [], approvals: [] });
    expect(r.substantive).toBe(false);
    expect(r.summary).toMatch(/^No brief this time/);
  });

  it("reads a stated deal outcome from a pasted note, and nothing else", () => {
    expect(inferOutcome("sales_call", "Great call. They signed today.")).toBe("won");
    expect(inferOutcome("sales_call", "Pine Street went with a cheaper tool.")).toBe("lost");
    expect(inferOutcome("crm_note", "They went with Jobber in the end.")).toBe("lost");
    expect(inferOutcome("sales_call", "Owner said he went with us because of arrival texts.")).toBe("won");
    expect(inferOutcome("sales_call", "Dana asked about pricing.")).toBeNull();
    expect(inferOutcome("review", "We went with a cheaper tool.")).toBeNull();
  });
});

describe("Today offers only ready agents", () => {
  const agent = (name: string, o: Partial<StepAgent> = {}): StepAgent => ({ id: name, name, ready: true, signals: 10, neverRun: true, activeRunId: null, ...o });
  const base: NextStepInput = {
    introGaps: 0, totalSignals: 8, weekSignals: 8, pulse: agent("Market pulse", { neverRun: false }), pendingMemoId: null, approvedMemo: true,
    downstream: [agent("Content drafter"), agent("Signal outreach", { ready: false, signals: 0 }), agent("Hook lab", { ready: false, signals: 0 })],
    hasHookLab: true, pendingDrafts: 0, experiments: [], can: { run: true, review: true, writeExperiments: true },
  };
  it("names exactly the agents it will run", () => {
    const s = nextStep(base);
    expect(s.kind).toBe("run_downstream");
    const names = s.kind === "run_downstream" ? s.agents.map((a) => a.name) : [];
    expect(names).toEqual(["Content drafter"]);
    expect(runAllLabel(names)).toBe("Run Content drafter");
    expect(runAllLabel(["Content drafter", "Signal outreach", "Hook lab"])).toBe("Run Content drafter, Signal outreach and Hook lab");
  });
  it("skips the step when no downstream agent is ready", () => {
    const s = nextStep({ ...base, downstream: base.downstream.map((a) => ({ ...a, ready: false })) });
    expect(s.kind).not.toBe("run_downstream");
  });
  it("asks for Market pulse's real minimum", () => {
    const s = nextStep({ ...base, approvedMemo: false, pulse: agent("Market pulse", { ready: false, signals: 3 }) });
    expect(s).toEqual({ kind: "add_signals", signals: 3, need: 5, days: 7 });
  });
});

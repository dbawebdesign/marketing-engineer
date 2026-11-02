import { describe, expect, it } from "vitest";
import type { SignalLite } from "@/server/agents/evidence";
import type { AgentTemplate, RunContext } from "@/server/agents/types";
import { getTemplate } from "@/server/agents/registry";
import { inferOutcome, quoteLine, stripLabel } from "@/server/agents/text";

let n = 0;
const sig = (source: string, content: string, o: Partial<SignalLite> & { is_sample?: boolean } = {}): SignalLite => ({
  id: `r${n++}`, source, content, title: "", url: null, account: null, occurred_at: "2026-11-01T09:00:00Z", metadata: {}, outcome: null, ...o,
});

function run(id: string, signals: SignalLite[], input: Record<string, unknown> = {}) {
  const t = getTemplate(id)! as AgentTemplate;
  const rc: RunContext = {
    tenantName: "Routewise", agentName: t.name, spec: t.spec, signals, signalMap: new Map(signals.map((s) => [s.id, s])),
    docs: {}, rules: [], recentFeedback: [], input, now: new Date("2026-11-02T09:00:00Z"),
  };
  return t.finalize(t.offline(rc) as never, rc);
}

/** A fresh routing-software tenant: two sales calls, a ticket, a churn note, a G2 review. None is sample data. */
const routing = () =>
  [
    sig("sales_call", "Sales call with Maria (Fast Freight): Our dispatchers re-route every truck by hand each morning. Maria said they can't see where drivers are after 10am.", { account: "Fast Freight" }),
    sig("sales_call", "Sales call with Tom (Metro Couriers): Tom wants a drive-time report for each driver. He said the current tool is too expensive.", { account: "Metro Couriers" }),
    sig("support_ticket", "Support ticket: The route optimizer crashes when we add more than 40 stops."),
    sig("churn_note", "Churn note: They never set up the driver app. Only the office ever used it."),
    sig("review", "G2 review: \"Paid for itself in the first month because drivers stopped doubling back.\" Setup took a day."),
  ].map((s) => ({ ...s, outcome: inferOutcome(s.source, s.content) }));

const INVENTED = [
  /payback measured in weeks/i,
  /Replacement quotes, out the same day/i,
  /Paid for the year in the first month/i,
  /One customer's words, not ours/i,
  /inbound already arrives using that language/i,
  /Most cancellations are decided/i,
  /first two weeks/i,
  /replacement|truck to office|quote nobody sent|best tech/i,
  /\."\./,
];

describe("a real tenant's signals never get the sample business's copy", () => {
  it("labels and doubled punctuation are stripped from quotes", () => {
    expect(stripLabel("G2 review: Paid for itself.")).toBe("Paid for itself.");
    expect(stripLabel("Sales call with Maria (Fast Freight): Our dispatchers re-route.")).toBe("Our dispatchers re-route.");
    expect(stripLabel("Price: too high for us.")).toBe("Price: too high for us.");
    expect(quoteLine('"Paid for itself in the first month."')).toBe('"Paid for itself in the first month."');
    expect(quoteLine("It paid for itself")).toBe('"It paid for itself."');
  });

  it("Hook lab quotes the tenant verbatim and invents nothing", () => {
    const sigs = routing();
    const r = run("hook-lab", sigs);
    const text = JSON.stringify(r);
    for (const re of INVENTED) expect(text).not.toMatch(re);
    expect(text).not.toMatch(/G2 review:|Sales call with/);
    if (r.substantive) {
      const angles = r.drafts[0]!.payload!.angles as { hooks: string[] }[];
      const all = sigs.map((s) => s.content.replace(/\s+/g, " ")).join(" ");
      for (const h of angles.flatMap((a) => a.hooks)) expect(all).toContain(h.replace(/^"|"$/g, "").replace(/\.$/, ""));
      expect(r.drafts[0]!.payload!.ads).toEqual([]);
    }
  });

  it("sample signals still get the worded sample batch", () => {
    const s = sig("review", "Paid for the whole year in the first month. Replacement quotes go out the same day now.", { title: "G2 review", is_sample: true } as never);
    const r = run("hook-lab", [s]);
    expect(JSON.stringify(r)).toMatch(/One customer's words, not ours/);
  });

  it("a test phrase run builds hooks only from quotes that use the phrase", () => {
    const input = { experiment_id: "e1", experiment: "Lead with drive-time report", offer: "Lead with drive-time report" };
    const r = run("hook-lab", routing(), input);
    expect(r.substantive).toBe(true);
    const hooks = (r.drafts[0]!.payload!.angles as { hooks: string[] }[]).flatMap((a) => a.hooks);
    expect(hooks.length).toBeGreaterThan(0);
    for (const h of hooks) expect(h.toLowerCase()).toContain("drive-time report");
  });

  it("a test phrase no signal says is skipped with a reason, not renamed", () => {
    const input = { experiment_id: "e2", experiment: "Lead with fuel savings", offer: "Lead with fuel savings" };
    const r = run("hook-lab", routing(), input);
    expect(r.substantive).toBe(false);
    expect(r.drafts).toEqual([]);
    expect(r.summary).toMatch(/^No hook batch for "Lead with fuel savings": .*"fuel savings"/);
  });

  it("Founder content adds no generic claim to a churn post", () => {
    const text = JSON.stringify(run("content-drafter", routing()));
    for (const re of INVENTED) expect(text).not.toMatch(re);
    expect(text).not.toMatch(/Churn note:/);
  });

  it("Market pulse strips source labels and says what it read but didn't quote", () => {
    const r = run("market-pulse", routing());
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/Sales call with|G2 review:|Support ticket:|Churn note:/);
    expect(text).not.toMatch(/[.!?]’\./);
    if (r.substantive) {
      const body = r.drafts[0]!.body;
      const quoted = new Set((r.drafts[0]!.evidence ?? []).map((e) => e.signal_id));
      const unused = routing().length - quoted.size;
      if (unused > 0) expect(body).toMatch(new RegExp(`Not used: ${unused} signals? \\(`));
    }
  });
});

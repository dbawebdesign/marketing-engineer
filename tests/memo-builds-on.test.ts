import { describe, expect, it } from "vitest";
import type { SignalLite } from "@/server/agents/evidence";
import type { AgentTemplate, RunContext } from "@/server/agents/types";
import { getTemplate } from "@/server/agents/registry";
import { memoTestPhrase } from "@/server/agents/text";

let n = 0;
const sig = (source: string, content: string, o: Partial<SignalLite> & { is_sample?: boolean } = {}): SignalLite => ({
  id: `m${n++}`, source, content, title: "", url: null, account: null, occurred_at: "2026-11-01T09:00:00Z", metadata: {}, outcome: null, ...o,
});

const MEMO = `**Buyers keep asking for the drive-time report.**\n\n## Test this week\n**Lead with drive-time report.** Outreach that opens with drive-time report gets more replies. Run it on outbound; decided by qualified positive replies.`;

function run(id: string, signals: SignalLite[], docs: Record<string, string> = {}, input: Record<string, unknown> = {}) {
  const t = getTemplate(id)! as AgentTemplate;
  const rc: RunContext = {
    tenantName: "Dispatchly", agentName: t.name, spec: t.spec, signals, signalMap: new Map(signals.map((s) => [s.id, s])),
    docs: Object.fromEntries(Object.entries(docs).map(([key, content]) => [key, { key, title: key, content, version: 1 }])),
    rules: [], recentFeedback: [], input, now: new Date("2026-11-02T09:00:00Z"),
  };
  return t.finalize(t.offline(rc) as never, rc);
}

const churn = () => sig("churn_note", "Cancelled because the app drains battery on older Androids. Our techs never got past lunch on one charge.", { account: "Summit Heating" });

describe("memo test phrase", () => {
  it("parses the approved memo's test", () => {
    expect(memoTestPhrase(MEMO)).toBe("Lead with drive-time report");
    expect(memoTestPhrase("**No test.**")).toBeNull();
    expect(memoTestPhrase(undefined)).toBeNull();
  });
});

describe("content drafter on a real churn note", () => {
  it("invents no date, call or lesson and names the source as a churn note", () => {
    const r = run("content-drafter", [churn()]);
    const all = JSON.stringify(r.drafts);
    expect(all).not.toMatch(/this month|this week|exit call|onboarding is the product|hasn't set up yet/i);
    expect(all).toMatch(/churn note/i);
    expect(all).toMatch(/drains battery on older Androids/);
    const meta = (r.drafts[0]!.payload as { meta: { label: string }[] }).meta;
    expect(meta.some((m) => m.label === "Angle")).toBe(false);
  });

  it("keeps the worded lesson for sample churn notes", () => {
    const r = run("content-drafter", [{ ...churn(), is_sample: true } as SignalLite]);
    expect(JSON.stringify(r.drafts)).toMatch(/exit call/);
  });
});

describe("agents build on the approved memo", () => {
  const sigs = () => [
    churn(),
    sig("churn_note", "We left because dispatchers wanted a drive-time report and never got one. Only the map view was there.", { account: "Polar Mechanical" }),
  ];

  it("content drafter prefers the signal that mentions the memo's test phrase", () => {
    const r = run("content-drafter", sigs(), { "customer-truth/what-the-market-is-telling-us": MEMO });
    expect(JSON.stringify(r.drafts)).toMatch(/drive-time report/);
  });

  it("content drafter falls back when no signal mentions it", () => {
    const r = run("content-drafter", [churn()], { "customer-truth/what-the-market-is-telling-us": MEMO });
    expect(JSON.stringify(r.drafts)).toMatch(/battery/);
  });

  it("hook lab with no explicit test defaults to the memo's test phrase", () => {
    const r = run("hook-lab", sigs(), { "customer-truth/what-the-market-is-telling-us": MEMO });
    expect(r.substantive).toBe(true);
    const p = r.drafts[0]!.payload as { angles: { hooks: string[] }[] };
    const hooks = p.angles.flatMap((a) => a.hooks);
    expect(hooks.length).toBeGreaterThan(0);
    for (const h of hooks) expect(h.toLowerCase()).toMatch(/drive-time report/);
  });

  it("hook lab falls back to current behaviour when no quote uses the memo phrase", () => {
    const r = run("hook-lab", [sig("support_ticket", "We have no idea which jobs ran over.")], { "customer-truth/what-the-market-is-telling-us": MEMO });
    expect(r.substantive).toBe(true);
    expect(JSON.stringify(r.drafts)).not.toMatch(/drive-time/);
  });
});

describe("hook lab without offers on a real tenant", () => {
  it("shows no placeholder offer", () => {
    const r = run("hook-lab", [sig("support_ticket", "We have no idea which jobs ran over.")]);
    expect(r.substantive).toBe(true);
    expect(`${r.summary}${JSON.stringify(r.drafts)}`).not.toMatch(/Our main offer/);
  });
});

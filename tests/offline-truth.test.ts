import { describe, expect, it } from "vitest";
import type { SignalLite } from "@/server/agents/evidence";
import type { AgentTemplate, RunContext } from "@/server/agents/types";
import { getTemplate } from "@/server/agents/registry";
import { OFFLINE_SINGLE } from "@/server/agents/templates/customer-truth";
import { lossSentence, postable } from "@/server/agents/templates/founder-content";
import { painScore, strongestSentences, topPhrases, weakPhrase } from "@/server/agents/text";
import { draftTypesFor } from "@/server/services/search";
import { draftHref } from "@/lib/search-links";

let n = 0;
const sig = (source: string, content: string, o: Partial<SignalLite> = {}): SignalLite => ({
  id: `t${n++}`, source, content, title: "", url: null, account: null, occurred_at: "2026-11-01T09:00:00Z", metadata: {}, outcome: null, ...o,
});

function run(id: string, signals: SignalLite[]) {
  const t = getTemplate(id)! as AgentTemplate;
  const rc: RunContext = {
    tenantName: "Dispatchly", agentName: t.name, spec: t.spec, signals, signalMap: new Map(signals.map((s) => [s.id, s])),
    docs: {}, rules: [], recentFeedback: [], input: {}, now: new Date("2026-11-02T09:00:00Z"),
  };
  return t.finalize(t.offline(rc) as never, rc);
}

// The critic's example week: the only repeated words are two prices.
const critic = () => [
  sig("sales_call", "Call with Polar Mechanical: dispatch takes us 2 hours of manual routing every morning, 50 min per tech.", { account: "Polar Mechanical" }),
  sig("sales_call", "Call with Ridge HVAC. $149 per tech is steep for apprentices.", { account: "Ridge HVAC" }),
  sig("support_ticket", "When a job runs long we have to re-route everyone by hand.", { account: "Cobalt Air" }),
  sig("review", "The app drains phone battery by lunch on a busy day.", { account: "Summit Heating" }),
];

describe("offline themes are content, not fragments", () => {
  it("rejects unit and stopword fragments", () => {
    for (const p of ["per tech", "min per tech", "149 per tech", "lot time", "hour manual"]) expect(weakPhrase(p)).toBe(true);
    for (const p of ["manual routing", "arrival text", "price per tech"]) expect(weakPhrase(p)).toBe(false);
    const ps = topPhrases(critic().map((s) => s.content), 12, 2).map((p) => p.phrase);
    expect(ps.join("|")).not.toMatch(/per tech/);
  });

  it("finds pain-shaped sentences", () => {
    expect(painScore("When a job runs long we have to re-route everyone by hand.")).toBeGreaterThan(painScore("We met at the trade show."));
    const top = strongestSentences(critic(), 4).map((x) => x.sentence).join(" ");
    expect(top).toMatch(/re-route everyone by hand/);
    expect(top).toMatch(/manual routing/);
  });

  it("market pulse says no theme repeats and quotes single signals instead of 'per tech'", () => {
    const r = run("market-pulse", critic());
    expect(r.substantive).toBe(true);
    const d = r.drafts[0]!;
    const all = `${d.body}\n${JSON.stringify(d.payload)}\n${r.summary}`;
    expect(all.toLowerCase()).not.toContain("per tech”");
    expect(all).not.toMatch(/“per tech”|Lead with per tech|without being asked/);
    expect(d.payload!.headline).toMatch(/^No theme repeats/);
    expect(d.body).toContain(OFFLINE_SINGLE);
    expect(d.body).toMatch(/re-route everyone by hand|manual routing/);
    expect(d.body).not.toMatch(/## Test this week/);
    // The price comment is an objection, labelled as price, quoted as said.
    expect(d.body).toMatch(/\*\*Price\*\*[^\n]*\n\s*> "[^"]*\$149 per tech is steep for apprentices\./);
  });

  it("a real recurring theme is labelled as an unverified offline match", () => {
    const sigs = [
      ...critic(),
      sig("sales_call", "Owner at Bay Plumbing says manual routing eats his whole morning.", { account: "Bay Plumbing" }),
      sig("support_ticket", "Still doing manual routing in a spreadsheet, please fix.", { account: "Elm Electric" }),
    ];
    const r = run("market-pulse", sigs);
    expect(r.drafts[0]!.body).toMatch(/Recurring phrase \(offline match, unverified\): “manual routing”/);
  });
});

describe("offline posts never invent a loss", () => {
  it("a price is not a loss", () => {
    const price = sig("sales_call", "Call with Ridge HVAC. $149 per tech is steep for apprentices.");
    expect(lossSentence(price)).toBeNull();
    expect(postable(price)).toBe(false);
    expect(lossSentence(sig("crm_note", "Owner said they lost a $48,000 replacement job last spring because nobody followed up."))).toMatch(/\$48,000/);
  });

  it("content drafter writes nothing loss-shaped from the critic's week", () => {
    const r = run("content-drafter", critic());
    const all = r.drafts.map((d) => `${d.title}\n${d.body}\n${JSON.stringify(d.payload)}`).join("\n");
    expect(all).not.toMatch(/\$149, gone|never showed up on a report|cost more than a year of software/);
    expect(all).not.toMatch(/\$149[^\n]*(lost|missed|cost|gone)/i);
  });

  it("insights quote the signal", () => {
    const s = sig("crm_note", "Owner said they lost a $48,000 replacement job last spring because nobody followed up.");
    const r = run("content-drafter", [s]);
    const insight = String((r.drafts[0]!.payload as { insight: string }).insight);
    expect(insight).toContain("lost a $48,000 replacement job");
    expect(insight).not.toMatch(/a year of software|never showed up/);
  });
});

describe("palette search terms", () => {
  it("'memo' finds memo drafts by type; short queries don't", () => {
    expect(draftTypesFor("memo")).toEqual(expect.arrayContaining(["market_memo", "cockpit_memo"]));
    expect(draftTypesFor("memos")).toContain("market_memo");
    expect(draftTypesFor("me")).toEqual([]);
  });
  it("draft links carry their inbox tab", () => {
    expect(draftHref({ id: "x", status: "approved" })).toBe("/inbox?d=x&tab=approved");
    expect(draftHref({ id: "x", status: "published" })).toBe("/inbox?d=x&tab=approved");
    expect(draftHref({ id: "x", status: "pending" })).toBe("/inbox?d=x&tab=pending");
  });
});

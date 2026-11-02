import { describe, expect, it } from "vitest";
import type { SignalLite } from "@/server/agents/evidence";
import type { AgentTemplate, RunContext } from "@/server/agents/types";
import { getTemplate } from "@/server/agents/registry";
import { isObjection } from "@/server/agents/templates/customer-truth";
import { sentences } from "@/server/agents/text";
import { nestQuotes, stripOuterQuotes, tidyQuote } from "@/lib/quotes";
import { normQuote, receiptFor } from "@/lib/receipts";

let n = 0;
const sig = (source: string, content: string, o: Partial<SignalLite> = {}): SignalLite => ({
  id: `p${n++}`, source, content, title: "", url: null, account: null, occurred_at: "2026-11-01T09:00:00Z", metadata: {}, outcome: null, ...o,
});

function run(signals: SignalLite[]) {
  const t = getTemplate("market-pulse")! as AgentTemplate;
  const rc: RunContext = {
    tenantName: "Dispatchly", agentName: t.name, spec: t.spec, signals, signalMap: new Map(signals.map((s) => [s.id, s])),
    docs: {}, rules: [], recentFeedback: [], input: {}, now: new Date("2026-11-02T09:00:00Z"),
  };
  return t.finalize(t.offline(rc) as never, rc);
}

// Pasted notes from five sources across several companies.
const week = () => [
  sig("sales_call", 'Sales call with Priya Shah at Northwind HVAC. She said "if the drive-time report works on the truck I\'ll use it." Pricing came up but she did not push back.', { account: "Northwind HVAC" }),
  sig("sales_call", "Sales call with Dan Ortiz at Bluefin Plumbing. Dan asked whether the drive-time report can be emailed to him on Fridays. He thinks $149 per tech is too expensive for apprentices.", { account: "Bluefin Plumbing" }),
  sig("support_ticket", "Ticket from Cedar Electric: the schedule view is confusing and the reassign button is buried under three menus.", { account: "Cedar Electric" }),
  sig("churn_note", "Churn note for Maple Mechanical: they left for a competitor that bundles invoicing with dispatch.", { account: "Maple Mechanical" }),
  sig("review", "G2 review from an ops manager at Granite Air: Price fine if it saves 30 min a day. Routing suggestions are good but the mobile app logs techs out at lunch.", { account: "Granite Air" }),
];

/** Each bullet of a section with the quotes printed under it. */
function bullets(body: string, heading: string) {
  const sec = body.split(/\n## /).find((s) => s.startsWith(heading)) ?? "";
  return sec
    .split(/\n- /)
    .slice(1)
    .map((b) => ({ head: b.split("\n")[0]!, quotes: b.split("\n").filter((l) => /^\s*> "/.test(l)) }));
}

describe("market pulse receipts match their counts", () => {
  const r = run(week());
  const d = r.drafts[0]!;
  const body = d.body;
  const evidence = d.evidence as { signal_id: string; quote: string }[];

  it("a recurring phrase in 2 calls lists both calls as quotes, each opening its own signal", () => {
    const theme = bullets(body, "What changed").find((b) => /drive-time report/.test(b.head));
    expect(theme, body).toBeTruthy();
    const count = Number(/came up in (\d+)/.exec(theme!.head)![1]);
    expect(count).toBe(2);
    expect(theme!.quotes).toHaveLength(count);
    expect(theme!.quotes.join("\n")).toMatch(/Northwind HVAC/);
    expect(theme!.quotes.join("\n")).toMatch(/Bluefin Plumbing/);
    // Each printed quote resolves to a receipt from its own signal.
    const quotes = evidence.map((e) => normQuote(e.quote));
    const accounts = theme!.quotes.map((l) => {
      const m = /> "(.*)" \(/.exec(l)!;
      const i = receiptFor(m[1]!, quotes);
      expect(i).toBeGreaterThanOrEqual(0);
      return (evidence[i] as { account?: string }).account;
    });
    expect(new Set(accounts)).toEqual(new Set(["Northwind HVAC", "Bluefin Plumbing"]));
  });

  it("every objection's count equals the quotes shown, and accepting price is not an objection", () => {
    const obs = bullets(body, "Objections");
    expect(obs.length).toBeGreaterThan(0);
    for (const o of obs) expect(Number(/\((\d+)\)/.exec(o.head)![1])).toBe(o.quotes.length);
    expect(body).not.toMatch(/Price fine if it saves 30 min/);
    const price = obs.find((o) => o.head.includes("**Price**"));
    expect(price?.quotes.join("\n")).toMatch(/too expensive for apprentices/);
  });

  it("no quote is broken across lines or nested with straight double quotes", () => {
    for (const l of body.split("\n").filter((x) => /^\s*> /.test(x))) {
      const m = /^\s*> "([^"\n]+)" \([^)]*\)$/.exec(l);
      expect(m, `bad receipt line: ${l}`).toBeTruthy();
    }
    expect(body).not.toMatch(/^\s*> "\s/m);
    expect(body).toMatch(/> "She said ‘if the drive-time report works on the truck I'll use it\.’" \(sales call, Northwind HVAC\)/);
  });

  it("the headline does not begin or end with a quote mark", () => {
    const h = String((d.payload as { headline: string }).headline);
    expect(h).not.toMatch(/^["“‘']|["”’']$/);
    expect(h).not.toMatch(/["“”]/);
  });
});

describe("objection direction", () => {
  it("treats acceptance as not an objection", () => {
    expect(isObjection("Price fine if it saves 30 min a day.")).toBe(false);
    expect(isObjection("Happy to pay the price if it works.")).toBe(false);
    expect(isObjection("Honestly the cost is worth it for us.")).toBe(false);
    expect(isObjection("$149 per tech is steep for apprentices.")).toBe(true);
    expect(isObjection("The price is not fine for a three-truck shop.")).toBe(true);
    expect(isObjection("The cost isn't worth it yet.")).toBe(true);
    expect(isObjection("Pricing came up but she did not push back.")).toBe(false);
  });
});

describe("quote punctuation", () => {
  it("never splits a sentence inside a quote, and keeps the closing mark with its sentence", () => {
    const ss = sentences('She said "it is great. I\'ll use it on the truck." Pricing came up at the very end of the call.');
    expect(ss[0]).toBe('She said "it is great. I\'ll use it on the truck."');
    expect(ss[1]).toMatch(/^Pricing came up/);
  });
  it("tidies quotes for printing inside double quotes", () => {
    expect(tidyQuote('She said "if it works I\'ll use it."')).toBe("She said ‘if it works I'll use it.’");
    expect(tidyQuote('" Pricing was fine.')).toBe("Pricing was fine.");
    expect(tidyQuote("“drive-time report”")).toBe("drive-time report");
  });
  it("strips only quotes that wrap the whole string", () => {
    expect(stripOuterQuotes("“drive-time report” came up in 2 calls")).toBe("“drive-time report” came up in 2 calls");
    expect(stripOuterQuotes("“drive-time report”")).toBe("drive-time report");
    expect(stripOuterQuotes('"Fine."')).toBe("Fine.");
    expect(stripOuterQuotes('"a" and "b"')).toBe('"a" and "b"');
    expect(nestQuotes('the "drive-time report" ask')).toBe("the ‘drive-time report’ ask");
  });
});

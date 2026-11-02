import { describe, expect, it } from "vitest";
import { computeResults, metricKind, verdictLine } from "@/lib/experiment-results";
import { receiptFor, receiptsWithPhrase, normQuote } from "@/lib/receipts";
import { winnerSection } from "@/server/services/experiments";

const e = {
  id: "e1",
  metric: "demo_request",
  variants: [
    { id: "h1.1", label: "Hook 1.1 · Leak", content: "You can't fix a leak you can't count.", angle: "Leak" },
    { id: "h1.2", label: "Hook 1.2 · Leak", content: "Count the quotes nobody sent.", angle: "Leak" },
    { id: "h2.1", label: "Hook 2.1 · Handoff", content: "The handoff breaks at the office.", angle: "Handoff" },
  ],
};

describe("experiment results", () => {
  it("maps prose metrics to event kinds", () => {
    expect(metricKind("Qualified positive replies")).toBe("qualified_reply");
    expect(metricKind("demo_request")).toBe("demo_request");
    expect(metricKind("Click-through rate")).toBe("click");
  });

  it("scores arms per 100 clicks from angle- and variant-tagged events", () => {
    const r = computeResults(e, [
      { kind: "click", value: 50, angle: "leak", variant: null, experiment_id: null },
      { kind: "demo_request", value: 5, angle: "Leak", variant: null, experiment_id: null },
      { kind: "click", value: 20, angle: null, variant: "h2.1", experiment_id: "e1" },
      { kind: "demo_request", value: 1, angle: null, variant: "h2.1", experiment_id: "e1" },
      { kind: "click", value: 999, angle: null, variant: "h2.1", experiment_id: "other" },
    ]);
    expect(r.arms).toHaveLength(2);
    expect(r.leader?.label).toBe("Leak");
    expect(r.leader?.score).toBeCloseTo(10);
    expect(r.runnerUp?.score).toBeCloseTo(5);
    expect(verdictLine(r)).toBe("Leak: 10.0 demo requests per 100 clicks vs 5.0 for Handoff");
    const s = winnerSection({ name: "Test" }, r, new Date("2026-11-02T12:00:00Z"));
    expect(s).toContain("## Leak");
    expect(s).toContain("- Count the quotes nobody sent.");
  });

  it("has no leader without hits", () => {
    const r = computeResults(e, [{ kind: "click", value: 10, angle: "Leak", variant: null, experiment_id: null }]);
    expect(r.measured).toBe(true);
    expect(r.leader).toBeNull();
  });
});

describe("receipts in prose", () => {
  const quotes = ["Main complaint was emergency dispatch at night and juggling the on-call schedule.", "Left for a competitor that bundles payroll."].map(normQuote);
  it("matches a quoted passage to its receipt", () => {
    expect(receiptFor("Main complaint was emergency dispatch at night and juggling the on-call schedule.", quotes)).toBe(0);
    expect(receiptFor("a competitor that bundles payroll", quotes)).toBe(1);
    expect(receiptFor("emergency dispatch", quotes)).toBe(-1);
  });
  it("finds receipts containing a claim's phrase", () => {
    expect(receiptsWithPhrase("emergency dispatch", quotes)).toEqual([0]);
    expect(receiptsWithPhrase("payroll", quotes)).toEqual([]);
  });
});

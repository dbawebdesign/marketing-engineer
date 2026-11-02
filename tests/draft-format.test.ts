import { describe, expect, it } from "vitest";
import { dedupeEvidence } from "@/server/agents/evidence";
import { draftTitle, fromSignals, meta, shippable, shortDate } from "@/server/agents/format";
import { TEMPLATES } from "@/server/agents/registry";
import { DEMO_DOCS, DEMO_SIGNALS } from "@/server/demo";
import type { RunContext } from "@/server/agents/types";

describe("draft format", () => {
  it("strips trailing scaffolding so the body is what ships", () => {
    const body = "Hook line.\n\nThe post.\n\n---\n**Platform:** LinkedIn (40 words)\n**Angle:** lost revenue";
    expect(shippable(body)).toBe("Hook line.\n\nThe post.");
    expect(shippable("**Platform:** X\nJust the post.\n#hvac #growth")).toBe("Just the post.");
  });

  it("titles never repeat the first line, drop platform prefixes and stay short", () => {
    expect(draftTitle("What buyers open with.\n\nMore.", "What buyers open with.", "Follow-up quotes")).toBe("Follow-up quotes");
    expect(draftTitle("Body", "LinkedIn: the $48k quote")).toBe("The $48k quote");
    expect(draftTitle("Body", "x".repeat(40) + " " + "y".repeat(40)).length).toBeLessThanOrEqual(70);
  });

  it("formats dates and sources for people", () => {
    expect(shortDate(new Date("2026-11-02T09:00:00Z"))).toBe("Nov 2");
    expect(fromSignals([{ signal_id: "a", source: "sales_call" }, { signal_id: "b", source: "sales_call" }, { signal_id: "a", source: "sales_call" }, { signal_id: "c", source: "review" }])).toBe("2 sales calls, 1 review");
    expect(meta(["A", "x"], ["B", null], ["C", ""])).toEqual([{ label: "A", value: "x" }]);
  });

  it("deduplicates receipts by signal and normalized quote", () => {
    const d = dedupeEvidence([
      { signal_id: "a", quote: "The quote never went out." },
      { signal_id: "a", quote: "the quote never went out" },
      { signal_id: "b", quote: "The quote never went out." },
    ]);
    expect(d).toHaveLength(2);
  });
});

describe("offline drafts", () => {
  const signals = DEMO_SIGNALS.map((s, i) => ({
    id: `sig-${i}`, source: s.source, content: s.content, title: s.title ?? "", url: s.url ?? null, account: s.account ?? null,
    occurred_at: new Date((s.occurred_at as Date | string | undefined) ?? Date.now()).toISOString(), metadata: s.metadata ?? {}, outcome: (s.metadata?.outcome as string) ?? null,
  }));
  const docs = Object.fromEntries(Object.entries(DEMO_DOCS).map(([k, c]) => [k, { key: k, title: k, content: c, version: 1 }]));
  const byAngle = [["A", 38, 9], ["B", 71, 4]].flatMap(([a, c, d]) => [{ angle: a as string, kind: "click", value: c as number }, { angle: a as string, kind: "demo_request", value: d as number }]);
  for (const t of TEMPLATES) {
    it(`${t.id}: body ships clean, meta carries the rest`, () => {
      const rc: RunContext = {
        tenantName: "Dispatchly", agentName: t.name, spec: t.spec, signals, signalMap: new Map(signals.map((s) => [s.id, s])), docs, rules: [], recentFeedback: [],
        metrics: t.needsMetrics ? { window: { from: "", to: "" }, totals: { click: 109, demo_request: 13 }, byAngle, experiments: [], approvals: [] } : undefined,
        input: {}, now: new Date("2026-11-02T09:00:00Z"),
      };
      const r = t.finalize(t.offline(rc) as never, rc);
      expect(r.drafts.length).toBeGreaterThan(0);
      expect(r.substantive).toBe(true);
      for (const d of r.drafts) {
        expect(d.body).not.toMatch(/\n---\n|^---$/m);
        expect(d.body).not.toMatch(/\*\*(Platform|Came from|Angle|Fit [0-9]|Offer|Hypothesis|Channel):?\*\*/);
        expect(d.body).not.toMatch(/offline engine|connect (a )?claude/i);
        expect(d.title.length).toBeLessThanOrEqual(70);
        expect(d.title).not.toMatch(/^(LinkedIn|X):|\d{4}-\d{2}-\d{2}/);
        const first = d.body.split("\n")[0]!.replace(/[*_#]/g, "").trim();
        expect(d.title).not.toBe(first);
        expect(Array.isArray((d.payload as { meta?: unknown }).meta)).toBe(true);
      }
    });
  }
});

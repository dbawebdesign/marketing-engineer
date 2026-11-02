import { describe, expect, it } from "vitest";
import { countLoaded, MIN_SIGNALS, readinessOf } from "@/server/agents/readiness";
import { getTemplate } from "@/server/agents/registry";
import type { SignalLite } from "@/server/agents/evidence";

const sig = (o: Partial<SignalLite>, i = 0): SignalLite => ({ id: `s${i}`, source: "sales_call", content: "", title: "", url: null, account: null, occurred_at: "2026-11-01", metadata: {}, ...o });

describe("agent readiness", () => {
  it("holds signal agents below the minimum and names what they read", () => {
    const r = readinessOf({ name: "Market pulse" }, { signals: 1, metrics: 0 }, 14);
    expect(r.ready).toBe(false);
    expect(r.reason).toBe(`Market pulse reads all your signals: 1 in the last 14 days. It needs at least ${MIN_SIGNALS}.`);
    expect(readinessOf({}, { signals: MIN_SIGNALS, metrics: 0 }, 7).ready).toBe(true);
  });

  it("counts only the sources an agent reads, and says so", () => {
    const outbound = getTemplate("signal-outreach")!;
    const r = readinessOf({ ...outbound, name: "Signal outreach" }, { signals: 0, usable: 0, metrics: 0 }, 14);
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("Signal outreach reads social posts, CRM notes, reviews and other notes: 0 in the last 14 days. It needs at least 1.");
  });

  it("signal outreach needs a company with a buying trigger, not just any post", () => {
    const tpl = { ...getTemplate("signal-outreach")!, name: "Signal outreach" };
    const docs = { "outbound/approved-angles": { content: "- Arrival texts stop the where-is-my-tech calls" } };
    const plain = [sig({ source: "social", account: "Summit", content: "Great week at the trade show, thanks to everyone who stopped by." })];
    const r = readinessOf(tpl, countLoaded(tpl, plain, 0, docs, true), 14);
    expect(r.ready).toBe(false);
    expect(r.reason).toMatch(/^Signal outreach reads social posts, CRM notes, reviews and other notes: 1 in the last 14 days, none naming a company with a buying trigger/);
    const hiring = [sig({ source: "social", account: "Summit", content: "Summit Heating is hiring two dispatchers for our new Denver branch." })];
    expect(readinessOf(tpl, countLoaded(tpl, hiring, 0, docs, true), 14).ready).toBe(true);
    // No approved angle: nothing to pitch, so it isn't offered.
    const noAngles = readinessOf(tpl, countLoaded(tpl, hiring, 0, {}, true), 14);
    expect(noAngles.ready).toBe(false);
    expect(noAngles.reason).toBe("Signal outreach needs your Approved angles, and it's still empty. Fill it in and run again.");
  });

  it("the answer builder waits for its docs, not for signals", () => {
    const tpl = { ...getTemplate("ai-visibility")!, name: "Answer builder" };
    const r = readinessOf(tpl, countLoaded(tpl, [], 0, { "ai-search/company-facts": { content: "We sell X." } }, true), 30);
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("Answer builder needs your Buyer questions and Company facts: Buyer questions is still empty. Fill it in and run again.");
    expect(readinessOf(tpl, countLoaded(tpl, [], 0, { "ai-search/company-facts": { content: "x" }, "ai-search/buyer-questions": { content: "y?" } }, true), 30).ready).toBe(true);
  });

  it("offline-only tests don't apply when a model writes", () => {
    const tpl = { ...getTemplate("hook-lab")!, name: "Hook lab" };
    const plain = [0, 1, 2].map((i) => sig({ content: "Talked scheduling for a while." }, i));
    expect(readinessOf(tpl, countLoaded(tpl, plain, 0, {}, true), 30).ready).toBe(false);
    expect(readinessOf(tpl, countLoaded(tpl, plain, 0, {}, false), 30).ready).toBe(true);
  });

  it("the cockpit waits for results; signals alone make an empty brief", () => {
    expect(readinessOf({ needsMetrics: true }, { signals: 0, metrics: 5 }, 7).ready).toBe(true);
    const none = readinessOf({ needsMetrics: true, name: "Weekly review" }, { signals: 8, metrics: 0 }, 7);
    expect(none.ready).toBe(false);
    expect(none.reason).toMatch(/^Weekly review reads results/);
  });
});

import { describe, expect, it } from "vitest";
import { MIN_SIGNALS, readinessOf } from "@/server/agents/readiness";

describe("agent readiness", () => {
  it("holds signal agents below the minimum and says why", () => {
    const r = readinessOf({}, 1, 0, 14);
    expect(r.ready).toBe(false);
    expect(r.reason).toBe("Not enough signals yet: 1 in the last 14 days. Add more and run again.");
    expect(readinessOf({}, MIN_SIGNALS, 0, 7).ready).toBe(true);
  });
  it("lets the cockpit run on metrics or signals, but not on nothing", () => {
    expect(readinessOf({ needsMetrics: true }, 0, 5, 7).ready).toBe(true);
    expect(readinessOf({ needsMetrics: true }, 1, 0, 7).ready).toBe(true);
    const none = readinessOf({ needsMetrics: true }, 0, 0, 7);
    expect(none.ready).toBe(false);
    expect(none.reason).toMatch(/no metrics or signals/);
  });
});

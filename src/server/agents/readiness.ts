import type { Tx } from "@/lib/db";
import type { AgentTemplate } from "./types";

/** Below this many signals in its window, an agent has nothing worth drafting from. */
export const MIN_SIGNALS = 3;

export type Readiness = {
  /** Signals in the agent's window (its sources only). */
  signals: number;
  /** Metric events in the window (metrics agents only, otherwise 0). */
  metrics: number;
  days: number;
  need: number;
  /** What it drafts from: signals alone, or metrics and signals (the cockpit). */
  reads: "signals" | "metrics";
  /** Enough input to draft from. */
  ready: boolean;
  /** Why not, in one sentence. Null when ready. */
  reason: string | null;
};

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

export function readinessOf(tpl: Pick<AgentTemplate, "needsMetrics">, signals: number, metrics: number, days: number): Readiness {
  if (tpl.needsMetrics) {
    const base = { signals, metrics, days, need: 1, reads: "metrics" as const };
    // The cockpit can read metrics alone; it only has nothing when both are empty.
    if (signals > 0 || metrics > 0) return { ...base, ready: true, reason: null };
    return { ...base, ready: false, reason: `Nothing to read yet: no metrics or signals in the last ${n(days, "day")}. Add signals and run again.` };
  }
  const base = { signals, metrics, days, need: MIN_SIGNALS, reads: "signals" as const };
  if (signals >= MIN_SIGNALS) return { ...base, ready: true, reason: null };
  return {
    ...base,
    ready: false,
    reason: `Not enough signals yet: ${signals} in the last ${n(days, "day")}. Add more and run again.`,
  };
}

/** Count what an agent would read, using the same window and sources the runner uses. */
export async function countInputs(tx: Tx, tpl: Pick<AgentTemplate, "signalSources" | "needsMetrics">, days: number) {
  const s = await tx.query<{ n: number }>(
    `select count(*)::int n from signals where occurred_at > now() - make_interval(days => $1) and ($2::text[] is null or source = any($2))`,
    [days, tpl.signalSources ?? null],
  );
  let metrics = 0;
  if (tpl.needsMetrics) {
    const m = await tx.query<{ n: number }>(`select count(*)::int n from metric_events where occurred_at > now() - make_interval(days => $1)`, [days]);
    metrics = m.rows[0]?.n ?? 0;
  }
  return { signals: s.rows[0]?.n ?? 0, metrics };
}

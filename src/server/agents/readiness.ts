import type { Tx } from "@/lib/db";
import type { AgentTemplate } from "./types";
import type { SignalLite } from "./evidence";
import { listJoin, sourceList } from "./format";

/** Below this many signals from its sources, an agent has nothing worth drafting from (unless its template says otherwise). */
export const MIN_SIGNALS = 3;
/**
 * Market pulse needs a repeated phrase from two different companies, or won and lost deals to
 * contrast. Tested with realistic first inputs: 3-4 short notes almost never repeat a phrase, so
 * below 5 a run would come back empty.
 */
export const PULSE_MIN = 5;

export type Readiness = {
  /** Signals in the agent's window that count toward `need`: from its sources only, and only the usable ones when the agent needs a particular kind. */
  signals: number;
  /** Every signal from the agent's sources in its window. */
  total: number;
  /** Metric events in the window (metrics agents only, otherwise 0). */
  metrics: number;
  days: number;
  need: number;
  /** What it drafts from: signals alone, or metrics (the cockpit). */
  reads: "signals" | "metrics";
  /** Enough input to draft from. */
  ready: boolean;
  /** Why not, in one sentence that names what the agent reads. Null when ready. */
  reason: string | null;
};

export type InputCounts = {
  /** Signals from the agent's sources in its window. */
  signals: number;
  /** Of those, the ones the agent can build from (null when the agent takes any signal). */
  usable?: number | null;
  metrics: number;
  /** Labels of required memory docs that are still empty. */
  missingDocs?: string[];
};

type Tpl = Partial<Pick<AgentTemplate, "name" | "needsMetrics" | "signalSources" | "readiness">>;

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** Whether the template's `usable` test applies on this engine. */
export function usableApplies(tpl: Tpl, offline: boolean) {
  return Boolean(tpl.readiness?.usable && (offline || !tpl.readiness.usableOfflineOnly));
}

export function readinessOf(tpl: Tpl, c: InputCounts, days: number): Readiness {
  const name = tpl.name ?? "This agent";
  const window = `in the last ${n(days, "day")}`;
  if (tpl.needsMetrics) {
    const base = { signals: c.signals, total: c.signals, metrics: c.metrics, days, need: 1, reads: "metrics" as const };
    // A weekly read with no results in it is a page of "nothing recorded": wait for metrics.
    if (c.metrics > 0) return { ...base, ready: true, reason: null };
    return {
      ...base,
      ready: false,
      reason: `${name} reads results (clicks, demo requests, replies): none ${window}. Send metric events tagged by angle, then run it.`,
    };
  }
  const missing = c.missingDocs ?? [];
  const spec = tpl.readiness ?? {};
  const min = spec.min ?? MIN_SIGNALS;
  const sources = sourceList(tpl.signalSources);
  const docsCheck = (): Readiness | null => {
    if (missing.length && spec.docs?.length) {
      const reason =
        spec.docs.length === 1
          ? `${name} needs your ${spec.docs[0]!.label}, and it's still empty. Fill it in and run again.`
          : `${name} needs your ${listJoin(spec.docs.map((d) => d.label))}: ${listJoin(missing)} ${missing.length === 1 ? "is" : "are"} still empty. Fill ${missing.length === 1 ? "it" : "them"} in and run again.`;
      return { signals: c.usable ?? c.signals, total: c.signals, metrics: c.metrics, days, need: min, reads: "signals", ready: false, reason };
    }
    return null;
  };
  if (c.signals < min) {
    return {
      signals: c.signals, total: c.signals, metrics: c.metrics, days, need: min, reads: "signals", ready: false,
      reason: `${name} reads ${sources}: ${c.signals} ${window}. It needs at least ${min}.`,
    };
  }
  if (c.usable != null) {
    const need = spec.minUsable ?? 1;
    const base = { signals: c.usable, total: c.signals, metrics: c.metrics, days, need, reads: "signals" as const };
    if (c.usable >= need) return docsCheck() ?? { ...base, ready: true, reason: null };
    const noun = spec.usableNoun ?? "it can use";
    return {
      ...base,
      ready: false,
      reason: `${name} reads ${sources}: ${c.signals} ${window}, ${c.usable === 0 ? "none" : `only ${c.usable}`} ${noun}.${c.usable > 0 ? ` It needs ${need}.` : ""}`,
    };
  }
  return docsCheck() ?? { signals: c.signals, total: c.signals, metrics: c.metrics, days, need: min, reads: "signals", ready: true, reason: null };
}

/** Counts from signals already loaded (the runner's window). */
export function countLoaded(tpl: Tpl, signals: SignalLite[], metrics: number, docs: Record<string, { content: string } | undefined>, offline: boolean): InputCounts {
  return {
    signals: signals.length,
    usable: usableApplies(tpl, offline) ? signals.filter((s) => tpl.readiness!.usable!(s)).length : null,
    metrics,
    missingDocs: (tpl.readiness?.docs ?? []).filter((d) => !docs[d.key]?.content.trim()).map((d) => d.label),
  };
}

/** Count what an agent would read, using the same window, sources and tests the runner uses. */
export async function countInputs(tx: Tx, tpl: Tpl, days: number, offline: boolean): Promise<InputCounts> {
  const sources = tpl.signalSources ?? null;
  let signals = 0;
  let usable: number | null = null;
  if (usableApplies(tpl, offline)) {
    const r = await tx.query<SignalLite>(
      `select id, source, left(content, 8000) content, title, url, account, occurred_at::text occurred_at, metadata
         from signals where occurred_at > now() - make_interval(days => $1) and ($2::text[] is null or source = any($2))
        order by occurred_at desc limit 400`,
      [days, sources],
    );
    signals = r.rows.length;
    usable = r.rows.filter((s) => tpl.readiness!.usable!(s)).length;
  } else {
    const s = await tx.query<{ n: number }>(
      `select count(*)::int n from signals where occurred_at > now() - make_interval(days => $1) and ($2::text[] is null or source = any($2))`,
      [days, sources],
    );
    signals = s.rows[0]?.n ?? 0;
  }
  let metrics = 0;
  if (tpl.needsMetrics) {
    const m = await tx.query<{ n: number }>(`select count(*)::int n from metric_events where occurred_at > now() - make_interval(days => $1)`, [days]);
    metrics = m.rows[0]?.n ?? 0;
  }
  let missingDocs: string[] = [];
  const docs = tpl.readiness?.docs ?? [];
  if (docs.length) {
    const d = await tx.query<{ key: string }>(`select key from memory_docs where key = any($1) and length(trim(content)) > 0`, [docs.map((x) => x.key)]);
    const filled = new Set(d.rows.map((r) => r.key));
    missingDocs = docs.filter((x) => !filled.has(x.key)).map((x) => x.label);
  }
  return { signals, usable, metrics, missingDocs };
}

/**
 * How a test is measured: each arm (an angle, or a variant without one) collects the metric
 * events tagged with its angle, or with this experiment and one of its variant ids. The
 * deciding metric is a rate per 100 clicks, except when the test is decided by clicks.
 */

export type Variant = { id: string; label: string; content?: string; angle?: string };
export type TaggedEvent = { kind: string; value: number; angle: string | null; variant: string | null; experiment_id: string | null };

export type Arm = {
  key: string;
  label: string;
  variants: Variant[];
  clicks: number;
  hits: number;
  /** Deciding metric: hits per 100 clicks, or clicks when the test is decided by clicks. Null with no data. */
  score: number | null;
};

export type Results = { kind: string; unit: string; arms: Arm[]; leader: Arm | null; runnerUp: Arm | null; measured: boolean };

const KIND_LABEL: Record<string, string> = { demo_request: "demo requests", qualified_reply: "qualified replies", click: "clicks", signup: "signups" };

/** "Qualified positive replies" → qualified_reply. Agents write the metric as prose or as a kind. */
export function metricKind(metric: string): string {
  const m = metric.toLowerCase();
  if (/demo/.test(m)) return "demo_request";
  if (/repl/.test(m)) return "qualified_reply";
  if (/sign.?up/.test(m)) return "signup";
  if (/click|ctr/.test(m)) return "click";
  return /^[a-z_]{2,40}$/.test(m) ? m : "demo_request";
}

export const unitFor = (kind: string) => (kind === "click" ? "clicks" : `${KIND_LABEL[kind] ?? kind.replace(/_/g, " ")} per 100 clicks`);

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export function computeResults(e: { id: string; metric: string; variants: Variant[] }, events: TaggedEvent[]): Results {
  const kind = metricKind(e.metric);
  const arms = new Map<string, Arm>();
  const byVariant = new Map<string, Arm>();
  for (const v of e.variants) {
    const label = (v.angle ?? v.label).trim();
    const key = norm(label);
    if (!key) continue;
    const arm = arms.get(key) ?? { key, label, variants: [], clicks: 0, hits: 0, score: null };
    arm.variants.push(v);
    arms.set(key, arm);
    byVariant.set(v.id, arm);
  }
  for (const ev of events) {
    const arm = (ev.experiment_id === e.id && ev.variant ? byVariant.get(ev.variant) : undefined) ?? arms.get(norm(ev.angle));
    if (!arm) continue;
    if (ev.kind === "click") arm.clicks += Number(ev.value) || 0;
    if (ev.kind === kind && kind !== "click") arm.hits += Number(ev.value) || 0;
  }
  const list = [...arms.values()];
  for (const a of list) a.score = kind === "click" ? (a.clicks ? a.clicks : null) : a.clicks ? (a.hits / a.clicks) * 100 : null;
  const ranked = list.filter((a) => a.score !== null).sort((a, b) => b.score! - a.score! || b.clicks - a.clicks);
  const leader = ranked[0] && (kind === "click" || ranked[0].hits > 0) ? ranked[0] : null;
  return { kind, unit: unitFor(kind), arms: list, leader, runnerUp: leader ? (ranked[1] ?? null) : null, measured: ranked.length > 0 };
}

export const fmtScore = (n: number | null, kind: string) => (n === null ? "—" : kind === "click" ? String(Math.round(n)) : n.toFixed(1));

/** One line that justifies calling the test: leader vs the next best. */
export function verdictLine(r: Results): string {
  if (!r.leader) return r.measured ? `No ${KIND_LABEL[r.kind] ?? r.kind} recorded yet` : "No results recorded yet";
  const l = `${r.leader.label}: ${fmtScore(r.leader.score, r.kind)} ${r.unit}`;
  return r.runnerUp ? `${l} vs ${fmtScore(r.runnerUp.score, r.kind)} for ${r.runnerUp.label}` : l;
}

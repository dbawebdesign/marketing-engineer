/**
 * Draft formatting rules shared by every template.
 * A draft's body is exactly what ships; everything about the draft (platform, angle,
 * where it came from, length) lives in `payload.meta`, which the review pane shows as a quiet row.
 */
import type { SignalLite } from "./evidence";

export type Meta = { label: string; value: string }[];

/** Build a meta row, dropping empty values. */
export function meta(...items: [label: string, value: string | number | null | undefined | false][]): Meta {
  return items.filter(([, v]) => v !== null && v !== undefined && v !== false && String(v).trim() !== "").map(([label, value]) => ({ label, value: String(value).trim() }));
}

/** "Nov 2". Titles never carry ISO dates. */
export function shortDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

const SOURCE_NOUN: Record<string, [string, string]> = {
  sales_call: ["sales call", "sales calls"],
  support_ticket: ["support ticket", "support tickets"],
  churn_note: ["churn note", "churn notes"],
  crm_note: ["CRM note", "CRM notes"],
  review: ["review", "reviews"],
  social: ["social post", "social posts"],
  interview: ["interview", "interviews"],
  product_event: ["product event", "product events"],
  survey: ["survey", "surveys"],
  other: ["note", "notes"],
};

/** "3 sales calls, 1 review": the distinct signals a draft rests on, by source. */
export function fromSignals(evidence: { signal_id: string; source?: string }[] | undefined, signals?: Map<string, SignalLite>): string {
  const bySource = new Map<string, Set<string>>();
  for (const e of evidence ?? []) {
    const src = e.source ?? signals?.get(e.signal_id)?.source ?? "other";
    if (!bySource.has(src)) bySource.set(src, new Set());
    bySource.get(src)!.add(e.signal_id);
  }
  return [...bySource.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .map(([src, ids]) => {
      const [one, many] = SOURCE_NOUN[src] ?? [src.replace(/_/g, " "), `${src.replace(/_/g, " ")}s`];
      return `${ids.size} ${ids.size === 1 ? one : many}`;
    })
    .join(", ");
}

const LABELS = "Platform|Angle|Came from|From|Insight|Word count|Words|Characters|Length|Hook|Kind|Why|Why now|Trigger|Fit|Account|Channel|Offer|Hypothesis|Decided by|Notes?";
const LABEL_LINE = new RegExp(`^\\s*(?:[-*]\\s+)?\\*{0,2}(?:${LABELS})\\*{0,2}\\s*:\\*{0,2}\\s.*$`, "i");

/**
 * Remove scaffolding a writer (model or template) might leave around shippable text:
 * a trailing `---` block, "**Platform:** X"-style label lines at either end, and hashtag walls.
 */
export function shippable(text: string): string {
  let t = text.replace(/\r\n/g, "\n").trim();
  // Anything after a horizontal rule is notes about the draft, not the draft.
  const hr = t.search(/\n\s*(?:-{3,}|\*{3,}|_{3,})\s*(?:\n|$)/);
  if (hr >= 0) t = t.slice(0, hr).trim();
  const lines = t.split("\n");
  while (lines.length && (LABEL_LINE.test(lines.at(-1)!) || /^\s*(#\w+\s*)+$/.test(lines.at(-1)!) || !lines.at(-1)!.trim())) lines.pop();
  while (lines.length && (LABEL_LINE.test(lines[0]!) || !lines[0]!.trim())) lines.shift();
  return lines.join("\n").trim();
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A short, specific title (at most 70 characters) that never repeats the body's first line
 * and never carries a platform prefix. Tries each candidate in order.
 */
export function draftTitle(body: string, ...candidates: (string | null | undefined)[]): string {
  const first = norm(body.split("\n").find((l) => l.trim()) ?? "");
  for (const c of candidates) {
    if (!c) continue;
    const t = fit(cap(c.replace(/^(linkedin|x|twitter)\s*[:·-]\s*/i, "").replace(/\s+/g, " ").trim().replace(/[.:;,]$/, "")));
    if (t && norm(t) !== first && !first.startsWith(norm(t).replace(/…$/, ""))) return t;
  }
  return fit(cap((candidates.find(Boolean) ?? "Draft").trim()));
}

function norm(s: string) {
  return s.toLowerCase().replace(/[*_#>"“”]/g, "").replace(/\s+/g, " ").trim();
}

/** Clip at a word boundary to 70 characters. */
function fit(s: string, n = 70) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.–-]+$/, "")}…`;
}

/** Pick the first quote per item that no earlier item already showed, so a memo never repeats a receipt. */
export function onePerItem<E extends { signal_id: string; quote: string }>(items: { evidence: E[] }[], used = new Set<string>()): (E | null)[] {
  return items.map((it) => {
    const key = (e: E) => `${e.signal_id}:${e.quote.toLowerCase().replace(/\s+/g, " ").trim()}`;
    const pick = it.evidence.find((e) => !used.has(key(e))) ?? null;
    if (pick) used.add(key(pick));
    return pick;
  });
}

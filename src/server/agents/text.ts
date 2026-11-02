/** Small, dependency-free text utilities used by the offline engine and the analytics. */
const STOP = new Set(
  "a an the and or but if then so to of in on for with at by from as is are was were be been being it its this that these those i we you they he she them our your their my me us do does did not no yes just very really can could would should will about into over after before than too also more most some any all each every what which who whom when where why how have has had get got there here out down off only own same such both few other again further once because while during until against between through above below said says asked told wants want wanted mentioned owner manager lead call calls month months".split(" "),
);

export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 25 && s.length <= 320);
}

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter((w) => (w.length > 2 || w === "up") && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith("ies") ? w.slice(0, -3) + "y" : w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/** Top n-grams (2-3 words) by document frequency. */
export function topPhrases(docs: string[], n = 12, minDocs = 2): { phrase: string; docs: number }[] {
  const df = new Map<string, number>();
  for (const d of docs) {
    const t = tokens(d);
    const seen = new Set<string>();
    for (let i = 0; i < t.length; i++) {
      for (const len of [2, 3]) {
        if (i + len > t.length) continue;
        const g = t.slice(i, i + len).join(" ");
        if (!seen.has(g)) {
          seen.add(g);
          df.set(g, (df.get(g) ?? 0) + 1);
        }
      }
    }
  }
  const ranked = [...df.entries()].filter(([, c]) => c >= minDocs).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  const out: { phrase: string; docs: number }[] = [];
  for (const [phrase, c] of ranked) {
    const words = phrase.split(" ");
    if (out.some((o) => o.phrase.includes(phrase) || phrase.includes(o.phrase) || (o.docs >= c && o.phrase.split(" ").some((w) => words.includes(w))))) continue;
    out.push({ phrase, docs: c });
    if (out.length >= n) break;
  }
  return out;
}

export function bestSentence(text: string, phrase: string): string | null {
  const words = phrase.split(" ");
  const ss = sentences(text);
  return ss.find((s) => words.every((w) => s.toLowerCase().includes(w))) ?? null;
}

export function clip(s: string, n: number) {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";
}

const WON = /\b(closed[- ]won|signed (the|our) (contract|deal|order)|they signed|(he|she) signed|signed today|became a customer|went with us|chose us|picked us|converted to paid)\b/i;
// Case-sensitive on purpose: a capitalised word after "went with" is a competitor's name.
const LOST = /\b([Ww]ent with|[Cc]hose|[Pp]icked|[Ss]igned with) (a|an|another|the other|[A-Z][\w-]+)\b/;

/**
 * A deal outcome stated in a sales or CRM note, for notes pasted without metadata.
 * Only explicit wording counts ("they signed", "went with a cheaper tool"); anything else stays unknown.
 */
export function inferOutcome(source: string, content: string): "won" | "lost" | null {
  if (source !== "sales_call" && source !== "crm_note") return null;
  const lost = LOST.test(content) || /\b(closed[- ]lost|lost the deal|lost (it|them|the deal) to|passed on us|not moving forward|decided against us)\b/i.test(content);
  const won = WON.test(content);
  if (won === lost) return null;
  return won ? "won" : "lost";
}

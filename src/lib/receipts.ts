const normQuote = (q: string) =>
  q
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”"]/g, "")
    .replace(/[^a-z0-9$%' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The same quote from the same signal counts once. */
export function dedupeReceipts<T extends { signal_id: string; quote: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((e) => {
    const k = `${e.signal_id}\n${normQuote(e.quote)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export { normQuote };

const words = (s: string) => (s ? s.split(" ").length : 0);

/**
 * Which receipt a quoted passage in prose stands for: the same words as an evidence quote,
 * or a run of at least three of its words. Returns the receipt's index, or -1.
 */
export function receiptFor(passage: string, quotes: string[]): number {
  const p = normQuote(passage);
  if (words(p) < 3) return -1;
  const i = quotes.findIndex((q) => q === p);
  if (i >= 0) return i;
  return quotes.findIndex((q) => words(q) >= 3 && (q.includes(p) || p.includes(q)));
}

/** Receipts whose quote contains a short phrase from a claim, e.g. “emergency dispatch”. */
export function receiptsWithPhrase(phrase: string, quotes: string[]): number[] {
  const p = normQuote(phrase);
  if (words(p) < 2) return [];
  const out: number[] = [];
  quotes.forEach((q, i) => {
    if (` ${q} `.includes(` ${p} `)) out.push(i);
  });
  return out;
}

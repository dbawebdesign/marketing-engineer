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

/**
 * Receipts. "Every insight needs a quote or a link or a source."
 * The model is asked to cite signal ids and verbatim quotes; we verify each quote
 * really appears in the cited signal and drop anything we can't verify.
 */
export type Evidence = { signal_id: string; quote: string };
export type VerifiedEvidence = Evidence & { verified: boolean; source?: string; url?: string | null; account?: string | null; occurred_at?: string };
export type SignalLite = { id: string; source: string; content: string; title: string; url: string | null; account: string | null; occurred_at: string; outcome?: string | null; metadata?: Record<string, unknown> };

export function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9$%' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function verifyEvidence(items: Evidence[], signals: Map<string, SignalLite>): VerifiedEvidence[] {
  const seen = new Set<string>();
  const out: VerifiedEvidence[] = [];
  for (const e of items) {
    const sig = signals.get(e.signal_id);
    const q = normalize(e.quote ?? "");
    const key = `${e.signal_id}:${q}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const verified = Boolean(sig && q.length >= 8 && normalize(sig.content).includes(q));
    out.push({
      signal_id: e.signal_id,
      quote: e.quote.trim().slice(0, 600),
      verified,
      source: sig?.source,
      url: sig?.url ?? null,
      account: sig?.account ?? null,
      occurred_at: sig?.occurred_at,
    });
  }
  return out;
}

/** Keep only claims with at least one verified receipt; report how many were dropped. */
export function keepSupported<T extends { evidence: Evidence[] }>(claims: T[], signals: Map<string, SignalLite>) {
  let dropped = 0;
  let unverifiedQuotes = 0;
  const kept: (Omit<T, "evidence"> & { evidence: VerifiedEvidence[] })[] = [];
  for (const c of claims) {
    const ev = verifyEvidence(c.evidence ?? [], signals);
    const good = ev.filter((e) => e.verified);
    unverifiedQuotes += ev.length - good.length;
    if (good.length === 0) {
      dropped++;
      continue;
    }
    kept.push({ ...c, evidence: good });
  }
  return { kept, dropped, unverifiedQuotes };
}

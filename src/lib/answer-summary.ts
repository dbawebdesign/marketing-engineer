const sentences = (t: string) => t.trim().split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/).filter(Boolean);

/**
 * Answers that each open with the same company summary read as one paragraph repeated five times.
 * Pull the sentences every answer starts with out once; each answer keeps only what's its own.
 * Display only: the stored pack (and its schema) keeps the full, stand-alone answers.
 */
export function splitSummary(answers: string[]): { summary: string | null; rest: string[] } {
  const parts = answers.map(sentences);
  const filled = parts.filter((p) => p.length);
  if (filled.length < 2) return { summary: null, rest: answers };
  let n = 0;
  while (filled.every((p) => p.length > n && p[n] === filled[0]![n])) n++;
  if (!n) return { summary: null, rest: answers };
  return { summary: filled[0]!.slice(0, n).join(" "), rest: parts.map((p) => (p.length ? p.slice(n).join(" ") : "")) };
}

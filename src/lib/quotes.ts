/**
 * Quote punctuation helpers shared by the agents (which write quotes) and the UI (which wraps them).
 * Dependency-free so both server and client code can import them.
 */

const OPEN = new Set(['"', "“", "'", "‘"]);
const CLOSE: Record<string, string[]> = { '"': ['"'], "“": ["”", '"'], "'": ["'"], "‘": ["’", "'"] };

/**
 * Remove one pair of quote marks that wraps the whole string, so a caller that adds its own
 * quotes doesn't print ““…””. Trailing sentence punctuation after the closing mark is kept
 * inside. Leaves the string alone when the marks belong to an inner phrase
 * (“manual routing” came up in 3 calls).
 */
export function stripOuterQuotes(s: string): string {
  const t = s.trim();
  const open = t[0];
  if (!open || !OPEN.has(open)) return t;
  const m = /^(.)([\s\S]*?)(["”'’])([.!?…]*)$/.exec(t);
  if (!m || !CLOSE[open]!.includes(m[3]!)) return t;
  const inner = m[2]!;
  // “a” and “b”: the first mark closes before the end, so it is not an outer pair.
  if (/["“”]/.test(inner) && (open === '"' || open === "“")) return t;
  return `${inner.trim()}${m[4]}`;
}

/** Turn double quotes inside a string into single curly ones, so it can sit inside “…”. */
export function nestQuotes(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "“") out += "‘";
    else if (c === "”") out += "’";
    else if (c === '"') out += i === 0 || /[\s(\[{—–-]/.test(s[i - 1]!) ? "‘" : "’";
    else out += c;
  }
  return out;
}

/**
 * A verbatim quote made safe to print inside double quotes on one line: whitespace collapsed,
 * a stray unmatched double quote at either edge dropped (a sentence split just after `."`),
 * and inner double quotes turned into single curly ones.
 * `She said "if it works on the truck I'll use it."` → `She said ‘if it works on the truck I'll use it.’`
 */
export function tidyQuote(q: string): string {
  let s = q.replace(/\s+/g, " ").trim();
  const straight = (s.match(/"/g) ?? []).length;
  if (straight % 2 === 1) {
    if (s.startsWith('"')) s = s.slice(1).trimStart();
    else if (s.endsWith('"')) s = s.slice(0, -1).trimEnd();
    else {
      const at = s.lastIndexOf('"');
      s = (s.slice(0, at) + s.slice(at + 1)).replace(/\s+/g, " ");
    }
  }
  const opens = (s.match(/“/g) ?? []).length;
  const closes = (s.match(/”/g) ?? []).length;
  if (opens > closes && s.startsWith("“")) s = s.slice(1).trimStart();
  else if (closes > opens && s.endsWith("”")) s = s.slice(0, -1).trimEnd();
  // A quote that is wholly one quoted passage loses its own marks; the caller adds them.
  return nestQuotes(stripOuterQuotes(s)).trim();
}

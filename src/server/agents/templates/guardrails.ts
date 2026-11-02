/**
 * Shared guardrails and helpers for the Growth OS templates.
 * Banned language is enforced mechanically, after the model (or the offline engine) writes.
 */
import type { MemoryDocLite, RunContext } from "../types";
import type { SignalLite } from "../evidence";
import { normalize } from "../evidence";
import { sentences } from "../text";

/** Phrases every agent avoids, on top of whatever the company bans. */
const HOUSE_BANNED = ["unlock", "supercharge", "game-changer", "game changer", "revolutionize", "in today's fast-paced world", "synergy"];

export type BannedList = { phrases: string[]; rules: string[] };

/**
 * Parse a banned-language doc. Each bullet is either quoted phrases ("Quick question", "synergy")
 * or a rule in prose ("Any claim about their revenue we can't back up"). Quoted phrases and short
 * bare bullets are enforced mechanically; longer prose bullets are passed to the model as rules.
 */
export function parseBanned(...docs: (MemoryDocLite | undefined)[]): BannedList {
  const phrases = new Set<string>(HOUSE_BANNED);
  const rules: string[] = [];
  for (const doc of docs) {
    if (!doc?.content) continue;
    let inNever = !doc.key.startsWith("content/"); // in voice docs, only the "Never" section is a ban list
    for (const raw of doc.content.split("\n")) {
      const line = raw.trim();
      if (/^#+\s/.test(line)) {
        if (doc.key.startsWith("content/")) inNever = /never|banned|avoid|don't|do not/i.test(line);
        continue;
      }
      if (!inNever || !/^([-*•]|\d+[.)])\s+/.test(line)) continue;
      const text = line.replace(/^([-*•]|\d+[.)])\s+/, "").trim();
      const quoted = [...text.matchAll(/["“]([^"”]{2,80})["”]/g)].map((m) => m[1]!);
      const clean = (s: string) => s.replace(/\.{2,}|…/g, "").replace(/[!?.,:;]+$/g, "").trim();
      if (quoted.length) {
        for (const q of quoted) if (clean(q).length >= 3) phrases.add(clean(q).toLowerCase());
        const rest = text.replace(/["“][^"”]*["”]/g, "").replace(/[,\s]+/g, " ").trim();
        if (rest.split(" ").length >= 3) rules.push(text);
      } else {
        const parts = text.split(/,\s*/).map(clean).filter(Boolean);
        if (parts.every((p) => p.split(/\s+/).length <= 3)) for (const p of parts) phrases.add(p.toLowerCase());
        else rules.push(text);
      }
    }
  }
  return { phrases: [...phrases], rules };
}

/** Banned phrases that appear in the text (word-boundary match on normalized text). */
export function findBanned(text: string, list: BannedList): string[] {
  const hay = ` ${normalize(text)} `;
  return list.phrases.filter((p) => {
    const n = normalize(p);
    // "i noticed you" also catches "i noticed you're".
    return n.length >= 3 && (hay.includes(` ${n} `) || hay.includes(` ${n}'`));
  });
}

export function renderBanned(list: BannedList) {
  return `## Banned language (enforced automatically: any draft containing these is rejected before a human sees it)
${list.phrases.map((p) => `- "${p}"`).join("\n")}${list.rules.length ? `\nAlso never:\n${list.rules.map((r) => `- ${r}`).join("\n")}` : ""}`;
}

/** Bullet or numbered lines from a doc, with markdown stripped. */
export function bullets(doc: MemoryDocLite | undefined): string[] {
  if (!doc?.content) return [];
  return doc.content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^([-*•]|\d+[.)])\s+/.test(l))
    .map((l) => l.replace(/^([-*•]|\d+[.)])\s+/, "").replace(/\*\*/g, "").trim());
}

/** Non-empty, non-heading lines. */
export function lines(doc: MemoryDocLite | undefined): string[] {
  if (!doc?.content) return [];
  return doc.content
    .split("\n")
    .map((l) => l.trim().replace(/^([-*•]|\d+[.)])\s+/, ""))
    .filter((l) => l && !l.startsWith("#"));
}

export function techsOf(s: SignalLite): number | null {
  const m = s.metadata?.techs;
  if (typeof m === "number") return m;
  const r = /(\d{1,4})\s*(?:\+\s*)?(?:techs?|technicians|trucks?)\b/i.exec(s.content);
  return r ? Number(r[1]) : null;
}

/** First verbatim sentence in the signal matching the predicate. */
export function findSentence(s: SignalLite, test: RegExp): string | null {
  return sentences(s.content).find((x) => test.test(x)) ?? null;
}

/** Verbatim evidence for a signal: the first sentence matching `test`, or its first sentence. */
export function ev(s: SignalLite | undefined, test?: RegExp) {
  if (!s) return [];
  const q = (test ? findSentence(s, test) : null) ?? sentences(s.content)[0];
  return q ? [{ signal_id: s.id, quote: q }] : [];
}

/** "Owner said they missed..." -> "An owner with 27 techs told us they missed..." */
export function retell(sentence: string, s: SignalLite) {
  const techs = techsOf(s);
  const who = (role: string) => `${/^[aeiou]/i.test(role) ? "An" : "A"} ${role.toLowerCase()}${techs ? ` at a ${techs}-tech shop` : ""}`;
  let out = sentence.replace(/^(Owner|Service manager|Operations lead|CFO|Office manager|GM)\s+said\s+(that\s+)?/i, (_m, role: string) => `${who(role)} told us `);
  if (s.account) out = out.replaceAll(s.account, "the shop");
  return out;
}

export function words(s: string) {
  return s.split(/\s+/).filter(Boolean).length;
}

export function docText(rc: RunContext, key: string) {
  return rc.docs[key]?.content ?? "";
}

export function pct(n: number, d: number) {
  return d ? Math.round((n / d) * 1000) / 10 : 0;
}

export const fmtEv = (e: { quote: string; source?: string; account?: string | null }[]) =>
  e.map((x) => `  > "${x.quote}" (${[x.source?.replace(/_/g, " "), x.account].filter(Boolean).join(", ")})`).join("\n");

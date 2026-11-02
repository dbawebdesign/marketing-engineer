import type { RunContext } from "./types";
import { clip } from "./text";

const SHARED_RULES = `House rules (non-negotiable):
- Every claim needs a receipt: cite the signal id and a VERBATIM quote copied character-for-character from that signal. Quotes that do not appear in the cited signal are discarded automatically, and claims left without a receipt are dropped.
- Be specific. "Customers want better collaboration" is useless. "5 calls mentioned emergency dispatch, but the 3 that converted all talked about missed follow-up quotes after the tech left" is useful.
- Prefer counts, named segments, and the customer's own words over adjectives.
- Never invent numbers, companies, people, or results. If the signal is thin, say so.
- Write plainly. No hype, no exclamation marks, no "unlock", "supercharge", "game-changer", "in today's fast-paced world".`;

export function baseSystem(role: string) {
  return `You are ${role}, one agent inside a company's Growth OS: a shared marketing memory that compounds every week.
You work like a senior marketing engineer with taste: you turn raw market signal into pipeline.

${SHARED_RULES}`;
}

export function renderSpec(rc: RunContext) {
  const s = rc.spec;
  return `## Your job spec
Mission: ${s.mission}
Filters: ${s.filters.join("; ") || "none"}
Expected output: ${s.output}
Good looks like:
${s.goodLooksLike.map((g) => `- ${g}`).join("\n")}
Metric that matters: ${s.metric}`;
}

export function renderRules(rc: RunContext) {
  if (!rc.rules.length && !rc.recentFeedback.length) return "";
  const rules = rc.rules.length ? `## Corrections from your manager (follow every one)\n${rc.rules.map((r) => `- ${r}`).join("\n")}` : "";
  const fb = rc.recentFeedback.filter((f) => f.feedback);
  const fbText = fb.length
    ? `\n\n## Recent review outcomes\n${fb.map((f) => `- [${f.status}] "${clip(f.title, 80)}": ${clip(f.feedback ?? "", 240)}`).join("\n")}`
    : "";
  return rules + fbText;
}

export function renderDocs(rc: RunContext, keys: string[]) {
  const parts: string[] = [];
  for (const k of keys) {
    const d = rc.docs[k];
    if (d && d.content.trim()) parts.push(`<doc key="${k}" title="${d.title}" version="${d.version}">\n${clip(d.content, 12000)}\n</doc>`);
  }
  return parts.length ? `## Growth OS memory\n${parts.join("\n\n")}` : "## Growth OS memory\n(empty so far)";
}

export function renderSignals(rc: RunContext, max = 200) {
  const list = rc.signals.slice(0, max);
  if (!list.length) return "## Signals\n(no signals in the window)";
  return `## Signals (${list.length} in the last ${rc.spec.lookbackDays} days)
${list
  .map((s) => {
    const meta = [s.source, s.account ? `account: ${s.account}` : null, s.occurred_at.slice(0, 10)].filter(Boolean).join(" | ");
    return `<signal id="${s.id}" ${s.title ? `title="${s.title.replace(/"/g, "'")}"` : ""}>\n[${meta}]\n${clip(s.content, 4000)}\n</signal>`;
  })
  .join("\n")}`;
}

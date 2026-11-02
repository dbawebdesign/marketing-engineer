import { z } from "zod";
import type { AgentTemplate, RunContext } from "../types";
import { baseSystem, renderDocs, renderRules, renderSignals, renderSpec } from "../prompting";
import { keepSupported } from "../evidence";
import { bestSentence, sentences, tokens, topPhrases } from "../text";

const Ev = z.object({ signal_id: z.string(), quote: z.string() });

const Schema = z.object({
  headline: z.string().describe("One sentence: the single most important thing the market told us in this window."),
  changes: z
    .array(
      z.object({
        claim: z.string().describe("A sharp, specific, countable observation."),
        why_it_matters: z.string(),
        strength: z.enum(["strong", "emerging"]),
        count: z.number().int().describe("How many distinct signals support this."),
        evidence: z.array(Ev),
      }),
    )
    .describe("3-7 observations, most important first."),
  language: z
    .array(z.object({ phrase: z.string(), note: z.string(), evidence: z.array(Ev) }))
    .describe("Exact phrases buyers use that we should reuse in copy."),
  objections: z.array(z.object({ objection: z.string(), count: z.number().int(), evidence: z.array(Ev) })),
  recommended_test: z.object({
    name: z.string(),
    hypothesis: z.string(),
    angle: z.string().describe("The one-line angle, in the customer's language."),
    channel: z.enum(["outbound", "linkedin", "x", "paid_social", "search", "landing_page", "email", "other"]),
    metric: z.string(),
    why_this_week: z.string(),
  }),
  confidence_note: z.string().describe("How thin or rich the signal was and what would sharpen it."),
});
type Out = z.infer<typeof Schema>;

const SOURCE_WORD: Record<string, string> = {
  sales_call: "sales calls", support_ticket: "support tickets", churn_note: "churn notes", crm_note: "CRM notes",
  review: "reviews", social: "social posts", interview: "interviews", product_event: "product events", survey: "surveys", other: "other notes",
};

/** Map a normalized phrase ("follow up quote") back to how customers actually wrote it ("follow-up quote"). */
function surface(phrase: string, texts: string[]): string {
  const words = phrase.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`\\b${words.map((w) => `${w}(?:s|es|ies)?`).join("(?:[\\s-]+[a-z']+){0,2}?[\\s-]+")}\\b`, "i");
  const counts = new Map<string, number>();
  for (const t of texts) {
    const m = t.match(re);
    if (m) counts.set(m[0].toLowerCase(), (counts.get(m[0].toLowerCase()) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? phrase;
}

/** Prefer the longer phrase when it carries almost all of the shorter one's mentions. */
function sharpen(p: { phrase: string; docs: number }, docs: string[]) {
  const tri = topPhrases(docs, 30, 2).filter((t) => t.phrase.split(" ").length === 3 && t.phrase.includes(p.phrase));
  const best = tri.sort((a, b) => b.docs - a.docs)[0];
  return best && best.docs >= Math.ceil(p.docs * 0.6) ? best : p;
}

const listJoin = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

function whyFor(sources: string[]): string {
  const has = (k: string) => sources.includes(k);
  if (has("churn_note")) return "It also shows up in churn notes, so it costs customers, not just deals.";
  if (has("sales_call") && has("support_ticket")) return "It's both a reason to buy and a product gap customers hit later.";
  if (has("review")) return "Customers repeat it in public reviews: free proof to reuse.";
  if (has("sales_call")) return "Buyers raise it on calls without being asked.";
  if (has("social")) return "People say it in public, in their own words.";
  return "It keeps coming up across sources.";
}

const OBJECTION = /\b(price|pricing|cost|expensive|cheaper|budget|per-tech|hard to justify|not interested|not urgent|left for|competitor|confusing|buried|took longer|built for bigger|bundles)\b/i;

function offline(rc: RunContext): Out {
  const sigs = rc.signals;
  const texts = sigs.map((s) => s.content);
  const won = sigs.filter((s) => s.outcome === "won");
  const lost = sigs.filter((s) => s.outcome === "lost");
  const quote = (s: { id: string; content: string }, phrase: string) => {
    const q = bestSentence(s.content, phrase);
    return q ? [{ signal_id: s.id, quote: q }] : [];
  };
  const hitsFor = (phrase: string) => sigs.filter((s) => phrase.split(" ").every((w) => tokens(s.content).includes(w)));

  const changes: Out["changes"] = [];
  let headline: string | null = null;
  let winning: string | null = null;

  // 1. What converts vs. what doesn't.
  if (won.length >= 2 && lost.length >= 1) {
    const lostTokens = new Set(lost.flatMap((s) => tokens(s.content)));
    const wonP = topPhrases(won.map((s) => s.content), 10, 2).find((p) => !p.phrase.split(" ").every((w) => lostTokens.has(w)));
    const lostP = topPhrases(lost.map((s) => s.content), 4, Math.min(2, lost.length))[0];
    if (wonP) {
      const sharp = sharpen(wonP, won.map((s) => s.content));
      winning = surface(sharp.phrase, won.map((s) => s.content));
      const lostWords = lostP ? surface(lostP.phrase, lost.map((s) => s.content)) : null;
      const ws = won.filter((s) => wonP.phrase.split(" ").every((w) => tokens(s.content).includes(w)));
      headline = lostWords
        ? `Deals we won talked about ${winning}. Deals we lost talked about ${lostWords}.`
        : `Deals we won kept coming back to ${winning}.`;
      changes.push({
        claim: `${ws.length} of ${won.length} won deals brought up ${winning}; none of the ${lost.length} lost deals did.`,
        why_it_matters: lostWords ? `Buyers often open with ${lostWords}, but that isn't what closes. Lead with what closes.` : "Lead with what closes.",
        strength: ws.length >= 3 ? "strong" : "emerging",
        count: ws.length,
        evidence: ws.slice(0, 3).flatMap((s) => quote(s, wonP.phrase)),
      });
    }
  }

  // 2. Repeated, unprompted language across sources.
  const phrases = topPhrases(texts, 12, 2).map((p) => sharpen(p, texts));
  const seen = new Set(changes.flatMap((c) => c.claim.toLowerCase().split(/\W+/)));
  for (const p of phrases) {
    if (changes.length >= 5) break;
    const words = surface(p.phrase, texts);
    if (winning && (winning.includes(words) || words.includes(winning))) continue;
    if (p.phrase.split(" ").every((w) => seen.has(w))) continue;
    const hits = hitsFor(p.phrase);
    if (hits.length < 2) continue;
    const sources = [...new Set(hits.map((h) => h.source))];
    changes.push({
      claim: `“${words}” came up in ${hits.length} separate ${sources.length === 1 ? SOURCE_WORD[sources[0]!] ?? "notes" : "signals"}${sources.length > 1 ? ` across ${listJoin(sources.map((x) => SOURCE_WORD[x] ?? x))}` : ""}.`,
      why_it_matters: whyFor(sources),
      strength: hits.length >= 4 ? "strong" : "emerging",
      count: hits.length,
      evidence: hits.slice(0, 2).flatMap((s) => quote(s, p.phrase)),
    });
  }

  // 3. Objections: sentences from lost deals, churn notes and tickets that push back.
  const objectionSources = sigs.filter((s) => s.outcome === "lost" || s.source === "churn_note" || s.source === "review" || s.source === "support_ticket");
  const objections: Out["objections"] = [];
  for (const s of objectionSources) {
    const sentence = sentences(s.content).find((x) => OBJECTION.test(x));
    if (!sentence || objections.length >= 4) continue;
    const kind = sentence.match(OBJECTION)![0].toLowerCase();
    const label = /price|pricing|cost|expensive|cheaper|budget|per-tech|justify/.test(kind)
      ? "Price, especially per-tech pricing for small shops"
      : /left for|competitor|bundles|cheaper/.test(kind)
        ? "A competitor offered more in one bundle"
        : /confusing|buried|took longer/.test(kind)
          ? "Setup friction: inviting the office team is hard to find"
          : /built for bigger/.test(kind)
            ? "Feels built for bigger commercial shops"
            : "Not urgent enough to switch now";
    const existing = objections.find((o) => o.objection === label);
    if (existing) {
      existing.count++;
      if (existing.evidence.length < 2) existing.evidence.push({ signal_id: s.id, quote: sentence });
    } else objections.push({ objection: label, count: 1, evidence: [{ signal_id: s.id, quote: sentence }] });
  }

  const angle = winning ?? (phrases[0] ? surface(phrases[0].phrase, texts) : null);
  return {
    headline: headline ?? (changes[0] ? changes[0].claim : "Not enough signal this window to say what changed."),
    changes,
    language: phrases.slice(0, 5).map((p) => {
      const words = surface(p.phrase, texts);
      const s = hitsFor(p.phrase)[0];
      return { phrase: words, note: `${p.docs} mentions`, evidence: s ? quote(s, p.phrase) : [] };
    }),
    objections,
    recommended_test: angle
      ? {
          name: `Lead with ${angle}`,
          hypothesis: `Outreach that opens with ${angle}, in the words buyers used, gets more qualified replies than our current opener.`,
          angle: winning ? `Open with ${angle}: it is what the buyers who signed talked about.` : `Open with ${angle}, in the buyers' own words.`,
          channel: "outbound",
          metric: "Qualified positive replies",
          why_this_week: winning ? "It's what the deals we won had in common." : "It's the most repeated phrase this week.",
        }
      : { name: "Collect more signal", hypothesis: "We need more customer notes before testing.", angle: "", channel: "other", metric: "Signals collected", why_this_week: "Too few signals this window." },
    confidence_note: "Built from frequency and contrast analysis of this week's signals. Connect Claude for deeper synthesis.",
  };
}

function md(o: Out, dropped: number) {
  const ev = (e: { quote: string; source?: string; account?: string | null }[]) =>
    e.map((x) => `  > "${x.quote}" (${[x.source?.replace(/_/g, " "), x.account].filter(Boolean).join(", ")})`).join("\n  >\n");
  return `# What the market is telling us

**${o.headline}**

## What changed
${o.changes.map((c) => `- **${c.claim}** ${c.why_it_matters}\n${ev((c.evidence as never[]).slice(0, 2) as never)}`).join("\n")}

## Their words, not ours
${o.language.map((l) => `- "${l.phrase}": ${l.note}`).join("\n") || "- Nothing repeated enough yet."}

## Objections
${o.objections.map((x) => `- ${x.objection} _(${x.count})_\n${ev(x.evidence as never)}`).join("\n") || "- None surfaced in this window."}

## Test this week
**${o.recommended_test.name}**: ${o.recommended_test.angle}
- Hypothesis: ${o.recommended_test.hypothesis}
- Channel: ${o.recommended_test.channel.replace("_", " ")} · Metric: ${o.recommended_test.metric}
- Why now: ${o.recommended_test.why_this_week}

---
_${o.confidence_note}${dropped ? ` ${dropped} claim(s) were dropped because their quotes could not be verified against the source signals.` : ""}_
`;
}

export const customerTruth: AgentTemplate<typeof Schema> = {
  id: "market-pulse",
  system: "customer_truth",
  name: "Market pulse",
  tagline: "Writes \"What the market is telling us\" from calls, tickets, churn notes and CRM.",
  tier: "deep",
  defaultCron: "0 7 * * 1-5",
  reads: ["customer-truth/what-the-market-is-telling-us", "outbound/icp"],
  spec: {
    mission: "Pull every customer signal into one place and show what changed, with receipts.",
    dataSources: ["Sales call notes", "Support tickets", "Churn notes", "CRM notes", "Reviews", "Social mentions", "Product events"],
    schedule: "Weekday mornings at 7:00",
    filters: ["Ignore internal chatter and spam", "Weight signals from ICP accounts higher", "Separate converted from lost deals when outcome is known"],
    output: "A dated memo: what changed, their words, objections, and one test to run this week.",
    goodLooksLike: [
      "Counts and segments, not adjectives",
      "Contrasts what converted with what did not",
      "Every claim carries a verbatim quote and a link to its source",
    ],
    approval: "A human approves the memo before it replaces the current truth file.",
    metric: "Share of recommended tests that win; memo approval rate",
    writesTo: "customer-truth/what-the-market-is-telling-us",
    lookbackDays: 7,
  },
  schema: Schema,
  systemPrompt: baseSystem("the Customer Truth analyst"),
  prompt: (rc) => `${renderSpec(rc)}

${renderRules(rc)}

${renderDocs(rc, ["customer-truth/what-the-market-is-telling-us", "outbound/icp"])}

The previous truth file (if any) is above. Your job is to say what CHANGED versus it, not to restate it.
When signals carry an outcome (won / lost / open) in their metadata, compare what converted with what did not.

${renderSignals(rc)}

Write this week's "What the market is telling us" for ${rc.tenantName}.`,
  offline,
  finalize(o, rc) {
    const changes = keepSupported(o.changes, rc.signalMap);
    const objections = keepSupported(o.objections, rc.signalMap);
    const language = keepSupported(o.language, rc.signalMap);
    const cleaned: Out = { ...o, changes: changes.kept as never, objections: objections.kept as never, language: language.kept as never };
    const dropped = changes.dropped + objections.dropped;
    const evidence = [...changes.kept, ...objections.kept].flatMap((c) => c.evidence);
    const date = rc.now.toISOString().slice(0, 10);
    return {
      summary: o.headline,
      stats: {
        signals: rc.signals.length,
        claims: changes.kept.length + objections.kept.length,
        dropped_claims: dropped,
        unverified_quotes: changes.unverifiedQuotes + objections.unverifiedQuotes + language.unverifiedQuotes,
      },
      drafts: [
        {
          type: "market_memo",
          title: `What the market is telling us · ${date}`,
          body: md(cleaned, dropped),
          payload: { headline: o.headline, recommended_test: o.recommended_test, language: cleaned.language.map((l) => l.phrase) },
          evidence,
        },
      ],
    };
  },
};

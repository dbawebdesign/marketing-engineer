import { z } from "zod";
import type { AgentTemplate, RunContext } from "../types";
import { baseSystem, renderDocs, renderRules, renderSignals, renderSpec } from "../prompting";
import { keepSupported } from "../evidence";
import { bestSentence, topPhrases } from "../text";

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

function offline(rc: RunContext): Out {
  const sigs = rc.signals;
  const won = sigs.filter((s) => s.outcome === "won");
  const phrases = topPhrases(sigs.map((s) => s.content), 10, 2);
  const changes: Out["changes"] = phrases.slice(0, 5).map((p) => {
    const hits = sigs.filter((s) => s.content.toLowerCase().includes(p.phrase.split(" ")[0]!) && s.content.toLowerCase().includes(p.phrase.split(" ").at(-1)!));
    const evidence = hits.slice(0, 3).flatMap((s) => {
      const q = bestSentence(s.content, p.phrase);
      return q ? [{ signal_id: s.id, quote: q }] : [];
    });
    const sources = [...new Set(hits.map((h) => h.source.replace("_", " ")))].join(", ");
    return {
      claim: `"${p.phrase}" came up in ${p.docs} separate signals (${sources}).`,
      why_it_matters: "Repeated, unprompted language is the cheapest positioning research there is. Test it in copy.",
      strength: p.docs >= 4 ? "strong" : "emerging",
      count: p.docs,
      evidence,
    };
  });
  // Converted vs. not: phrases that show up in won deals but not in lost ones.
  const calls = sigs.filter((s) => s.outcome === "won" || s.outcome === "lost");
  const lost = calls.filter((s) => s.outcome === "lost");
  if (won.length >= 2 && lost.length >= 1) {
    const wonP = topPhrases(won.map((s) => s.content), 8, 2);
    const lostText = lost.map((s) => s.content.toLowerCase()).join(" ");
    const distinct = wonP.find((p) => !p.phrase.split(" ").every((w) => lostText.includes(w)));
    const lostP = topPhrases(lost.map((s) => s.content), 4, Math.min(2, lost.length))[0];
    if (distinct) {
      const ws = won.filter((s) => s.content.toLowerCase().includes(distinct.phrase.split(" ")[0]!));
      changes.unshift({
        claim: `${distinct.docs} of ${won.length} won deals talked about "${distinct.phrase}"; none of the ${lost.length} lost deals did${lostP ? ` (they talked about "${lostP.phrase}")` : ""}.`,
        why_it_matters: "What converts is not always what buyers open with. Lead with what closes.",
        strength: distinct.docs >= 3 ? "strong" : "emerging",
        count: distinct.docs,
        evidence: ws.slice(0, 3).flatMap((s) => {
          const q = bestSentence(s.content, distinct.phrase);
          return q ? [{ signal_id: s.id, quote: q }] : [];
        }),
      });
    }
  }
  const top = changes[0] && won.length >= 2 ? (topPhrases(won.map((s) => s.content), 8, 2).find((p) => !lost.map((s) => s.content.toLowerCase()).join(" ").includes(p.phrase))?.phrase ?? phrases[0]?.phrase ?? "the most repeated pain") : (phrases[0]?.phrase ?? "the most repeated pain");
  return {
    headline: changes[0]?.claim ?? "Not enough signal this window to say what changed.",
    changes,
    language: phrases.slice(0, 6).map((p) => {
      const s = sigs.find((x) => x.content.toLowerCase().includes(p.phrase.split(" ")[0]!));
      const q = s ? bestSentence(s.content, p.phrase) : null;
      return { phrase: p.phrase, note: `${p.docs} mentions`, evidence: s && q ? [{ signal_id: s.id, quote: q }] : [] };
    }),
    objections: [],
    recommended_test: {
      name: `Lead with "${top}"`,
      hypothesis: `If we lead with the buyer's own phrase "${top}", positive reply and demo rates beat our current generic angle.`,
      angle: `Open with "${top}": the words buyers used before they signed.`,
      channel: "outbound",
      metric: "Qualified positive replies",
      why_this_week: "It is the most repeated phrase in this window's signal.",
    },
    confidence_note:
      "Generated by the offline engine (frequency analysis, no LLM). Connect a Claude API key for judgment-quality synthesis: converted vs. lost comparisons, objections, and sharper angles.",
  };
}

function md(o: Out, dropped: number) {
  const ev = (e: { quote: string; source?: string; account?: string | null }[]) =>
    e.map((x) => `  > "${x.quote}" (${[x.source?.replace(/_/g, " "), x.account].filter(Boolean).join(", ")})`).join("\n  >\n");
  return `# What the market is telling us

**${o.headline}**

## What changed
${o.changes.map((c) => `- **${c.claim}** ${c.why_it_matters} _(${c.strength}, ${c.count} signals)_\n${ev(c.evidence as never)}`).join("\n")}

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

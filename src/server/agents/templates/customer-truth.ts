import { z } from "zod";
import type { AgentTemplate, RunContext } from "../types";
import { baseSystem, renderDocs, renderRules, renderSignals, renderSpec } from "../prompting";
import { dedupeEvidence, keepSupported, type VerifiedEvidence } from "../evidence";
import { countBySource, listJoin, meta, onePerItem, shortDate } from "../format";
import { bestSentence, clip, sentences, strongestSentences, tokens, topPhrases } from "../text";
import { PULSE_MIN } from "../readiness";

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

/** Distinct voices behind a set of signals: one per named account, one per unnamed signal. */
const voices = (sigs: { id: string; account: string | null }[]) => new Set(sigs.map((s) => (s.account ? `a:${s.account.trim().toLowerCase()}` : `s:${s.id}`))).size;

/** A recommended test that is only a placeholder ("collect more signal") must never become an experiment. */
export function isRealTest(t: { name?: string; angle?: string } | null | undefined) {
  const name = t?.name?.trim() ?? "";
  return Boolean(name && t?.angle?.trim() && !/^(collect|gather|get|add) more\b|\bmore (signal|signals|data|notes)\b|not enough/i.test(name));
}

/**
 * Why a window produced no memo, in terms of what the person can see and change:
 * "5 sales calls, all about Brightline Plumbing and none with a deal outcome. Add notes from deals you won or lost, or calls with other companies."
 */
export function nothingToSay(sigs: { id: string; source: string; account: string | null; outcome?: string | null }[]) {
  const withOutcome = sigs.filter((s) => s.outcome === "won" || s.outcome === "lost").length;
  const accounts = [...new Set(sigs.map((s) => s.account?.trim()).filter(Boolean))] as string[];
  const oneAccount = accounts.length === 1 && sigs.every((s) => s.account?.trim());
  const facts = [oneAccount ? `all about ${accounts[0]}` : null, withOutcome ? null : "none with a deal outcome"].filter(Boolean);
  const asks = [withOutcome ? null : "notes from deals you won or lost", oneAccount ? "notes from other companies" : "more calls, tickets or reviews"].filter(Boolean) as string[];
  return `Not enough to say what changed yet: ${countBySource(sigs)}${facts.length ? `, ${facts.join(" and ")}` : ""}. Add ${asks.join(", or ")}.`;
}

/** Where a phrase appeared, stated as fact; no characterisation the notes don't support. */
function whyFor(sources: string[]): string {
  const has = (k: string) => sources.includes(k);
  if (has("churn_note")) return "It also appears in churn notes.";
  if (has("sales_call") && has("support_ticket")) return "It appears in both sales calls and support tickets.";
  if (has("review")) return "It appears in public reviews.";
  if (has("social")) return "It appears in public posts.";
  return "Read the quotes before acting on it.";
}

/** Prefix for every theme the offline engine asserts: it matched words, it did not understand them. */
export const OFFLINE_THEME = "Recurring phrase (offline match, unverified)";
export const OFFLINE_SINGLE = "Single signal, not a pattern yet";

const OBJECTION = /\b(price|pricing|cost|expensive|steep|cheaper|budget|per-tech|hard to justify|not interested|not urgent|left for|competitor|confusing|buried|took longer|built for bigger|bundles)\b/i;

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
    // One lost deal has no repeated phrase, only its own words; don't dress a random trigram up as a pattern.
    const lostP = lost.length >= 2 ? topPhrases(lost.map((s) => s.content), 4, 2)[0] : undefined;
    if (wonP) {
      const sharp = sharpen(wonP, won.map((s) => s.content));
      winning = surface(sharp.phrase, won.map((s) => s.content));
      const lostWords = lostP ? surface(lostP.phrase, lost.map((s) => s.content)) : null;
      const ws = won.filter((s) => wonP.phrase.split(" ").every((w) => tokens(s.content).includes(w)));
      headline = lostWords
        ? `Deals we won talked about ${winning}. Deals we lost talked about ${lostWords}.`
        : `Deals we won kept coming back to ${winning}.`;
      changes.push({
        claim: `${OFFLINE_THEME}: ${ws.length} of ${won.length} won deals brought up ${winning}; ${lost.length === 1 ? "the one lost deal didn't" : `none of the ${lost.length} lost deals did`}.`,
        why_it_matters: lostWords ? `The lost deals talked about ${lostWords} instead.` : "Check the quotes: it may be what closes.",
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
    // One company repeating itself across five calls is one voice, not a market signal.
    if (hits.length < 2 || voices(hits) < 2) continue;
    const sources = [...new Set(hits.map((h) => h.source))];
    changes.push({
      claim: `${OFFLINE_THEME}: “${words}” came up in ${hits.length} separate ${sources.length === 1 ? SOURCE_WORD[sources[0]!] ?? "notes" : "signals"}${sources.length > 1 ? ` across ${listJoin(sources.map((x) => SOURCE_WORD[x] ?? x))}` : ""}.`,
      why_it_matters: whyFor(sources),
      strength: hits.length >= 4 ? "strong" : "emerging",
      count: hits.length,
      evidence: hits.slice(0, 2).flatMap((s) => quote(s, p.phrase)),
    });
  }

  // 2b. Nothing recurs: say so, and quote the strongest single signals instead of inventing a pattern.
  // One company on repeat is still one voice; that case is left to nothingToSay().
  let noTheme = false;
  if (!changes.length && voices(sigs) >= 2) {
    // Price and competitor pushback is listed under Objections; keep this list for the other pains.
    const ranked = strongestSentences(sigs, 8);
    const pains = ranked.filter((x) => !OBJECTION.test(x.sentence));
    const strongest = (pains.length ? pains : ranked).slice(0, 3);
    if (strongest.length) {
      noTheme = true;
      headline = `No theme repeats across these ${sigs.length} signals yet. Strongest single signal: “${clip(strongest[0]!.sentence, 160)}”`;
      for (const x of strongest) {
        changes.push({
          claim: `${OFFLINE_SINGLE}: ${SOURCE_WORD[x.item.source]?.replace(/s$/, "") ?? "note"}${x.item.account ? ` from ${x.item.account}` : ""}`,
          why_it_matters: "Raised once. Watch for it in the next calls before acting on it.",
          strength: "emerging",
          count: 1,
          evidence: [{ signal_id: x.item.id, quote: x.sentence }],
        });
      }
    }
  }

  // 3. Objections: sentences from lost deals, churn notes and tickets that push back.
  const objectionSources = sigs.filter((s) => s.outcome === "lost" || s.source === "churn_note" || s.source === "review" || s.source === "support_ticket" || (s.source === "sales_call" && s.outcome !== "won"));
  const objections: Out["objections"] = [];
  for (const s of objectionSources) {
    const sentence = sentences(s.content).find((x) => OBJECTION.test(x));
    if (!sentence || objections.length >= 4) continue;
    const kind = sentence.match(OBJECTION)![0].toLowerCase();
    // Labels name the kind of pushback only; the quote under each says the specifics.
    const label = /price|pricing|cost|expensive|steep|cheaper|budget|per-tech|justify/.test(kind)
      ? "Price"
      : /left for|competitor|bundles/.test(kind)
        ? "Lost to a competitor or a bundle"
        : /confusing|buried|took longer/.test(kind)
          ? "Setup is confusing or slow"
          : /built for bigger/.test(kind)
            ? "Feels built for bigger companies"
            : "Not urgent enough to switch now";
    const existing = objections.find((o) => o.objection === label);
    if (existing) {
      existing.count++;
      if (existing.evidence.length < 2) existing.evidence.push({ signal_id: s.id, quote: sentence });
    } else objections.push({ objection: label, count: 1, evidence: [{ signal_id: s.id, quote: sentence }] });
  }

  // The test leads with what closed, or with the phrase behind the top change; never with a phrase that didn't make the memo.
  const topChange = changes[0] && !noTheme ? /“([^”]+)”/.exec(changes[0].claim)?.[1] ?? null : null;
  const angle = winning ?? topChange;
  return {
    headline: headline ?? (changes[0] ? `${changes[0].claim.slice(OFFLINE_THEME.length + 2).replace(/\.$/, "")} (offline phrase match, unverified).` : ""),
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
      : { name: "", hypothesis: "", angle: "", channel: "other", metric: "", why_this_week: "" },
    confidence_note: `${won.length + lost.length ? `Deal outcome known for ${won.length} won and ${lost.length} lost` : "No deal outcomes recorded yet"}. Written offline by phrase matching, not a model: check each quote.`,
  };
}

type V<T> = Omit<T, "evidence"> & { evidence: VerifiedEvidence[] };
type Kept = Omit<Out, "changes" | "objections"> & { changes: V<Out["changes"][number]>[]; objections: V<Out["objections"][number]>[] };

const receipt = (e: VerifiedEvidence | null) => (e ? `\n  > "${e.quote}" (${[e.source ? (SOURCE_WORD[e.source] ?? e.source).replace(/s$/, "") : null, e.account].filter(Boolean).join(", ")})` : "");

/** The memo body: dense, one receipt per bullet (the full list stays on the draft's evidence). */
function md(o: Kept) {
  const used = new Set<string>();
  const changes = o.changes.slice(0, 4);
  const objections = o.objections.slice(0, 3);
  const cq = onePerItem(changes, used);
  const oq = onePerItem(objections, used);
  // Phrases already named in a claim are not news twice.
  const claims = changes.map((c) => c.claim.toLowerCase()).join(" ");
  const words = o.language.filter((l) => !claims.includes(l.phrase.toLowerCase())).slice(0, 5);
  const t = o.recommended_test;
  return [
    o.headline.trim() ? `**${o.headline}**` : null,
    changes.length ? `## What changed\n${changes.map((c, i) => `- **${c.claim.replace(/\.$/, "")}.** ${c.why_it_matters}${receipt(cq[i]!)}`).join("\n")}` : null,
    words.length ? `## Their words\n${words.map((l) => `"${l.phrase}" (${l.note.replace(/ mentions?$/, "")})`).join(" · ")}` : null,
    objections.length ? `## Objections\n${objections.map((x, i) => `- **${x.objection}** (${x.count})${receipt(oq[i]!)}`).join("\n")}` : null,
    isRealTest(t) ? `## Test this week\n**${t.name}.** ${t.hypothesis} Run it on ${t.channel.replace("_", " ")}; decided by ${t.metric.toLowerCase()}.` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const customerTruth: AgentTemplate<typeof Schema> = {
  id: "market-pulse",
  system: "customer_truth",
  name: "Market pulse",
  tagline: "Writes \"What the market is telling us\" from calls, tickets, churn notes and CRM.",
  tier: "deep",
  defaultCron: "0 7 * * 1-5",
  reads: ["customer-truth/what-the-market-is-telling-us", "outbound/icp"],
  readiness: { min: PULSE_MIN },
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
    const cleaned = { ...o, changes: changes.kept, objections: objections.kept, language: language.kept } as Kept;
    const dropped = changes.dropped + objections.dropped;
    const evidence = dedupeEvidence([...changes.kept, ...objections.kept].flatMap((c) => c.evidence));
    const date = shortDate(rc.now);
    // A memo is worth reviewing only when at least one change survived verification.
    const substantive = changes.kept.length > 0;
    const headline = substantive && o.headline.trim() ? o.headline : (changes.kept[0]?.claim ?? "");
    const test = isRealTest(o.recommended_test) ? o.recommended_test : null;
    return {
      substantive,
      summary: substantive ? headline : nothingToSay(rc.signals),
      stats: {
        signals: rc.signals.length,
        claims: changes.kept.length + objections.kept.length,
        dropped_claims: dropped,
        unverified_quotes: changes.unverifiedQuotes + objections.unverifiedQuotes + language.unverifiedQuotes,
      },
      drafts: !substantive ? [] : [
        {
          type: "market_memo",
          title: `What the market is telling us · ${date}`,
          body: md({ ...cleaned, headline, recommended_test: test ?? cleaned.recommended_test }),
          payload: {
            headline,
            recommended_test: test,
            language: cleaned.language.map((l) => l.phrase),
            meta: meta(
              ["Signals", `${rc.signals.length} in the last ${rc.spec.lookbackDays} days`],
              ["Confidence", o.confidence_note],
              ["Dropped", dropped ? `${dropped} claim${dropped === 1 ? "" : "s"} without a verifiable quote` : null],
            ),
          },
          evidence,
        },
      ],
    };
  },
};

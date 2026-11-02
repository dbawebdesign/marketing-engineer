import { z } from "zod";
import type { AgentTemplate, RunContext } from "../types";
import type { SignalLite } from "../evidence";
import { baseSystem, renderDocs, renderRules, renderSignals, renderSpec } from "../prompting";
import { keepSupported } from "../evidence";
import { bullets, findBanned, findSentence, parseBanned, renderBanned, techsOf } from "./guardrails";
import { countBySource, draftTitle, fromSignals, meta } from "../format";
import { mentionsPhrase, phraseWords, quoteLine, sentences, stripLabel } from "../text";

const READS = ["creative/offers", "customer-truth/what-the-market-is-telling-us", "outbound/approved-angles", "content/winning-hooks", "content/founder-voice", "outbound/banned-language"];
const CHANNELS = ["paid_social", "linkedin", "x", "search", "landing_page", "email", "outbound", "other"] as const;

const Ev = z.object({ signal_id: z.string(), quote: z.string().describe("Verbatim sentence copied from the signal.") });

const Schema = z.object({
  offer: z.string().describe("The offer being tested, as one line."),
  hypothesis: z.string().describe("Which angle should win, on which metric, and why, in one or two sentences."),
  channel: z.enum(CHANNELS),
  metric: z.string().describe("The metric event kind that decides the test, e.g. demo_request or qualified_reply."),
  angles: z
    .array(
      z.object({
        name: z.string().describe("Short angle name, 2-5 words."),
        insight: z.string().describe("The buyer truth this angle rests on, one sentence."),
        hooks: z.array(z.string()).describe("Exactly 4 hooks for this angle. Each under 15 words, specific, in buyer language."),
        evidence: z.array(Ev).describe("Signals that justify the angle."),
      }),
    )
    .describe("5 distinct angles (20 hooks in total)."),
  ads: z
    .array(
      z.object({
        angle: z.string().describe("Name of the angle this ad belongs to."),
        headline: z.string().describe("Under 40 characters."),
        primary_text: z.string().describe("Under 200 characters. One idea, ends with what to do."),
        visual: z.string().describe("Visual direction a designer can shoot or build without a meeting."),
      }),
    )
    .describe("10 ad concepts, two per angle."),
  notes: z.string(),
});
type Out = z.infer<typeof Schema>;

function parseOffer(rc: RunContext): { name: string; detail: string } {
  const input = typeof rc.input.offer === "string" ? rc.input.offer.trim() : "";
  if (input) return { name: input.split(/[:.]/)[0]!.trim(), detail: input };
  const first = bullets(rc.docs["creative/offers"])[0];
  if (!first) return { name: "Our main offer", detail: "" };
  const [name, ...rest] = first.split(/:\s+/);
  return { name: name!.trim(), detail: rest.join(": ").trim() };
}

const unquote = (s: string) => s.replace(/^.*?:\s+(?=[a-z])/, "").replace(/^(She|He|They)\s+(said|says)\s+/i, "").replace(/^./, (c) => c.toUpperCase());

function find(sigs: SignalLite[], re: RegExp) {
  for (const s of sigs) {
    const q = findSentence(s, re);
    if (q) return { s, q };
  }
  return null;
}

/**
 * Sample (demo) signals carry `is_sample`. The worded hooks, insights and ads below describe the sample
 * business (follow-up quotes from the truck), so they are only written for sample signals; a real
 * tenant gets hooks quoted verbatim from its own signals and nothing else.
 */
const isSample = (s: SignalLite) => Boolean((s as SignalLite & { is_sample?: boolean }).is_sample);

/** The test phrase a run was started for ("Run Hook lab on this" on an experiment), if any. */
export function testPhraseOf(rc: Pick<RunContext, "input">): string | null {
  const i = rc.input ?? {};
  if (typeof i.experiment_id !== "string" || !i.experiment_id) return null;
  const name = typeof i.experiment === "string" ? i.experiment.trim() : "";
  const offer = typeof i.offer === "string" ? i.offer.split(/[:.]/)[0]!.trim() : "";
  const phrase = name || offer;
  return phrase && phraseWords(phrase).length ? phrase : null;
}

/** "Lead with drive-time report" → "drive-time report". */
const phraseCore = (p: string) => p.replace(/^\s*(lead|open|start|go|test|try)\s+(with|on)\s+/i, "").replace(/^\s*(test|try)\s+/i, "").trim();

/** Verbatim sentences (or a whole short line) from a signal, labels stripped. */
function quotable(s: SignalLite): string[] {
  const ss = sentences(s.content);
  const t = s.content.replace(/\s+/g, " ").trim();
  return (ss.length ? ss : t.length >= 12 && t.length <= 320 ? [t] : []).map(stripLabel).filter((q) => q.length >= 12);
}

const SOURCE_NAME: Record<string, string> = { sales_call: "sales calls", support_ticket: "support tickets", churn_note: "churn notes", review: "reviews", crm_note: "CRM notes", interview: "interviews", social: "social posts", email: "emails" };

/** Hooks for a test phrase: only verbatim quotes that use it, one angle per source. Empty when no quote does. */
function phraseBatch(rc: RunContext, phrase: string): Out["angles"] {
  const words = phraseWords(phrase);
  const core = phraseCore(phrase);
  const bySource = new Map<string, { s: SignalLite; q: string }[]>();
  for (const s of rc.signals) {
    for (const q of quotable(s)) {
      if (!mentionsPhrase(q, words)) continue;
      if (!bySource.has(s.source)) bySource.set(s.source, []);
      const list = bySource.get(s.source)!;
      if (!list.some((x) => x.q === q)) list.push({ s, q });
    }
  }
  return [...bySource.entries()].slice(0, 5).map(([src, xs]) => {
    const picked = xs.slice(0, 4);
    return {
      name: `"${core}" in ${SOURCE_NAME[src] ?? src.replace(/_/g, " ")}`,
      insight: `Quoted verbatim from ${countBySource(picked.map((x) => x.s).filter((s, i, a) => a.indexOf(s) === i))}.`,
      hooks: picked.map((x) => quoteLine(x.q)),
      evidence: picked.map((x) => ({ signal_id: x.s.id, quote: x.q })),
    };
  });
}

/** The buyer lines each angle is built on. A signal matching none of them gives the offline writer nothing to test. */
const ANGLE_LINES = {
  money: /\$\s?\d[\d,]{2,}/,
  blind: /\b(can't see|cannot see|no idea|on the table)\b/i,
  handoff: /\b(handoff|black hole|never turns|never gets sent|nowhere to go)\b/i,
  best: /\bbest tech\b/i,
  proof: /\b(paid for|first month|same day)\b/i,
};
// The loss angle's hooks are about a quote nobody sent: only build it from a note that says so.
const moneyLine = (s: SignalLite) => (/\b(quote|follow)/i.test(s.content) ? findSentence(s, ANGLE_LINES.money) : null);

export function angleable(s: SignalLite) {
  return Boolean(
    moneyLine(s) || findSentence(s, ANGLE_LINES.blind) || findSentence(s, ANGLE_LINES.handoff) || findSentence(s, ANGLE_LINES.best) || (s.source === "review" && findSentence(s, ANGLE_LINES.proof)),
  );
}

/** A real tenant's angle: its hooks are the verbatim buyer lines, nothing written around them. */
function verbatimAngle(name: string, xs: { s: SignalLite; q: string }[]): Out["angles"][number] {
  const qs = xs.map((x) => ({ ...x, q: stripLabel(x.q) }));
  return {
    name,
    insight: `Quoted verbatim from ${countBySource(qs.map((x) => x.s).filter((s, i, a) => a.indexOf(s) === i))}.`,
    hooks: qs.map((x) => quoteLine(x.q)),
    evidence: qs.map((x) => ({ signal_id: x.s.id, quote: x.q })),
  };
}

function offline(rc: RunContext): Out {
  const sigs = rc.signals;
  const offer = parseOffer(rc);
  const phrase = testPhraseOf(rc);
  if (phrase) {
    const angles = phraseBatch(rc, phrase);
    return {
      offer: offer.detail ? `${offer.name}: ${offer.detail}` : offer.name,
      hypothesis: angles.length ? `Hooks that say "${phraseCore(phrase)}" in the buyer's own words, tested against each other on demo requests per click.` : "",
      channel: "paid_social",
      metric: "demo_request",
      angles,
      ads: [],
      notes: "Every hook is a verbatim quote that uses the test phrase. Run 2-3 per angle first.",
    };
  }
  const isCalc = /calculator/i.test(offer.name);
  const isPilot = /pilot|trial/i.test(offer.name);
  const cta = isCalc ? "Get your number." : isPilot ? "Start the pilot." : "See how it works.";
  const inputs = offer.detail.split(/\s*[×x*]\s*/).length;
  const angles: Out["angles"] = [];
  const ads: Out["ads"] = [];
  const approved = bullets(rc.docs["outbound/approved-angles"]);

  // 1. A specific loss.
  const money = sigs.map((s) => ({ s, q: moneyLine(s) })).find((x): x is { s: SignalLite; q: string } => Boolean(x.q)) ?? null;
  if (money && !isSample(money.s)) {
    angles.push(verbatimAngle("A cost they named", [money]));
  } else if (money) {
    const amount = /\$\s?\d[\d,]+/.exec(money.q)![0];
    const what = /\b(chiller|rooftop unit|boiler|compressor|furnace|unit)\b/i.exec(money.q)?.[1]?.toLowerCase() ?? "equipment";
    const competitor = /competitor/i.test(money.s.content);
    angles.push({
      name: "The job someone else quoted",
      insight: `Contractors lose large replacement jobs after their own tech spotted the problem (one lost a ${amount} ${what} replacement${competitor ? " to a competitor" : ""}).`,
      hooks: [
        `A ${amount} ${what} job${competitor ? " went to a competitor" : " was lost"} because nobody sent the quote.`,
        `Your tech found the replacement. Someone else sent the quote.`,
        `How many replacements did your techs spot last month that never got quoted?`,
        `The most expensive quote is the one that never leaves the truck.`,
      ],
      evidence: [{ signal_id: money.s.id, quote: money.q }],
    });
    ads.push(
      { angle: "The job someone else quoted", headline: `The ${amount} quote nobody sent`, primary_text: `A tech flagged a failing ${what}. Nobody followed up.${competitor ? " A competitor got the job three weeks later." : ""} ${cta}`, visual: `Close-up of a tech's handwritten service note ("compressor failing") on a clipboard, next to an empty quote screen. Muted, real-shop photography, no stock smiles.` },
      { angle: "The job someone else quoted", headline: "Your tech saw it first", primary_text: `Your techs spot dying units every week. Count the ones that never turned into a quote. ${cta}`, visual: `Split frame: left, your truck at a rooftop unit; right, a competitor's truck at the same unit three weeks later. Simple caption overlay with the dates.` },
    );
  }

  // 2. The leak they can't count.
  const blind = find(sigs, ANGLE_LINES.blind);
  if (blind && !isSample(blind.s)) {
    angles.push(verbatimAngle("What they can't see", [blind]));
  } else if (blind) {
    const said = unquote(blind.q).replace(/\.$/, "");
    angles.push({
      name: "The leak you can't count",
      insight: "Buyers already believe they lose replacement work; what they lack is the number.",
      hooks: [
        quoteLine(said),
        `You can't fix a leak you can't count.`,
        `Put a number on the replacement jobs your techs already found.`,
        isCalc && inputs >= 3 ? `${inputs === 4 ? "Four" : inputs} numbers you already know. One you don't.` : `The revenue leak that never shows up on a report.`,
      ],
      evidence: [{ signal_id: blind.s.id, quote: blind.q }],
    });
    ads.push(
      { angle: "The leak you can't count", headline: "Count the leak", primary_text: `Most commercial shops know they leave replacement jobs on the table. Few know how many. ${cta}`, visual: isCalc ? `Screen recording of the calculator: ${inputs} inputs filled in, the result counter ticking up to a monthly dollar figure. No voiceover, captions only.` : `A leaking pipe with a dollar-sign drip, shot practically, not illustrated.` },
      { angle: "The leak you can't count", headline: "What does missed follow-up cost?", primary_text: `${offer.detail ? `${offer.detail.replace(/\.$/, "").replace(/^./, (c) => c.toUpperCase())}.` : ""} ${cta}`.trim(), visual: `Plain white card with the formula written in marker, one variable circled: "missed follow-ups".` },
    );
  }

  // 3. The handoff that breaks.
  const handoff = find(sigs, ANGLE_LINES.handoff);
  if (handoff && !isSample(handoff.s)) {
    angles.push(verbatimAngle("Where the handoff breaks", [handoff]));
  } else if (handoff) {
    const nextQuote = approved.find((a) => /next quote/i.test(a));
    angles.push({
      name: "The handoff that breaks",
      insight: "The replacement is lost between the truck and the office, not in the field.",
      hooks: [
        /handoff/i.test(handoff.q) && handoff.q.length < 70 ? handoff.q : `The quote dies in the handoff from truck to office.`,
        `Your tech knows the unit is dying. Your office doesn't.`,
        `Between the truck and the office, replacement jobs disappear.`,
        nextQuote ? `${nextQuote.replace(/\.$/, "")}.` : `Every completed job should create the next quote.`,
      ],
      evidence: [{ signal_id: handoff.s.id, quote: handoff.q }],
    });
    ads.push(
      { angle: "The handoff that breaks", headline: "Where replacement jobs go to die", primary_text: `The tech knows. The customer trusts the tech. Then the quote sits at the office. ${cta}`, visual: `Three-panel storyboard: tech on a roof, paper note on a dashboard, an office inbox with 47 unread. Real photos, handheld.` },
      { angle: "The handoff that breaks", headline: "One button from the truck", primary_text: `The tech starts the quote before leaving the site. The office sends it the same day. ${cta}`, visual: `Phone in a tech's gloved hand on a rooftop, tapping "Create quote". Shot over the shoulder.` },
    );
  }

  // 4. Every tech, your best tech.
  const best = find(sigs, ANGLE_LINES.best);
  if (best && !isSample(best.s)) {
    angles.push(verbatimAngle("Their best person", [best]));
  } else if (best) {
    const techs = techsOf(best.s);
    angles.push({
      name: "Every tech, your best tech",
      insight: "Equipment sales concentrate in the one tech who follows up; buyers want that habit everywhere.",
      hooks: [
        `Your best tech isn't the fastest. He's the one who follows up.`,
        `What if every tech followed up like your best one?`,
        techs ? `At a ${techs}-tech shop, one tech drove most equipment sales. He followed up.` : `Most equipment sales come from one tech. That's a process problem.`,
        `Follow-up shouldn't depend on who's on the truck.`,
      ],
      evidence: [{ signal_id: best.s.id, quote: best.q }],
    });
    ads.push(
      { angle: "Every tech, your best tech", headline: "Clone your best tech's habit", primary_text: `He isn't faster. He follows up on every failing unit. Make that the default for the whole crew. ${cta}`, visual: `Portrait of a veteran tech by his truck, overlaid with a simple stat card: "follow-ups sent: every job".` },
      { angle: "Every tech, your best tech", headline: "Follow-up, not heroics", primary_text: `When one tech sells most of your replacements, it's a process gap, not a talent gap. ${cta}`, visual: `Leaderboard-style bar chart of replacement quotes per tech: one tall bar, the rest flat. Then the same chart, all bars level.` },
    );
  }

  // 5. Proof from a customer.
  const proof = sigs.filter((s) => s.source === "review").map((s) => ({ s, q: findSentence(s, ANGLE_LINES.proof) })).find((x): x is { s: SignalLite; q: string } => Boolean(x.q));
  if (proof && !isSample(proof.s)) {
    const second = findSentence(proof.s, /same day/i);
    angles.push(verbatimAngle("In a customer's words", [proof, ...(second && second !== proof.q ? [{ s: proof.s, q: second }] : [])]));
  } else if (proof) {
    const second = findSentence(proof.s, /same day/i);
    angles.push({
      name: "It paid for itself",
      insight: "Customers who use follow-up quotes describe a payback measured in weeks.",
      hooks: [
        quoteLine(proof.q),
        second ? `Techs flag replacements from the truck. The office quotes the same day.` : `Replacement quotes, out the same day.`,
        `What would one extra replacement job a month pay for?`,
        `Paid for the year in the first month. One customer's words, not ours.`,
      ],
      evidence: [{ signal_id: proof.s.id, quote: proof.q }, ...(second && second !== proof.q ? [{ signal_id: proof.s.id, quote: second }] : [])],
    });
    ads.push(
      { angle: "It paid for itself", headline: "Paid for the year in month one", primary_text: `${quoteLine(proof.q)} From a ${/g2/i.test(proof.s.title) ? "G2" : /capterra/i.test(proof.s.title) ? "Capterra" : "customer"} review. ${cta}`, visual: `The review itself as the creative: star rating and quote on a plain background, reviewer's company size underneath. No product UI.` },
      { angle: "It paid for itself", headline: "One replacement pays for it", primary_text: `What would one recovered replacement job a month pay for? Count the ones you missed. ${cta}`, visual: `A replacement invoice with the total circled, next to a much smaller annual software receipt. Desk-level photo.` },
    );
  }

  const order = angles.map((a) => a.name);
  const lead = order.includes("The leak you can't count") ? "The leak you can't count" : order[0];
  const sampleLead = lead ? angles.find((a) => a.name === lead)!.evidence.every((e) => isSample(rc.signalMap.get(e.signal_id) ?? ({} as SignalLite))) : false;
  return {
    offer: offer.detail ? `${offer.name}: ${offer.detail}` : offer.name,
    hypothesis: !lead
      ? ""
      : sampleLead
        ? `Angles built on a concrete loss in the buyer's own words will beat product-feature framing on demo requests per click. We expect "${lead}" to win because inbound already arrives using that language.`
        : `Hooks quoted from the buyer's own words, tested against each other on demo requests per click. "${lead}" leads the batch.`,
    channel: isCalc ? "paid_social" : isPilot ? "outbound" : "paid_social",
    metric: isPilot ? "qualified_reply" : "demo_request",
    angles,
    ads,
    notes: `Run 2-3 hooks per angle first; cut angles, not hooks, after the first week.`,
  };
}

export const creativeTesting: AgentTemplate<typeof Schema> = {
  id: "hook-lab",
  system: "creative_testing",
  name: "Hook lab",
  tagline: "Takes one offer and writes 20 hooks across five angles plus 10 ad concepts, ready to test.",
  tier: "fast",
  defaultCron: "0 9 * * 3",
  reads: READS,
  readiness: {
    usable: angleable,
    usableOfflineOnly: true,
    usableNoun: "with a buyer line to build an angle on (a dollar loss from a missed quote, \"we can't see\", a broken handoff, \"our best tech\", or a review saying it paid for itself)",
  },
  spec: {
    mission: "Find the angle that sells the offer by testing many hooks built from real buyer language, not guesses.",
    dataSources: ["Offers doc", "Customer truth file (recommended test, buyer language)", "Approved angles", "Winning hooks", "Recent signals"],
    schedule: "Wednesdays at 9:00, or on demand with an offer",
    filters: ["One offer per batch", "Every angle traces to at least one signal", "No claims the offer doesn't make", "Drop any hook that uses banned language"],
    output: "One test batch: a hypothesis, 5 angles with 4 hooks each, and 10 ad concepts with headline, primary text and visual direction.",
    goodLooksLike: [
      "Angles are genuinely different buyer truths, not rewordings",
      "Hooks use the buyer's words and a number where one exists",
      "A designer could brief the visuals without a meeting",
      "The hypothesis names the angle expected to win and the metric that decides it",
    ],
    approval: "A human approves the batch, which starts an experiment with these variants.",
    metric: "Win rate of tested angles on demo requests per click",
    writesTo: "Experiments; winners land in content/winning-hooks",
    lookbackDays: 30,
  },
  schema: Schema,
  systemPrompt: baseSystem("the Creative Testing lead"),
  prompt: (rc) => {
    const offer = parseOffer(rc);
    return `${renderSpec(rc)}

${renderRules(rc)}

${renderDocs(rc, READS)}

${renderBanned(parseBanned(rc.docs["outbound/banned-language"], rc.docs["content/founder-voice"]))}

The offer to test: **${offer.name}**${offer.detail ? `: ${offer.detail}` : ""}
${testPhraseOf(rc) ? `\nThis batch is for the test "${testPhraseOf(rc)}". Every hook must use the words "${phraseCore(testPhraseOf(rc)!)}", built from signal quotes that contain them. If no signal says it, return no angles.\n` : ""}
How to work:
- Start from the truth file's recommended test and buyer language, then find 5 genuinely different angles (loss, invisible problem, broken process, aspiration, proof, etc.). Each angle cites the signals behind it.
- 4 hooks per angle. Under 15 words. Use the buyer's words, numbers that appear in the signals, never invented stats.
- 10 ad concepts, two per angle: headline under 40 characters, primary text under 200, and a visual direction specific enough to shoot.
- A hypothesis that names the angle you expect to win and why. Metric is an event kind (demo_request, qualified_reply, click).
- Do not repeat hooks already listed in Winning hooks; build on what they teach.

${renderSignals(rc)}

Write the batch for ${rc.tenantName}.`;
  },
  offline,
  finalize(o, rc) {
    const banned = parseBanned(rc.docs["outbound/banned-language"], rc.docs["content/founder-voice"]);
    const sup = keepSupported(o.angles, rc.signalMap);
    const keptNames = new Set(sup.kept.map((a) => a.name));
    // A run started for a test phrase must test that phrase: hooks and ads that don't use it are dropped.
    const phrase = testPhraseOf(rc);
    const words = phrase ? phraseWords(phrase) : [];
    const onPhrase = (t: string) => !phrase || mentionsPhrase(t, words);
    let bannedHooks = 0;
    const angles = sup.kept.map((a) => {
      const hooks = a.hooks.filter(onPhrase).filter((h) => {
        const bad = findBanned(h, banned).length > 0;
        if (bad) bannedHooks++;
        return !bad;
      });
      return { ...a, hooks };
    });
    const ads = o.ads.filter((x) => keptNames.has(x.angle)).filter((x) => onPhrase(`${x.headline} ${x.primary_text}`)).filter((x) => {
      const bad = findBanned(`${x.headline} ${x.primary_text}`, banned).length > 0;
      if (bad) bannedHooks++;
      return !bad;
    });
    const variants = [
      ...angles.flatMap((a, ai) => a.hooks.map((h, hi) => ({ id: `h${ai + 1}.${hi + 1}`, label: `Hook ${ai + 1}.${hi + 1} · ${a.name}`, content: h, angle: a.name }))),
      ...ads.map((x, i) => ({ id: `ad${i + 1}`, label: `Ad ${i + 1} · ${x.headline}`, content: `${x.headline}\n\n${x.primary_text}\n\nVisual: ${x.visual}`, angle: x.angle })),
    ];
    const nHooks = angles.reduce((n, a) => n + a.hooks.length, 0);
    const [offerName, ...offerRest] = o.offer.split(/:\s+/);
    // A batch with no hooks is not a test: keep no draft, start no experiment.
    if (nHooks === 0 && phrase) {
      return {
        substantive: false,
        summary: `No hook batch for "${phrase}": none of the ${countBySource(rc.signals) || "0 signals"} in the last ${rc.spec.lookbackDays} days has a line that says "${phraseCore(phrase)}", and hooks for this test are built only from quotes that do. Add a note where a buyer says it, or rename the test to the words buyers use.`,
        stats: { angles: 0, hooks: 0, ads: 0, dropped_angles: sup.dropped, banned_removed: bannedHooks, unverified_quotes: sup.unverifiedQuotes },
        drafts: [],
      };
    }
    if (nHooks === 0) {
      const why = [sup.dropped ? `${sup.dropped} angle${sup.dropped === 1 ? "" : "s"} dropped because their quotes didn't match the signals` : null, bannedHooks ? `${bannedHooks} line${bannedHooks === 1 ? "" : "s"} removed for banned language` : null].filter(Boolean);
      return {
        substantive: false,
        summary: why.length
          ? `No hook batch this time: ${why.join("; ")}.`
          : `No hook batch this time: ${countBySource(rc.signals)} in the last ${rc.spec.lookbackDays} days, none with a buyer line to build an angle on (a dollar loss from a missed quote, "we can't see", a broken handoff, "our best tech", or a review saying it paid for itself).`,
        stats: { angles: 0, hooks: 0, ads: 0, dropped_angles: sup.dropped, banned_removed: bannedHooks, unverified_quotes: sup.unverifiedQuotes },
        drafts: [],
      };
    }
    const body = `${o.hypothesis ? `${o.hypothesis}\n\n` : ""}## Hooks
${angles
  .filter((a) => a.hooks.length)
  .map((a, ai) => `### ${ai + 1}. ${a.name}\n_${a.insight}_\n\n${a.hooks.map((h, hi) => `${ai + 1}.${hi + 1} ${h}`).join("  \n")}`)
  .join("\n\n")}${
      ads.length ? `\n\n## Ad concepts\n${ads.map((x, i) => `**${i + 1}. ${x.headline}** _(${x.angle})_  \n${x.primary_text}  \nVisual: ${x.visual}`).join("\n\n")}` : ""
    }`;
    const metaRow = meta(
      ["Offer", offerRest.join(": ") || null],
      ["Channel", o.channel.replace("_", " ")],
      ["Decided by", o.metric.replace(/_/g, " ")],
      ["Batch", `${nHooks} hooks, ${ads.length} ads, ${angles.length} angles`],
      ["From", fromSignals(sup.kept.flatMap((a) => a.evidence), rc.signalMap)],
      ["Removed", [sup.dropped ? `${sup.dropped} angle${sup.dropped === 1 ? "" : "s"} without a verifiable quote` : null, bannedHooks ? `${bannedHooks} line${bannedHooks === 1 ? "" : "s"} with banned language` : null].filter(Boolean).join("; ") || null],
      ["Notes", o.notes],
    );
    return {
      substantive: true,
      summary: `${nHooks} ${nHooks === 1 ? "hook" : "hooks"} and ${ads.length} ${ads.length === 1 ? "ad concept" : "ad concepts"} across ${angles.length} ${angles.length === 1 ? "angle" : "angles"} for "${o.offer.split(":")[0]}".`,
      stats: { angles: angles.length, hooks: nHooks, ads: ads.length, dropped_angles: sup.dropped, banned_removed: bannedHooks, unverified_quotes: sup.unverifiedQuotes },
      drafts: [
        {
          type: "creative_batch",
          // Without a named offer, name the batch after its lead angle rather than "Our main offer".
          title: draftTitle(body, /^our main offer$/i.test((offerName ?? "").trim()) && angles[0] ? `Hooks: ${angles[0].name}` : offerName),
          body,
          payload: {
            offer: o.offer,
            hypothesis: o.hypothesis,
            channel: o.channel,
            metric: o.metric,
            angles: angles.map((a) => ({ name: a.name, insight: a.insight, hooks: a.hooks })),
            ads,
            variants,
            meta: metaRow,
          },
          evidence: sup.kept.flatMap((a) => a.evidence),
        },
      ],
    };
  },
};

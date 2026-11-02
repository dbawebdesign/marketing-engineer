import { z } from "zod";
import type { AgentTemplate, DraftInput, RunContext } from "../types";
import type { SignalLite } from "../evidence";
import { baseSystem, renderDocs, renderRules, renderSignals, renderSpec } from "../prompting";
import { keepSupported } from "../evidence";
import { clip, sentences, tokens, topPhrases } from "../text";
import { bullets, ev, findBanned, findSentence, parseBanned, renderBanned, retell, techsOf } from "./guardrails";

const READS = ["customer-truth/what-the-market-is-telling-us", "content/founder-voice", "content/winning-hooks", "outbound/approved-angles", "outbound/banned-language"];

const Ev = z.object({ signal_id: z.string(), quote: z.string().describe("Verbatim sentence copied from the signal.") });

const Schema = z.object({
  posts: z
    .array(
      z.object({
        platform: z.enum(["linkedin", "x"]),
        hook: z.string().describe("The first line. Earns the second line. No question-bait, no emoji."),
        body: z.string().describe("The full post text after the hook, ready to paste. LinkedIn: 60-180 words, short paragraphs. X: the whole post including the hook under 280 characters."),
        insight: z.string().describe("The customer pain or insight this post came from, in one sentence."),
        angle: z.string().describe("The angle in a few words, e.g. 'lost replacement revenue'."),
        evidence: z.array(Ev).describe("The signals this post is built on. At least one."),
      }),
    )
    .describe("5 posts, each from a different insight. Mix LinkedIn and X."),
  asset_ideas: z
    .array(
      z.object({
        kind: z.enum(["calculator", "landing_line", "checklist", "teardown", "other"]),
        name: z.string(),
        pitch: z.string().describe("The one line a buyer would see."),
        why: z.string().describe("Why the signal says this would convert."),
        evidence: z.array(Ev),
      }),
    )
    .describe("0-2 asset ideas (calculator, landing page line, checklist) the posts could point to."),
  notes: z.string().describe("What was thin, what you skipped and why."),
});
type Out = z.infer<typeof Schema>;
type Post = Out["posts"][number];

const pretty = (p: string) => p.replace(/^follow up$/, "follow-up quotes").replace(/\bfollow up\b/g, "follow-up").replace(/\bopportunitie\b/g, "opportunities").replace(/\bup quote\b/g, "follow-up quote");
const phraseIn = (s: SignalLite, phrase: string) => phrase.split(" ").every((w) => tokens(s.content).some((t) => t.startsWith(w)));

/** "She said every completed job should create the next quote." -> "Every completed job should create the next quote." */
function bare(sentence: string) {
  const s = sentence
    .replace(/^.*?:\s+(?=[a-z])/, "")
    .replace(/^(She|He|They|Owner|The owner|Service manager)\s+(said|says|wants|asked if|asked whether)\s+/i, "")
    .trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function voiceLine(rc: RunContext, about: string): string | null {
  const loved = bullets(rc.docs["content/founder-voice"])
    .map((b) => /^["“](.+)["”]$/.exec(b)?.[1])
    .filter((x): x is string => Boolean(x));
  const want = new Set(tokens(about));
  const scored = loved.map((l) => ({ l, s: tokens(l).filter((t) => want.has(t)).length })).sort((a, b) => b.s - a.s);
  return scored[0] && scored[0].s > 0 ? scored[0].l : null;
}

function offline(rc: RunContext): Out {
  const sigs = rc.signals;
  const posts: Post[] = [];
  const used = new Set<string>();
  const calls = sigs.filter((s) => s.source === "sales_call");
  const won = calls.filter((s) => s.outcome === "won");
  const notWon = calls.filter((s) => s.outcome === "lost" || s.outcome === "open");

  // 1. Contrast: what buyers open with vs. what closes.
  if (won.length >= 2 && notWon.length >= 1) {
    const loud = topPhrases(notWon.map((s) => s.content), 5, 2)[0] ?? topPhrases(calls.map((s) => s.content), 5, 2)[0];
    const wonP = topPhrases(won.map((s) => s.content), 8, 2).find((p) => !loud || !p.phrase.includes(loud.phrase.split(" ")[0]!));
    if (loud && wonP) {
      const openers = calls.filter((s) => phraseIn(s, loud.phrase));
      const closers = won.filter((s) => phraseIn(s, wonP.phrase));
      const both = closers.find((s) => phraseIn(s, loud.phrase)) ?? closers[0]!;
      const q = findSentence(both, new RegExp(wonP.phrase.split(" ")[0]!, "i")) ?? sentences(both.content)[0]!;
      const text = `${calls.length} sales calls last week. ${openers.length} brought up ${pretty(loud.phrase)}. ${closers.length} of the ${won.length} that bought ended up talking about ${pretty(wonP.phrase)} instead.\n\nLead with what closes, not with what's loudest on the first call.`;
      posts.push({
        platform: "x",
        hook: `What buyers open with is not what they buy.`,
        body: text,
        insight: `Buyers raise ${pretty(loud.phrase)} first, but the deals that close are decided on ${pretty(wonP.phrase)}.`,
        angle: pretty(wonP.phrase),
        evidence: [{ signal_id: both.id, quote: q }, ...openers.filter((s) => s.id !== both.id).slice(0, 1).flatMap((s) => ev(s, new RegExp(loud.phrase.split(" ")[0]!, "i")))],
      });
      used.add(both.id);
    }
  }

  // 2. A number from the field: the most expensive miss anyone told us about.
  const money = sigs
    .filter((s) => !used.has(s.id))
    .map((s) => ({ s, q: findSentence(s, /\$\s?\d[\d,]{2,}/) }))
    .filter((x): x is { s: SignalLite; q: string } => Boolean(x.q))
    .sort((a, b) => Number(/\d[\d,]+/.exec(b.q)![0].replace(/,/g, "")) - Number(/\d[\d,]+/.exec(a.q)![0].replace(/,/g, "")))[0];
  if (money) {
    const amount = /\$\s?\d[\d,]+/.exec(money.q)![0];
    const after = sentences(money.s.content).slice(sentences(money.s.content).indexOf(money.q) + 1, sentences(money.s.content).indexOf(money.q) + 3);
    const followUp = /follow/i.test(money.q);
    const vl = voiceLine(rc, money.s.content);
    posts.push({
      platform: "linkedin",
      hook: followUp ? `${amount}. That's what one quote nobody sent cost a contractor last quarter.` : `${amount}, gone, and it never showed up on a report.`,
      body: [
        `${retell(money.q, money.s)}`,
        after.map((a) => retell(a, money.s)).join(" "),
        `The tech did his job: he spotted it. The quote just had nowhere to go. That gap between the truck and the office is where replacement revenue disappears, and it never shows up on a report.`,
        vl ? `I keep coming back to this: ${vl}` : `If the follow-up depends on someone remembering, it depends on luck.`,
        `How does your shop make sure the quote actually goes out?`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      insight: `A single missed follow-up after a service call can cost more than a year of software (${amount} in one case).`,
      angle: "lost replacement revenue",
      evidence: [{ signal_id: money.s.id, quote: money.q }, ...after.slice(0, 1).map((a) => ({ signal_id: money.s.id, quote: a }))],
    });
    used.add(money.s.id);
  }

  // 3. The buyer's own words, from an inbound form, review or thread.
  const own = sigs
    .filter((s) => !used.has(s.id) && ["crm_note", "review", "social", "survey"].includes(s.source) && !s.metadata?.trigger)
    .map((s) => ({ s, q: findSentence(s, /\bwe (know|just|can't|cannot|lose|need)\b|\bour\b.*\b(leak|biggest)\b/i) }))
    .find((x): x is { s: SignalLite; q: string } => Boolean(x.q));
  if (own) {
    const said = bare(own.q).replace(/^We\b/, "we");
    const t = techsOf(own.s);
    posts.push({
      platform: "x",
      hook: `"${said.charAt(0).toUpperCase()}${said.slice(1).replace(/\.$/, "")}."`,
      body: `${t ? `A ${t}-tech shop` : "A contractor"} wrote that on a demo request this week.\n\nYou can't fix a leak you can't count. Count it first.`,
      insight: `Buyers already suspect the leak; what they lack is a number.`,
      angle: "make the leak visible",
      evidence: [{ signal_id: own.s.id, quote: own.q }],
    });
    used.add(own.s.id);
  }

  // 4. A churn lesson, told honestly.
  const churn = sigs
    .filter((s) => s.source === "churn_note" && !used.has(s.id))
    .sort((a, b) => Number(/if we had|would have/i.test(b.content)) - Number(/if we had|would have/i.test(a.content)))[0];
  if (churn) {
    const ss = sentences(churn.content);
    const why = ss.find((x) => /didn't see|never|only/i.test(x)) ?? ss[0]!;
    const regret = ss.find((x) => /if we had|would have/i.test(x));
    const aboutMoney = /revenue|money|upside/i.test(churn.content);
    posts.push({
      platform: "linkedin",
      hook: `We lost a customer this month. The exit call told us exactly why.`,
      body: [
        retell(bare(why), churn),
        regret ? `Then the line that stuck: "${bare(regret).replace(/^If/, "if").replace(/^./, (c) => c.toUpperCase())}"` : null,
        aboutMoney
          ? `That's on us. If software only saves time, it's a cost line. If it shows you money you were missing, it's the last thing you cancel.`
          : `That's on us. Most cancellations are decided in the first two weeks, by what the customer never set up.`,
        aboutMoney ? `The lesson for us: show a new customer the money they were missing in week one, before anything else.` : `The lesson for us: onboarding is the product. The first two weeks decide the renewal.`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      insight: aboutMoney ? `Customers who never see the revenue upside churn, even when the product works.` : `Customers who skip a key setup step churn.`,
      angle: aboutMoney ? "show the money in week one" : "onboarding is the product",
      evidence: [{ signal_id: churn.id, quote: why }, ...(regret ? [{ signal_id: churn.id, quote: regret }] : [])],
    });
    used.add(churn.id);
  }

  // 5. Answer a question buyers ask in public, with practices pulled from real calls.
  const question = sigs
    .filter((s) => (s.source === "social" || s.source === "review") && !s.metadata?.trigger)
    .map((s) => ({ s, q: sentences(s.content).find((x) => x.trim().endsWith("?")) }))
    .find((x): x is { s: SignalLite; q: string } => Boolean(x.q));
  if (question) {
    const practiceSigs = sigs.filter((s) => (s.outcome === "won" || s.source === "interview" || s.source === "review") && s.id !== question.s.id);
    const practices: { text: string; s: SignalLite; q: string }[] = [];
    for (const s of practiceSigs) {
      const q = findSentence(s, /\b(should|tracked|trigger|from the truck|before leaving|same day|one button)\b/i);
      if (q && !practices.some((p) => p.s.id === s.id)) practices.push({ text: bare(q), s, q });
      if (practices.length >= 3) break;
    }
    if (practices.length >= 2) {
      const where = /reddit/i.test(`${question.s.title} ${question.s.url ?? ""}`) ? "Someone on r/HVAC asked" : "A contractor asked online";
      posts.push({
        platform: "linkedin",
        hook: `${where}: "${question.q}"`,
        body: [
          `Here's what we hear from the shops that do it well. Their words, lightly trimmed:`,
          practices.map((p, i) => `${i + 1}. ${p.text}`).join("\n"),
          `None of this needs a new hire. It needs the follow-up to start before the truck leaves the driveway.`,
        ].join("\n\n"),
        insight: `Owners are asking in public how to track replacement opportunities; customers who solved it describe the same few habits.`,
        angle: "every completed job creates the next quote",
        evidence: [{ signal_id: question.s.id, quote: question.q }, ...practices.map((p) => ({ signal_id: p.s.id, quote: p.q }))],
      });
    }
  }

  // Asset idea: a calculator or landing line where inbound already proves demand.
  const asset_ideas: Out["asset_ideas"] = [];
  const calc = sigs.find((s) => /calculator/i.test(s.content));
  if (calc) {
    const q = findSentence(calc, /calculator/i)!;
    const words = own ? bare(own.q).replace(/^We\b/, "we") : null;
    asset_ideas.push({
      kind: "landing_line",
      name: "Calculator landing page headline",
      pitch: `Your techs already found the replacement jobs. See how many never got quoted.`,
      why: `Inbound is already arriving from the calculator${words ? `, and buyers describe the problem as "${words.replace(/\.$/, "")}"` : ""}. The headline should name the number they can't see.`,
      evidence: [{ signal_id: calc.id, quote: q }, ...(own ? [{ signal_id: own.s.id, quote: own.q }] : [])],
    });
  }

  return {
    posts: posts.slice(0, 5),
    asset_ideas,
    notes: `Offline engine: ${posts.length} posts built from ${sigs.length} signals using fixed post shapes (contrast, field number, buyer's words, churn lesson, public question). Connect a Claude API key for posts written in the founder's voice from scratch.`,
  };
}

function postText(p: Post) {
  return p.platform === "x" ? `${p.hook}\n\n${p.body}` : `${p.hook}\n\n${p.body}`;
}

export const founderContent: AgentTemplate<typeof Schema> = {
  id: "content-drafter",
  system: "founder_content",
  name: "Content drafter",
  tagline: "Turns this week's customer pain into posts in the founder's voice.",
  tier: "fast",
  defaultCron: "0 8 * * 2",
  reads: READS,
  spec: {
    mission: "Turn real customer pain into founder posts people in the industry would forward, in the founder's voice, every week.",
    dataSources: ["Customer truth file", "Sales calls", "Support tickets", "Churn notes", "Reviews", "Social threads", "Founder voice doc", "Winning hooks"],
    schedule: "Tuesdays at 8:00",
    filters: [
      "One insight per post; no listicles of features",
      "Never name a customer or prospect without permission; describe them by size and trade",
      "Skip insights that only matter to us (bugs, internal process)",
      "Drop any draft that uses banned language",
    ],
    output: "Five ready-to-paste posts (LinkedIn and X), each tied to the customer pain it came from, plus an optional asset idea.",
    goodLooksLike: [
      "Starts from something a customer actually said, with the receipt attached",
      "A number from the field beats an adjective",
      "Sounds like the founder on a good day: direct, specific, no hype",
      "Ends with a point of view, not a pitch",
    ],
    approval: "The founder approves, edits or rejects each post. Edits become rules for next week.",
    metric: "Qualified inbound (demo requests and replies from ICP accounts) attributed to posts",
    writesTo: "content/winning-hooks (hooks from posts that drive qualified inbound)",
    lookbackDays: 7,
  },
  schema: Schema,
  systemPrompt: baseSystem("the Founder Content writer"),
  prompt: (rc) => `${renderSpec(rc)}

${renderRules(rc)}

${renderDocs(rc, READS)}

${renderBanned(parseBanned(rc.docs["outbound/banned-language"], rc.docs["content/founder-voice"]))}

How to write these:
- Each post starts from ONE signal-backed insight. Cite the signals it rests on, with verbatim quotes.
- Write in the founder's voice described above. Reuse the rhythm of the posts they love; never copy them.
- Describe customers by size and trade ("a 27-tech commercial shop"), never by name.
- A specific number or the customer's exact words in the first two lines.
- No hashtags, no emoji, no "Here's the thing", no "Let that sink in", no engagement-bait questions as hooks.
- If a hook in Winning hooks already worked, you may reuse its shape with a new insight.
- Mix platforms: at least two X posts (whole post under 280 characters) and two LinkedIn posts.

${renderSignals(rc)}

Write this week's posts for ${rc.tenantName}.`,
  offline,
  finalize(o, rc) {
    const banned = parseBanned(rc.docs["outbound/banned-language"], rc.docs["content/founder-voice"]);
    const posts = keepSupported(o.posts, rc.signalMap);
    const assets = keepSupported(o.asset_ideas, rc.signalMap);
    const blocked: string[] = [];
    const drafts: DraftInput[] = [];
    let xOver = 0;
    for (const p of posts.kept) {
      const text = postText(p as Post);
      const hits = findBanned(`${text} ${p.insight}`, banned);
      if (hits.length) {
        blocked.push(`"${p.hook}" (${hits.join(", ")})`);
        continue;
      }
      const over = p.platform === "x" && text.length > 280;
      if (over) xOver++;
      drafts.push({
        type: "post",
        title: clip(`${p.platform === "x" ? "X" : "LinkedIn"}: ${p.hook}`, 90),
        body: `${text}

---
**Platform:** ${p.platform === "x" ? `X (${text.length} characters${over ? ", over 280: trim before posting" : ""})` : `LinkedIn (${text.split(/\s+/).length} words)`}
**Came from:** ${p.insight}
**Angle:** ${p.angle}`,
        payload: { platform: p.platform, hook: p.hook, text, insight: p.insight, angle: p.angle },
        evidence: p.evidence,
      });
    }
    for (const a of assets.kept) {
      const hits = findBanned(`${a.name} ${a.pitch}`, banned);
      if (hits.length) {
        blocked.push(`"${a.name}" (${hits.join(", ")})`);
        continue;
      }
      drafts.push({
        type: "asset_idea",
        title: `Asset idea: ${a.name}`,
        body: `**${a.pitch}**

- Kind: ${a.kind.replace("_", " ")}
- Why: ${a.why}`,
        payload: { kind: a.kind, name: a.name, pitch: a.pitch, why: a.why },
        evidence: a.evidence,
      });
    }
    const nPosts = drafts.filter((d) => d.type === "post").length;
    return {
      summary: `${nPosts} posts ready for review${blocked.length ? `; ${blocked.length} blocked for banned language: ${blocked.join("; ")}` : ""}${posts.dropped ? `; ${posts.dropped} dropped for unverifiable receipts` : ""}.`,
      stats: {
        signals: rc.signals.length,
        posts: nPosts,
        asset_ideas: drafts.length - nPosts,
        banned_blocked: blocked.length,
        dropped_unverified: posts.dropped + assets.dropped,
        unverified_quotes: posts.unverifiedQuotes + assets.unverifiedQuotes,
        x_over_length: xOver,
      },
      drafts,
    };
  },
};

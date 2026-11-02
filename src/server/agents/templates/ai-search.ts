import { z } from "zod";
import type { AgentTemplate, RunContext } from "../types";
import { baseSystem, renderDocs, renderRules, renderSignals, renderSpec } from "../prompting";
import { keepSupported, normalize, verifyEvidence } from "../evidence";
import { sentences, tokens } from "../text";
import { lines } from "./guardrails";
import { meta, shortDate } from "../format";

const READS = ["ai-search/buyer-questions", "ai-search/company-facts", "customer-truth/what-the-market-is-telling-us"];

const Ev = z.object({ signal_id: z.string(), quote: z.string().describe("Verbatim sentence copied from the signal.") });

const Schema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string(),
        status: z.enum(["covered", "partial", "missing"]).describe("Do our company facts answer this question? covered = fully, partial = some of it, missing = not at all."),
        answer: z
          .string()
          .describe("An answer-ready paragraph (40-90 words) an AI assistant could quote. Starts with the company name. Uses ONLY company facts. Empty string when status is missing."),
        facts_used: z.array(z.string()).describe("The company-facts lines the answer rests on, copied verbatim."),
        missing_facts: z.array(z.string()).describe("Facts we would need to answer fully. Phrase as questions for the team, never as claims."),
        placement: z.string().describe("Where this answer should live: page and section, e.g. 'Homepage FAQ' or '/compare/servicetitan page, first section'."),
        buyer_language: z.string().describe("How buyers phrase this in our signals, verbatim, or empty."),
        evidence: z.array(Ev).describe("Signals showing buyers ask this or use this language. May be empty."),
      }),
    )
    .describe("One entry per buyer question, in the order given."),
  fact_conflicts: z
    .array(z.object({ fact: z.string(), issue: z.string(), evidence: z.array(Ev) }))
    .describe("Company facts that signals contradict or complicate (e.g. a ticket saying a listed feature does not work). Empty if none."),
  notes: z.string(),
});
type Out = z.infer<typeof Schema>;
type Q = Out["questions"][number];

const GENERIC = new Set(["best", "software", "company", "companie", "help", "helps", "top", "tool", "tools", "app", "way", "good", "using", "use", "need", "find"]);
/** Offline-only synonyms so buyer wording ("replacement opportunities") can find product wording ("follow-up quotes"). */
const SYN: Record<string, string[]> = {
  replacement: ["quote"], opportunitie: ["quote"], opportunity: ["quote"], equipment: ["quote"], sale: ["quote", "paid"], upsell: ["quote"],
  send: ["quote"], estimate: ["quote"], proposal: ["quote"], field: ["mobile", "tech"], phone: ["mobile"], schedule: ["dispatch"], scheduling: ["dispatch"],
  increase: ["paid"], grow: ["paid"], roi: ["paid"], accounting: ["quickbook"], invoice: ["quickbook"], price: ["pricing"], cost: ["pricing"],
};
const NEG = /\b(not|doesn't|don't|isn't|aren't|never|no longer|missing|broken|fails?)\b/i;

function factBits(rc: RunContext) {
  return lines(rc.docs["ai-search/company-facts"]).map((line) => {
    const m = /^([A-Z][A-Za-z ]{2,20}):\s+(.+)$/.exec(line);
    return { line, label: m ? m[1]!.toLowerCase() : "", text: m ? m[2]! : line, toks: new Set(tokens(line)) };
  });
}

/** Turn a labelled fact ("Pricing: per technician...") into a sentence that starts with the company. */
function asSentence(f: { label: string; text: string; line: string }, company: string) {
  const t = f.text.replace(/\.$/, "");
  switch (f.label) {
    case "core":
    case "features":
    case "product":
      return `${company} includes ${t.charAt(0).toLowerCase()}${t.slice(1)}.`;
    case "pricing":
      return `Pricing is ${t.charAt(0).toLowerCase()}${t.slice(1)}.`;
    case "integrations":
      return `It integrates with ${t}.`;
    case "proof":
      return `${t}.`;
    default:
      return f.line.endsWith(".") ? f.line : `${f.line}.`;
  }
}

function offline(rc: RunContext): Out {
  const company = rc.tenantName;
  const facts = factBits(rc);
  const factsText = normalize(facts.map((f) => f.line).join(" "));
  const qs = lines(rc.docs["ai-search/buyer-questions"]).filter((l) => l.length > 8);
  const who = facts.find((f) => !f.label && normalize(f.line).startsWith(normalize(company))) ?? facts[0];
  const proof = facts.find((f) => f.label === "proof");
  const pricing = facts.find((f) => f.label === "pricing");
  const hasG2 = rc.signals.some((s) => /\bg2\b|capterra/i.test(s.title));

  const questions: Q[] = qs.map((question) => {
    const qt = tokens(question).filter((t) => !GENERIC.has(t));
    const comparison = /\b(alternatives?|vs\.?|versus|compared?|competitors?)\b/i.test(question);
    const best = /\b(best|top|which|recommend)\b/i.test(question);
    const competitor = comparison ? (/\b([A-Z][a-z]+[A-Z][A-Za-z]+|[A-Z][a-z]{3,}(?:\s[A-Z][a-z]+)?)\b/.exec(question.replace(/^(What|How|Which|Is|Are|Can|Does)\b/, ""))?.[1] ?? null) : null;
    const inFact = (t: string, toks: Set<string>) => [t, ...(SYN[t] ?? [])].some((w) => toks.has(w) || [...toks].some((x) => x.length > 3 && w.length > 3 && (x.startsWith(w) || w.startsWith(x))));
    const segment = new Set(who ? [...who.toks] : []);
    const ranked = facts
      .map((f) => ({ f, hits: qt.filter((t) => !segment.has(t) && inFact(t, f.toks)).length }))
      .sort((a, b) => b.hits - a.hits);
    const allToks = new Set(facts.flatMap((f) => [...f.toks]));
    const covered = new Set(qt.filter((t) => factsText.includes(t) || inFact(t, allToks)));
    const uncovered = qt.filter((t) => !covered.has(t) && t !== competitor?.toLowerCase() && t.length > 3);

    const used: typeof facts = [];
    const add = (f?: (typeof facts)[number]) => f && !used.includes(f) && used.push(f);
    let status: Q["status"];
    const missing: string[] = [];
    if (comparison && competitor) {
      const named = factsText.includes(normalize(competitor));
      add(who);
      add(ranked.find((r) => r.f.label === "core")?.f);
      add(pricing);
      status = named ? "covered" : "partial";
      if (!named) missing.push(`How does ${company} compare with ${competitor}: who each is built for, pricing model, and what switching takes?`, `Have any customers switched from ${competitor}? If so, can we name them?`);
    } else if (best) {
      add(who);
      add(ranked.find((r) => r.f.label === "core")?.f);
      add(proof);
      status = who && proof ? (uncovered.length ? "partial" : "covered") : "partial";
      missing.push(`How many ${who ? "customers in this segment" : "customers"} use ${company} today?`);
      if (hasG2 && !/g2|capterra|rating/i.test(factsText)) missing.push(`What is our current G2 / Capterra rating? Reviews exist; the facts don't state the score.`);
    } else {
      const top = ranked[0];
      if (!top || top.hits === 0) status = "missing";
      else {
        add(who);
        add(top.f);
        add(ranked[1] && ranked[1].hits > 0 && ranked[1].f.label !== "proof" ? ranked[1].f : undefined);
        if (/(sales|revenue|increase|replacement)/i.test(question)) add(proof);
        status = uncovered.length === 0 ? "covered" : "partial";
      }
    }
    if (status !== "covered" && uncovered.length && !comparison)
      missing.push(`Nothing in company facts covers "${uncovered.join('", "')}". Does ${company} do this? If yes, add a one-line fact.`);
    // Who-we-are first (quotable on its own), proof last.
    const rank = (f: (typeof facts)[number]) => (f === who ? 0 : f.label === "proof" ? 2 : 1);
    used.sort((x, y) => rank(x) - rank(y));
    const answer = status === "missing" ? "" : used.map((f) => asSentence(f, company)).join(" ");

    // Buyer language: the signal sentence closest to the question.
    // Only distinctive words count (not the segment words every signal shares), and never trigger news.
    const distinct = qt.filter((t) => !segment.has(t));
    let bestSig: { id: string; q: string; score: number } | null = null;
    for (const s of rc.signals.filter((x) => !x.metadata?.trigger)) {
      for (const sent of sentences(s.content)) {
        const st = new Set(tokens(sent));
        const hits = distinct.filter((t) => st.has(t)).length;
        const score = hits + (sent.trim().endsWith("?") ? 1 : 0);
        if (hits >= 2 && (!bestSig || score > bestSig.score)) bestSig = { id: s.id, q: sent, score };
      }
    }
    const quoteFeature = used.some((f) => /quote/i.test(f.text)) && /quote|replacement/i.test(question);
    const placement = comparison && competitor
      ? `New page /compare/${competitor.toLowerCase().replace(/\s+/g, "-")}-alternative: this paragraph as the opening section, plus a comparison table once the missing facts exist`
      : best
        ? "Homepage: first paragraph under the hero, and the first item in the homepage FAQ"
        : quoteFeature
          ? "Follow-up quotes feature page: FAQ section, question as the H3"
          : used.some((f) => f.label === "pricing")
            ? "Pricing page FAQ"
            : "Product page FAQ";
    return {
      question,
      status,
      answer,
      facts_used: used.map((f) => f.line),
      missing_facts: missing,
      placement,
      buyer_language: bestSig?.q ?? "",
      evidence: bestSig ? [{ signal_id: bestSig.id, quote: bestSig.q }] : [],
    };
  });

  // Facts that support tickets contradict.
  const fact_conflicts: Out["fact_conflicts"] = [];
  for (const s of rc.signals.filter((x) => x.source === "support_ticket" || x.source === "review")) {
    for (const sent of sentences(s.content).filter((x) => NEG.test(x))) {
      const st = tokens(sent);
      const best = facts
        .filter((f) => f.label !== "proof")
        .map((f) => ({ f, n: st.filter((t) => f.toks.has(t)).length }))
        .sort((a, b) => b.n - a.n)[0];
      if (best && best.n >= 3 && !fact_conflicts.some((c) => c.fact === best.f.line)) {
        fact_conflicts.push({ fact: best.f.line, issue: `A ${s.source.replace("_", " ")} says part of this doesn't work as stated. Fix it or soften the fact before AI assistants repeat it.`, evidence: [{ signal_id: s.id, quote: sent }] });
      }
    }
  }

  return {
    questions,
    fact_conflicts,
    notes: `Answers assembled from ${facts.length} company-fact lines only.`,
  };
}

const nums = (s: string) => (s.match(/\$?\d[\d,.]*%?/g) ?? []).map((n) => n.replace(/[.,]$/, ""));

export const aiSearch: AgentTemplate<typeof Schema> = {
  id: "ai-visibility",
  system: "ai_search",
  name: "Answer builder",
  tagline: "Writes answer-ready copy and FAQ schema for the questions buyers ask AI assistants.",
  tier: "deep",
  defaultCron: "0 9 * * 4",
  reads: READS,
  spec: {
    mission: "Make the company easy for ChatGPT, Claude, Perplexity and Google to understand, quote and recommend for the questions buyers actually ask.",
    dataSources: ["Buyer questions", "Company facts", "Customer truth file", "Signals (for buyer language)"],
    schedule: "Thursdays at 9:00",
    filters: [
      "Answers use only company facts; nothing invented",
      "If the facts don't answer it, say what's missing instead of guessing",
      "Prefer the buyer's phrasing from signals",
    ],
    output: "An answer pack: per question, coverage, a quotable paragraph, where it goes on the site, missing facts, plus FAQPage JSON-LD.",
    goodLooksLike: [
      "Each answer stands alone: names the company, the category and who it's for in the first sentence",
      "Every number and name in an answer appears in company facts",
      "Gaps are listed as questions for the team, not papered over",
      "Placement is specific enough to ship this week",
    ],
    approval: "A human approves the pack before answers and schema go on the site.",
    metric: "Share of buyer questions where AI assistants mention us (checked monthly)",
    writesTo: "Website FAQ and schema (manual publish)",
    lookbackDays: 30,
  },
  schema: Schema,
  systemPrompt: baseSystem("the AI Search Visibility editor"),
  prompt: (rc) => `${renderSpec(rc)}

${renderRules(rc)}

${renderDocs(rc, READS)}

Grounding rules (strict):
- Answers may only state what the company-facts doc says. No new numbers, customers, integrations, features or comparisons.
- facts_used must be lines copied verbatim from company facts.
- If the facts can't answer a question, set status "missing", leave answer empty, and list the facts we'd need as questions for the team.
- For "X alternatives" questions, never characterize the competitor. Describe only us, and list the comparison facts we lack.
- Use signals only to learn how buyers phrase things and to spot facts that signals contradict (e.g. a ticket saying a listed feature doesn't work).

${renderSignals(rc, 120)}

Build this week's answer pack for ${rc.tenantName}.`,
  offline,
  finalize(o, rc) {
    const factsDoc = rc.docs["ai-search/company-facts"]?.content ?? "";
    const factsN = normalize(factsDoc);
    const factNums = new Set(nums(factsDoc));
    let ungrounded = 0;
    let unverified = 0;
    const qs = o.questions.map((q) => {
      const ev = verifyEvidence(q.evidence, rc.signalMap);
      unverified += ev.filter((e) => !e.verified).length;
      const badFacts = q.facts_used.filter((f) => !factsN.includes(normalize(f)));
      const badNums = nums(q.answer).filter((n) => !factNums.has(n));
      const grounded = badFacts.length === 0 && badNums.length === 0 && (q.status === "missing" || q.facts_used.length > 0);
      if (!grounded) ungrounded++;
      return { ...q, evidence: ev.filter((e) => e.verified), grounded, problems: [...badFacts.map((f) => `fact not in company facts: "${f}"`), ...badNums.map((n) => `number not in company facts: ${n}`)] };
    });
    const conflicts = keepSupported(o.fact_conflicts, rc.signalMap);
    const publishable = qs.filter((q) => q.status !== "missing" && q.grounded && q.answer.trim());
    const jsonld = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: publishable.map((q) => ({ "@type": "Question", name: q.question, acceptedAnswer: { "@type": "Answer", text: q.answer } })),
    };
    const counts = { covered: qs.filter((q) => q.status === "covered").length, partial: qs.filter((q) => q.status === "partial").length, missing: qs.filter((q) => q.status === "missing").length };
    const label = { covered: "Covered", partial: "Partly covered", missing: "Not covered" } as const;
    const body = `${qs
  .map(
    (q, i) => `### ${i + 1}. ${q.question}
**${label[q.status]}**${q.grounded ? "" : " · held back: " + q.problems.join("; ")}

${q.answer ? q.answer : "_No answer: our facts don't cover this yet._"}

- **Put it:** ${q.placement}${q.buyer_language ? `\n- **Buyers say:** "${q.buyer_language}"` : ""}${q.missing_facts.length ? `\n- **Facts we need:**\n${q.missing_facts.map((m) => `  - ${m}`).join("\n")}` : ""}`,
  )
  .join("\n\n")}
${
  conflicts.kept.length
    ? `\n## Facts to double-check\n${conflicts.kept.map((c) => `- **"${c.fact}"**: ${c.issue} Signal: "${c.evidence[0]!.quote}"`).join("\n")}\n`
    : ""
}
## FAQPage schema
Paste into the page that carries these answers (${publishable.length} of ${qs.length} questions included; uncovered or held-back answers are left out).

\`\`\`json
${JSON.stringify(jsonld, null, 2)}
\`\`\``;
    return {
      summary: `${counts.covered} of ${qs.length} buyer questions covered by our facts, ${counts.partial} partly, ${counts.missing} not at all${conflicts.kept.length ? `; ${conflicts.kept.length} fact(s) contradicted by signals` : ""}.`,
      stats: { questions: qs.length, ...counts, held_back_ungrounded: ungrounded, fact_conflicts: conflicts.kept.length, missing_facts: qs.reduce((n, q) => n + q.missing_facts.length, 0), unverified_quotes: unverified + conflicts.unverifiedQuotes },
      drafts: [
        {
          type: "ai_answer_pack",
          title: `AI answer pack · ${shortDate(rc.now)}`,
          body,
          payload: {
            questions: qs.map((q) => ({ question: q.question, status: q.status, answer: q.answer, facts_used: q.facts_used, missing_facts: q.missing_facts, placement: q.placement, grounded: q.grounded })),
            fact_conflicts: conflicts.kept.map((c) => ({ fact: c.fact, issue: c.issue })),
            jsonld,
            meta: meta(
              ["Coverage", `${counts.covered} covered, ${counts.partial} partly, ${counts.missing} not covered`],
              ["Questions", qs.length],
              ["In schema", `${publishable.length} of ${qs.length}`],
              ["Held back", ungrounded ? `${ungrounded} answer${ungrounded === 1 ? "" : "s"} citing facts we don't have` : null],
              ["Grounding", "Company facts only"],
            ),
          },
          evidence: [...qs.flatMap((q) => q.evidence), ...conflicts.kept.flatMap((c) => c.evidence)],
        },
      ],
    };
  },
};

import { z } from "zod";
import type { AgentTemplate, DraftInput, RunContext } from "../types";
import type { SignalLite } from "../evidence";
import { baseSystem, renderDocs, renderRules, renderSignals, renderSpec } from "../prompting";
import { keepSupported, normalize } from "../evidence";
import { bullets, docText, findBanned, parseBanned, renderBanned, techsOf, words } from "./guardrails";
import { draftTitle, meta, shippable } from "../format";

const TRIGGER_LABEL: Record<string, string> = { hiring: "Hiring", new_location: "New location", bad_review: "Bad review", funding: "Funding", leadership_change: "New leader", tech_change: "Tool change", other: "Trigger" };

const READS = ["outbound/icp", "outbound/approved-angles", "outbound/banned-language", "customer-truth/what-the-market-is-telling-us"];
const FIT_THRESHOLD = 60;
const MAX_WORDS = 90;
const TRIGGERS = ["hiring", "new_location", "bad_review", "funding", "leadership_change", "tech_change", "other"] as const;
type Trigger = (typeof TRIGGERS)[number];

const Ev = z.object({ signal_id: z.string(), quote: z.string().describe("Verbatim text copied from the signal.") });

const Schema = z.object({
  accounts: z
    .array(
      z.object({
        account: z.string(),
        trigger: z.enum(TRIGGERS),
        fit_score: z.number().int().describe(`0-100 fit against the ICP. Below ${FIT_THRESHOLD} is dropped automatically.`),
        fit_reasons: z.string().describe("Why this score, in terms of the ICP: size, segment, trigger, disqualifiers."),
        why_now: z.string().describe("One sentence: why this week and not next quarter."),
        angle: z.string().describe("Which approved angle this message uses."),
        subject: z.string().describe("2-6 words, lowercase is fine, no clickbait."),
        first_line: z.string().describe("Opens on the specific trigger and quotes it verbatim inside double quotes."),
        email: z.string().describe(`The full email including the first line, under ${MAX_WORDS} words. Greeting may use {{first_name}}. One soft ask. Only the email: no subject line, labels or notes.`),
        evidence: z.array(Ev).describe("The trigger signal (and any proof point) with verbatim quotes."),
      }),
    )
    .describe("One entry per account with a trigger event, best fit first."),
  skipped: z.array(z.object({ account: z.string(), reason: z.string() })).describe("Trigger events you chose not to act on, and why."),
  notes: z.string(),
});
type Out = z.infer<typeof Schema>;
type Acct = Out["accounts"][number];

/** A short verbatim snippet of the trigger: the sentence (or clause) that carries it. */
function snippet(s: SignalLite, kw: RegExp): string | null {
  const raw = s.content.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
  const i = raw.findIndex((x) => kw.test(x));
  if (i < 0) return null;
  let sent = raw[i]!;
  const next = raw[i + 1];
  if (next && next.length < 40 && sent.length + next.length < 130) sent = `${sent} ${next}`;
  if (sent.length <= 110) return sent;
  const clauses = sent.split(/,\s+/).filter((c) => !(s.account && c.includes(s.account)));
  return clauses.find((c) => kw.test(c) && /\d/.test(c)) ?? clauses.find((c) => kw.test(c)) ?? clauses.find((c) => /\d/.test(c)) ?? sent;
}

const KW: Record<Trigger, RegExp> = {
  hiring: /\b(growing|counting)\b/i,
  new_location: /\b(branch|location|adding|opening|expan)/i,
  bad_review: /\b(quote|follow|never called|nobody)\b/i,
  funding: /\b(raised|acquir|funding|capital)/i,
  leadership_change: /\b(joins|appointed|named|hired)\b/i,
  tech_change: /\b(switch|migrat|replac)/i,
  other: /./,
};

function fit(s: SignalLite, trigger: Trigger, icp: string) {
  const techs = techsOf(s);
  const range = /(\d{1,3})\s*[–-]\s*(\d{1,3})\s*tech/i.exec(icp);
  const plus = /(\d{1,3})\s*\+\s*tech/i.exec(icp);
  const [lo, hi] = range ? [Number(range[1]), Number(range[2])] : plus ? [Number(plus[1]), 1000] : [15, 80];
  const reasons: string[] = [];
  let score = 15;
  if (techs == null) reasons.push("size unknown");
  else if (techs >= lo && techs <= hi) {
    // Our won deals cluster in the middle of the range, where there is an office team and a CFO.
    const sweet = hi >= 1000 ? techs >= lo * 1.3 && techs <= lo * 4 : techs >= lo + (hi - lo) * 0.08 && techs <= lo + (hi - lo) * 0.7;
    score += sweet ? 35 : 25;
    reasons.push(`${techs} techs, ${sweet ? "in the sweet spot of" : "inside"} the ${hi >= 1000 ? `${lo}+` : `${lo}-${hi}`} range`);
  } else if (techs >= lo * 0.8 && techs <= hi * 1.25) (score += 10), reasons.push(`${techs} techs, just outside ${lo}-${hi}`);
  else (score -= 20), reasons.push(`${techs} techs, outside ${lo}-${hi}`);
  const text = s.content.toLowerCase();
  if (/commercial|refrigeration|facilit/.test(text)) (score += 20), reasons.push("commercial work stated");
  else if (/rooftop|chiller|compressor/.test(text)) (score += 10), reasons.push("commercial work implied (rooftop equipment)");
  if (/residential/.test(text) && !/commercial/.test(text)) (score -= 30), reasons.push("residential-first");
  if (/dispatcher|service manager|office/.test(text)) (score += 5), reasons.push("separate office team");
  const icpL = icp.toLowerCase();
  const noTriggerList = !/trigger/.test(icpL);
  const listed =
    (noTriggerList && trigger !== "other") ||
    (trigger === "hiring" && /hiring/.test(icpL) && /dispatcher|service manager/.test(text)) ||
    (trigger === "new_location" && /branch|location/.test(icpL)) ||
    (trigger === "bad_review" && /review/.test(icpL) && /quote|follow|called/.test(text)) ||
    (trigger === "funding" && /funding|acquisition/.test(icpL));
  if (listed) (score += 20), reasons.push(noTriggerList ? "standard buying trigger (the ICP doc lists none)" : "trigger is on our ICP list");
  else reasons.push("trigger not on our ICP list");
  return { score: Math.max(0, Math.min(100, score)), reasons: reasons.join("; ") };
}

function pickAngle(angles: string[], want: RegExp) {
  return angles.find((a) => want.test(a)) ?? angles[0] ?? "Lost replacement revenue after the service call";
}

function offline(rc: RunContext): Out {
  const icp = docText(rc, "outbound/icp");
  const angles = bullets(rc.docs["outbound/approved-angles"]);
  const company = rc.tenantName;
  const proofSig = rc.signals.find((s) => s.source === "review" && /paid for|first month|same day/i.test(s.content));
  const proofQ = proofSig ? snippet(proofSig, /paid for|first month/i) : null;
  const where = proofSig ? (/g2/i.test(proofSig.title) ? "G2" : /capterra/i.test(proofSig.title) ? "Capterra" : "a review site") : "";
  const proof = proofQ ? `A customer on ${where}: "${proofQ}"` : "";

  const byAccount = new Map<string, SignalLite>();
  const skipped: Out["skipped"] = [];
  for (const s of rc.signals) {
    if (typeof s.metadata?.trigger !== "string") continue;
    if (!s.account) {
      skipped.push({ account: s.title || "(unknown)", reason: "Trigger event with no account attached." });
      continue;
    }
    if (!byAccount.has(s.account)) byAccount.set(s.account, s);
  }

  const accounts: Acct[] = [];
  for (const [account, s] of byAccount) {
    const trigger = (TRIGGERS as readonly string[]).includes(s.metadata!.trigger as string) ? (s.metadata!.trigger as Trigger) : "other";
    const { score, reasons } = fit(s, trigger, icp);
    const q = snippet(s, KW[trigger]) ?? snippet(s, /hiring|announc|raised/i) ?? snippet(s, /./)!;
    const techs = techsOf(s);
    const role = (s.metadata?.role as string | undefined)?.toLowerCase();
    let a: Pick<Acct, "subject" | "first_line" | "why_now" | "angle"> & { middle: string; ask: string };
    switch (trigger) {
      case "hiring":
        a = {
          subject: `your new ${role ?? "hire"}`,
          first_line: `Saw the ${role ?? "job"} posting: "${q}"`,
          why_now: `They are hiring a ${role ?? "new role"} now, which means the office workflow is being rebuilt this month.`,
          angle: pickAngle(angles, /next quote/i),
          middle: `A ${role ?? "new hire"} will fix the schedule. What still leaks${techs ? ` at ${techs} techs` : ""} is the step after the job: a tech spots a failing unit and the replacement quote never goes out. ${company} lets the tech start that quote from the truck, before leaving the site.`,
          ask: `Worth 15 minutes before they start?`,
        };
        break;
      case "new_location":
        a = {
          subject: "new techs, same follow-up?",
          first_line: `Saw the expansion news: "${q}"`,
          why_now: "New branch and new techs: habits get set in the first months, before anyone writes them down.",
          angle: pickAngle(angles, /best tech/i),
          middle: `New techs fix the job in front of them. What they don't do yet is what your veterans do: make sure the replacement quote goes out. ${company} lets every tech start it from the truck.`,
          ask: "Open to a look before the new team starts?",
        };
        break;
      case "bad_review":
        a = {
          subject: "that google review",
          first_line: `A recent review of ${account} says: "${q}"`,
          why_now: "The review is public and recent; the fix is cheaper than the next lost replacement.",
          angle: pickAngle(angles, /lost replacement/i),
          middle: `Not fun to read, but it's the most common way commercial shops lose replacement work: the tech does his part and the quote has nowhere to go. ${company} lets the tech send it from the truck, and the office sees every open quote.`,
          ask: "Worth 15 minutes?",
        };
        break;
      case "funding":
        a = {
          subject: "follow-up across acquisitions",
          first_line: `Read that you "${q.replace(/\.$/, "")}."`,
          why_now: "Fresh capital to roll up service companies: standard operating process gets chosen in the next two quarters.",
          angle: pickAngle(angles, /best tech/i),
          middle: `Every shop you buy will have its own habit for the quote after a service call, usually "tell someone in the office." ${company} makes that step the same everywhere: the tech starts the quote from the truck, and you see every open one.`,
          ask: "Worth a look before the next deal closes?",
        };
        break;
      default:
        a = {
          subject: "a quick idea",
          first_line: `Saw this: "${q}"`,
          why_now: "Recent public change at the account.",
          angle: pickAngle(angles, /./),
          middle: `Most commercial shops lose replacement work in the handoff between the truck and the office. ${company} lets the tech start the quote on site.`,
          ask: "Worth 15 minutes?",
        };
    }
    const email = [`Hi {{first_name}},`, a.first_line, `${a.middle}${proof ? ` ${proof}` : ""}`, a.ask, `{{sender_name}}`].join("\n\n");
    accounts.push({
      account,
      trigger,
      fit_score: score,
      fit_reasons: reasons,
      why_now: a.why_now,
      angle: a.angle,
      subject: a.subject,
      first_line: a.first_line,
      email,
      evidence: [{ signal_id: s.id, quote: q }, ...(proofSig && proofQ ? [{ signal_id: proofSig.id, quote: proofQ }] : [])],
    });
  }
  accounts.sort((x, y) => y.fit_score - x.fit_score);
  return {
    accounts,
    skipped,
    notes: `Scored ${accounts.length} accounts with trigger events against the ICP (size range, commercial work, listed triggers).`,
  };
}

const quotedIn = (line: string) => [...line.matchAll(/["“]([^"”]{8,})["”]/g)].map((m) => m[1]!);
const countWords = (email: string) => words(email.replace(/\{\{[^}]+\}\}/g, "").replace(/^Hi\s*,?/m, ""));

export const outboundSignal: AgentTemplate<typeof Schema> = {
  id: "signal-outreach",
  system: "outbound_signal",
  name: "Signal outreach",
  tagline: "Finds accounts where something just changed and writes the first message, tied to the trigger.",
  tier: "fast",
  defaultCron: "0 8 * * 1-5",
  reads: READS,
  signalSources: ["social", "crm_note", "review", "other"],
  spec: {
    mission: "Reach the right accounts in the week the problem hurts, with a first line they can tell was written for them.",
    dataSources: ["Hiring posts", "New location and funding news", "Public reviews", "CRM notes", "ICP", "Approved angles", "Customer truth file"],
    schedule: "Weekday mornings at 8:00",
    filters: [
      `Only accounts with a trigger event in the window`,
      `Drop accounts scoring below ${FIT_THRESHOLD} against the ICP`,
      "Skip residential-first shops and owner-dispatchers",
      "Never claim anything about their business we can't quote",
      "Drop any message that uses banned language",
    ],
    output: "One ready-to-send email per qualified account: fit score, trigger, why now, a first line quoting the trigger, under 90 words.",
    goodLooksLike: [
      "The first line could only have been written to this account this week",
      "Uses an approved angle and one real proof point",
      "Under 90 words, one soft ask, no fake familiarity",
      "Bad-fit accounts are skipped, with the reason recorded",
    ],
    approval: "A rep approves or edits each message before it is sent. Edits become rules.",
    metric: "Positive replies from qualified accounts",
    writesTo: "Outbound queue (approved messages)",
    lookbackDays: 14,
  },
  schema: Schema,
  systemPrompt: baseSystem("the Outbound Signal writer"),
  prompt: (rc) => `${renderSpec(rc)}

${renderRules(rc)}

${renderDocs(rc, READS)}

${renderBanned(parseBanned(rc.docs["outbound/banned-language"]))}

How to work:
- A trigger event is a signal whose metadata names a trigger (hiring, new branch, bad review, funding) or that plainly describes one. Inbound demo requests are not triggers; skip them.
- Score fit 0-100 strictly against the ICP above. Explain the score in ICP terms. Below ${FIT_THRESHOLD}: still list the account with its score so the drop is recorded.
- The first line quotes the trigger verbatim inside double quotes. The quote must be copied exactly from the signal.
- Use only approved angles. Proof points must come from signals (cite them). Do not guess their revenue, headcount or problems beyond what the signal says.
- Under ${MAX_WORDS} words, plain text, one soft ask, no links, no "I hope", no flattery.

${renderSignals(rc)}

Write this run's outbound for ${rc.tenantName}.`,
  offline,
  finalize(o, rc) {
    const banned = parseBanned(rc.docs["outbound/banned-language"]);
    const seen = new Set<string>();
    const unique = o.accounts.filter((a) => !seen.has(a.account.toLowerCase()) && seen.add(a.account.toLowerCase()));
    const sup = keepSupported(unique, rc.signalMap);
    const badFit = sup.kept.filter((a) => a.fit_score < FIT_THRESHOLD);
    const blocked: string[] = [];
    let ungrounded = 0;
    let overLength = 0;
    const drafts: DraftInput[] = [];
    for (const a of sup.kept.filter((x) => x.fit_score >= FIT_THRESHOLD)) {
      const hits = findBanned(`${a.subject}\n${a.email}`, banned);
      if (hits.length) {
        blocked.push(`${a.account} (${hits.join(", ")})`);
        continue;
      }
      const triggerText = a.evidence.map((e) => rc.signalMap.get(e.signal_id)?.content ?? "").map(normalize).join(" | ");
      const grounded = quotedIn(a.first_line).some((q) => normalize(q).length >= 8 && triggerText.includes(normalize(q)));
      if (!grounded) ungrounded++;
      const n = countWords(a.email);
      if (n >= MAX_WORDS) overLength++;
      const check = [!grounded ? "First line doesn't quote the trigger verbatim" : null, n >= MAX_WORDS ? `Trim under ${MAX_WORDS} words` : null].filter(Boolean).join("; ");
      const subject = shippable(a.subject).replace(/^subject:\s*/i, "");
      const email = shippable(a.email.replace(/^\s*\**subject:?\**:?.*\n+/i, ""));
      const body = `Subject: ${subject}\n\n${email}`;
      drafts.push({
        type: "outbound_message",
        title: draftTitle(body, `${a.account} · ${TRIGGER_LABEL[a.trigger] ?? "Trigger"}`, a.account),
        body,
        payload: {
          account: a.account,
          trigger: a.trigger,
          fit_score: a.fit_score,
          fit_reasons: a.fit_reasons,
          subject,
          first_line: a.first_line,
          why_now: a.why_now,
          angle: a.angle,
          words: n,
          meta: meta(["Check", check || null], ["Fit", `${a.fit_score}/100`], ["Why now", a.why_now], ["Angle", a.angle], ["Length", `${n} words`]),
        },
        evidence: a.evidence,
      });
    }
    const skippedTxt = [...badFit.map((a) => `${a.account} (fit ${a.fit_score})`), ...o.skipped.map((s) => `${s.account}: ${s.reason}`)];
    return {
      summary: `${drafts.length} messages for accounts with fresh triggers${badFit.length ? `; ${badFit.length} dropped as bad fit` : ""}${blocked.length ? `; ${blocked.length} blocked for banned language` : ""}${skippedTxt.length ? `. Skipped: ${skippedTxt.join("; ")}` : ""}.`,
      stats: {
        trigger_accounts: unique.length,
        messages: drafts.length,
        bad_fit_dropped: badFit.length,
        banned_blocked: blocked.length,
        skipped: o.skipped.length,
        dropped_unverified: sup.dropped,
        first_line_not_grounded: ungrounded,
        over_length: overLength,
      },
      drafts,
    };
  },
};

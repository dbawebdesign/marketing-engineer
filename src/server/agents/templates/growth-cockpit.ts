import { z } from "zod";
import type { AgentTemplate, MetricsDigest, RunContext } from "../types";
import type { SignalLite } from "../evidence";
import { baseSystem, renderDocs, renderRules, renderSignals, renderSpec } from "../prompting";
import { keepSupported, verifyEvidence } from "../evidence";
import { sentences, tokens, topPhrases } from "../text";
import { bullets, findSentence } from "./guardrails";

const READS = ["customer-truth/what-the-market-is-telling-us", "cockpit/weekly-brief", "content/winning-hooks", "outbound/approved-angles"];

const Ev = z.object({ signal_id: z.string(), quote: z.string().describe("Verbatim sentence copied from the signal.") });

const Schema = z.object({
  headline: z.string().describe("The one sentence the team should remember from this week. Numbers from the metrics only."),
  what_changed: z
    .array(z.object({ point: z.string(), evidence: z.array(Ev).describe("Signals behind the point. Empty when the point comes from metrics.") }))
    .describe("3-5 things that changed this week, most important first."),
  angle_read: z.string().describe("Which angle drove clicks versus demos and qualified replies, with the numbers from the metrics, e.g. 'X drew 2x the clicks of Y but Y produced 2x the demo requests'."),
  tests_read: z.string().describe("Tests run, won and lost, win rate, and what that says about the testing habit. From the metrics only."),
  repeated_objection: z.object({
    objection: z.string(),
    count: z.number().int().describe("Distinct signals raising it."),
    so_what: z.string(),
    evidence: z.array(Ev),
  }),
  getting_louder: z
    .array(z.object({ topic: z.string(), detail: z.string(), evidence: z.array(Ev) }))
    .describe("Pains or competitors showing up more often in signals. Up to 3."),
  next_tests: z
    .array(
      z.object({
        name: z.string(),
        hypothesis: z.string(),
        angle: z.string(),
        metric: z.string().describe("Event kind that decides it, e.g. demo_request."),
        why: z.string(),
      }),
    )
    .describe("1-3 things to test next week, highest expected value first."),
  notes: z.string(),
});
type Out = z.infer<typeof Schema>;

const TOP_KINDS = ["click", "visit", "impression", "open"];
const label = (k: string) => { const w = k.replace(/_/g, " "); return w.endsWith("s") ? w : w.endsWith("y") ? `${w.slice(0, -1)}ies` : `${w}s`; };
const MIN_TOP = 10; // below this many clicks a per-100 rate is noise
const r1 = (n: number) => Math.round(n * 10) / 10;
const times = (a: number, b: number) => (b ? `${r1(a / b)}x` : "n/a");

type Row = { angle: string; kinds: Record<string, number> };
function scoreboard(m: MetricsDigest | undefined) {
  const map = new Map<string, Row>();
  for (const r of m?.byAngle ?? []) {
    if (r.angle === "(none)") continue;
    const row = map.get(r.angle) ?? { angle: r.angle, kinds: {} };
    row.kinds[r.kind] = (row.kinds[r.kind] ?? 0) + r.value;
    map.set(r.angle, row);
  }
  const rows = [...map.values()];
  const kinds = [...new Set((m?.byAngle ?? []).map((r) => r.kind))];
  const top = kinds.find((k) => TOP_KINDS.includes(k)) ?? null;
  const bottom = ["demo_request", "qualified_reply", "positive_reply", "signup", "meeting_booked"].filter((k) => kinds.includes(k));
  return { rows, top, bottom, kinds };
}

/** Friction themes: what keeps coming up in tickets, churn notes, lost deals and low reviews. */
const THEMES: { name: string; re: RegExp; test: { name: string; hypothesis: string; metric: string } }[] = [
  {
    name: "The office team never gets invited",
    re: /\binvit|teammate|office (staff|team|manager)\b/i,
    test: { name: "Invite-the-office step in trial setup", hypothesis: "Making 'invite your office manager' a required step on day one raises the share of trials where tech notes become quotes.", metric: "trial_teammate_invited" },
  },
  {
    name: "Price per tech is hard to justify",
    re: /\b(price|pricing|per-tech|per tech|expensive|cheaper|cost)\b/i,
    test: { name: "Lead with payback, not price", hypothesis: "Showing one recovered replacement job against the annual price before the pricing page lowers price objections on calls.", metric: "demo_request" },
  },
  {
    name: "Missing integration or bundle",
    re: /\b(integrat|quickbooks|payroll|bundles?)\b/i,
    test: { name: "Integrations proof on the demo page", hypothesis: "Naming the accounting integrations above the fold reduces 'does it connect to X' stalls.", metric: "demo_request" },
  },
  {
    name: "Reporting is not good enough",
    re: /\breport(ing)?\b/i,
    test: { name: "Reporting teaser in follow-up", hypothesis: "Sending a sample profitability report after the demo moves stalled deals.", metric: "qualified_reply" },
  },
  {
    name: "Reliability and speed",
    re: /\b(late|delayed?|bug|crash|slow|missing the first alert)\b/i,
    test: { name: "Reliability fix note to affected accounts", hypothesis: "Telling affected accounts what we fixed reduces churn risk.", metric: "qualified_reply" },
  },
];

function friction(sigs: SignalLite[]) {
  return sigs.filter(
    (s) =>
      ["support_ticket", "churn_note"].includes(s.source) ||
      (s.source === "sales_call" && (s.outcome === "lost" || s.outcome === "open")) ||
      (s.source === "review" && /\b[1-3] stars?\b/i.test(s.title)),
  );
}

function prevNumber(prev: string, kind: string): number | null {
  const m = new RegExp(`(\\d[\\d,]*)\\s+${label(kind).replace(/ /g, "\\s+")}`, "i").exec(prev);
  return m ? Number(m[1]!.replace(/,/g, "")) : null;
}

function offline(rc: RunContext): Out {
  const m = rc.metrics;
  const sigs = rc.signals;
  const { rows, top, bottom } = scoreboard(m);
  const prev = rc.docs["cockpit/weekly-brief"]?.content ?? "";
  const what_changed: Out["what_changed"] = [];

  // Totals, with a delta against last week's brief when it has the same numbers.
  const tot = m?.totals ?? {};
  const totKinds = Object.keys(tot).sort((a, b) => (TOP_KINDS.includes(a) ? -1 : TOP_KINDS.includes(b) ? 1 : 0));
  if (totKinds.length) {
    const parts = totKinds.map((k) => {
      const p = prev ? prevNumber(prev, k) : null;
      return `${tot[k]} ${label(k)}${p != null ? ` (${tot[k]! >= p ? "+" : ""}${tot[k]! - p} vs last brief)` : ""}`;
    });
    what_changed.push({ point: `Last ${rc.spec.lookbackDays} days: ${parts.join(", ")}.${prev.trim() ? "" : " This is the first brief, so there is no week-over-week comparison yet."}`, evidence: [] });
  } else what_changed.push({ point: "No channel results were recorded this window. Connect metric events before trusting any read below.", evidence: [] });

  // Angle read.
  let angle_read = "Not enough angle-tagged results to compare angles this week.";
  let winner: Row | null = null;
  let loudest: Row | null = null;
  const b0 = bottom[0];
  const sized = top ? rows.filter((r) => (r.kinds[top] ?? 0) >= MIN_TOP) : [];
  if (top && b0 && sized.length >= 2) {
    loudest = [...sized].sort((a, b) => (b.kinds[top] ?? 0) - (a.kinds[top] ?? 0))[0]!;
    winner = [...sized].sort((a, b) => (b.kinds[b0] ?? 0) - (a.kinds[b0] ?? 0))[0]!;
    const per = (r: Row) => r1(((r.kinds[b0] ?? 0) / Math.max(1, r.kinds[top] ?? 0)) * 100);
    if (winner.angle !== loudest.angle) {
      const b1 = bottom[1];
      const w1 = b1 ? winner.kinds[b1] ?? 0 : 0;
      const l1 = b1 ? loudest.kinds[b1] ?? 0 : 0;
      const extra = !b1 ? "" : w1 === l1 ? `; ${label(b1)} were level (${w1} each)` : w1 > l1 ? ` and ${l1 ? `${times(w1, l1)} the` : "more"} ${label(b1)} (${w1} vs ${l1})` : `, though it trailed on ${label(b1)} (${w1} vs ${l1})`;
      angle_read = `"${loudest.angle}" drew ${times(loudest.kinds[top] ?? 0, winner.kinds[top] ?? 0)} the ${label(top)} of "${winner.angle}" (${loudest.kinds[top] ?? 0} vs ${winner.kinds[top] ?? 0}), but "${winner.angle}" produced ${times(winner.kinds[b0] ?? 0, loudest.kinds[b0] ?? 0)} the ${label(b0)} (${winner.kinds[b0] ?? 0} vs ${loudest.kinds[b0] ?? 0})${extra}. Per 100 ${label(top)}: ${per(winner)} ${label(b0)} vs ${per(loudest)}. Clicks are rewarding the wrong angle.`;
    } else angle_read = `"${winner.angle}" led on both ${label(top)} (${winner.kinds[top] ?? 0}) and ${label(b0)} (${winner.kinds[b0] ?? 0}), at ${per(winner)} per 100 ${label(top)}. No conflict between attention and pipeline this week.`;
  }

  // Tests.
  const ex = m?.experiments ?? [];
  const by = (s: string) => ex.filter((e) => e.status === s).length;
  const decided = by("won") + by("lost") + by("inconclusive");
  const dupes = ex.length - new Set(ex.map((e) => e.name.toLowerCase())).size;
  const tests_read = !ex.length
    ? "No tests in the last 60 days. Nothing is being learned on purpose."
    : `${ex.length} tests in the last 60 days: ${by("running")} running, ${by("won")} won, ${by("lost")} lost, ${by("inconclusive")} inconclusive, ${by("draft")} never started.${decided ? ` Win rate ${Math.round((by("won") / decided) * 100)}% of ${decided} decided.` : " None has been decided, so there is no win rate yet."}${dupes ? ` ${dupes} are duplicates of another test's name; merge them.` : ""}${by("draft") && !by("running") ? " The bottleneck is starting tests, not ideas." : ""}`;
  if (ex.length && by("draft") && !by("running")) what_changed.push({ point: `${by("draft")} tests are queued and none is running.`, evidence: [] });

  // Truth file headline: what the market said this week.
  const truth = rc.docs["customer-truth/what-the-market-is-telling-us"]?.content ?? "";
  const truthHead = /\*\*(.+?)\*\*/.exec(truth)?.[1];
  if (truthHead) what_changed.push({ point: `Customer truth: ${truthHead}`, evidence: [] });

  // Approvals.
  const ap = m?.approvals ?? [];
  const pend = ap.reduce((n, a) => n + a.pending, 0);
  if (ap.length) {
    const worst = [...ap].sort((a, b) => b.pending - a.pending)[0]!;
    what_changed.push({ point: `Review queue: ${ap.reduce((n, a) => n + a.approved, 0)} drafts approved, ${ap.reduce((n, a) => n + a.rejected, 0)} rejected, ${pend} waiting${worst.pending ? ` (most in ${worst.system.replace(/_/g, " ")}: ${worst.pending})` : ""}.`, evidence: [] });
  }

  // Repeated objection.
  const fr = friction(sigs);
  const scored = THEMES.map((t) => ({ t, hits: fr.filter((s) => t.re.test(s.content)) })).sort((a, b) => b.hits.length - a.hits.length);
  const obj = scored[0]!;
  const objSources = [...new Set(obj.hits.map((s) => s.source.replace("_", " ")))];
  const repeated_objection: Out["repeated_objection"] = obj.hits.length >= 2
    ? {
        objection: obj.t.name,
        count: obj.hits.length,
        so_what: `It showed up in ${objSources.join(", ")}: across the funnel, not one bad week in support.`,
        evidence: obj.hits.slice(0, 4).flatMap((s) => {
          const q = findSentence(s, obj.t.re);
          return q ? [{ signal_id: s.id, quote: q }] : [];
        }),
      }
    : { objection: "No objection repeated this week.", count: 0, so_what: "Thin friction signal; check that tickets and lost-deal notes are flowing in.", evidence: [] };

  // Getting louder: top pain phrase by recency split, and competitor mentions.
  const getting_louder: Out["getting_louder"] = [];
  const mid = rc.now.getTime() - (rc.spec.lookbackDays / 2) * 864e5;
  const pain = topPhrases(sigs.map((s) => s.content), 3, 3)[0];
  if (pain) {
    const words = pain.phrase.split(" ");
    const hit = sigs.filter((s) => words.every((w) => tokens(s.content).some((t) => t.startsWith(w))));
    const recent = hit.filter((s) => new Date(s.occurred_at).getTime() >= mid).length;
    const pretty = pain.phrase.replace(/\bfollow up\b/, "follow-up");
    getting_louder.push({
      topic: `"${pretty}"`,
      detail: `${hit.length} signals mention it; ${recent} of them in the last ${Math.ceil(rc.spec.lookbackDays / 2)} days vs ${hit.length - recent} in the days before.${recent > hit.length - recent ? " Rising." : " Steady."}`,
      evidence: hit.slice(0, 2).flatMap((s) => {
        const q = sentences(s.content).find((x) => words.every((w) => x.toLowerCase().includes(w)));
        return q ? [{ signal_id: s.id, quote: q }] : [];
      }),
    });
  }
  const comp = sigs.flatMap((s) => {
    const q = findSentence(s, /\b(competitor|went with|switched to|left for|cheaper)\b/i);
    return q ? [{ s, q }] : [];
  });
  if (comp.length) {
    getting_louder.push({
      topic: "Competitors",
      detail: `${comp.length} signals name a competitor or cheaper alternative: ${comp.map((c) => `${c.s.source.replace("_", " ")}${c.s.outcome ? ` (${c.s.outcome})` : ""}`).join(", ")}.`,
      evidence: comp.slice(0, 3).map((c) => ({ signal_id: c.s.id, quote: c.q })),
    });
  }

  // Next tests.
  const next_tests: Out["next_tests"] = [];
  if (winner && loudest && top && b0 && winner.angle !== loudest.angle) {
    next_tests.push({
      name: `Move ${loudest.angle} spend to ${winner.angle}`,
      hypothesis: `Running "${winner.angle}" creative on the budget now spent on "${loudest.angle}" raises ${label(b0)} per 100 ${label(top)} without a big drop in volume.`,
      angle: winner.angle,
      metric: b0,
      why: `Per 100 ${label(top)}: ${r1(((winner.kinds[b0] ?? 0) / Math.max(1, winner.kinds[top] ?? 0)) * 100)} ${label(b0)} vs ${r1(((loudest.kinds[b0] ?? 0) / Math.max(1, loudest.kinds[top] ?? 0)) * 100)}.`,
    });
  }
  if (repeated_objection.count >= 2) next_tests.push({ ...obj.t.test, angle: obj.t.name, why: `${repeated_objection.count} signals this week raised it.` });
  const tested = rows.map((r) => new Set(tokens(r.angle)));
  const untested = [...bullets(rc.docs["outbound/approved-angles"]), ...bullets(rc.docs["content/winning-hooks"])].find(
    (a) => !tested.some((t) => tokens(a).filter((w) => t.has(w)).length >= 2),
  );
  if (untested && next_tests.length < 3) {
    next_tests.push({
      name: `First test of "${untested}"`,
      hypothesis: `"${untested}" is approved but has no results yet. Run it against ${winner ? `"${winner.angle}"` : "the current best angle"} on the same audience.`,
      angle: untested,
      metric: b0 ?? "demo_request",
      why: "An approved angle with zero data is an untested guess.",
    });
  }

  const headline =
    winner && loudest && top && b0 && winner.angle !== loudest.angle
      ? `"${winner.angle}" got fewer ${label(top)} than "${loudest.angle}" but ${times(winner.kinds[b0] ?? 0, loudest.kinds[b0] ?? 0)} the ${label(b0)}.`
      : winner
        ? `"${winner.angle}" led on ${label(b0!)} this week.`
        : "Not enough tagged results for a confident read this week.";

  return {
    headline,
    what_changed,
    angle_read,
    tests_read,
    repeated_objection,
    getting_louder,
    next_tests: next_tests.slice(0, 3),
    notes: "Offline engine: numbers computed directly from metric events, experiments and the review queue; objections and rising topics from keyword themes over signals. Connect a Claude API key for a written read.",
  };
}

/** Numbers that may legitimately appear in narrative: metric values, their ratios, counts. */
function allowedNumbers(m: MetricsDigest | undefined, rc: RunContext) {
  const ok = new Set<string>();
  const add = (n: number) => {
    ok.add(String(n));
    ok.add(String(r1(n)));
    ok.add(String(Math.round(n)));
  };
  const vals: number[] = [];
  for (const v of Object.values(m?.totals ?? {})) vals.push(v);
  const { rows } = scoreboard(m);
  for (const r of rows) for (const v of Object.values(r.kinds)) vals.push(v);
  for (const v of vals) add(v);
  for (const a of vals) for (const b of vals) if (b) (add(a / b), add((a / b) * 100), add(a - b));
  for (const a of m?.approvals ?? []) [a.approved, a.rejected, a.pending].forEach(add);
  for (let i = 0; i <= Math.max(rc.signals.length, (m?.experiments.length ?? 0) + 1, 100); i++) add(i);
  add(rc.spec.lookbackDays);
  return ok;
}

export const growthCockpit: AgentTemplate<typeof Schema> = {
  id: "weekly-cockpit",
  system: "growth_cockpit",
  name: "Weekly review",
  tagline: "Monday's read: what changed, which angle drove pipeline, what to test next.",
  tier: "deep",
  defaultCron: "0 7 * * 1",
  needsMetrics: true,
  reads: READS,
  spec: {
    mission: "Close the loop every week: read results against the market, decide what won, and pick the next tests so the system gets smarter.",
    dataSources: ["Metric events by angle (clicks, demo requests, qualified replies)", "Experiments", "Review queue", "Customer truth file", "Last week's brief", "Signals"],
    schedule: "Mondays at 7:00",
    filters: ["Numbers come from metrics only, never estimated", "Separate attention (clicks) from pipeline (demos, qualified replies)", "Call out tests that never started"],
    output: "One weekly brief: what changed, angle read, tests and win rate, the objection that repeated, what's getting louder, and 1-3 tests for next week.",
    goodLooksLike: [
      "Leads with the decision the numbers support, not a recap",
      "Contrasts clicks with demos and replies per angle",
      "Every number traces to a metric; every market claim to a signal",
      "Next tests are specific enough to start on Monday",
    ],
    approval: "The head of growth approves the brief, which replaces the weekly brief doc.",
    metric: "Test win rate, and qualified pipeline per week",
    writesTo: "cockpit/weekly-brief",
    lookbackDays: 7,
  },
  schema: Schema,
  systemPrompt: baseSystem("the Growth Cockpit analyst"),
  prompt: (rc) => `${renderSpec(rc)}

${renderRules(rc)}

${renderDocs(rc, READS)}

## Metrics (the only source for numbers)
\`\`\`json
${JSON.stringify(rc.metrics ?? {}, null, 2)}
\`\`\`

How to work:
- Every number you write must come from the metrics JSON above or be a simple ratio of two of its numbers. Never estimate.
- Compare angles on attention (click) versus pipeline (demo_request, qualified_reply). Say plainly when the angle that gets clicks is not the one that gets demos.
- Tests: count run, won, lost, never started; compute the win rate only over decided tests.
- The repeated objection and what's getting louder come from signals, with verbatim quotes.
- If last week's brief is above, say what changed against it.
- 1-3 next tests, each with an angle, a hypothesis and the metric event that decides it.

${renderSignals(rc, 150)}

Write this week's brief for ${rc.tenantName}.`,
  offline,
  finalize(o, rc) {
    const m = rc.metrics;
    const { rows, top, bottom } = scoreboard(m);
    // Market claims that cite signals must verify; metric points carry no evidence.
    let droppedClaims = 0;
    let unverified = 0;
    const changed = o.what_changed.flatMap((c) => {
      if (!c.evidence.length) return [{ ...c, evidence: [] as ReturnType<typeof verifyEvidence> }];
      const ev = verifyEvidence(c.evidence, rc.signalMap);
      const good = ev.filter((e) => e.verified);
      unverified += ev.length - good.length;
      if (!good.length) {
        droppedClaims++;
        return [];
      }
      return [{ ...c, evidence: good }];
    });
    const louder = keepSupported(o.getting_louder, rc.signalMap);
    const objEv = verifyEvidence(o.repeated_objection.evidence, rc.signalMap).filter((e) => e.verified);
    const objection = o.repeated_objection.count > 0 && !objEv.length ? null : o.repeated_objection;
    if (!objection) droppedClaims++;
    droppedClaims += louder.dropped;
    unverified += louder.unverifiedQuotes;

    const ok = allowedNumbers(m, rc);
    const narrative = [o.headline, o.angle_read, o.tests_read, ...changed.map((c) => c.point)].join(" ");
    const badNums = [...new Set((narrative.match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => !ok.has(n) && !ok.has(String(Number(n)))))];

    const kinds = [top, ...bottom].filter((k): k is string => Boolean(k));
    const per = (r: Row) => (top && bottom[0] && (r.kinds[top] ?? 0) >= MIN_TOP ? r1(((r.kinds[bottom[0]] ?? 0) / (r.kinds[top] ?? 1)) * 100) : -1);
    const table = rows.length && kinds.length
      ? `| Angle | ${kinds.map((k) => label(k)).join(" | ")}${top && bottom[0] ? ` | ${label(bottom[0])} per 100 ${label(top)}` : ""} |
|---|${kinds.map(() => "---:").join("|")}${top && bottom[0] ? "|---:" : ""}|
${[...rows]
  .sort((a, b) => per(b) - per(a))
  .map((r) => `| ${r.angle} | ${kinds.map((k) => r.kinds[k] ?? 0).join(" | ")}${top && bottom[0] ? ` | ${per(r) < 0 ? "too few clicks" : per(r)}` : ""} |`)
  .join("\n")}`
      : "_No angle-tagged results this window._";
    const date = rc.now.toISOString().slice(0, 10);
    const body = `# Weekly brief · ${date}

**${o.headline}**

## What changed
${changed.map((c) => `- ${c.point}`).join("\n")}

## Angles: attention vs. pipeline
${o.angle_read}

${table}

## Tests
${o.tests_read}

## The objection that keeps coming back
${objection && objection.count ? `**${objection.objection}** (${objection.count} signals). ${objection.so_what}` : "Nothing repeated enough to call out this week."}

## Getting louder
${louder.kept.map((l) => `- **${l.topic}**: ${l.detail}`).join("\n") || "- Nothing clearly rising this week."}

## Test next
${o.next_tests.map((t, i) => `${i + 1}. **${t.name}**. ${t.hypothesis}  \n   Angle: ${t.angle} · Decided by: ${t.metric.replace(/_/g, " ")} · Why: ${t.why}`).join("\n")}

---
_Window: last ${rc.spec.lookbackDays} days. ${o.notes}${badNums.length ? ` Check these numbers, they don't trace to the metrics: ${badNums.join(", ")}.` : ""}${droppedClaims ? ` ${droppedClaims} market claim(s) dropped for unverifiable receipts.` : ""}_`;
    const evidence = [...changed.flatMap((c) => c.evidence), ...objEv, ...louder.kept.flatMap((l) => l.evidence)];
    return {
      summary: o.headline,
      stats: {
        signals: rc.signals.length,
        angles: rows.length,
        experiments: m?.experiments.length ?? 0,
        next_tests: o.next_tests.length,
        untraced_numbers: badNums.length,
        dropped_claims: droppedClaims,
        unverified_quotes: unverified,
      },
      drafts: [
        {
          type: "cockpit_memo",
          title: `Weekly brief · ${date}`,
          body,
          payload: { headline: o.headline, next_tests: o.next_tests, angle_read: o.angle_read, scoreboard: rows },
          evidence,
        },
      ],
    };
  },
};

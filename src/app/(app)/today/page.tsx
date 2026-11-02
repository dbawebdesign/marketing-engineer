import { ArrowRight, Check, LoaderCircle, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { requireCtx, currentSession } from "@/server/web/session";
import { getDraft, listDrafts, pendingCount } from "@/server/services/drafts";
import { listAgents, listRuns, type Agent } from "@/server/services/agents";
import { getDoc, introGaps } from "@/server/services/memory";
import { listExperiments } from "@/server/services/experiments";
import { tenantFlags } from "@/server/services/tenants";
import { IntroStep } from "@/components/intro-step";
import { signalStats, SOURCE_LABEL } from "@/server/services/signals";
import { todayState } from "@/server/services/review-extra";
import { SYSTEM_META, type System } from "@/server/agents/types";
import { L } from "@/components/nav";
import { slugForSystem } from "@/lib/systems";
import { Dot, buttonClass, cx, plural, timeAgo } from "@/components/ui";
import { RunAllButton, RunButton } from "@/components/run-button";
import { StartTestButton } from "@/components/start-test-button";
import { ExperimentActions } from "@/components/experiment-actions";
import { AgentStatusText, agentStatus } from "@/components/agent-status";
import { testAngle } from "@/components/system-views";
import { can } from "@/lib/rbac";
import { fmtScore } from "@/lib/experiment-results";
import { nextStep, type NextStep, type StepAgent } from "@/lib/next-step";
import { DemoButton } from "@/components/demo-button";
import { LiveRefresh } from "@/components/live-refresh";

export const metadata = { title: "Today" };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function headlineOf(md: string | undefined) {
  const m = md?.match(/^\*\*(.+?)\*\*\s*$/m);
  return m?.[1] ?? null;
}

/** "A", "A and B", "A, B and C". */
const listOf = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** Quiet, sentence-case heading for secondary sections: one style on the page. */
function Heading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex h-6 items-center justify-between gap-3">
      <h2 className="text-[13px] font-medium text-ink-3">{children}</h2>
      {aside ? <div className="text-[13px] text-ink-3">{aside}</div> : null}
    </div>
  );
}

const REVIEW_ROWS = 5;
const DOWNSTREAM: System[] = ["founder_content", "outbound_signal", "creative_testing"];

const fmtNext = (a: Agent) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: a.timezone || "UTC", timeZoneName: "short" }).format(new Date(a.next_run_at!)).replace(",", "");

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ setup?: string }> }) {
  const ctx = await requireCtx();
  const s = await currentSession();
  const sp = await searchParams;
  const [pendingRows, pendingTotal, gaps, flags, agents, stats, truth, runs, state, experiments] = await Promise.all([
    listDrafts(ctx, { status: "pending", limit: 50 }),
    pendingCount(ctx),
    introGaps(ctx),
    tenantFlags(ctx),
    listAgents(ctx, { readiness: true }),
    signalStats(ctx),
    getDoc(ctx, "customer-truth/what-the-market-is-telling-us"),
    listRuns(ctx, 6),
    todayState(ctx),
    listExperiments(ctx, 20),
  ]);
  const totalSignals = stats.reduce((a, b) => a + b.total, 0);
  const weekSignals = stats.reduce((a, b) => a + b.week, 0);
  const first = s?.name?.split(" ")[0];
  const canRun = can(ctx.role, "agents:run");
  const canWriteMemory = can(ctx.role, "memory:write");
  const activeFor = (id: string) => state.active.find((r) => r.agent_id === id)?.id ?? null;
  const toStep = (a: Agent): StepAgent => ({
    id: a.id,
    name: a.name,
    ready: !a.readiness || a.readiness.ready,
    signals: a.readiness?.signals ?? 0,
    neverRun: !a.last_run,
    activeRunId: activeFor(a.id),
    need: a.readiness?.need,
  });
  const bySystem = (sys: System) => agents.find((a) => a.system === sys);
  const pulse = bySystem("customer_truth");
  const downstream = DOWNSTREAM.flatMap((sys) => {
    const a = bySystem(sys);
    return a ? [toStep(a)] : [];
  });
  const hookLab = bySystem("creative_testing");
  const pendingMemos = pendingRows.filter((d) => d.type === "market_memo").length;

  const askIntro = canWriteMemory && gaps.length > 0 && (sp.setup === "1" || !flags.onboarded);
  const step = nextStep({
    introGaps: askIntro ? gaps.length : 0,
    totalSignals,
    weekSignals,
    pulse: pulse ? toStep(pulse) : null,
    pendingMemoId: state.pendingMemoId,
    approvedMemo: state.approvedMemo,
    downstream,
    hasHookLab: !!hookLab,
    pendingDrafts: Math.max(pendingTotal - pendingMemos, 0),
    experiments: experiments.map((e) => ({
      id: e.id,
      name: e.name,
      status: e.status,
      variants: e.variants.length,
      measured: !!e.results?.measured,
      leader: e.results?.leader?.label ?? null,
    })),
    can: { run: canRun, review: can(ctx.role, "drafts:review"), writeExperiments: can(ctx.role, "experiments:write") },
  });

  // The memo the Next card points at stays out of the review list below.
  const memoInCard = step.kind === "review_memo" ? step.draftId : null;
  const memo = memoInCard ? await getDraft(ctx, memoInCard).catch(() => null) : null;
  const reviewable = pendingRows.filter((d) => d.id !== memoInCard && !(memoInCard && d.type === "market_memo"));
  const pending = reviewable.slice(0, REVIEW_ROWS);
  const headline = headlineOf(truth?.content);
  const running = experiments.find((e) => e.status === "running");
  // The latest memo's run says what "What the market is telling us" already says: keep it out of Recent activity.
  const showHeadline = !!(headline && step.kind !== "review_memo");
  const norm = (t: string | null | undefined) => (t ?? "").replace(/[*_`]/g, "").trim().toLowerCase();
  const memoRun = showHeadline ? runs.find((r) => r.system === "customer_truth" && r.status === "succeeded") : undefined;
  const activity = runs.filter((r) => r !== memoRun && !(showHeadline && r.summary && norm(r.summary).includes(norm(headline))));

  // Keep the page (and the agent rail) in step with any run still going, wherever it was started.
  const recent = (t: string) => Date.now() - new Date(t).getTime() < 30 * 60_000;
  const liveRefresh = state.active.length > 0 || agents.some((a) => a.last_run && (a.last_run.status === "running" || a.last_run.status === "queued") && recent(a.last_run.created_at));

  // Agents rail: the ones that have done something. Never-run agents fold into one quiet line,
  // unless one is ready and the viewer can run it right now (and the Next card isn't already asking).
  const inCard = new Set(step.kind === "run_downstream" ? step.agents.map((a) => a.id) : step.kind === "run_pulse" ? [step.agent.id] : []);
  const runnableNow = (a: Agent) => canRun && state.approvedMemo && !inCard.size && (!a.readiness || a.readiness.ready);
  const railAgents = agents.filter((a) => a.last_run || activeFor(a.id) || runnableNow(a));
  const quietAgents = agents.length - railAgents.length;

  // Before the first approved memo, a three-step "How it works" explains the loop; it leaves once the loop has run.
  // Shown only where the page would otherwise be bare: no review list, no activity yet.
  const leftBusy = !!(headline && step.kind !== "review_memo") || pending.length > 0 || state.active.length > 0 || activity.length > 0;
  const showHow = !state.approvedMemo && step.kind !== "intro" && !leftBusy;
  const how = showHow ? <HowItWorks signals={totalSignals > 0} memo={!!state.pendingMemoId || pendingMemos > 0} /> : null;
  const leftHasContent = leftBusy || !!how;

  const nextScheduled = agents
    .filter((a) => a.enabled && a.schedule_cron && a.next_run_at)
    .sort((a, b) => +new Date(a.next_run_at!) - +new Date(b.next_run_at!))[0];

  return (
    <div className="animate-in">
      {liveRefresh ? <LiveRefresh /> : null}
      <p className="text-[13px] text-ink-3">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
      <h1 className="mt-1 text-[26px] font-semibold tracking-[-0.02em]">
        {greeting()}
        {first ? `, ${first}` : ""}.
      </h1>

      {step.kind === "intro" ? (
        <IntroStep ask={gaps} canSkip={sp.setup !== "1"} />
      ) : (
        <NextCard
          step={step}
          memoHeadline={memo ? headlineOf(memo.body) : null}
          reviewFirst={pending[0] ? { id: pending[0].id, agents: [...new Set(reviewable.map((d) => d.agent_name).filter((n): n is string => !!n))] } : null}
          totalSignals={totalSignals}
          hookLab={hookLab ? { id: hookLab.id, name: hookLab.name } : null}
          experiment={step.kind === "start_test" || step.kind === "hooks_for_test" || step.kind === "call_test" ? experiments.find((e) => e.id === step.experiment.id) : undefined}
          nextScheduled={nextScheduled ? `${nextScheduled.name} runs next, ${fmtNext(nextScheduled)}.` : null}
          pulseReason={pulse?.readiness?.reason ?? null}
        />
      )}

      {totalSignals === 0 && how ? <div className="mt-12">{how}</div> : null}

      {totalSignals > 0 ? (
        <div className={cx("mt-12 grid gap-12", leftHasContent ? "lg:grid-cols-[minmax(0,1fr)_248px] lg:gap-14" : "max-w-md")}>
          {leftHasContent ? <div className="min-w-0 space-y-12">
            {how}
            {headline && step.kind !== "review_memo" ? (
              <section>
                <Heading>What the market is telling us</Heading>
                <L href="/s/truth" className="group block">
                  <p className="max-w-2xl text-[15px] font-medium leading-relaxed text-ink text-pretty">{headline}</p>
                  <p className="mt-1 inline-flex items-center gap-1 text-[13px] text-ink-3 transition-colors duration-150 group-hover:text-ink-2">
                    Read the truth file <ArrowRight size={13} aria-hidden />
                  </p>
                </L>
              </section>
            ) : null}

            {pending.length || state.active.length ? (
              <section>
                <Heading aside={pendingTotal ? <L href="/inbox" className="tnum transition-colors duration-150 hover:text-ink">Open inbox · {pendingTotal}</L> : null}>
                  Needs your review
                </Heading>
                <ul className="divide-y divide-line border-y border-line">
                  {state.active.map((r) => (
                    <li key={r.id} className="flex h-14 items-center gap-3" aria-live="polite">
                      <LoaderCircle size={13} className="shrink-0 animate-spin text-ink-3 motion-reduce:animate-none" />
                      <p className="min-w-0 flex-1 truncate text-[15px] text-ink-2">
                        <span className="font-medium text-ink">{r.agent_name}</span> {r.signals ? `is reading ${plural(r.signals, "signal")}…` : "is working…"}
                      </p>
                    </li>
                  ))}
                  {pending.map((d) => {
                    const n = d.evidence?.length ?? 0;
                    return (
                      <li key={d.id}>
                        <L href={`/inbox?d=${d.id}`} className="group -mx-3 flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-subtle">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[15px] font-medium">{d.title}</p>
                            <p className="truncate text-[13px] text-ink-3 tnum">
                              {SYSTEM_META[d.system as System]?.label} · {timeAgo(d.created_at)}
                              {n ? ` · ${plural(n, "receipt")}` : ""}
                            </p>
                          </div>
                          <ArrowRight size={14} aria-hidden className="shrink-0 text-ink-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
                        </L>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            {activity.length ? (
              <section>
                <Heading>Recent activity</Heading>
                <ul>
                  {activity.map((r) => {
                    const outcome = r.status === "failed" ? `Failed: ${r.error ?? "unknown error"}` : r.status === "succeeded" ? (r.summary ?? "Finished") : "Working…";
                    return (
                      <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-1 text-[13px] sm:grid-cols-[128px_minmax(0,1fr)_auto] sm:items-baseline" title={`${r.agent_name}: ${outcome}`}>
                        <span className="truncate font-medium text-ink-2">{r.agent_name}</span>
                        <span className={cx("col-span-2 row-start-2 truncate sm:col-span-1 sm:row-start-auto", r.status === "failed" ? "text-danger" : "text-ink-3")}>{outcome}</span>
                        <time dateTime={r.created_at} className="col-start-2 row-start-1 text-right text-ink-3 tnum sm:col-start-auto sm:row-start-auto">
                          {timeAgo(r.created_at)}
                        </time>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
          </div> : null}

          <aside className="space-y-12">
            {running ? (
              <section>
                <Heading aside={<L href="/s/creative" className="transition-colors duration-150 hover:text-ink">Open</L>}>Running test</Heading>
                <L href="/s/creative" className="block">
                  <p className="truncate text-[15px] font-medium" title={running.name}>{running.name}</p>
                  <p className="text-[13px] text-ink-3 tnum">
                    {running.results?.measured && running.results.leader
                      ? `${running.results.leader.label} leads · ${fmtScore(running.results.leader.score, running.results.kind)} ${running.results.unit}`
                      : `No results yet · decided by ${running.results?.unit ?? running.metric}`}
                  </p>
                </L>
              </section>
            ) : null}

            {railAgents.length || quietAgents ? (
              <section>
                <Heading aside={<L href="/agents" className="transition-colors duration-150 hover:text-ink">All</L>}>Agents</Heading>
                <ul className="-mx-2">
                  {railAgents.map((a) => {
                    const st = agentStatus(activeFor(a.id) ? { ...a, last_run: { status: "running", created_at: new Date().toISOString() } } : a);
                    return (
                      <li key={a.id} className="flex items-center gap-1 rounded-lg transition-colors duration-150 hover:bg-subtle">
                        <L href={`/s/${slugForSystem(a.system)}`} className="flex min-w-0 flex-1 items-baseline justify-between gap-3 px-2 py-1.5">
                          <span className="truncate text-[13px] font-medium text-ink">{a.name}</span>
                          {st.kind !== "never" ? <AgentStatusText status={st} drafts={false} className="shrink-0 text-[13px] tnum" /> : null}
                        </L>
                        {st.kind === "never" ? <RunButton agentId={a.id} label="Run" size="sm" variant="ghost" className="mr-1 shrink-0" /> : null}
                      </li>
                    );
                  })}
                </ul>
                {quietAgents ? (
                  <L href="/agents" className="mt-1 block text-[13px] text-ink-3 transition-colors duration-150 hover:text-ink-2">
                    {quietAgents === 1 ? "1 agent hasn’t run yet" : `${quietAgents} agents haven’t run yet`}
                  </L>
                ) : null}
              </section>
            ) : null}

            <section>
              <Heading aside={<L href="/signals" className="transition-colors duration-150 hover:text-ink">All</L>}>Signals this week</Heading>
              <p className="text-[26px] font-semibold leading-none tracking-[-0.02em] tnum">{weekSignals}</p>
              {weekSignals ? (
                <ul className="mt-3 space-y-1 text-[13px]">
                  {stats
                    .filter((x) => x.week)
                    .map((x) => (
                      <li key={x.source} className="flex justify-between text-ink-2">
                        <span>{SOURCE_LABEL[x.source as keyof typeof SOURCE_LABEL] ?? x.source}</span>
                        <span className="tnum text-ink-3">{x.week}</span>
                      </li>
                    ))}
                </ul>
              ) : null}
              {step.kind !== "fresh_signals" && step.kind !== "add_signals" && can(ctx.role, "signals:write") ? (
                <L href="/signals?add=1" className="mt-3 inline-flex items-center gap-1 text-[13px] text-ink-2 transition-colors duration-150 hover:text-ink">
                  <Plus size={13} aria-hidden /> Add signals
                </L>
              ) : null}
            </section>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

/** First run only: the loop in three steps, each checked off as it happens. */
function HowItWorks({ signals, memo }: { signals: boolean; memo: boolean }) {
  const steps = [
    { done: signals, title: "Add what customers say", body: "Call notes, tickets, reviews, churn reasons." },
    { done: memo, title: "Market pulse writes a memo", body: "What changed, with a receipt for every claim." },
    { done: false, title: "You approve it", body: "It becomes the truth file every other agent drafts from." },
  ];
  return (
    <section aria-labelledby="how-h" data-how-it-works>
      <Heading>
        <span id="how-h">How it works</span>
      </Heading>
      <ol className="grid gap-x-6 gap-y-4 border-t border-line pt-4 sm:grid-cols-3">
        {steps.map((st, i) => (
          <li key={st.title} className="flex gap-3">
            <span
              className={cx(
                "mt-px grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-medium tnum",
                st.done ? "bg-accent-soft text-accent" : "bg-subtle text-ink-3 ring-1 ring-line",
              )}
              aria-hidden
            >
              {st.done ? <Check size={11} strokeWidth={2.5} /> : i + 1}
            </span>
            <span className="min-w-0">
              <span className={cx("block text-[14px] font-medium", st.done ? "text-ink-3" : "text-ink")}>
                {st.title}
                {st.done ? <span className="sr-only"> (done)</span> : null}
              </span>
              <span className="mt-0.5 block text-[13px] leading-snug text-ink-3">{st.body}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The one thing worth doing next, with the control to do it. */
function NextCard({
  step,
  memoHeadline,
  reviewFirst,
  totalSignals,
  hookLab,
  experiment,
  nextScheduled,
  pulseReason = null,
}: {
  step: Exclude<NextStep, { kind: "intro" }>;
  /** Market pulse's own readiness reason: the same words the system page uses. */
  pulseReason?: string | null;
  memoHeadline: string | null;
  reviewFirst: { id: string; agents: string[] } | null;
  totalSignals: number;
  hookLab: { id: string; name: string } | null;
  experiment?: Awaited<ReturnType<typeof listExperiments>>[number];
  nextScheduled: string | null;
}) {
  let title: ReactNode;
  let body: ReactNode = null;
  let actions: ReactNode = null;
  switch (step.kind) {
    case "add_signals":
      if (step.signals === 0) {
        title = "Start with what customers are already saying";
        body = "Paste sales call notes, support tickets, churn reasons or reviews. Market pulse reads them and tells you what changed, with a receipt for every claim.";
        actions = (
          <>
            <L href="/signals?add=1" className={buttonClass("primary")}>
              <Plus size={14} aria-hidden /> Add signals
            </L>
            {totalSignals === 0 ? <DemoButton /> : null}
          </>
        );
      } else {
        title = "Add a few more signals";
        body = pulseReason ?? `Market pulse needs at least ${step.need} signals from the last ${step.days ?? 7} days to write a memo. There ${step.signals === 1 ? "is 1" : `are ${step.signals}`} so far.`;
        actions = (
          <L href="/signals?add=1" className={buttonClass("primary")}>
            <Plus size={14} aria-hidden /> Add signals
          </L>
        );
      }
      break;
    case "run_pulse":
      title = "Run Market pulse";
      body = `${plural(step.agent.signals || totalSignals, "signal")} ready. It writes what customers are telling you, with a receipt for every claim.`;
      actions = (
        <>
          <RunButton agentId={step.agent.id} label="Run Market pulse" activeRunId={step.agent.activeRunId} />
          <L href="/signals" className={buttonClass("ghost")}>
            Review signals first
          </L>
        </>
      );
      break;
    case "review_memo":
      title = "Review the market memo";
      body = (
        <>
          {memoHeadline ? <span className="text-ink">“{memoHeadline}” </span> : null}
          Approve it to update the truth file. Every other agent reads it.
        </>
      );
      actions = (
        <L href={`/inbox?d=${step.draftId}`} className={buttonClass("primary")}>
          Review memo <ArrowRight size={14} aria-hidden />
        </L>
      );
      break;
    case "run_downstream": {
      const names = step.agents.map((a) => a.name);
      title = "Turn the memo into content, outreach and tests";
      body = "Your approved memo now feeds the other agents. Each one lands drafts in your inbox for review.";
      actions = <RunAllButton agents={step.agents} label={`Run ${listOf(names)}`} />;
      break;
    }
    case "review_drafts":
      title = `Review ${plural(step.count, "draft")}`;
      body = reviewFirst?.agents.length ? `From ${listOf(reviewFirst.agents.slice(0, 3))}${reviewFirst.agents.length > 3 ? " and others" : ""}. Approve what's good, reject with a reason, and the agent learns.` : null;
      actions = (
        <L href={reviewFirst ? `/inbox?d=${reviewFirst.id}` : "/inbox"} className={buttonClass("primary")}>
          Start reviewing <ArrowRight size={14} aria-hidden />
        </L>
      );
      break;
    case "start_test":
      title = `Start the test: ${step.experiment.name}`;
      body = `${plural(step.experiment.variants, "variant")} ready. Start it, then tag metric events with each variant's angle to see which wins.`;
      actions = <StartTestButton id={step.experiment.id} />;
      break;
    case "hooks_for_test":
      title = `Write hooks for ${step.experiment.name}`;
      body = "This test needs at least two variants before it can start.";
      actions =
        hookLab && experiment ? (
          <RunButton
            agentId={hookLab.id}
            label={`Run ${hookLab.name} on this`}
            workingLabel="Writing hooks…"
            input={{ offer: testAngle(experiment).slice(0, 600), experiment_id: experiment.id, experiment: experiment.name.slice(0, 200) }}
          />
        ) : null;
      break;
    case "call_test":
      title = `Call the test: ${step.experiment.name}`;
      body = experiment?.results?.leader
        ? `${experiment.results.leader.label} leads on ${experiment.results.unit}. Call it when you've seen enough.`
        : "Results are in. Call it when you've seen enough.";
      actions = experiment ? (
        <>
          <ExperimentActions id={experiment.id} name={experiment.name} status={experiment.status} variants={experiment.variants.length} results={experiment.results} canWrite hookLab={null} />
          <L href="/s/creative" className={cx(buttonClass("ghost", "sm"), "mt-2.5")}>
            See results
          </L>
        </>
      ) : null;
      break;
    case "fresh_signals":
      title = "Add this week's signals";
      body = "Nothing new in the last 7 days. Fresh notes keep the memo, and every draft built on it, current.";
      actions = (
        <L href="/signals?add=1" className={buttonClass("primary")}>
          <Plus size={14} aria-hidden /> Add signals
        </L>
      );
      break;
    case "caught_up":
      title = "You're all caught up";
      body = `New drafts land in your inbox as agents run.${nextScheduled ? ` ${nextScheduled}` : ""}`;
      break;
  }
  return (
    <section className="mt-8 rounded-2xl bg-surface p-6 shadow-soft ring-1 ring-line sm:p-7" aria-labelledby="next-h" data-next={step.kind}>
      <p className="text-[13px] font-medium text-accent">{step.kind === "caught_up" ? "Today" : "Next"}</p>
      <h2 id="next-h" className="mt-1 text-[15px] font-semibold text-ink text-pretty">
        {title}
      </h2>
      {body ? <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-ink-2 text-pretty">{body}</p> : null}
      {actions ? <div className="mt-5 flex flex-wrap items-center gap-2">{actions}</div> : null}
    </section>
  );
}

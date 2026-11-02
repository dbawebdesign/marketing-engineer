import { ArrowRight, LoaderCircle, Radio } from "lucide-react";
import type { ReactNode } from "react";
import { requireCtx, currentSession } from "@/server/web/session";
import { listDrafts } from "@/server/services/drafts";
import { listAgents, listRuns } from "@/server/services/agents";
import { getDoc } from "@/server/services/memory";
import { signalStats, SOURCE_LABEL } from "@/server/services/signals";
import { todayState } from "@/server/services/review-extra";
import { SYSTEM_META, type System } from "@/server/agents/types";
import { L } from "@/components/nav";
import { slugForSystem } from "@/lib/systems";
import { Badge, Dot, Empty, buttonClass, cx, plural, timeAgo } from "@/components/ui";
import { RunButton } from "@/components/run-button";
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

/** Quiet, sentence-case heading for secondary sections. */
function Heading({ children, aside, strong }: { children: ReactNode; aside?: ReactNode; strong?: boolean }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className={strong ? "flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-ink" : "text-[13px] font-medium text-ink-2"}>{children}</h2>
      {aside}
    </div>
  );
}

export default async function TodayPage() {
  const ctx = await requireCtx();
  const s = await currentSession();
  const [pending, agents, stats, truth, runs, state] = await Promise.all([
    listDrafts(ctx, { status: "pending", limit: 5 }),
    listAgents(ctx),
    signalStats(ctx),
    getDoc(ctx, "customer-truth/what-the-market-is-telling-us"),
    listRuns(ctx, 6),
    todayState(ctx),
  ]);
  const totalSignals = stats.reduce((a, b) => a + b.total, 0);
  const weekSignals = stats.reduce((a, b) => a + b.week, 0);
  const headline = headlineOf(truth?.content);
  const first = s?.name?.split(" ")[0];
  const bySystem = (sys: string) => agents.find((a) => a.system === sys);
  const pulse = bySystem("customer_truth");
  const content = bySystem("founder_content");
  const outbound = bySystem("outbound_signal");
  const activeFor = (id?: string) => state.active.find((r) => r.agent_id === id)?.id ?? null;
  const working = new Set(state.active.map((r) => r.agent_id));
  const firstRun = !state.finishedRun;
  const showNext = state.finishedRun && state.approvedMemo && state.contentDrafts === 0 && (content || outbound);

  return (
    <div className="animate-in">
      {state.active.length ? <LiveRefresh /> : null}
      <p className="text-sm text-ink-3">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
      <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.02em]">
        {greeting()}
        {first ? `, ${first}` : ""}.
      </h1>

      {totalSignals === 0 ? (
        <section className="mt-10 rounded-2xl bg-surface p-6 shadow-soft ring-1 ring-line sm:p-8">
          <h2 className="text-lg font-semibold tracking-tight">Start with what customers are already saying</h2>
          <p className="mt-1 max-w-xl text-ink-2">
            Paste sales call notes, support tickets, churn notes or reviews. Your agents read them, tell you what changed with receipts, and turn it into content, outbound and tests you approve.
          </p>
          <ol className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              ["Add signals", "Paste 10–20 real notes, or use sample data."],
              ["Run Market pulse", "Get “What the market is telling us”."],
              ["Approve", "Approved insight feeds every other system."],
            ].map(([t, d], i) => (
              <li key={t} className="rounded-xl bg-subtle p-4">
                <span className="text-xs font-semibold text-ink-3 tnum">0{i + 1}</span>
                <p className="mt-1 font-medium">{t}</p>
                <p className="text-sm text-ink-2">{d}</p>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-wrap gap-2">
            <L href="/signals?add=1" className={buttonClass("primary")}>
              Add signals
            </L>
            <DemoButton />
          </div>
        </section>
      ) : (
        <>
          {firstRun ? (
            <section className="mt-10 rounded-2xl bg-surface p-6 shadow-soft ring-1 ring-line sm:p-8">
              <h2 className="text-[22px] font-semibold leading-snug tracking-[-0.015em] text-pretty">{plural(totalSignals, "signal")} ready.</h2>
              <p className="mt-1.5 max-w-xl text-ink-2">Run Market pulse to get your first memo: what customers are telling you, with a receipt for every claim.</p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                {pulse ? <RunButton agentId={pulse.id} label="Run Market pulse" activeRunId={activeFor(pulse.id)} /> : null}
                <L href="/signals" className="text-sm text-ink-3 hover:text-ink-2">
                  Review signals first
                </L>
              </div>
            </section>
          ) : (
            <section className="mt-10">
              <p className="text-[12px] font-semibold uppercase tracking-[0.07em] text-ink-3">What the market is telling us</p>
              {headline ? (
                <L href="/s/truth" className="group mt-2 block">
                  <p className="max-w-3xl text-[22px] font-medium leading-snug tracking-[-0.015em] text-ink text-pretty group-hover:text-ink/80">{headline}</p>
                  <p className="mt-2 inline-flex items-center gap-1 text-sm text-ink-3 group-hover:text-ink-2">
                    Read the truth file <ArrowRight size={13} />
                  </p>
                </L>
              ) : state.pendingMemoId ? (
                <L href={`/inbox?d=${state.pendingMemoId}`} className="group mt-2 block">
                  <p className="text-[22px] font-medium leading-snug tracking-[-0.015em] text-ink group-hover:text-ink/80">Your market memo is ready.</p>
                  <p className="mt-2 inline-flex items-center gap-1 text-sm text-ink-3 group-hover:text-ink-2">
                    Review it to update the truth file <ArrowRight size={13} />
                  </p>
                </L>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <p className="text-ink-2">{plural(weekSignals, "new signal")} this week. Run Market pulse to see what changed.</p>
                  {pulse ? <RunButton agentId={pulse.id} label="Run Market pulse" activeRunId={activeFor(pulse.id)} /> : null}
                </div>
              )}
            </section>
          )}

          {showNext ? (
            <section className="mt-8 flex flex-col gap-4 rounded-2xl bg-surface p-5 ring-1 ring-line sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div className="min-w-0">
                <h2 className="font-semibold tracking-tight">Next: turn this into content and outbound</h2>
                <p className="mt-0.5 text-sm text-ink-2">Your approved memo now feeds the other agents. Each run lands drafts in your inbox.</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {content ? <RunButton agentId={content.id} label={`Run ${content.name}`} variant="secondary" workingLabel="Drafting posts…" activeRunId={activeFor(content.id)} /> : null}
                {outbound ? <RunButton agentId={outbound.id} label={`Run ${outbound.name}`} variant="secondary" workingLabel="Finding accounts…" activeRunId={activeFor(outbound.id)} /> : null}
              </div>
            </section>
          ) : null}

          <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="min-w-0 space-y-10">
              <section>
                <Heading
                  strong
                  aside={pending.length ? <L href="/inbox" className="text-sm text-ink-2 hover:text-ink">Open inbox</L> : null}
                >
                  Needs your review
                </Heading>
                {pending.length || state.active.length ? (
                  <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface ring-1 ring-line">
                    {state.active.map((r) => (
                      <li key={r.id} className="flex items-center gap-3 px-4 py-3.5" aria-live="polite">
                        <LoaderCircle size={14} className="shrink-0 animate-spin text-ink-3 motion-reduce:animate-none" />
                        <p className="min-w-0 flex-1 truncate text-ink-2">
                          <span className="font-medium text-ink">{r.agent_name}</span> {r.signals ? `is reading ${plural(r.signals, "signal")}…` : "is working…"}
                        </p>
                      </li>
                    ))}
                    {pending.map((d) => {
                      const n = d.evidence?.length ?? 0;
                      return (
                        <li key={d.id}>
                          <L href={`/inbox?d=${d.id}`} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-subtle">
                            <Dot tone="accent" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium">{d.title}</p>
                              <p className="truncate text-sm text-ink-3">
                                <span className="hidden sm:inline">{SYSTEM_META[d.system as System]?.label} · </span>
                                {d.agent_name} · {timeAgo(d.created_at)}
                                {n ? <span className="sm:hidden"> · {plural(n, "receipt")}</span> : null}
                              </p>
                            </div>
                            {n ? <span className="hidden shrink-0 sm:block"><Badge>{plural(n, "receipt")}</Badge></span> : null}
                            <ArrowRight size={15} className="hidden shrink-0 text-ink-3 sm:block" />
                          </L>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <Empty title={firstRun ? "Nothing to review yet" : "You're all caught up"}>
                    {firstRun ? "Your first memo lands here when Market pulse finishes." : "New drafts from your agents show up here for approval."}
                  </Empty>
                )}
              </section>

              {runs.length ? (
                <section>
                  <Heading>Recent activity</Heading>
                  <ul className="-my-1.5">
                    {runs.map((r) => {
                      const outcome = r.status === "failed" ? `Failed: ${r.error ?? "unknown error"}` : r.status === "succeeded" ? (r.summary ?? "Finished") : "Working…";
                      return (
                        <li key={r.id} className="flex items-center gap-3 py-1.5 text-sm" title={`${r.agent_name}: ${outcome}`}>
                          <Dot tone={r.status === "failed" ? "danger" : r.status === "succeeded" ? "neutral" : "accent"} pulse={r.status === "running" || r.status === "queued"} />
                          <span className="shrink-0 font-medium text-ink">{r.agent_name}</span>
                          <span className={cx("min-w-0 flex-1 truncate", r.status === "failed" ? "text-danger" : "text-ink-2")}>{outcome}</span>
                          <time dateTime={r.created_at} className="shrink-0 text-[13px] text-ink-3 tnum">
                            {timeAgo(r.created_at)}
                          </time>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}
            </div>

            <aside className="space-y-10">
              <section>
                <Heading>Agents</Heading>
                <ul className="-mx-2 space-y-0.5">
                  {agents.map((a) => (
                    <li key={a.id}>
                      <L href={`/s/${slugForSystem(a.system)}`} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-subtle">
                        <Dot tone={!a.enabled ? "neutral" : a.last_run?.status === "failed" ? "danger" : "accent"} pulse={working.has(a.id)} />
                        <span className="flex-1 truncate text-sm">{a.name}</span>
                        <span className="text-xs text-ink-3 tnum">{working.has(a.id) ? "working" : a.next_run_at && a.enabled ? timeAgo(a.next_run_at) : "manual"}</span>
                      </L>
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <Heading aside={<L href="/signals" className="text-sm text-ink-2 hover:text-ink">All</L>}>Signals this week</Heading>
                <p className="text-3xl font-semibold tracking-tight tnum">{weekSignals}</p>
                <ul className="mt-3 space-y-1.5 text-sm">
                  {stats.filter((x) => x.week).map((x) => (
                    <li key={x.source} className="flex justify-between text-ink-2">
                      <span>{SOURCE_LABEL[x.source as keyof typeof SOURCE_LABEL] ?? x.source}</span>
                      <span className="tnum">{x.week}</span>
                    </li>
                  ))}
                </ul>
                <L href="/signals?add=1" className={`${buttonClass("secondary", "sm")} mt-4 w-full`}>
                  <Radio size={13} /> Add signals
                </L>
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

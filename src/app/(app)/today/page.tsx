import { ArrowRight, Radio } from "lucide-react";
import { requireCtx, currentSession } from "@/server/web/session";
import { listDrafts } from "@/server/services/drafts";
import { listAgents, listRuns } from "@/server/services/agents";
import { getDoc } from "@/server/services/memory";
import { signalStats, SOURCE_LABEL } from "@/server/services/signals";
import { SYSTEM_META, type System } from "@/server/agents/types";
import { L } from "@/components/nav";
import { slugForSystem } from "@/lib/systems";
import { Badge, Dot, Empty, Section, buttonClass, timeAgo } from "@/components/ui";
import { RunButton } from "@/components/run-button";
import { DemoButton } from "@/components/demo-button";

export const metadata = { title: "Today" };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function headlineOf(md: string | undefined) {
  const m = md?.match(/^\*\*(.+?)\*\*\s*$/m);
  return m?.[1] ?? null;
}

export default async function TodayPage() {
  const ctx = await requireCtx();
  const s = await currentSession();
  const [pending, agents, stats, truth, runs] = await Promise.all([
    listDrafts(ctx, { status: "pending", limit: 5 }),
    listAgents(ctx),
    signalStats(ctx),
    getDoc(ctx, "customer-truth/what-the-market-is-telling-us"),
    listRuns(ctx, 6),
  ]);
  const totalSignals = stats.reduce((a, b) => a + b.total, 0);
  const weekSignals = stats.reduce((a, b) => a + b.week, 0);
  const headline = headlineOf(truth?.content);
  const first = s?.name?.split(" ")[0];
  const pulse = agents.find((a) => a.system === "customer_truth");

  return (
    <div className="animate-in">
      <p className="text-sm text-ink-3">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
      <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.02em]">
        {greeting()}
        {first ? `, ${first}` : ""}.
      </h1>

      {totalSignals === 0 ? (
        <section className="mt-10 rounded-2xl bg-surface p-8 shadow-soft ring-1 ring-line">
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
          <section className="mt-10">
            <p className="text-[12px] font-semibold uppercase tracking-[0.07em] text-ink-3">What the market is telling us</p>
            {headline ? (
              <L href="/s/truth" className="group mt-2 block">
                <p className="max-w-3xl text-[22px] font-medium leading-snug tracking-[-0.015em] text-ink group-hover:text-ink/80">{headline}</p>
                <p className="mt-2 inline-flex items-center gap-1 text-sm text-ink-3 group-hover:text-ink-2">
                  Read the truth file <ArrowRight size={13} />
                </p>
              </L>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <p className="text-ink-2">
                  {weekSignals} new signals this week. Run Market pulse to see what changed.
                </p>
                {pulse ? <RunButton agentId={pulse.id} label="Run Market pulse" /> : null}
              </div>
            )}
          </section>

          <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div>
              <Section title="Needs your review" aside={pending.length ? <L href="/inbox" className="text-sm text-ink-2 hover:text-ink">Open inbox</L> : null}>
                {pending.length ? (
                  <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface ring-1 ring-line">
                    {pending.map((d) => (
                      <li key={d.id}>
                        <L href={`/inbox?d=${d.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-subtle">
                          <Dot tone="accent" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{d.title}</p>
                            <p className="text-sm text-ink-3">
                              {SYSTEM_META[d.system as System]?.label} · {d.agent_name} · {timeAgo(d.created_at)}
                            </p>
                          </div>
                          {d.evidence?.length ? <Badge>{d.evidence.length} {d.evidence.length === 1 ? "receipt" : "receipts"}</Badge> : null}
                          <ArrowRight size={15} className="text-ink-3" />
                        </L>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty title="You're all caught up">New drafts from your agents show up here for approval.</Empty>
                )}
              </Section>

              <Section title="Recent activity">
                <ul className="space-y-3">
                  {runs.map((r) => (
                    <li key={r.id} className="flex items-start gap-3 text-sm">
                      <span className="mt-1.5">
                        <Dot tone={r.status === "failed" ? "danger" : r.status === "succeeded" ? "neutral" : "accent"} pulse={r.status === "running" || r.status === "queued"} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-ink">
                          <span className="font-medium">{r.agent_name}</span>{" "}
                          <span className="text-ink-2">{r.status === "failed" ? `failed: ${r.error ?? ""}` : r.status === "succeeded" ? (r.summary ?? "finished") : "is working…"}</span>
                        </p>
                        <p className="text-ink-3">{timeAgo(r.created_at)}{r.trigger === "schedule" ? " · scheduled" : ""}</p>
                      </div>
                    </li>
                  ))}
                  {!runs.length ? <li className="text-sm text-ink-3">No agent runs yet.</li> : null}
                </ul>
              </Section>
            </div>

            <aside>
              <Section title="Agents">
                <ul className="space-y-1">
                  {agents.map((a) => (
                    <li key={a.id}>
                      <L href={`/s/${slugForSystem(a.system)}`} className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-subtle">
                        <Dot tone={!a.enabled ? "neutral" : a.last_run?.status === "failed" ? "danger" : "accent"} pulse={a.last_run?.status === "running" || a.last_run?.status === "queued"} />
                        <span className="flex-1 truncate text-sm">{a.name}</span>
                        <span className="text-xs text-ink-3">{a.next_run_at && a.enabled ? timeAgo(a.next_run_at) : "manual"}</span>
                      </L>
                    </li>
                  ))}
                </ul>
              </Section>
              <Section title="Signals this week" aside={<L href="/signals" className="text-sm text-ink-2 hover:text-ink">All</L>}>
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
              </Section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

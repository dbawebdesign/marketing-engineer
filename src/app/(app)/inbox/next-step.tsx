import type { ReactNode } from "react";
import { ArrowRight, Check, LoaderCircle } from "lucide-react";
import { requireCtx } from "@/server/web/session";
import { getDraft, type Draft } from "@/server/services/drafts";
import { listAgents, type Agent } from "@/server/services/agents";
import { signalStats } from "@/server/services/signals";
import { getDoc } from "@/server/services/memory";
import { todayState } from "@/server/services/review-extra";
import { SYSTEM_META, type System } from "@/server/agents/types";
import { slugForSystem } from "@/lib/systems";
import { L } from "@/components/nav";
import { RunButton } from "@/components/run-button";
import { DemoButton } from "@/components/demo-button";
import { LiveRefresh } from "@/components/live-refresh";
import { buttonClass, plural, timeAgo } from "@/components/ui";

type Link = { href: string; label: string };
type Step = { title: string; body: ReactNode; links: Link[]; run: string[]; tone?: "done" };

/** What an approval did, and the natural next move from there. Keyed by draft type. */
function afterApproval(d: Draft): Step {
  const sys = SYSTEM_META[d.system as System]?.label ?? d.system;
  switch (d.type) {
    case "market_memo":
      return {
        title: "Truth file updated",
        body: "Every agent now builds on this week’s memo, and its recommended test is queued. Turn it into posts and outreach next.",
        links: [
          { href: "/s/truth", label: "View truth file" },
          { href: "/s/creative", label: "See the queued test" },
        ],
        run: ["founder_content", "outbound_signal", "creative_testing"],
        tone: "done",
      };
    case "cockpit_memo":
      return { title: "Weekly brief published", body: "The brief is on the cockpit for anyone who asks what changed.", links: [{ href: "/s/cockpit", label: "Open the brief" }], run: ["customer_truth"], tone: "done" };
    case "creative_batch":
      return { title: "Experiment started", body: "The variants are live as a running test. Results show up on Creative testing.", links: [{ href: "/s/creative", label: "View experiment" }], run: [], tone: "done" };
    default:
      return {
        title: `Approved. Saved to ${sys}`,
        body: "It’s ready to ship from there. Run an agent when you want the next batch.",
        links: [{ href: `/s/${slugForSystem(d.system)}`, label: `Open ${sys}` }],
        run: [d.system === "founder_content" ? "outbound_signal" : d.system === "outbound_signal" ? "founder_content" : "customer_truth"],
        tone: "done",
      };
  }
}

const WORKING: Record<string, string> = { founder_content: "Drafting posts…", outbound_signal: "Finding accounts…", creative_testing: "Writing hooks…" };

/** The agents that build on the truth file, in the order they're worth running. */
const DOWNSTREAM = ["founder_content", "outbound_signal", "creative_testing"];

const list = (names: string[]) => (names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

export async function InboxNextStep({ doneId }: { doneId: string | null }) {
  const ctx = await requireCtx();
  const [done, agents, state, stats, truth] = await Promise.all([
    doneId ? getDraft(ctx, doneId).catch(() => null) : null,
    listAgents(ctx),
    todayState(ctx),
    signalStats(ctx),
    getDoc(ctx, "customer-truth/what-the-market-is-telling-us"),
  ]);
  const signals = stats.reduce((a, b) => a + b.total, 0);
  const bySystem = (s: string) => agents.find((a) => a.system === s);
  const activeFor = (id: string) => state.active.find((r) => r.agent_id === id)?.id ?? null;
  const runButtons = (systems: string[], primaryFirst = false) =>
    systems
      .map(bySystem)
      .filter((a): a is Agent => !!a)
      .map((a, i) => (
        <RunButton
          key={a.id}
          agentId={a.id}
          label={`Run ${a.name}`}
          variant={primaryFirst && i === 0 ? "primary" : "secondary"}
          workingLabel={WORKING[a.system] ?? "Reading signals…"}
          activeRunId={activeFor(a.id)}
        />
      ));

  // Something is running: say so, and keep the page fresh until drafts arrive.
  if (state.active.length && !done) {
    return (
      <Card title="Your agents are working" eyebrow={<LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" />}>
        <LiveRefresh />
        <p>
          {state.active.map((r) => r.agent_name).join(" and ")} {state.active.length > 1 ? "are" : "is"} reading{" "}
          {plural(Math.max(...state.active.map((r) => r.signals)), "signal")}. Drafts land here when {state.active.length > 1 ? "they finish" : "it finishes"}.
        </p>
      </Card>
    );
  }

  // Nothing has ever run: tell them what to do first, not that they're done.
  if (!state.finishedRun && !done) {
    if (!signals) {
      return (
        <Card title="Start with what customers are already saying" eyebrow="Nothing to review yet">
          <p>Add 10–20 real notes: sales calls, support tickets, churn notes, reviews. Then run Market pulse and its memo lands here for you to approve.</p>
          <Actions>
            <L href="/signals?add=1" className={buttonClass("primary")}>
              Add signals
            </L>
            <DemoButton />
          </Actions>
        </Card>
      );
    }
    const pulse = bySystem("customer_truth");
    return (
      <Card title={`${plural(signals, "signal")} ready. Run Market pulse first.`} eyebrow="Nothing to review yet">
        <p>It reads your signals and writes “What the market is telling us”, with a receipt for every claim. The memo lands here for approval.</p>
        <Actions>
          {pulse ? <RunButton agentId={pulse.id} label="Run Market pulse" activeRunId={activeFor(pulse.id)} /> : null}
          <L href="/signals" className="text-sm text-ink-3 hover:text-ink-2">
            Review signals first
          </L>
        </Actions>
      </Card>
    );
  }

  if (done && done.status !== "pending") {
    if (done.status === "rejected") {
      const again = agents.find((a) => a.id === done.agent_id);
      return (
        <Card title={`Rejected. ${done.agent_name ?? "The agent"} will do better next run`} eyebrow="Inbox is clear">
          <p>{done.feedback ? <>It learned: “{done.feedback}”.</> : "Run it again when you want a fresh draft."}</p>
          <Actions>
            {again ? <RunButton agentId={again.id} label={`Run ${again.name} again`} variant="primary" workingLabel="Rewriting…" activeRunId={activeFor(again.id)} /> : null}
          </Actions>
        </Card>
      );
    }
    const step = afterApproval(done);
    return (
      <Card title={step.title} eyebrow={<><Check size={13} className="text-accent" /> Inbox is clear</>}>
        <p>{step.body}</p>
        {step.run.length ? <Actions>{runButtons(step.run, true)}</Actions> : null}
        <div className={step.run.length ? "mt-4 flex flex-wrap gap-x-5 gap-y-2" : "mt-6 flex flex-wrap gap-x-5 gap-y-2"}>
          {step.links.map((l) => (
            <L key={l.href} href={l.href} className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
              {l.label} <ArrowRight size={13} />
            </L>
          ))}
        </div>
      </Card>
    );
  }

  // Caught up, nothing just decided. If the truth file moved since the downstream agents
  // last ran, they're drafting from an old picture: running them is the next step.
  const truthAt = state.approvedMemo && truth?.content.trim() ? new Date(truth.updated_at) : null;
  const stale = truthAt
    ? DOWNSTREAM.map(bySystem).filter((a): a is Agent => !!a && a.enabled !== false && (!a.last_run || new Date(a.last_run.created_at) < truthAt))
    : [];
  if (stale.length) {
    const never = stale.filter((a) => !a.last_run);
    return (
      <Card title={`Truth file updated. ${stale.length === 1 ? `${stale[0]!.name} hasn’t` : `${plural(stale.length, "agent")} haven’t`} read it yet`} eyebrow={<><Check size={13} className="text-accent" /> Inbox is clear</>}>
        <p>
          The truth file changed {timeAgo(truth!.updated_at)} (v{truth!.version}).{" "}
          {never.length === stale.length
            ? `${list(stale.map((a) => a.name))} ${stale.length > 1 ? "have" : "has"} never run.`
            : `${list(stale.map((a) => a.name))} last ran before that.`}{" "}
          Run {stale.length > 1 ? "them" : "it"} to draft from what the market is saying now.
        </p>
        <Actions>{runButtons(stale.map((a) => a.system), true)}</Actions>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
          <L href="/s/truth" className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
            View truth file <ArrowRight size={13} />
          </L>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Nothing waiting for you" eyebrow="Inbox is clear">
      <p>{state.approvedMemo ? "Run an agent when you want the next batch. Market pulse first if new signals came in." : "Run Market pulse to get this week’s memo. Everything else builds on it."}</p>
      <Actions>
        {runButtons(["customer_truth"], true)}
        <L href="/today" className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
          Back to Today <ArrowRight size={13} />
        </L>
      </Actions>
    </Card>
  );
}

function Card({ title, eyebrow, children }: { title: string; eyebrow?: ReactNode; children: ReactNode }) {
  return (
    <section data-next-step className="animate-in max-w-2xl rounded-2xl bg-surface p-6 shadow-soft ring-1 ring-line sm:p-8">
      {eyebrow ? <p className="mb-2 flex items-center gap-1.5 text-[13px] text-ink-3">{eyebrow}</p> : null}
      <h2 className="text-[20px] font-semibold leading-snug tracking-[-0.015em] text-pretty">{title}</h2>
      <div className="mt-1.5 text-ink-2">{children}</div>
    </section>
  );
}

const Actions = ({ children }: { children: ReactNode }) => <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">{children}</div>;

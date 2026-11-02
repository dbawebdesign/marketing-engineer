import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { requireCtx } from "@/server/web/session";
import { listAgents } from "@/server/services/agents";
import { listDrafts } from "@/server/services/drafts";
import { getDoc } from "@/server/services/memory";
import { listExperiments, angleMetrics } from "@/server/services/experiments";
import { SYSTEM_META } from "@/server/agents/types";
import { SYSTEM_SLUGS, type SystemSlug } from "@/lib/systems";
import { can } from "@/lib/rbac";
import { L } from "@/components/nav";
import { AgentCard } from "@/components/agent-card";
import { Markdown } from "@/components/markdown";
import { Badge, Empty, PageHeader, Section, timeAgo } from "@/components/ui";

export async function generateMetadata({ params }: { params: Promise<{ system: string }> }) {
  const s = SYSTEM_SLUGS[(await params).system as SystemSlug];
  return { title: s ? SYSTEM_META[s].label : "System" };
}

const DOC_FOR: Partial<Record<string, { key: string; title: string }>> = {
  customer_truth: { key: "customer-truth/what-the-market-is-telling-us", title: "Current truth file" },
  growth_cockpit: { key: "cockpit/weekly-brief", title: "This week's brief" },
};

export default async function SystemPage({ params }: { params: Promise<{ system: string }> }) {
  const { system: slug } = await params;
  const system = SYSTEM_SLUGS[slug as SystemSlug];
  if (!system) notFound();
  const ctx = await requireCtx();
  const meta = SYSTEM_META[system];
  const docRef = DOC_FOR[system];
  const [agents, drafts, doc, experiments, angles] = await Promise.all([
    listAgents(ctx),
    listDrafts(ctx, { system, limit: 12 }),
    docRef ? getDoc(ctx, docRef.key) : null,
    system === "creative_testing" || system === "growth_cockpit" ? listExperiments(ctx, 10) : [],
    system === "growth_cockpit" ? angleMetrics(ctx, 14) : [],
  ]);
  const mine = agents.filter((a) => a.system === system);
  const canRun = can(ctx.role, "agents:run");
  const maxClicks = Math.max(1, ...angles.map((a) => a.click ?? 0));

  return (
    <div className="animate-in">
      <PageHeader title={meta.label} sub={meta.blurb} />

      <Section>
        <div className="space-y-4">
          {mine.map((a) => (
            <AgentCard key={a.id} agent={a} canRun={canRun} />
          ))}
          {!mine.length ? <Empty title="No agent for this system yet">An admin can add one from Agents.</Empty> : null}
        </div>
      </Section>

      {system === "growth_cockpit" && angles.length ? (
        <Section title="Angles · last 14 days">
          <div className="rounded-2xl bg-surface p-6 ring-1 ring-line">
            <div className="mb-4 flex gap-4 text-xs text-ink-3">
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-line-strong" /> Clicks</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-accent" /> Demo requests</span>
            </div>
            <ul className="space-y-5">
              {angles
                .sort((a, b) => (b.demo_request ?? 0) - (a.demo_request ?? 0))
                .map((a) => {
                  const clicks = a.click ?? 0;
                  const demos = a.demo_request ?? 0;
                  const rate = clicks ? (demos / clicks) * 100 : 0;
                  return (
                    <li key={a.angle}>
                      <div className="mb-1.5 flex items-baseline justify-between gap-4 text-sm">
                        <span className="font-medium">{a.angle}</span>
                        <span className="text-ink-2 tnum">
                          {clicks} clicks · {demos} demos · {a.qualified_reply ?? 0} qualified replies · <span className="font-medium text-ink">{rate.toFixed(1)}%</span> click→demo
                        </span>
                      </div>
                      <div className="space-y-1">
                        <div className="h-2 rounded-full bg-line-strong" style={{ width: `${(clicks / maxClicks) * 100}%` }} />
                        <div className="h-2 rounded-full bg-accent" style={{ width: `${Math.max((demos / maxClicks) * 100, demos ? 1.5 : 0)}%` }} />
                      </div>
                    </li>
                  );
                })}
            </ul>
          </div>
        </Section>
      ) : null}

      {doc ? (
        <Section title={docRef?.title} aside={<span className="text-xs text-ink-3">v{doc.version} · updated {timeAgo(doc.updated_at)}</span>}>
          {doc.content.trim() ? (
            <div className="rounded-2xl bg-surface p-7 ring-1 ring-line">
              <Markdown>{doc.content}</Markdown>
            </div>
          ) : (
            <Empty title="Nothing approved yet">Run the agent, then approve its memo in your inbox. Approved memos become the source of truth every other agent reads.</Empty>
          )}
        </Section>
      ) : null}

      {experiments.length ? (
        <Section title="Experiments">
          <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface ring-1 ring-line">
            {experiments.map((e) => (
              <li key={e.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{e.name}</p>
                  <Badge tone={e.status === "won" ? "accent" : e.status === "running" ? "warn" : "neutral"}>{e.status}</Badge>
                  <span className="ml-auto text-xs text-ink-3">
                    {e.channel.replace(/_/g, " ")} · {e.variants.length} variants · {timeAgo(e.created_at)}
                  </span>
                </div>
                {e.hypothesis ? <p className="mt-1 text-sm text-ink-2">{e.hypothesis}</p> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Drafts" aside={<L href="/inbox" className="text-sm text-ink-2 hover:text-ink">Inbox</L>}>
        {drafts.length ? (
          <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface ring-1 ring-line">
            {drafts.map((d) => (
              <li key={d.id}>
                <L href={`/inbox?tab=${d.status === "published" ? "approved" : d.status}&d=${d.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-subtle">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{d.title}</p>
                    <p className="text-xs text-ink-3">{timeAgo(d.created_at)}</p>
                  </div>
                  <Badge tone={d.status === "pending" ? "warn" : d.status === "rejected" ? "danger" : "accent"}>{d.status === "pending" ? "to review" : d.status}</Badge>
                  <ArrowRight size={14} className="text-ink-3" />
                </L>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No drafts yet">Run the agent to get its first drafts.</Empty>
        )}
      </Section>
    </div>
  );
}

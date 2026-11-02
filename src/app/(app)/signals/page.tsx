import { ArrowUpRight, Radio, Search } from "lucide-react";
import { requireCtx } from "@/server/web/session";
import { listSignals, signalStats, SOURCE_LABEL, SIGNAL_SOURCES } from "@/server/services/signals";
import { L } from "@/components/nav";
import { AddSignals } from "@/components/add-signals";
import { DemoButton } from "@/components/demo-button";
import { Badge, Empty, PageHeader, cx, timeAgo } from "@/components/ui";

export const metadata = { title: "Signals" };

export default async function SignalsPage({ searchParams }: { searchParams: Promise<{ source?: string; q?: string; add?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const source = (SIGNAL_SOURCES as readonly string[]).includes(sp.source ?? "") ? sp.source : undefined;
  const q = sp.q?.slice(0, 200) || undefined;
  const [signals, stats] = await Promise.all([listSignals(ctx, { source, q, limit: 100 }), signalStats(ctx)]);
  const total = stats.reduce((a, b) => a + b.total, 0);
  const href = (s?: string) => `/signals${s || q ? "?" : ""}${s ? `source=${s}` : ""}${s && q ? "&" : ""}${q ? `q=${encodeURIComponent(q)}` : ""}`;

  return (
    <div className="animate-in">
      <PageHeader
        title="Signals"
        sub="Everything the market tells you: calls, tickets, churn notes, reviews, social. Agents read this, so you don't have to remember it."
        actions={<AddSignals key={sp.add ?? "x"} defaultOpen={sp.add === "1"} />}
      />
      {total === 0 ? (
        <Empty icon={<Radio size={22} />} title="No signals yet" action={<DemoButton />}>
          Paste 10 to 20 real customer notes to start. Or load a sample HVAC software company to see the whole system work.
        </Empty>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <form className="relative mr-2">
              {source ? <input type="hidden" name="source" value={source} /> : null}
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
              <input
                name="q"
                defaultValue={q}
                placeholder="Search signals"
                className="h-8 w-56 rounded-lg bg-surface pl-8 pr-3 text-sm ring-1 ring-line-strong placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </form>
            <L href={href()} className={cx("h-8 rounded-lg px-3 text-[13px] leading-8", !source ? "bg-ink text-bg" : "text-ink-2 hover:bg-subtle")}>
              All <span className="tnum opacity-60">{total}</span>
            </L>
            {stats.map((s) => (
              <L key={s.source} href={href(s.source)} className={cx("h-8 rounded-lg px-3 text-[13px] leading-8", source === s.source ? "bg-ink text-bg" : "text-ink-2 hover:bg-subtle")}>
                {SOURCE_LABEL[s.source as keyof typeof SOURCE_LABEL] ?? s.source} <span className="tnum opacity-60">{s.total}</span>
              </L>
            ))}
          </div>
          {signals.length ? (
            <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface ring-1 ring-line">
              {signals.map((s) => (
                <li key={s.id} className="px-5 py-4">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                    <Badge>{SOURCE_LABEL[s.source]}</Badge>
                    {s.account ? <span className="font-medium text-ink-2">{s.account}</span> : null}
                    {typeof s.metadata?.outcome === "string" ? (
                      <Badge tone={s.metadata.outcome === "won" ? "accent" : s.metadata.outcome === "lost" ? "danger" : "neutral"}>{String(s.metadata.outcome)}</Badge>
                    ) : null}
                    {typeof s.metadata?.trigger === "string" ? <Badge tone="warn">trigger: {String(s.metadata.trigger).replace(/_/g, " ")}</Badge> : null}
                    <span>{timeAgo(s.occurred_at)}</span>
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="ml-auto inline-flex items-center gap-0.5 hover:text-ink">
                        Source <ArrowUpRight size={12} />
                      </a>
                    ) : null}
                  </div>
                  {s.title ? <p className="font-medium">{s.title}</p> : null}
                  <p className="mt-0.5 line-clamp-3 text-[14px] leading-relaxed text-ink-2">{s.content}</p>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No signals match">Try a different search or source.</Empty>
          )}
        </>
      )}
    </div>
  );
}

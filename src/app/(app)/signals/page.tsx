import { ArrowUpRight, Radio, Search } from "lucide-react";
import { requireCtx } from "@/server/web/session";
import { getSignalDetail, listSignals, signalStats, SOURCE_LABEL, SIGNAL_SOURCES } from "@/server/services/signals";
import { isUuid } from "@/lib/db";
import { SignalSheetRoute } from "@/components/signal-sheet";
import { L } from "@/components/nav";
import { AddSignals } from "@/components/add-signals";
import { DemoButton } from "@/components/demo-button";
import { Badge, Empty, PageHeader, cx, plural, timeAgo } from "@/components/ui";

export const metadata = { title: "Signals" };

/** Untitled notes lead with their first line (or sentence, when the first line runs long). */
function splitNote(title: string, content: string) {
  if (title.trim()) return { head: title.trim(), rest: content };
  const text = content.trim();
  const nl = text.indexOf("\n");
  const line = nl < 0 ? text : text.slice(0, nl);
  if (line.length <= 110) return { head: line, rest: nl < 0 ? "" : text.slice(nl + 1).trim() };
  const m = line.slice(0, 111).match(/^.{20,}?[.?!](?=\s)/);
  if (m) return { head: m[0], rest: text.slice(m[0].length).trim() };
  return { head: line, rest: nl < 0 ? "" : text.slice(nl + 1).trim(), clamp: true };
}

export default async function SignalsPage({ searchParams }: { searchParams: Promise<{ source?: string; q?: string; add?: string; id?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const source = (SIGNAL_SOURCES as readonly string[]).includes(sp.source ?? "") ? sp.source : undefined;
  const q = sp.q?.slice(0, 200) || undefined;
  const openId = isUuid(sp.id) ? sp.id : null;
  const [signals, stats, detail] = await Promise.all([
    listSignals(ctx, { source, q, limit: 100 }),
    signalStats(ctx),
    openId ? getSignalDetail(ctx, openId) : null,
  ]);
  const total = stats.reduce((a, b) => a + b.total, 0);
  const qs = (o: { source?: string; id?: string }) => {
    const p = new URLSearchParams();
    if (o.source) p.set("source", o.source);
    if (q) p.set("q", q);
    if (o.id) p.set("id", o.id);
    const str = p.toString();
    return `/signals${str ? `?${str}` : ""}`;
  };
  const href = (s?: string) => qs({ source: s });

  return (
    <div className="animate-in">
      <PageHeader
        title="Signals"
        sub="Everything the market tells you: calls, tickets, churn notes, reviews, social. Agents read this, so you don't have to remember it."
        actions={<AddSignals key={sp.add ?? "x"} defaultOpen={sp.add === "1"} />}
      />
      {openId ? <SignalSheetRoute key={openId} id={openId} initial={detail} closeHref={qs({ source })} /> : null}
      {total === 0 ? (
        <Empty icon={<Radio size={22} />} title="No signals yet" action={<DemoButton />}>
          Paste 10 to 20 real customer notes to start. Or load a sample HVAC software company to see the whole system work.
        </Empty>
      ) : (
        <>
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <form className="relative shrink-0" role="search">
              {source ? <input type="hidden" name="source" value={source} /> : null}
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
              {/* Browser extensions and autofill restyle search inputs (e.g. caret-color) before hydration. */}
              <input
                suppressHydrationWarning
                name="q"
                type="search"
                defaultValue={q}
                aria-label="Search signals"
                placeholder="Search signals"
                className="h-8 w-full rounded-lg bg-surface pl-8 pr-3 text-sm ring-1 ring-line-strong placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent sm:w-56"
              />
            </form>
            <nav
              aria-label="Filter by source"
              className="-mx-4 flex min-w-0 gap-1 overflow-x-auto px-4 [mask-image:linear-gradient(to_right,transparent,#000_16px,#000_calc(100%-24px),transparent)] [scrollbar-width:none] sm:mx-0 sm:px-0 sm:[mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)] [&::-webkit-scrollbar]:hidden"
            >
              <L href={href()} aria-current={!source ? "page" : undefined} className={cx("h-8 shrink-0 whitespace-nowrap rounded-lg px-3 text-[13px] leading-8 transition-colors", !source ? "bg-ink text-bg" : "text-ink-2 hover:bg-subtle hover:text-ink")}>
                All <span className="tnum opacity-60">{total}</span>
              </L>
              {stats.map((s) => (
                <L
                  key={s.source}
                  href={href(s.source)}
                  aria-current={source === s.source ? "page" : undefined}
                  className={cx("h-8 shrink-0 whitespace-nowrap rounded-lg px-3 text-[13px] leading-8 transition-colors", source === s.source ? "bg-ink text-bg" : "text-ink-2 hover:bg-subtle hover:text-ink")}
                >
                  {SOURCE_LABEL[s.source as keyof typeof SOURCE_LABEL] ?? s.source} <span className="tnum opacity-60">{s.total}</span>
                </L>
              ))}
              <span aria-hidden className="w-4 shrink-0" />
            </nav>
          </div>
          {q ? (
            <p className="-mt-3 mb-4 text-sm text-ink-3">
              {plural(signals.length, "signal")} matching “{q}”{" "}
              <L href={source ? `/signals?source=${source}` : "/signals"} className="text-ink-2 underline-offset-2 hover:text-ink hover:underline">
                Clear
              </L>
            </p>
          ) : null}
          {signals.length ? (
            <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface ring-1 ring-line">
              {signals.map((s) => (
                <li key={s.id} className={cx("relative px-5 py-4 transition-colors hover:bg-subtle/60", s.id === openId && "bg-subtle/60")}>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                    <Badge>{SOURCE_LABEL[s.source]}</Badge>
                    {s.account ? <span className="font-medium text-ink-2">{s.account}</span> : null}
                    {typeof s.metadata?.outcome === "string" ? (
                      <Badge tone={s.metadata.outcome === "won" ? "accent" : s.metadata.outcome === "lost" ? "danger" : "neutral"}>{String(s.metadata.outcome)}</Badge>
                    ) : null}
                    {typeof s.metadata?.trigger === "string" ? <Badge tone="warn">trigger: {String(s.metadata.trigger).replace(/_/g, " ")}</Badge> : null}
                    <span>{timeAgo(s.occurred_at)}</span>
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="relative z-10 ml-auto inline-flex items-center gap-0.5 hover:text-ink">
                        Source <ArrowUpRight size={12} />
                      </a>
                    ) : null}
                  </div>
                  {(() => {
                    const n = splitNote(s.title, s.content);
                    return (
                      <>
                        <p className={cx("font-medium text-ink text-pretty", n.clamp && "line-clamp-1")}>
                          {/* The whole row opens the signal; the overlay keeps the Source link clickable on top. */}
                          <L href={qs({ source, id: s.id })} scroll={false} className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-accent">
                            {n.head}
                          </L>
                        </p>
                        {n.rest ? <p className="mt-0.5 line-clamp-3 text-[14px] leading-relaxed text-ink-2">{n.rest}</p> : null}
                      </>
                    );
                  })()}
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

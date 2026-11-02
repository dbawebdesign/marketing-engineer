import { ArrowRight, ChevronDown } from "lucide-react";
import type { Draft } from "@/server/services/drafts";
import type { Experiment } from "@/server/services/experiments";
import { L } from "./nav";
import { Markdown } from "./markdown";
import { CopyButton } from "./copy-button";
import { Badge, Dot, buttonClass, cx, plural, timeAgo } from "./ui";

/* ------------------------------------------------------------------ shared */

/** A page block. Sentence-case heading plus quiet meta: the only two label styles on system pages. */
export function Block({ title, meta, children, className }: { title?: React.ReactNode; meta?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx("mb-12", className)}>
      {title || meta ? (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          {title ? <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2> : <span />}
          {meta ? <div className="text-[13px] text-ink-3">{meta}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export const inboxHref = (d: Pick<Draft, "id" | "status">) => `/inbox?tab=${d.status === "published" ? "approved" : d.status}&d=${d.id}`;

const STATUS: Record<Draft["status"], { label: string; tone: "warn" | "accent" | "neutral" }> = {
  pending: { label: "To review", tone: "warn" },
  approved: { label: "Approved", tone: "accent" },
  published: { label: "Published", tone: "accent" },
  rejected: { label: "Rejected", tone: "neutral" },
};

const card = "rounded-2xl bg-surface ring-1 ring-line";

/** "3 posts are waiting for your review  Review →" */
export function PendingNote({ drafts, noun }: { drafts: Draft[]; noun: [string, string?] }) {
  if (!drafts.length) return null;
  const one = drafts.length === 1;
  return (
    <L
      href={one ? inboxHref(drafts[0]!) : "/inbox"}
      className="group mb-4 flex items-center gap-3 rounded-xl bg-warn-soft/60 px-4 py-3 text-[14px] text-ink transition-colors hover:bg-warn-soft"
    >
      <Dot tone="warn" />
      <span className="flex-1">
        {one ? `A new ${noun[0]} is` : `${plural(drafts.length, noun[0], noun[1])} are`} waiting for your review
      </span>
      <span className="flex items-center gap-1 text-[13px] font-medium text-ink-2 group-hover:text-ink">
        Review <ArrowRight size={14} />
      </span>
    </L>
  );
}

/** The empty state for an artifact, pointing at the pending draft when there is one. */
export function ArtifactEmpty({ pending, noun, idle }: { pending: Draft[]; noun: string; idle: { title: string; body: string } }) {
  const p = pending[0];
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong px-6 py-12 text-center">
      <p className="font-medium text-ink">{p ? `A new ${noun} is waiting for your review` : idle.title}</p>
      <p className="mt-1 max-w-sm text-sm text-ink-2">{p ? `Approve it and it shows up here.` : idle.body}</p>
      {p ? (
        <L href={inboxHref(p)} className={cx(buttonClass("primary", "sm"), "mt-5")}>
          Review {noun} <ArrowRight size={14} />
        </L>
      ) : null}
    </div>
  );
}

export function DocView({ doc, title, pending, noun, idle }: { doc: { content: string; version: number; updated_at: string } | null; title: string; pending: Draft[]; noun: string; idle: { title: string; body: string } }) {
  const has = !!doc?.content.trim();
  return (
    <Block title={title} meta={has ? `v${doc!.version} · updated ${timeAgo(doc!.updated_at)}` : null}>
      {has ? (
        <>
          <PendingNote drafts={pending} noun={[noun]} />
          <div className={cx(card, "p-6 sm:p-8")}>
            <Markdown>{doc!.content}</Markdown>
          </div>
        </>
      ) : (
        <ArtifactEmpty pending={pending} noun={noun} idle={idle} />
      )}
    </Block>
  );
}

/** Recent drafts, identical titles collapsed, three rows at most. */
export function DraftsList({ drafts }: { drafts: Draft[] }) {
  const groups: { d: Draft; earlier: number }[] = [];
  const seen = new Map<string, number>();
  for (const d of drafts) {
    const k = d.title.trim().toLowerCase();
    const i = seen.get(k);
    if (i === undefined) {
      seen.set(k, groups.length);
      groups.push({ d, earlier: 0 });
    } else groups[i]!.earlier++;
  }
  const rows = groups.slice(0, 3);
  return (
    <Block title="Recent drafts" meta={drafts.length ? <L href="/inbox" className="hover:text-ink">See all in Inbox</L> : null}>
      {rows.length ? (
        <ul className={cx(card, "divide-y divide-line overflow-hidden")}>
          {rows.map(({ d, earlier }) => {
            const s = STATUS[d.status];
            return (
              <li key={d.id}>
                <L href={inboxHref(d)} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-subtle">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium">{d.title}</p>
                    <p className="text-[13px] text-ink-3">
                      {timeAgo(d.created_at)}
                      {earlier ? ` · +${plural(earlier, "earlier version")}` : ""}
                    </p>
                  </div>
                  <Badge tone={s.tone}>{s.label}</Badge>
                  <ArrowRight size={14} className="text-ink-3" aria-hidden />
                </L>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[14px] text-ink-3">No drafts yet. Run the agent to get its first ones.</p>
      )}
    </Block>
  );
}

/* --------------------------------------------------------- founder content */

export function PostsLibrary({ drafts }: { drafts: Draft[] }) {
  const posts = drafts.filter((d) => d.type === "post");
  const approved = posts.filter((d) => d.status === "approved" || d.status === "published");
  const pending = posts.filter((d) => d.status === "pending");
  return (
    <Block title="Approved posts" meta={approved.length ? plural(approved.length, "post") : null}>
      {approved.length ? (
        <>
          <PendingNote drafts={pending} noun={["post"]} />
          <ul className="grid gap-4 sm:grid-cols-2">
            {approved.map((d) => {
              const p = d.payload as { platform?: string; text?: string };
              const text = p.text ?? d.body.split("\n---\n")[0] ?? "";
              return (
                <li key={d.id} className={cx(card, "flex flex-col p-5")}>
                  <p className="mb-2.5 text-[13px] text-ink-3">{p.platform === "x" ? "X" : "LinkedIn"}</p>
                  <p className="line-clamp-[9] flex-1 whitespace-pre-line text-[14px] leading-relaxed text-ink">{text}</p>
                  <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
                    <L href={inboxHref(d)} className="text-[13px] text-ink-3 hover:text-ink">
                      {d.status === "published" ? "Published" : "Approved"} {timeAgo(d.reviewed_at ?? d.created_at)}
                    </L>
                    <CopyButton text={text} />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <ArtifactEmpty
          pending={pending}
          noun={pending.length > 1 ? "batch of posts" : "post"}
          idle={{ title: "No approved posts yet", body: "Approve a post in your inbox and it lands here, ready to copy." }}
        />
      )}
    </Block>
  );
}

/* -------------------------------------------------------- outbound signals */

const TRIGGER: Record<string, string> = { hiring: "Hiring", new_location: "New location", funding: "Funding", bad_review: "Bad review", leadership_change: "New leader", tech_change: "Tool change" };
const humanize = (s: string) => TRIGGER[s] ?? (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, " ");

function emailText(d: Draft) {
  const p = d.payload as { subject?: string };
  const top = d.body.split("\n---\n")[0] ?? d.body;
  const email = top.replace(/^\*\*Subject:\*\*.*\n+/, "").trim();
  return `Subject: ${p.subject ?? ""}\n\n${email}`;
}

export function OutboundQueue({ drafts }: { drafts: Draft[] }) {
  const rows = drafts.filter((d) => d.type === "outbound_message");
  const ready = rows.filter((d) => d.status === "approved").length;
  const toReview = rows.filter((d) => d.status === "pending").length;
  const cols = "md:grid md:grid-cols-[minmax(0,1.25fr)_minmax(0,0.8fr)_44px_minmax(0,1.6fr)_minmax(0,1fr)] md:items-center md:gap-5";
  return (
    <Block
      title="Queue"
      meta={rows.length ? [ready ? `${ready} ready to send` : null, toReview ? `${toReview} to review` : null].filter(Boolean).join(" · ") || plural(rows.length, "account") : null}
    >
      {rows.length ? (
        <div className={cx(card, "overflow-hidden")} role="table" aria-label="Outbound queue">
          <div role="row" className={cx("hidden border-b border-line px-5 py-2.5 text-[13px] text-ink-3", cols)}>
            <span role="columnheader">Account</span>
            <span role="columnheader">Trigger</span>
            <span role="columnheader" className="text-right">Fit</span>
            <span role="columnheader">Subject</span>
            <span role="columnheader" className="text-right">Status</span>
          </div>
          <div className="divide-y divide-line">
            {rows.map((d) => {
              const p = d.payload as { account?: string; trigger?: string; fit_score?: number; subject?: string };
              return (
                <div role="row" key={d.id} className={cx("grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-5 py-3.5 text-[14px]", cols)}>
                  <span role="cell" className="min-w-0">
                    <L href={inboxHref(d)} className="block truncate font-medium hover:underline">
                      {p.account ?? d.title}
                    </L>
                    <span className="hidden text-[13px] text-ink-3 md:block">{timeAgo(d.created_at)}</span>
                  </span>
                  <span role="cell" className="col-start-1 row-start-2 text-[13px] text-ink-2 md:col-auto md:row-auto md:text-[14px]">
                    {humanize(p.trigger ?? "")}
                    <span className="text-ink-3 md:hidden"> · fit {p.fit_score ?? "—"}</span>
                  </span>
                  <span role="cell" className="hidden text-right tnum md:block">{p.fit_score ?? "—"}</span>
                  <span role="cell" className="col-span-2 row-start-3 truncate text-ink-2 md:col-auto md:row-auto" title={p.subject}>
                    {p.subject}
                  </span>
                  <span role="cell" className="col-start-2 row-start-1 flex items-center justify-end gap-2 md:col-auto md:row-auto">
                    <QueueStatus d={d} />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <ArtifactEmpty pending={[]} noun="message" idle={{ title: "No accounts in the queue", body: "When an account shows a buying trigger, the agent drafts a message and it lands here." }} />
      )}
    </Block>
  );
}

function QueueStatus({ d }: { d: Draft }) {
  if (d.status === "approved")
    return (
      <>
        <span className="hidden items-center gap-1.5 whitespace-nowrap text-[13px] text-accent lg:flex">
          <Dot tone="accent" /> Ready
        </span>
        <CopyButton text={emailText(d)} label="Copy email" />
      </>
    );
  if (d.status === "pending")
    return (
      <L href={inboxHref(d)} className="flex items-center gap-1.5 whitespace-nowrap text-[13px] text-warn hover:underline">
        <Dot tone="warn" /> To review
      </L>
    );
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-[13px] text-ink-3">
      <Dot /> {d.status === "published" ? "Sent" : "Skipped"}
    </span>
  );
}

/* -------------------------------------------------------- creative testing */

const EXP_ORDER = ["running", "draft", "won", "lost"];
const rank = (s: string) => (EXP_ORDER.includes(s) ? EXP_ORDER.indexOf(s) : 99);
const EXP_LABEL: Record<string, string> = { running: "Running", draft: "Not started", won: "Won", lost: "Lost" };

export function ExperimentBoard({ experiments }: { experiments: Experiment[] }) {
  // The same test proposed twice shows once.
  const seen = new Set<string>();
  const list = experiments
    .filter((e) => {
      const k = `${e.status}:${e.name.trim().toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => rank(a.status) - rank(b.status) || +new Date(b.created_at) - +new Date(a.created_at));
  const count = (s: string) => list.filter((e) => e.status === s).length;
  const meta = EXP_ORDER.filter((s) => count(s)).map((s) => `${count(s)} ${EXP_LABEL[s]!.toLowerCase()}`).join(" · ");
  return (
    <Block title="Experiments" meta={meta || null}>
      {list.length ? (
        <ul className={cx(card, "divide-y divide-line overflow-hidden")}>
          {list.map((e) => (
            <li key={e.id} className="grid gap-x-4 gap-y-1 px-5 py-4 sm:grid-cols-[112px_minmax(0,1fr)_auto] sm:items-baseline">
              <span className="flex items-center gap-2 text-[13px] text-ink-2">
                <Dot tone={e.status === "running" || e.status === "won" ? "accent" : e.status === "lost" ? "danger" : "neutral"} />
                {EXP_LABEL[e.status] ?? e.status}
              </span>
              <div className="min-w-0">
                <p className="text-[14px] font-medium">{e.name}</p>
                {e.hypothesis ? <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-2">{e.hypothesis}</p> : null}
              </div>
              <span className="text-[13px] text-ink-3 sm:text-right">
                {e.variants.length ? `${plural(e.variants.length, "variant")} · ` : ""}
                {timeAgo(e.started_at ?? e.created_at)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <ArtifactEmpty pending={[]} noun="test" idle={{ title: "No experiments yet", body: "Approve a batch of hooks and it starts an experiment here." }} />
      )}
    </Block>
  );
}

export function CreativeBatch({ draft }: { draft: Draft | undefined }) {
  if (!draft) return null;
  const p = draft.payload as { offer?: string; hypothesis?: string; angles?: { name: string; insight: string; hooks: string[] }[]; ads?: unknown[] };
  const angles = p.angles ?? [];
  if (!angles.length) return null;
  const status = draft.status === "pending" ? "Waiting for your review" : draft.status === "rejected" ? "Rejected" : "Running as an experiment";
  return (
    <Block
      title="Latest batch"
      meta={
        <L href={inboxHref(draft)} className={cx("hover:text-ink", draft.status === "pending" && "text-warn")}>
          {status} · {timeAgo(draft.created_at)}
        </L>
      }
    >
      {p.offer ? <p className="mb-4 max-w-2xl text-[14px] text-ink-2"><span className="font-medium text-ink">{p.offer.split(":")[0]}.</span> {p.hypothesis}</p> : null}
      <ol className="grid gap-4 lg:grid-cols-2">
        {angles.map((a, ai) => (
          <li key={a.name} className={cx(card, "p-5")}>
            <p className="text-[14px] font-semibold">{a.name}</p>
            <p className="mt-1 text-[13px] text-ink-2">{a.insight}</p>
            <ol className="mt-4 space-y-2.5">
              {a.hooks.map((h, hi) => (
                <li key={hi} className="flex gap-3 text-[14px] leading-snug">
                  <span className="w-7 shrink-0 text-[13px] text-ink-3 tnum">{ai + 1}.{hi + 1}</span>
                  <span>{h}</span>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
      {p.ads?.length ? (
        <p className="mt-3 text-[13px] text-ink-3">
          Plus {plural(p.ads.length, "ad concept")} in the full batch.{" "}
          <L href={inboxHref(draft)} className="text-ink-2 underline-offset-2 hover:underline">Open it</L>
        </p>
      ) : null}
    </Block>
  );
}

/* --------------------------------------------------------------- AI search */

type Q = { question: string; status: "covered" | "partial" | "missing"; answer?: string; missing_facts?: string[]; placement?: string };
const COV = { covered: { label: "Covered", tone: "accent" }, partial: { label: "Partial", tone: "warn" }, missing: { label: "Missing", tone: "danger" } } as const;

export function Coverage({ draft }: { draft: Draft | undefined }) {
  const qs = ((draft?.payload as { questions?: Q[] } | undefined)?.questions ?? []).filter((q) => q.question);
  if (!draft || !qs.length)
    return (
      <Block title="Coverage">
        <ArtifactEmpty pending={[]} noun="answer pack" idle={{ title: "No coverage read yet", body: "Run the agent to check which buyer questions your facts can answer." }} />
      </Block>
    );
  const n = { covered: 0, partial: 0, missing: 0 };
  for (const q of qs) n[q.status] = (n[q.status] ?? 0) + 1;
  const score = Math.round(((n.covered + 0.5 * n.partial) / qs.length) * 100);
  const order = { missing: 0, partial: 1, covered: 2 } as const;
  const sorted = [...qs].sort((a, b) => order[a.status] - order[b.status]);
  return (
    <>
      <section className={cx(card, "mb-12 grid gap-6 p-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-10 sm:p-8")}>
        <div>
          <p className="text-[52px] font-semibold leading-none tracking-[-0.03em] tnum">
            {score}
            <span className="text-[28px] text-ink-3">%</span>
          </p>
          <p className="mt-2 text-[13px] text-ink-3">Visibility score</p>
        </div>
        <div>
          <p className="max-w-md text-[14px] text-ink-2">
            How much of what buyers ask AI assistants your published facts can answer. Partial answers count half.
          </p>
          <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-subtle" aria-hidden>
            <div className="bg-accent" style={{ width: `${(n.covered / qs.length) * 100}%` }} />
            <div className="bg-warn" style={{ width: `${(n.partial / qs.length) * 100}%` }} />
          </div>
          <p className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-3 tnum">
            <span className="flex items-center gap-1.5"><Dot tone="accent" /> {n.covered} covered</span>
            <span className="flex items-center gap-1.5"><Dot tone="warn" /> {n.partial} partial</span>
            <span className="flex items-center gap-1.5"><span className="inline-block size-1.5 rounded-full bg-line-strong" /> {n.missing} missing</span>
          </p>
        </div>
      </section>
      <Block
        title="Buyer questions"
        meta={
          <L href={inboxHref(draft)} className={cx("hover:text-ink", draft.status === "pending" && "text-warn")}>
            {draft.status === "pending" ? "Answer pack waiting for review" : "From the answer pack"} · {timeAgo(draft.created_at)}
          </L>
        }
      >
        <ul className={cx(card, "divide-y divide-line overflow-hidden")}>
          {sorted.map((q, i) => {
            const c = COV[q.status];
            return (
              <li key={i}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-3.5 transition-colors hover:bg-subtle [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0 flex-1 text-[14px]">{q.question}</span>
                    <Badge tone={c.tone}>{c.label}</Badge>
                    <ChevronDown size={14} aria-hidden className="shrink-0 text-ink-3 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
                  </summary>
                  <div className="space-y-2 px-5 pb-4 text-[14px] text-ink-2">
                    {q.answer ? <p className="leading-relaxed">{q.answer}</p> : <p className="text-ink-3">Your facts don&rsquo;t answer this yet.</p>}
                    {q.missing_facts?.length ? (
                      <p className="text-[13px]">
                        <span className="text-ink-3">Facts to add: </span>
                        {q.missing_facts.join("; ")}
                      </p>
                    ) : null}
                    {q.placement ? <p className="text-[13px] text-ink-3">Put it: {q.placement}</p> : null}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      </Block>
    </>
  );
}

/* ---------------------------------------------------------- growth cockpit */

export function AngleChart({ angles, days }: { angles: ({ angle: string } & Record<string, number>)[]; days: number }) {
  const rows = angles.filter((a) => a.angle && a.angle !== "(none)").sort((a, b) => (b.demo_request ?? 0) - (a.demo_request ?? 0) || (b.click ?? 0) - (a.click ?? 0));
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((a) => a.click ?? 0));
  return (
    <Block
      title="Angles"
      meta={
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>Last {days} days</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-line-strong" /> Clicks</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-accent" /> Demo requests</span>
        </span>
      }
    >
      <ul className={cx(card, "divide-y divide-line")}>
        {rows.map((a) => {
          const clicks = a.click ?? 0;
          const demos = a.demo_request ?? 0;
          const replies = a.qualified_reply ?? 0;
          return (
            <li key={a.angle} className="grid gap-2.5 px-5 py-4 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto] sm:items-center sm:gap-6">
              <span className="truncate text-[14px] font-medium" title={a.angle}>{a.angle}</span>
              <div className="space-y-1" aria-hidden>
                <div className="h-1.5 rounded-full bg-line-strong" style={{ width: `${(clicks / max) * 100}%` }} />
                <div className="h-1.5 rounded-full bg-accent" style={{ width: `${Math.max((demos / max) * 100, demos ? 1.5 : 0)}%` }} />
              </div>
              <div className="flex items-baseline justify-between gap-4 text-[13px] text-ink-3 tnum sm:justify-end">
                <span>
                  {plural(clicks, "click")} · {plural(demos, "demo")} · {plural(replies, "reply", "replies")}
                </span>
                <span className="w-24 text-right">
                  <span className="text-[14px] font-medium text-ink">{clicks ? `${((demos / clicks) * 100).toFixed(1)}%` : "—"}</span>
                  <span className="sr-only"> click to demo</span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-right text-[13px] text-ink-3">Rate is demo requests per click.</p>
    </Block>
  );
}

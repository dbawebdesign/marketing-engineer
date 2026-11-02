import { ArrowRight, ChevronDown, Pencil } from "lucide-react";
import { needsLine } from "@/lib/next-step";
import type { Draft } from "@/server/services/drafts";
import type { Experiment } from "@/server/services/experiments";
import { L } from "./nav";
import { ReceiptMarkdown } from "./receipt-markdown";
import { CopyButton } from "./copy-button";
import { DraftPreview } from "./draft-preview";
import { DemoButton } from "./demo-button";
import { ExperimentActions } from "./experiment-actions";
import { metaOf } from "@/lib/draft-meta";
import { fmtScore } from "@/lib/experiment-results";
import { splitSummary } from "@/lib/answer-summary";
import { Badge, Dot, buttonClass, cx, plural, timeAgo } from "./ui";

/* ------------------------------------------------------------------ shared */

/** A page block. Sentence-case heading plus quiet meta: the only two label styles on system pages. */
export function Block({ title, meta, children, className }: { title?: React.ReactNode; meta?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx("mb-12", className)}>
      {title || meta ? (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          {title ? <h2 className="text-[14px] font-semibold text-ink">{title}</h2> : <span />}
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

/** Drafts of a system waiting for review, as a filtered inbox link. */
export const systemInboxHref = (slug: string, d?: { id: string }) => `/inbox?system=${slug}${d ? `&d=${d.id}` : ""}`;

const NOUN: Record<string, [string, string?]> = {
  market_memo: ["memo"],
  cockpit_memo: ["brief"],
  post: ["post"],
  asset_idea: ["asset idea"],
  outbound_message: ["message"],
  creative_batch: ["batch", "batches"],
  ai_answer_pack: ["answer pack"],
};

/**
 * "Waiting for review": the one waiting pattern on every system and agent page. A short list of
 * the waiting drafts (title, age), each opening in the inbox filtered to this system.
 * `preview` shows the first draft in full instead, with the waiting line as its header, only
 * where the page has nothing else showing it (a truth file or brief before the first approval).
 */
export function PendingBlock({ drafts, slug, preview = false }: { drafts: Draft[]; slug: string; preview?: boolean }) {
  if (!drafts.length) return null;
  const types = new Set(drafts.map((d) => d.type));
  const noun = types.size === 1 ? (NOUN[drafts[0]!.type] ?? ["draft"]) : (["draft"] as [string]);
  const first = drafts[0]!;
  if (preview)
    return (
      <section className="mb-12" data-pending-block>
        <DraftPreview
          title={first.title}
          body={first.body}
          meta={metaOf(first.payload)}
          createdAt={first.created_at}
          sample={!!first.is_sample}
          href={systemInboxHref(slug, first)}
          label="Waiting for review"
          more={drafts.length - 1}
        />
      </section>
    );
  const LIMIT = 5;
  const rows = drafts.slice(0, LIMIT);
  return (
    <Block
      title="Waiting for review"
      meta={
        <L href={systemInboxHref(slug, first)} className="flex items-center gap-1 hover:text-ink">
          {plural(drafts.length, noun[0], noun[1])} · Review all <ArrowRight size={13} aria-hidden />
        </L>
      }
    >
      <ul className={cx(card, "divide-y divide-line overflow-hidden")} data-pending-block>
        {rows.map((d) => (
          <li key={d.id}>
            <L href={systemInboxHref(slug, d)} className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-subtle">
              <Dot tone="warn" />
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{d.title}</span>
              <span className="shrink-0 text-[13px] text-ink-3 tnum">{timeAgo(d.created_at)}</span>
              <ArrowRight size={14} className="shrink-0 text-ink-3 group-hover:text-ink" aria-hidden />
            </L>
          </li>
        ))}
      </ul>
    </Block>
  );
}

/** The empty state for an artifact: one compact line, not a tall box. */
export function ArtifactEmpty({ idle }: { idle: { title: string; body: string } }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong px-5 py-4">
      <p className="text-[14px] font-medium text-ink">{idle.title}</p>
      <p className="mt-0.5 text-[13px] text-ink-2">{idle.body}</p>
    </div>
  );
}

/**
 * An agent-kept document, document first. When there's no document yet, the pending
 * draft (if any) previews in its place.
 */
export function DocView({
  doc,
  title,
  pending,
  slug,
  idle,
  updated,
  receipts = [],
  editHref,
}: {
  doc: { content: string; version: number; updated_at: string } | null;
  title: string;
  pending: Draft[];
  slug: string;
  idle: { title: string; body: string };
  /** "Updated Nov 2 · Approved by Maya". */
  updated?: string | null;
  /** The evidence behind the doc: its quotes open their signals. */
  receipts?: { signal_id: string; quote: string }[];
  /** Where to edit the document by hand, when the viewer may. */
  editHref?: string | null;
}) {
  const has = !!doc?.content.trim();
  return (
    <>
      <PendingBlock drafts={pending} slug={slug} preview={!has} />
      {has || !pending.length ? (
        <Block
          title={title}
          meta={
            has ? (
              <span className="flex items-center gap-3">
                <span className="tnum">{updated}</span>
                {editHref ? (
                  <L href={editHref} className={buttonClass("secondary", "sm")}>
                    <Pencil size={13} aria-hidden /> Edit
                  </L>
                ) : null}
              </span>
            ) : null
          }
        >
          {has ? (
            <div className={cx(card, "p-6 sm:p-8")}>
              <ReceiptMarkdown receipts={receipts}>{doc!.content}</ReceiptMarkdown>
            </div>
          ) : (
            <ArtifactEmpty idle={idle} />
          )}
        </Block>
      ) : null}
    </>
  );
}

/**
 * Everything the agent drafted that's already been decided, identical titles collapsed.
 * Pending drafts live in the inbox line above; drafts the page shows in full stay out.
 */
export function DraftsList({ drafts, hide = [], slug }: { drafts: Draft[]; /** Drafts the page already shows in full. */ hide?: string[]; slug: string }) {
  const hidden = new Set(hide);
  const groups: { d: Draft; earlier: number }[] = [];
  const seen = new Map<string, number>();
  for (const d of drafts) {
    if (d.status === "pending" || hidden.has(d.id)) continue;
    const k = d.title.trim().toLowerCase();
    const i = seen.get(k);
    if (i === undefined) {
      seen.set(k, groups.length);
      groups.push({ d, earlier: 0 });
    } else groups[i]!.earlier++;
  }
  if (!groups.length) return null;
  const rows = groups.slice(0, 5);
  return (
    <Block title="Recent drafts" meta={groups.length > rows.length ? <L href={`/inbox?tab=approved&system=${slug}`} className="hover:text-ink">See all in Inbox</L> : null}>
      <ul className={cx(card, "divide-y divide-line overflow-hidden")}>
        {rows.map(({ d, earlier }) => {
          const s = STATUS[d.status];
          return (
            <li key={d.id}>
              <L href={inboxHref(d)} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-subtle">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">{d.title}</p>
                  <p className="text-[13px] text-ink-3">
                    {timeAgo(d.reviewed_at ?? d.created_at)}
                    {earlier ? ` · +${plural(earlier, "earlier version")}` : ""}
                  </p>
                </div>
                <Badge tone={s.tone}>{s.label}</Badge>
              </L>
            </li>
          );
        })}
      </ul>
    </Block>
  );
}

/* --------------------------------------------------------- founder content */

const postText = (d: Draft) => {
  const p = d.payload as { platform?: string; text?: string };
  return { platform: p.platform === "x" ? "X" : "LinkedIn", text: p.text ?? d.body.split("\n---\n")[0] ?? "" };
};

export function PostsLibrary({ drafts }: { drafts: Draft[] }) {
  const posts = drafts.filter((d) => d.type === "post");
  const approved = posts.filter((d) => d.status === "approved" || d.status === "published");
  // Nothing approved yet but posts are waiting: the waiting list above says it all.
  if (!approved.length && posts.some((d) => d.status === "pending")) return null;
  return (
    <Block title="Approved posts" meta={approved.length ? plural(approved.length, "post") : null}>
      {approved.length ? (
        <ul className="grid gap-4 sm:grid-cols-2">
          {approved.map((d) => {
            const { platform, text } = postText(d);
            return (
              <li key={d.id} className={cx(card, "flex flex-col p-5")}>
                <p className="mb-2.5 text-[13px] text-ink-3">{platform}</p>
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
      ) : (
        <ArtifactEmpty idle={{ title: "No approved posts yet", body: "Approve a post in your inbox and it lands here, ready to copy." }} />
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
  const email = top.replace(/^\**Subject:\**.*\n+/i, "").trim();
  return `Subject: ${p.subject ?? ""}\n\n${email}`;
}

export function OutboundQueue({ drafts }: { drafts: Draft[] }) {
  // One order everywhere: best fit first, then newest.
  const fit = (d: Draft) => Number((d.payload as { fit_score?: number }).fit_score ?? -1);
  const rows = drafts.filter((d) => d.type === "outbound_message").sort((a, b) => fit(b) - fit(a) || +new Date(b.created_at) - +new Date(a.created_at));
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
        <ArtifactEmpty idle={{ title: "No accounts in the queue", body: "When an account shows a buying trigger, the agent drafts a message and it lands here." }} />
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

/** The angle a queued test is about: what Hook lab writes hooks for. */
export const testAngle = (e: Pick<Experiment, "variants" | "hypothesis" | "name">) => {
  const v = e.variants[0];
  return (v?.angle ?? v?.label ?? "").trim() || (e.hypothesis ? `${e.name}: ${e.hypothesis}` : e.name);
};

/** The deciding metric per arm, leader first. Quiet when nothing's been measured yet. */
function ExperimentResults({ e }: { e: Experiment }) {
  const r = e.results;
  if (!r) return null;
  const arms = [...r.arms].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.clicks - a.clicks);
  const max = Math.max(...arms.map((a) => a.score ?? 0)) || 1;
  if (!r.measured)
    return (
      <p className="mt-2 text-[13px] text-ink-3" data-experiment-results>
        No results yet. Decided by {r.unit}, from metric events tagged with{" "}
        <span className="text-ink-2">{arms.map((a) => a.label).join(" · ")}</span>
      </p>
    );
  return (
    <div className="mt-3 max-w-xl" data-experiment-results>
      <p className="mb-1.5 text-[13px] text-ink-3">Decided by {r.unit}</p>
      <ul className="space-y-1.5">
        {arms.map((a) => {
          const lead = r.leader?.key === a.key;
          return (
            <li key={a.key} className="grid grid-cols-[minmax(0,1fr)_44px] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)_44px]">
              <span className={cx("truncate text-[13px]", lead ? "font-medium text-ink" : "text-ink-2")} title={`${a.label} · ${plural(a.variants.length, "variant")}`}>
                {a.label}
              </span>
              <span className="order-3 col-span-2 h-1.5 overflow-hidden rounded-full bg-line sm:order-none sm:col-span-1" aria-hidden>
                <span className={cx("block h-full rounded-full", lead ? "bg-accent" : "bg-ink-3/50")} style={{ width: `${a.score ? Math.max((a.score / max) * 100, 2) : 0}%` }} />
              </span>
              <span className="text-right text-[13px] tnum" title={`${plural(a.clicks, "click")}${r.kind !== "click" ? ` · ${a.hits} ${r.kind.replace(/_/g, " ")}` : ""}`}>
                {fmtScore(a.score, r.kind)}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-1.5 text-[13px] text-ink-3 tnum">
        {plural(arms.reduce((n, a) => n + a.clicks, 0), "click")} {e.status === "running" ? "since it started" : "while it ran"}
      </p>
    </div>
  );
}

/** The queued test whose next move (start it, or write its hooks) is the page's one primary action, if any. */
export function primaryTest(experiments: Experiment[], can: { write: boolean; run: boolean; hookLab: boolean }) {
  return (
    experiments
      .filter((e) => e.status === "draft" && (e.variants.length >= 2 ? can.write : can.run && can.hookLab))
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0]?.id ?? null
  );
}

export function ExperimentBoard({
  experiments,
  hookLab,
  canWrite = false,
  canRun = false,
  primaryId = null,
}: {
  experiments: Experiment[];
  /** The agent that writes hooks for a test, when this workspace has one. */
  hookLab?: { id: string; name: string } | null;
  canWrite?: boolean;
  canRun?: boolean;
  /** The one test whose next move is the page's primary action; every other control stays quiet. */
  primaryId?: string | null;
}) {
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
                <ExperimentResults e={e} />
                {(canWrite || (canRun && hookLab)) && (e.status === "draft" || e.status === "running") ? (
                  <ExperimentActions
                    id={e.id}
                    name={e.name}
                    status={e.status}
                    variants={e.variants.length}
                    results={e.results}
                    canWrite={canWrite}
                    quiet={e.id !== primaryId}
                    hookLab={canRun && hookLab && e.status === "draft" ? { id: hookLab.id, name: hookLab.name, offer: testAngle(e) } : null}
                  />
                ) : null}
              </div>
              <span className="text-[13px] text-ink-3 sm:text-right">
                {e.variants.length ? `${plural(e.variants.length, "variant")} · ` : ""}
                {e.status === "draft" ? `queued ${timeAgo(e.created_at)}` : e.status === "running" ? `started ${timeAgo(e.started_at ?? e.created_at)}` : timeAgo(e.started_at ?? e.created_at)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <ArtifactEmpty idle={{ title: "No experiments yet", body: "Approve a market memo or a batch of hooks and its test shows up here." }} />
      )}
    </Block>
  );
}

export function CreativeBatch({ draft }: { draft: Draft | undefined }) {
  if (!draft) return null;
  const p = draft.payload as { offer?: string; hypothesis?: string; angles?: { name: string; insight: string; hooks: string[] }[]; ads?: unknown[] };
  const angles = p.angles ?? [];
  if (!angles.length) return null;
  // The waiting line above already says it's pending; here it's just a way in.
  const status = draft.status === "pending" ? "Pending review" : draft.status === "rejected" ? "Rejected" : "Running as an experiment";
  return (
    <Block
      title="Latest batch"
      meta={
        draft.status === "pending" ? (
          <span>{status} · {timeAgo(draft.created_at)}</span>
        ) : (
          <L href={inboxHref(draft)} className="hover:text-ink">
            {status} · {timeAgo(draft.created_at)}
          </L>
        )
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
          Plus {plural(p.ads.length, "ad concept")} in the full batch.
          {draft.status !== "pending" ? (
            <>
              {" "}
              <L href={inboxHref(draft)} className="text-ink-2 underline-offset-2 hover:underline">Open it</L>
            </>
          ) : null}
        </p>
      ) : null}
    </Block>
  );
}

/* --------------------------------------------------------------- AI search */

type Q = { question: string; status: "covered" | "partial" | "missing"; answer?: string; missing_facts?: string[]; placement?: string };
const COV = { covered: { label: "Covered", tone: "accent" }, partial: { label: "Partial", tone: "warn" }, missing: { label: "Missing", tone: "danger" } } as const;

const questionsOf = (d: Draft | undefined) => ((d?.payload as { questions?: Q[] } | undefined)?.questions ?? []).filter((q) => q.question);

/** "Pending review": its own neutral, striped chip, so it never reads as a coverage colour. */
function PendingChip({ className }: { className?: string }) {
  return (
    <span
      className={cx("inline-flex h-5 items-center rounded-md px-1.5 text-[12px] font-medium text-ink-2 ring-1 ring-line-strong", className)}
      style={{ backgroundImage: "repeating-linear-gradient(135deg, var(--subtle) 0 4px, transparent 4px 8px)" }}
    >
      Pending review
    </span>
  );
}

/**
 * Fact coverage: how many buyer questions the *approved* answer pack can answer. A pack still
 * waiting for review shows its numbers as provisional until someone approves it.
 */
export function Coverage({ approved, pending }: { approved: Draft | undefined; pending: Draft | undefined }) {
  const draft = approved ?? pending;
  const qs = questionsOf(draft);
  if (!draft || !qs.length)
    return (
      <Block title="Coverage">
        <ArtifactEmpty idle={{ title: "No coverage read yet", body: "Run the agent to check which buyer questions your facts can answer." }} />
      </Block>
    );
  const n = { covered: 0, partial: 0, missing: 0 };
  for (const q of qs) n[q.status] = (n[q.status] ?? 0) + 1;
  const provisional = !approved;
  const order = { missing: 0, partial: 1, covered: 2 } as const;
  const sorted = [...qs].sort((a, b) => order[a.status] - order[b.status]);
  const { summary, rest } = splitSummary(sorted.map((q) => q.answer ?? ""));
  return (
    <>
      <section className={cx(card, "mb-12 grid gap-6 p-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-10 sm:p-8")} data-coverage>
        <div>
          <p className={cx("text-[44px] font-semibold leading-none tracking-[-0.03em] tnum", provisional && "text-ink-2")}>
            {n.covered}
            <span className="text-[24px] font-medium text-ink-3"> of {qs.length}</span>
          </p>
          <p className="mt-2 text-[13px] text-ink-3">buyer questions covered</p>
        </div>
        <div>
          {provisional ? (
            <p className="mb-2 flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
              <PendingChip />
              Provisional — pack not yet approved
            </p>
          ) : null}
          <p className="max-w-md text-[14px] text-ink-2">
            {provisional
              ? "Questions buyers ask AI assistants that this pack\u2019s facts can fully answer. It counts once you approve it."
              : `Questions buyers ask AI assistants that your approved facts can fully answer.${pending ? " A newer pack is pending review." : ""}`}
          </p>
          <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-subtle" aria-hidden>
            <div className={provisional ? "bg-accent/60" : "bg-accent"} style={{ width: `${(n.covered / qs.length) * 100}%` }} />
            <div className={provisional ? "bg-warn/60" : "bg-warn"} style={{ width: `${(n.partial / qs.length) * 100}%` }} />
          </div>
          <p className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-3 tnum">
            <span className="flex items-center gap-1.5"><Dot tone="accent" /> {n.covered} covered</span>
            <span className="flex items-center gap-1.5"><Dot tone="warn" /> {n.partial} partial</span>
            <span className="flex items-center gap-1.5"><span className="inline-block size-1.5 rounded-full bg-line-strong" /> {n.missing} missing</span>
          </p>
          <p className="mt-3 text-[13px] text-ink-3">Not yet measured in AI assistants.</p>
        </div>
      </section>
      <Block
        title="Buyer questions"
        meta={
          draft.status === "pending" ? (
            <span className="flex items-center gap-2">
              <PendingChip /> {timeAgo(draft.created_at)}
            </span>
          ) : (
            <L href={inboxHref(draft)} className="hover:text-ink">
              From the approved answer pack · {timeAgo(draft.reviewed_at ?? draft.created_at)}
            </L>
          )
        }
      >
        {summary ? (
          <div className={cx(card, "mb-3 px-5 py-4")} data-company-summary>
            <p className="text-[13px] font-medium text-ink-3">Company summary</p>
            <p className="mt-1 max-w-[68ch] text-[14px] leading-relaxed text-ink-2">{summary}</p>
            <p className="mt-1.5 text-[12.5px] text-ink-3">Every answer opens with this. Below, only what each answer adds.</p>
          </div>
        ) : null}
        <ul className={cx(card, "divide-y divide-line overflow-hidden")}>
          {sorted.map((q, i) => {
            const c = COV[q.status];
            const own = summary ? rest[i] : q.answer;
            return (
              <li key={i}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-3.5 transition-colors hover:bg-subtle [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0 flex-1 text-[14px]">{q.question}</span>
                    <Badge tone={c.tone}>{c.label}</Badge>
                    <ChevronDown size={14} aria-hidden className="shrink-0 text-ink-3 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
                  </summary>
                  <div className="space-y-2 px-5 pb-4 text-[14px] text-ink-2">
                    {own ? (
                      <p className="leading-relaxed">{own}</p>
                    ) : q.answer ? (
                      <p className="text-ink-3">The company summary answers this on its own.</p>
                    ) : (
                      <p className="text-ink-3">Your facts don&rsquo;t answer this yet.</p>
                    )}
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
  const rate = (a: Record<string, number>) => ((a.click ?? 0) ? ((a.demo_request ?? 0) / a.click!) * 100 : 0);
  const rows = angles
    .filter((a) => a.angle && a.angle !== "(none)")
    .sort((a, b) => rate(b) - rate(a) || (b.demo_request ?? 0) - (a.demo_request ?? 0) || (b.click ?? 0) - (a.click ?? 0));
  if (!rows.length) return null;
  // One shared scale: the best rate fills the track.
  const max = Math.max(...rows.map(rate)) || 1;
  return (
    <Block title="Angles" meta={`Demo requests per 100 clicks · last ${days} days`}>
      <ul className={cx(card, "divide-y divide-line")}>
        {rows.map((a) => {
          const clicks = a.click ?? 0;
          const demos = a.demo_request ?? 0;
          const replies = a.qualified_reply ?? 0;
          const r = rate(a);
          return (
            <li key={a.angle} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)_56px_minmax(0,210px)] sm:gap-x-5">
              <span className="truncate text-[14px] font-medium" title={a.angle}>{a.angle}</span>
              <span className="text-right text-[14px] font-medium text-ink tnum sm:order-3">
                {clicks ? r.toFixed(1) : "—"}
                <span className="sr-only"> demo requests per 100 clicks</span>
              </span>
              <div className="col-span-2 h-2 overflow-hidden rounded-full bg-line sm:order-2 sm:col-span-1" aria-hidden>
                <div className="h-full rounded-full bg-accent" style={{ width: `${clicks ? Math.max((r / max) * 100, r ? 2 : 0) : 0}%` }} />
              </div>
              <span className="col-span-2 text-[13px] text-ink-3 tnum sm:order-4 sm:col-span-1 sm:text-right">
                {plural(clicks, "click")} · {plural(demos, "demo")} · {plural(replies, "reply", "replies")}
              </span>
            </li>
          );
        })}
      </ul>
    </Block>
  );
}

/* ---------------------------------------------------------------- first run */

/**
 * Before an agent has made anything: what it will make and what it needs, in place of empty
 * artifact views. The Run (or Add signals) control lives in the page header, as on every system page.
 */
export function FirstRun({
  agentName,
  readiness,
  noun,
  promise,
  canLoadSamples,
}: {
  agentName: string;
  readiness: { signals: number; need: number; days: number; ready: boolean; reads: "signals" | "metrics"; reason?: string | null } | null;
  noun: string;
  /** What the agent turns signals into, one sentence. */
  promise: string;
  canLoadSamples: boolean;
}) {
  const ready = !readiness || readiness.ready;
  const n = readiness?.signals ?? 0;
  return (
    <section className="mb-12 rounded-xl border border-dashed border-line-strong px-6 py-8 sm:px-8">
      <div className="max-w-lg">
        <h2 className="text-[14px] font-semibold text-ink">
          {ready ? `Ready to draft its first ${noun}` : `Give ${agentName} something to read`}
        </h2>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-2">
          {promise}{" "}
          {ready
            ? `It has ${plural(n, "signal")} from the last ${readiness?.days ?? 7} days to work from. Run it, then approve what it drafts.`
            : // Exactly what this agent reads and what's missing, from its own readiness.
              readiness!.reads === "metrics"
              ? "Send metric events tagged by angle from your stack with an API key, then run it."
              : `${agentName} ${(needsLine({ ...readiness!, reason: readiness!.reason ?? null }) ?? "Needs more to read").replace(/^Needs/, "needs")}. ${/still empty/.test(readiness!.reason ?? "") ? "Fill that in on Memory" : "Add that on Signals"}, then run it.`}
        </p>
        {canLoadSamples ? (
          <div className="mt-5">
            <DemoButton />
          </div>
        ) : null}
      </div>
    </section>
  );
}

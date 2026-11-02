"use client";
import { useId, useState } from "react";
import { ArrowRight } from "lucide-react";
import { L } from "./nav";
import { Markdown } from "./markdown";
import { DraftMetaRow, SampleTag } from "./draft-meta";
import { Dot, buttonClass, cx, timeAgo } from "./ui";

const LINES = 12;

/** Drop a leading H1 that just repeats the draft title. */
function bodyOf(title: string, body: string) {
  const lines = body.replace(/^\s+/, "").split("\n");
  if (/^#\s/.test(lines[0] ?? "")) {
    const h = lines[0]!.replace(/^#\s+/, "").trim().toLowerCase();
    const t = title.trim().toLowerCase();
    if (h === t || t.includes(h) || h.includes(t)) lines.shift();
  }
  return lines.join("\n").replace(/^\s+/, "");
}

/**
 * A pending draft, previewed in place: title and the first lines, fading out.
 * "Review in Inbox" is the next action; "Open" reads the rest here.
 */
export function DraftPreview({
  title,
  body,
  createdAt,
  href,
  more = 0,
  label = "Waiting for your review",
  meta,
  quiet = false,
  sample = false,
}: {
  title: string;
  body: string;
  createdAt: string;
  href: string;
  /** Other pending drafts of the same kind. */
  more?: number;
  label?: string;
  /** Quiet facts about the draft, one row under the title. */
  meta?: { label: string; value: string }[];
  /** The page already says it's waiting: no status line, only an optional label. */
  quiet?: boolean;
  /** Built from sample data: a quiet tag beside the title. */
  sample?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const text = bodyOf(title, body);
  const lines = text.split("\n");
  const long = lines.length > LINES;
  const shown = open || !long ? text : lines.slice(0, LINES).join("\n");
  return (
    <section className="mb-4 overflow-hidden rounded-2xl bg-surface ring-1 ring-line" aria-labelledby={`${id}-t`}>
      <div className="px-6 pt-5 sm:px-8 sm:pt-6">
        {quiet ? (
          label !== "Waiting for your review" ? <p className="text-[13px] text-ink-3">{label}</p> : null
        ) : (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-3">
          <Dot tone="warn" />
          <span className="font-medium text-warn">{label}</span>
          <span aria-hidden>·</span>
          <span>{timeAgo(createdAt)}</span>
          {more ? (
            <>
              <span aria-hidden>·</span>
              <span>{more} more in Inbox</span>
            </>
          ) : null}
        </p>
        )}
        <h3 id={`${id}-t`} className={cx("text-[17px] font-semibold tracking-[-0.01em] text-ink text-pretty", (!quiet || label !== "Waiting for your review") && "mt-2")}>
          {title}
          {sample ? <SampleTag className="ml-2 align-[2px]" /> : null}
        </h3>
        <DraftMetaRow meta={meta} className="mt-1" />
      </div>
      <div
        id={`${id}-b`}
        className={cx(
          "relative px-6 pt-3 sm:px-8",
          long && !open && "max-h-[340px] overflow-hidden [mask-image:linear-gradient(to_bottom,#000_55%,transparent)]",
        )}
      >
        <Markdown>{shown}</Markdown>
      </div>
      <div className="flex items-center gap-2 px-6 pb-5 pt-4 sm:px-8 sm:pb-6">
        <L href={href} className={buttonClass("primary", "sm")}>
          Review in Inbox <ArrowRight size={14} aria-hidden />
        </L>
        {long ? (
          <button type="button" className={buttonClass("ghost", "sm")} aria-expanded={open} aria-controls={`${id}-b`} onClick={() => setOpen((o) => !o)}>
            {open ? "Collapse" : "Open"}
          </button>
        ) : null}
      </div>
    </section>
  );
}

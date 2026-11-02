import { cx } from "./ui";

/** A draft's quiet facts as one row: label in grey, value a step darker. No separators to strand at a wrap. */
export function DraftMetaRow({ meta, className }: { meta?: { label: string; value: string }[]; className?: string }) {
  if (!meta?.length) return null;
  return (
    <p data-draft-meta className={cx("flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-[13px] text-ink-3", className)}>
      {meta.map((m, i) => (
        <span key={`${m.label}:${i}`} className="min-w-0">
          {m.label} <span className="text-ink-2">{m.value}</span>
        </span>
      ))}
    </p>
  );
}

/** Marks a draft built from sample data. Deliberately quiet: a hairline pill in the faintest ink. */
export function SampleTag({ className }: { className?: string }) {
  return (
    <span
      data-sample-tag
      title="Built from sample data: Dispatchly, a made-up HVAC company"
      className={cx("inline-flex h-[17px] items-center rounded px-1.5 text-[11px] font-medium leading-none text-ink-3 ring-1 ring-inset ring-line-strong", className)}
    >
      Sample
    </span>
  );
}

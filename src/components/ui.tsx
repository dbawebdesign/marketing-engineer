import { clsx } from "clsx";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

export const cx = clsx;

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" };

export function buttonClass(variant: BtnProps["variant"] = "secondary", size: BtnProps["size"] = "md") {
  return cx(
    "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-[background,color,box-shadow,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
    size === "sm" ? "h-8 px-3 text-[13px]" : "h-9 px-3.5 text-sm",
    variant === "primary" && "bg-ink text-bg hover:bg-ink/85 shadow-soft",
    variant === "secondary" && "bg-surface text-ink ring-1 ring-line-strong hover:bg-subtle",
    variant === "ghost" && "text-ink-2 hover:bg-subtle hover:text-ink",
    variant === "danger" && "bg-surface text-danger ring-1 ring-line-strong hover:bg-danger-soft",
  );
}

export function Button({ variant, size, className, ...p }: BtnProps) {
  return <button className={cx(buttonClass(variant, size), className)} {...p} />;
}

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "h-10 w-full rounded-lg bg-surface px-3 text-[15px] text-ink ring-1 ring-line-strong placeholder:text-ink-3 transition-shadow focus:outline-none focus:ring-2 focus:ring-accent",
        className,
      )}
      {...p}
    />
  );
}

export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cx(
        "w-full resize-y rounded-lg bg-surface px-3 py-2.5 text-[15px] leading-relaxed text-ink ring-1 ring-line-strong placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent",
        className,
      )}
      {...p}
    />
  );
}

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <span className="mb-1.5 flex items-baseline justify-between text-[13px] font-medium text-ink-2">
      {children}
      {hint ? <span className="font-normal text-ink-3">{hint}</span> : null}
    </span>
  );
}

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "accent" | "warn" | "danger"; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium tnum",
        tone === "neutral" && "bg-subtle text-ink-2",
        tone === "accent" && "bg-accent-soft text-accent",
        tone === "warn" && "bg-warn-soft text-warn",
        tone === "danger" && "bg-danger-soft text-danger",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-surface px-1 font-mono text-[11px] text-ink-3">{children}</kbd>;
}

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
        {sub ? <p className="mt-1 max-w-2xl text-[15px] text-ink-2">{sub}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Section({ title, aside, children, className }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("mb-10", className)}>
      {title ? (
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.07em] text-ink-3">{title}</h2>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-ink-3">{icon}</div> : null}
      <p className="font-medium text-ink">{title}</p>
      {children ? <p className="mt-1 max-w-sm text-sm text-ink-2">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Dot({ tone = "neutral", pulse }: { tone?: "neutral" | "accent" | "warn" | "danger"; pulse?: boolean }) {
  return (
    <span
      className={cx(
        "inline-block size-1.5 shrink-0 rounded-full",
        tone === "neutral" && "bg-ink-3",
        tone === "accent" && "bg-accent",
        tone === "warn" && "bg-warn",
        tone === "danger" && "bg-danger",
        pulse && "pulse-dot",
      )}
    />
  );
}

export function timeAgo(d: string | Date | null | undefined) {
  if (!d) return "";
  const t = typeof d === "string" ? new Date(d) : d;
  const s = Math.round((Date.now() - t.getTime()) / 1000);
  if (s < 0) {
    const f = -s;
    if (f < 3600) return `in ${Math.max(1, Math.round(f / 60))}m`;
    if (f < 86400) return `in ${Math.round(f / 3600)}h`;
    return `in ${Math.round(f / 86400)}d`;
  }
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d ago`;
  return t.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

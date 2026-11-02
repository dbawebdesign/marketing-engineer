"use client";
import Link, { type LinkProps } from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type AnchorHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Bot, Ellipsis, FlaskConical, Gauge, Inbox, PenLine, Quote, Radio, ScanSearch, Search, Send, Settings2, Sun, X } from "lucide-react";
import { cx } from "./ui";

/** Base path: "" in the app, "/embed" when rendered inside a host business's iframe. */
const BaseCtx = createContext("");
export const BaseProvider = ({ base, children }: { base: string; children: ReactNode }) => <BaseCtx.Provider value={base}>{children}</BaseCtx.Provider>;
export const useBase = () => useContext(BaseCtx);

export function L({ href, ...p }: Omit<LinkProps, "href"> & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const base = useBase();
  return <Link href={href.startsWith("/") ? base + href : href} {...p} />;
}

const PRIMARY = [
  { href: "/today", label: "Today", icon: Sun },
  { href: "/inbox", label: "Inbox", icon: Inbox, badge: "inbox" as const },
  { href: "/signals", label: "Signals", icon: Radio },
];
const SYSTEMS = [
  { href: "/s/truth", label: "Customer truth", icon: Quote },
  { href: "/s/content", label: "Founder content", icon: PenLine },
  { href: "/s/outbound", label: "Outbound signals", icon: Send },
  { href: "/s/creative", label: "Creative testing", icon: FlaskConical },
  { href: "/s/ai-search", label: "AI search", icon: ScanSearch },
  { href: "/s/cockpit", label: "Growth cockpit", icon: Gauge },
];
const SECONDARY = [
  { href: "/memory", label: "Memory", icon: BookOpen },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

export const NAV_ITEMS = [...PRIMARY, ...SYSTEMS, ...SECONDARY];

function useActive() {
  const base = useBase();
  const path = usePathname();
  return (href: string) => {
    const full = base + href;
    return path === full || path.startsWith(full + "/");
  };
}

function Item({ href, label, icon: Icon, count }: { href: string; label: string; icon: typeof Sun; count?: number }) {
  const base = useBase();
  const active = useActive()(href);
  return (
    <Link
      href={base + href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "group flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors",
        active ? "bg-surface font-medium text-ink shadow-soft ring-1 ring-line" : "text-ink-2 hover:bg-subtle hover:text-ink",
      )}
    >
      <Icon size={15} strokeWidth={active ? 2.1 : 1.8} className={cx("shrink-0", active ? "text-ink" : "text-ink-3 group-hover:text-ink-2")} />
      <span className="truncate">{label}</span>
      {count ? <span className="ml-auto rounded-md bg-accent px-1.5 text-[11px] font-semibold leading-[18px] text-accent-ink tnum">{count}</span> : null}
    </Link>
  );
}

export function SidebarNav({ inboxCount }: { inboxCount: number }) {
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {PRIMARY.map((i) => (
        <Item key={i.href} {...i} count={i.badge ? inboxCount : undefined} />
      ))}
      <p className="mb-1 mt-5 px-2.5 text-[12px] font-medium text-ink-3">Systems</p>
      {SYSTEMS.map((i) => (
        <Item key={i.href} {...i} />
      ))}
      <div className="my-4 h-px bg-line" />
      {SECONDARY.map((i) => (
        <Item key={i.href} {...i} />
      ))}
    </nav>
  );
}

const openPalette = () => window.dispatchEvent(new Event("me:palette"));

/**
 * Compact navigation for small screens and embedded mode: a top bar with the
 * workspace and search, the three daily destinations, and everything else
 * behind More. Below md the destinations sit in a bottom tab bar; from md up
 * they sit inline in the top bar.
 */
export function CompactNav({ inboxCount, workspace }: { inboxCount: number; workspace: ReactNode }) {
  const [more, setMore] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const isActive = useActive();
  const path = usePathname();
  const moreActive = [...SYSTEMS, ...SECONDARY].some((i) => isActive(i.href));

  // Close the sheet when navigation happens.
  useEffect(() => setMore(false), [path]);

  const tabs = (variant: "bar" | "inline") =>
    [...PRIMARY.map((i) => ({ ...i, active: isActive(i.href) })), { href: "", label: "More", icon: Ellipsis, active: moreActive || more }].map((i) => {
      const count = "badge" in i && i.badge ? inboxCount : 0;
      const inner = (
        <>
          <span className="relative">
            <i.icon size={variant === "bar" ? 20 : 15} strokeWidth={i.active ? 2.1 : 1.8} />
            {count && variant === "bar" ? (
              <span className="absolute -right-2.5 -top-1.5 min-w-[17px] rounded-full bg-accent px-1 text-center text-[10.5px] font-semibold leading-[17px] text-accent-ink tnum">{count > 99 ? "99+" : count}</span>
            ) : null}
          </span>
          <span>{i.label}</span>
          {count && variant === "inline" ? <span className="rounded-md bg-accent px-1.5 text-[11px] font-semibold leading-[18px] text-accent-ink tnum">{count}</span> : null}
        </>
      );
      const cls =
        variant === "bar"
          ? cx("flex h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors", i.active ? "text-ink" : "text-ink-3")
          : cx("flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] transition-colors", i.active ? "bg-surface font-medium text-ink ring-1 ring-line" : "text-ink-2 hover:bg-subtle hover:text-ink");
      if (!i.href)
        return (
          <button
            key="more"
            type="button"
            className={cls}
            aria-haspopup="dialog"
            aria-expanded={more}
            onClick={(e) => {
              moreBtn.current = e.currentTarget;
              setMore((m) => !m);
            }}
          >
            {inner}
          </button>
        );
      return (
        <L key={i.href} href={i.href} className={cls} aria-current={i.active ? "page" : undefined} aria-label={count ? `${i.label}, ${count} to review` : undefined}>
          {inner}
        </L>
      );
    });

  return (
    <>
      <div className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="flex h-14 items-center gap-2 px-3">
          <div className="min-w-0 flex-1">{workspace}</div>
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {tabs("inline")}
          </nav>
          <button type="button" onClick={openPalette} aria-label="Search" className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-2 hover:bg-subtle hover:text-ink">
            <Search size={18} />
          </button>
        </div>
      </div>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {tabs("bar")}
      </nav>
      {more ? (
        <MoreSheet
          isActive={isActive}
          onClose={() => {
            setMore(false);
            moreBtn.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}

function MoreSheet({ onClose, isActive }: { onClose: () => void; isActive: (href: string) => boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab" || !panel.current) return;
      const els = [...panel.current.querySelectorAll<HTMLElement>("a,button")];
      const first = els[0];
      const last = els.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const row = (i: (typeof SYSTEMS)[number]) => {
    const active = isActive(i.href);
    return (
      <li key={i.href}>
        <L
          href={i.href}
          onClick={onClose}
          aria-current={active ? "page" : undefined}
          className={cx("flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] transition-colors md:h-9 md:text-[14px]", active ? "bg-subtle font-medium text-ink" : "text-ink-2 hover:bg-subtle hover:text-ink")}
        >
          <i.icon size={17} strokeWidth={1.8} className={active ? "text-ink" : "text-ink-3"} />
          {i.label}
        </L>
      </li>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="animate-in absolute inset-0 bg-black/30 dark:bg-black/50" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="More"
        className="animate-in absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-surface px-3 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-2 shadow-pop ring-1 ring-line md:inset-x-auto md:bottom-auto md:right-3 md:top-16 md:w-72 md:rounded-2xl md:pb-3"
      >
        <div className="mx-auto mb-1 h-1 w-9 rounded-full bg-line-strong md:hidden" aria-hidden />
        <div className="flex items-center justify-between px-3 pb-1 pt-2">
          <p className="text-[13px] font-medium text-ink-3">Systems</p>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-subtle hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <ul>{SYSTEMS.map(row)}</ul>
        <div className="mx-3 my-2 h-px bg-line" />
        <ul>{SECONDARY.map(row)}</ul>
      </div>
    </div>,
    document.body,
  );
}

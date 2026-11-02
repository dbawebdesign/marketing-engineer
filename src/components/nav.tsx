"use client";
import Link, { type LinkProps } from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode, type AnchorHTMLAttributes } from "react";
import { BookOpen, Bot, FlaskConical, Gauge, Inbox, PenLine, Quote, Radio, ScanSearch, Send, Settings2, Sun } from "lucide-react";
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

function Item({ href, label, icon: Icon, count }: { href: string; label: string; icon: typeof Sun; count?: number }) {
  const base = useBase();
  const path = usePathname();
  const full = base + href;
  const active = path === full || path.startsWith(full + "/");
  return (
    <Link
      href={full}
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
      <p className="mb-1 mt-5 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Systems</p>
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

/** Compact horizontal nav for small screens and embedded mode. */
export function TopNav({ inboxCount }: { inboxCount: number }) {
  const base = useBase();
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none]" aria-label="Main">
      {NAV_ITEMS.map((i) => {
        const full = base + i.href;
        const active = path === full || path.startsWith(full + "/");
        return (
          <Link
            key={i.href}
            href={full}
            className={cx("flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px]", active ? "bg-surface font-medium text-ink ring-1 ring-line" : "text-ink-2")}
          >
            <i.icon size={14} />
            {i.label}
            {"badge" in i && inboxCount ? <span className="rounded bg-accent px-1 text-[11px] font-semibold text-accent-ink">{inboxCount}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, LogOut } from "lucide-react";
import { switchTenantAction } from "@/app/(app)/actions";
import { logoutAction } from "@/app/(auth)/actions";
import { Logo } from "./logo";
import { cx } from "./ui";

export function WorkspaceMenu({
  current,
  tenants,
  user,
  compact,
}: {
  current: { id: string; name: string };
  tenants: { id: string; name: string }[];
  user: { name: string; email: string };
  /** Top-bar variant: sized to its content instead of the sidebar's width. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const router = useRouter();
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={cx("relative", compact && "inline-block max-w-full")}>
      <button
        ref={btn}
        onClick={() => setOpen((o) => !o)}
        className={cx("flex h-10 items-center gap-2.5 rounded-lg px-2 text-left hover:bg-subtle", compact ? "max-w-full" : "w-full")}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Workspace: ${current.name}`}
      >
        <Logo />
        <span className={cx("min-w-0 truncate text-[14px] font-semibold tracking-tight", !compact && "flex-1")}>{current.name}</span>
        <ChevronDown size={14} className="shrink-0 text-ink-3" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className={cx("animate-in absolute top-11 z-40 rounded-xl bg-surface p-1.5 shadow-pop ring-1 ring-line", compact ? "left-0 w-64" : "left-0 right-0")} role="menu">
            <p className="truncate px-2.5 pb-1 pt-1.5 text-xs text-ink-3">{user.email}</p>
            {tenants.map((t) => (
              <button
                key={t.id}
                role="menuitem"
                onClick={() =>
                  start(async () => {
                    setOpen(false);
                    if (t.id !== current.id) {
                      await switchTenantAction(t.id);
                      router.refresh();
                    }
                  })
                }
                className={cx("flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-sm hover:bg-subtle", t.id === current.id ? "text-ink" : "text-ink-2")}
              >
                <span className="flex-1 truncate text-left">{t.name}</span>
                {t.id === current.id ? <Check size={14} /> : null}
              </button>
            ))}
            <div className="my-1 h-px bg-line" />
            <form action={logoutAction}>
              <button role="menuitem" className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-sm text-ink-2 hover:bg-subtle">
                <LogOut size={14} /> Sign out
              </button>
            </form>
          </div>
        </>
      ) : null}
    </div>
  );
}

"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, LogOut } from "lucide-react";
import { switchTenantAction } from "@/app/(app)/actions";
import { logoutAction } from "@/app/(auth)/actions";
import { Logo } from "./logo";
import { cx } from "./ui";

export function WorkspaceMenu({ current, tenants, user }: { current: { id: string; name: string }; tenants: { id: string; name: string }[]; user: { name: string; email: string } }) {
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const router = useRouter();
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-left hover:bg-subtle" aria-expanded={open}>
        <Logo />
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-tight">{current.name}</span>
        <ChevronDown size={14} className="text-ink-3" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="animate-in absolute left-0 right-0 top-11 z-40 rounded-xl bg-surface p-1.5 shadow-pop ring-1 ring-line">
            <p className="px-2.5 pb-1 pt-1.5 text-xs text-ink-3">{user.email}</p>
            {tenants.map((t) => (
              <button
                key={t.id}
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
              <button className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-sm text-ink-2 hover:bg-subtle">
                <LogOut size={14} /> Sign out
              </button>
            </form>
          </div>
        </>
      ) : null}
    </div>
  );
}

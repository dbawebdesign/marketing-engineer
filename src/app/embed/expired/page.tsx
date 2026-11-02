import type { Metadata } from "next";

export const metadata: Metadata = { title: "Session expired", robots: { index: false } };

/** Shown inside the host's iframe when the embed session is missing or has expired. */
export default function EmbedExpired() {
  return (
    <main className="grid min-h-[240px] place-items-center bg-[var(--bg)] px-4 py-12 text-[var(--ink)]">
      <div className="max-w-[360px] text-center">
        <h1 className="text-[15px] font-semibold tracking-tight">Your session has expired</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-[var(--ink-2)]">
          For your security, embedded sessions end after a while. Reload this page to pick up where you left off.
        </p>
      </div>
    </main>
  );
}

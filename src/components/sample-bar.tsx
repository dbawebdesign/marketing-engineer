"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { clearSampleAction } from "@/app/(app)/actions";
import { plural } from "./ui";
import { toast } from "./toast";

/** Quiet, persistent reminder that some of what's on screen is sample data, with the way out. */
export function SampleBar({ canClear }: { canClear: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const clear = () =>
    start(async () => {
      const r = await clearSampleAction();
      if (!r.ok) return void toast.error(r.error);
      const d = r.data!;
      toast.ok(`Cleared ${plural(d.signals, "sample signal")}${d.drafts ? ` and ${plural(d.drafts, "draft")} built from them` : ""}`);
      setConfirming(false);
      router.refresh();
    });
  const link = "font-medium text-ink underline-offset-2 hover:underline disabled:opacity-60";
  return (
    <div role="status" className="border-b border-line bg-subtle py-2 text-[13px] text-ink-2">
      <div className="mx-auto flex max-w-[1080px] flex-wrap px-4 sm:px-10 items-center gap-x-2 gap-y-1">
        {confirming ? (
          <>
            <span>Delete sample signals, sample metrics and pending drafts built from them? Reviewed drafts and the audit log stay.</span>
            <span className="flex items-center gap-3">
              <button type="button" onClick={clear} disabled={pending} className={`${link} inline-flex items-center gap-1 text-danger`}>
                {pending ? <LoaderCircle size={12} className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
                {pending ? "Clearing…" : "Clear"}
              </button>
              <button type="button" onClick={() => setConfirming(false)} disabled={pending} className="text-ink-3 hover:text-ink-2">
                Cancel
              </button>
            </span>
          </>
        ) : (
          <>
            <span>You&rsquo;re looking at sample data</span>
            {canClear ? (
              <>
                <span aria-hidden className="text-ink-3">·</span>
                <button type="button" onClick={() => setConfirming(true)} className={link}>
                  Clear sample data
                </button>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

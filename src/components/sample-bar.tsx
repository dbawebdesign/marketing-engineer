"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { clearSampleAction } from "@/app/(app)/actions";
import { plural } from "./ui";
import type { SampleClearPlan } from "@/server/services/sample";
import { toast } from "./toast";

/** Quiet, persistent reminder that some of what's on screen is sample data, with the way out. */
function describe(p: SampleClearPlan | null) {
  if (!p) return "Delete the sample signals and metrics, and everything built from them?";
  const parts = [plural(p.signals, "sample signal"), p.metricEvents ? plural(p.metricEvents, "sample metric") : null, p.drafts ? plural(p.drafts, "pending draft") : null, p.experiments ? plural(p.experiments, "experiment") : null].filter(Boolean);
  const docs = p.docs.length ? ` Resets ${p.docs.map((d) => d.title).join(", ")} to before the sample.` : "";
  return `Removes ${parts.join(", ")}.${docs} Reviewed drafts and the audit log stay.`;
}

export function SampleBar({ canClear, plan = null }: { canClear: boolean; plan?: SampleClearPlan | null }) {
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
            <span>{describe(plan)}</span>
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
            <span>You&rsquo;re looking at sample data from Dispatchly, a made-up HVAC software company</span>
            {canClear ? (
              <span className="whitespace-nowrap">
                <span aria-hidden className="mr-2 text-ink-3">·</span>
                <button type="button" onClick={() => setConfirming(true)} className={link}>
                  Clear sample data
                </button>
              </span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, LoaderCircle } from "lucide-react";
import { runAgentAction, runStatusAction } from "@/app/(app)/actions";
import { Button } from "./ui";
import { toast } from "./toast";
import { useBase } from "./nav";

/** Runs an agent and follows the run until it finishes, then routes to the result. */
export function RunButton({ agentId, label = "Run now", variant = "primary", input, size }: { agentId: string; label?: string; variant?: "primary" | "secondary"; input?: Record<string, unknown>; size?: "sm" | "md" }) {
  const [runId, setRunId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const base = useBase();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!runId) return;
    let tries = 0;
    const poll = async () => {
      tries++;
      const r = await runStatusAction(runId);
      if (r.ok && r.data && (r.data.status === "succeeded" || r.data.status === "failed")) {
        setRunId(null);
        if (r.data.status === "succeeded") {
          toast.ok("Done. Your draft is waiting for review.");
          router.push(`${base}/inbox`);
        } else toast.error(r.data.error ?? "The run failed.");
        router.refresh();
        return;
      }
      timer.current = setTimeout(poll, Math.min(1000 + tries * 300, 4000));
    };
    timer.current = setTimeout(poll, 700);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [runId, router, base]);

  const busy = pending || !!runId;
  return (
    <Button
      variant={variant}
      size={size}
      disabled={busy}
      onClick={() =>
        start(async () => {
          const r = await runAgentAction(agentId, input);
          if (!r.ok) toast.error(r.error);
          else if (r.data) setRunId(r.data.runId);
        })
      }
    >
      {busy ? <LoaderCircle size={14} className="animate-spin" /> : <Play size={13} className="fill-current" />}
      {busy ? "Working…" : label}
    </Button>
  );
}

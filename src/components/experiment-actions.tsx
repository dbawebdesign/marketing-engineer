"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Play, X } from "lucide-react";
import { moveExperimentAction } from "@/app/(app)/actions-extra";
import type { ExperimentMove } from "@/server/services/experiments";
import { RunButton } from "./run-button";
import { Button } from "./ui";
import { toast } from "./toast";

const DONE: Record<ExperimentMove, string> = { start: "Test started", won: "Marked as won", lost: "Marked as lost" };

/** The next move on a test: start a queued one (or get hooks for it first), call a running one. */
export function ExperimentActions({
  id,
  status,
  canWrite,
  hookLab,
}: {
  id: string;
  status: string;
  canWrite: boolean;
  hookLab: { id: string; name: string; offer: string } | null;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const move = (m: ExperimentMove) =>
    start(async () => {
      const r = await moveExperimentAction(id, m);
      if (!r.ok) return void toast.error(r.error);
      toast.ok(DONE[m]);
      router.refresh();
    });
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5" data-experiment-actions>
      {status === "draft" ? (
        <>
          {canWrite ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => move("start")}>
              <Play size={12} className="fill-current" aria-hidden /> Start test
            </Button>
          ) : null}
          {hookLab ? (
            <RunButton agentId={hookLab.id} size="sm" variant="ghost" label={`Run ${hookLab.name} on this`} workingLabel="Writing hooks…" input={{ offer: hookLab.offer.slice(0, 600) }} />
          ) : null}
        </>
      ) : status === "running" && canWrite ? (
        <>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => move("won")}>
            <Check size={13} aria-hidden /> Won
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => move("lost")}>
            <X size={13} aria-hidden /> Lost
          </Button>
        </>
      ) : null}
    </div>
  );
}

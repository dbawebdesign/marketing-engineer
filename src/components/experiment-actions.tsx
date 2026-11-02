"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Play, X } from "lucide-react";
import { moveExperimentAction } from "@/app/(app)/actions-extra";
import type { ExperimentMove } from "@/server/services/experiments";
import { verdictLine, type Results } from "@/lib/experiment-results";
import { RunButton } from "./run-button";
import { Button } from "./ui";
import { toast } from "./toast";
import { useBase } from "./nav";

/** How long a Won/Lost call waits for Undo before it's committed. */
const GRACE_MS = 5000;

/**
 * The next move on a test. A queued test with fewer than two variants gets hooks first;
 * a running one is called Won or Lost on its numbers, with a few seconds to take it back.
 */
export function ExperimentActions({
  id,
  name,
  status,
  variants,
  results,
  canWrite,
  hookLab,
  quiet = false,
}: {
  id: string;
  name: string;
  status: string;
  variants: number;
  results: Results | null;
  canWrite: boolean;
  /** Hook lab run "on this": the test's angle as the offer, linked back to the test. */
  hookLab: { id: string; name: string; offer: string } | null;
  /** Another control on the page is the primary action: no dark buttons here. */
  quiet?: boolean;
}) {
  const [pending, start] = useTransition();
  const [calling, setCalling] = useState<ExperimentMove | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef<(() => void) | null>(null);
  const router = useRouter();
  const base = useBase();

  const commit = (m: ExperimentMove) =>
    start(async () => {
      const r = await moveExperimentAction(id, m);
      setCalling(null);
      if (!r.ok) return void toast.error(r.error, { key: `exp:${id}` });
      if (m === "start") toast.ok("Test started", { key: `exp:${id}` });
      else if (m === "won" && r.data?.winner) toast.ok(`Won. “${r.data.winner}” added to Winning hooks.`, { key: `exp:${id}`, action: { label: "View", run: () => router.push(`${base}/memory?doc=content%2Fwinning-hooks`) } });
      else toast.ok(m === "won" ? "Marked as won" : "Marked as lost", { key: `exp:${id}` });
      router.refresh();
    });

  // A call still in its grace period goes through if the page is left: the person meant it.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        commitRef.current?.();
      }
    },
    [],
  );

  const call = (m: "won" | "lost") => {
    if (timer.current) return;
    setCalling(m);
    const go = () => {
      timer.current = null;
      commitRef.current = null;
      commit(m);
    };
    commitRef.current = go;
    timer.current = setTimeout(go, GRACE_MS);
    const why = results ? verdictLine(results) : "No results recorded";
    toast.ok(`${m === "won" ? "Marking won" : "Marking lost"}: ${why}`, {
      key: `exp:${id}`,
      duration: GRACE_MS,
      action: {
        label: "Undo",
        run: () => {
          if (timer.current) clearTimeout(timer.current);
          timer.current = null;
          commitRef.current = null;
          setCalling(null);
        },
      },
    });
  };

  if (status === "draft") {
    const ready = variants >= 2;
    return (
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5" data-experiment-actions>
        {ready && canWrite ? (
          <Button size="sm" variant={quiet ? "secondary" : "primary"} disabled={pending} onClick={() => commit("start")}>
            <Play size={12} className="fill-current" aria-hidden /> Start test
          </Button>
        ) : null}
        {hookLab ? (
          <RunButton
            agentId={hookLab.id}
            size="sm"
            variant={ready ? "ghost" : quiet ? "secondary" : "primary"}
            label={`Run ${hookLab.name} on this`}
            workingLabel="Writing hooks…"
            input={{ offer: hookLab.offer.slice(0, 600), experiment_id: id, experiment: name.slice(0, 200) }}
          />
        ) : null}
        {!ready ? <span className="text-[13px] text-ink-3">Needs two variants to start</span> : null}
      </div>
    );
  }
  if (status !== "running" || !canWrite) return null;
  const canWin = !!results?.leader;
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5" data-experiment-actions>
      {calling ? (
        <span className="text-[13px] text-ink-2" aria-live="polite">
          {calling === "won" ? "Marking won…" : "Marking lost…"}
        </span>
      ) : (
        <>
          <Button size="sm" variant="ghost" disabled={pending || !canWin} title={canWin ? undefined : "No results yet. Tag metric events with this test's angles."} onClick={() => call("won")}>
            <Check size={13} aria-hidden /> <span className="max-w-[240px] truncate">Won{canWin ? `: ${results!.leader!.label}` : ""}</span>
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => call("lost")}>
            <X size={13} aria-hidden /> Lost
          </Button>
        </>
      )}
    </div>
  );
}

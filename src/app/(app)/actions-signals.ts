"use server";
import { act, requireCtx } from "@/server/web/session";
import { listAgents } from "@/server/services/agents";
import { canDo } from "@/lib/ctx";
import { revalidatePath } from "next/cache";
import { ingestSignals, SIGNAL_SOURCES, type SignalInputT } from "@/server/services/signals";
import { badRequest } from "@/lib/errors";

/**
 * Add pasted notes, each with its own source and account (guessed per note in the drawer, editable there).
 * A single note may carry a title.
 */
export async function addNotesAction(notes: { source: string; content: string; account?: string | null; title?: string }[]) {
  return act(async () => {
    const ctx = await requireCtx();
    const clean = notes.map((n) => ({ ...n, content: n.content.trim() })).filter((n) => n.content);
    if (!clean.length) throw badRequest("Paste at least one note");
    if (clean.length > 1000) throw badRequest("Up to 1,000 notes at a time, please");
    for (const n of clean) if (!(SIGNAL_SOURCES as readonly string[]).includes(n.source)) throw badRequest("Pick a source for every note");
    const rows: SignalInputT[] = clean.map((n) => ({
      source: n.source as SignalInputT["source"],
      content: n.content,
      title: clean.length === 1 ? n.title : undefined,
      account: n.account?.trim() || null,
      url: null,
    }));
    const r = await ingestSignals(ctx, rows);
    revalidatePath("/", "layout");
    return r;
  });
}

/**
 * After signals are added: is Market pulse ready to read them, and may this viewer run it?
 * Null when there's nothing to offer (no pulse agent, not ready, a run already going, or no permission).
 */
export async function pulseOfferAction() {
  return act(async () => {
    const ctx = await requireCtx();
    if (!canDo(ctx, "agents:run")) return null;
    const pulse = (await listAgents(ctx, { readiness: true })).find((a) => a.system === "customer_truth" && a.enabled !== false);
    if (!pulse || (pulse.readiness && !pulse.readiness.ready)) return null;
    const busy = pulse.last_run && (pulse.last_run.status === "queued" || pulse.last_run.status === "running");
    return busy ? null : { id: pulse.id, name: pulse.name };
  });
}

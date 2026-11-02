"use server";
import { act, requireCtx } from "@/server/web/session";
import { listAgents } from "@/server/services/agents";
import { canDo } from "@/lib/ctx";

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

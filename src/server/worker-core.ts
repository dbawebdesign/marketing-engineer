import { claim, complete, fail, requeueStale, scheduleDueAgents } from "./jobs";
import { executeRun, reapStuckRuns } from "./agents/runner";

export async function handle(job: { type: string; tenant_id: string | null; payload: Record<string, unknown> }) {
  switch (job.type) {
    case "agent.run":
      if (!job.tenant_id) throw new Error("agent.run requires a tenant");
      await executeRun(job.tenant_id, String(job.payload.runId));
      return;
    default:
      throw new Error(`Unknown job type ${job.type}`);
  }
}

/** Process ready jobs until the queue is empty or the budget runs out. */
export async function drain(workerId: string, maxJobs = 10) {
  let n = 0;
  while (n < maxJobs) {
    const job = await claim(workerId);
    if (!job) break;
    n++;
    try {
      await handle(job);
      await complete(job.id);
    } catch (e) {
      await fail(job, e);
    }
  }
  return n;
}

export async function tick(workerId: string) {
  await scheduleDueAgents();
  await requeueStale();
  await reapStuckRuns();
  return drain(workerId, 25);
}

import { claim, complete, fail, release, requeueStale, scheduleDueAgents, sweep, type Job } from "./jobs";
import { executeRun, reapStuckRuns } from "./agents/runner";

/** Aborted on SIGTERM so in-flight model calls stop and their jobs go back to the queue. */
export const shutdown = new AbortController();

export async function handle(job: Job) {
  switch (job.type) {
    case "agent.run":
      if (!job.tenant_id) throw new Error("agent.run requires a tenant");
      await executeRun(job.tenant_id, String(job.payload.runId), { finalAttempt: job.attempts >= job.max_attempts, signal: shutdown.signal });
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
      if (shutdown.signal.aborted) await release(job.id);
      else await fail(job, e);
    }
    if (shutdown.signal.aborted) break;
  }
  return n;
}

let ticks = 0;

export async function tick(workerId: string) {
  if (ticks++ % 120 === 0) await sweep().catch((e) => console.error("[worker] sweep failed", e));
  await scheduleDueAgents();
  await requeueStale();
  await reapStuckRuns();
  return drain(workerId, 25);
}

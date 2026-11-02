import { CronExpressionParser } from "cron-parser";
import { sys, sysTx, type Tx } from "@/lib/db";

/**
 * A Postgres-backed job queue (FOR UPDATE SKIP LOCKED). No extra infrastructure to
 * run, horizontally scalable: add workers and they share the queue safely.
 */
export async function enqueue(tx: Tx | null, job: { tenantId: string | null; type: string; payload: Record<string, unknown>; runAt?: Date }) {
  const q = `insert into jobs(tenant_id, type, payload, run_at) values ($1,$2,$3,coalesce($4, now()))`;
  const p = [job.tenantId, job.type, job.payload, job.runAt ?? null];
  if (tx) await tx.query(q, p);
  else await sys(q, p);
}

export type Job = { id: string; tenant_id: string | null; type: string; payload: Record<string, unknown>; attempts: number; max_attempts: number };

export async function claim(workerId: string): Promise<Job | null> {
  const r = await sys<Job>(
    `update jobs set status='running', locked_at=now(), locked_by=$1, attempts=attempts+1
      where id = (select id from jobs where status='queued' and run_at <= now() order by run_at limit 1 for update skip locked)
      returning id, tenant_id, type, payload, attempts, max_attempts`,
    [workerId],
  );
  return r.rows[0] ?? null;
}

export async function complete(id: string) {
  await sys(`update jobs set status='done', locked_at=null where id=$1`, [id]);
}

export async function fail(job: Job, err: unknown) {
  const msg = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
  const retry = job.attempts < job.max_attempts;
  // Exponential backoff: 30s, 2m, 8m...
  await sys(
    `update jobs set status=$2, last_error=$3, locked_at=null, run_at = now() + make_interval(secs => $4) where id=$1`,
    [job.id, retry ? "queued" : "failed", msg, 30 * 4 ** (job.attempts - 1)],
  );
}

/** Re-queue jobs whose worker died mid-flight. */
export async function requeueStale() {
  await sys(`update jobs set status='queued', locked_at=null where status='running' and locked_at < now() - interval '35 minutes'`);
}

export function nextRun(cron: string, tz = "UTC", from = new Date()): Date | null {
  try {
    return CronExpressionParser.parse(cron, { currentDate: from, tz }).next().toDate();
  } catch {
    return null;
  }
}

/** Find agents whose schedule is due, create a run for each, and advance their schedule. */
export async function scheduleDueAgents(limit = 50): Promise<number> {
  return sysTx(async (tx) => {
    const due = await tx.query<{ id: string; tenant_id: string; schedule_cron: string; timezone: string }>(
      `select id, tenant_id, schedule_cron, timezone from agents
        where enabled and next_run_at <= now() and schedule_cron is not null
        order by next_run_at limit $1 for update skip locked`,
      [limit],
    );
    for (const a of due.rows) {
      const run = await tx.query<{ id: string }>(
        `insert into runs(tenant_id, agent_id, trigger) values ($1,$2,'schedule') returning id`,
        [a.tenant_id, a.id],
      );
      await enqueue(tx, { tenantId: a.tenant_id, type: "agent.run", payload: { runId: run.rows[0]!.id } });
      await tx.query(`update agents set next_run_at=$2 where id=$1`, [a.id, nextRun(a.schedule_cron, a.timezone)]);
    }
    return due.rows.length;
  });
}

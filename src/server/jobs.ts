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
  const job = await claimOne(workerId);
  if (!job || !job.tenant_id) return job;
  // Concurrent claims can each see room under the cap; re-check and hand back the extra.
  const n = await sys<{ n: number }>(
    `select count(*)::int n from jobs where tenant_id = $1 and status = 'running' and (locked_at, id) <= (select locked_at, id from jobs where id = $2)`,
    [job.tenant_id, job.id],
  );
  if ((n.rows[0]?.n ?? 0) > TENANT_CONCURRENCY) {
    await sys(`update jobs set status='queued', locked_at=null, locked_by=null, attempts=attempts-1, run_at=now() + interval '2 seconds' where id=$1`, [job.id]);
    return null;
  }
  return job;
}

async function claimOne(workerId: string): Promise<Job | null> {
  const r = await sys<Job>(
    `update jobs set status='running', locked_at=now(), locked_by=$1, attempts=attempts+1
      where id = (select j.id from jobs j
                   where j.status='queued' and j.run_at <= now()
                     -- per-tenant concurrency cap, so one busy tenant can never starve the rest
                     and (select count(*) from jobs r where r.tenant_id = j.tenant_id and r.status = 'running') < $2
                   order by j.run_at limit 1 for update skip locked)
      returning id, tenant_id, type, payload, attempts, max_attempts`,
    [workerId, TENANT_CONCURRENCY],
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

const TENANT_CONCURRENCY = Math.max(1, Number(process.env.ME_TENANT_CONCURRENCY ?? "2") || 2);
/** Runs a workspace may start per rolling 24 hours (manual and scheduled), to bound model spend. */
export const DAILY_RUN_LIMIT = Math.max(1, Number(process.env.ME_DAILY_RUN_LIMIT ?? "100") || 100);
/** Shortest allowed gap between scheduled runs. */
export const MIN_SCHEDULE_MINUTES = Math.max(1, Number(process.env.ME_MIN_SCHEDULE_MINUTES ?? "60") || 60);

/** Valid 5-field cron that fires no more often than MIN_SCHEDULE_MINUTES. Returns an error message or null. */
export function scheduleProblem(cron: string, tz = "UTC"): string | null {
  if (cron.trim().split(/\s+/).length !== 5) return "Use a standard 5-part schedule, like 0 9 * * 1";
  try {
    const it = CronExpressionParser.parse(cron, { tz });
    let prev = it.next().toDate().getTime();
    for (let i = 0; i < 24; i++) {
      const n = it.next().toDate().getTime();
      if (n - prev < MIN_SCHEDULE_MINUTES * 60_000) return `Agents can run at most once every ${MIN_SCHEDULE_MINUTES} minutes`;
      prev = n;
    }
    return null;
  } catch {
    return "That schedule isn't a valid cron expression";
  }
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
      await tx.query(`update agents set next_run_at=$2 where id=$1`, [a.id, nextRun(a.schedule_cron, a.timezone)]);
      // Skip this slot if the previous run is still going or the workspace is over its daily budget.
      const busy = await tx.query(
        `select 1 where exists (select 1 from runs where agent_id = $1 and status in ('queued','running') and created_at > now() - interval '30 minutes')
            or (select count(*) from runs where tenant_id = $2 and created_at > now() - interval '24 hours') >= $3`,
        [a.id, a.tenant_id, DAILY_RUN_LIMIT],
      );
      if (busy.rowCount) continue;
      const run = await tx.query<{ id: string }>(
        `insert into runs(tenant_id, agent_id, trigger) values ($1,$2,'schedule') returning id`,
        [a.tenant_id, a.id],
      );
      await enqueue(tx, { tenantId: a.tenant_id, type: "agent.run", payload: { runId: run.rows[0]!.id } });
    }
    return due.rows.length;
  });
}

import pg from "pg";

/**
 * Two pools:
 *  - `app`  connects as an RLS-bound role. Every tenant query goes through `withTenant`,
 *           which sets `app.tenant_id` for the transaction, so Postgres itself refuses
 *           cross-tenant reads and writes even if application code has a bug.
 *  - `sys`  connects as the schema owner. Only used for identity lookups (sessions,
 *           API keys, signup) and the job queue. Never handed tenant-controlled SQL.
 */
type Pools = { app: pg.Pool; sys: pg.Pool };
const g = globalThis as unknown as { __mePools?: Pools };

function make(): Pools {
  const appUrl = process.env.DATABASE_URL;
  const sysUrl = process.env.DATABASE_ADMIN_URL ?? appUrl;
  if (!appUrl) throw new Error("DATABASE_URL is not set");
  const max = Number(process.env.DB_POOL_MAX ?? 10);
  return {
    app: new pg.Pool({ connectionString: appUrl, max, idleTimeoutMillis: 30_000, statement_timeout: 15_000 }),
    sys: new pg.Pool({ connectionString: sysUrl, max: Math.max(2, Math.floor(max / 2)), idleTimeoutMillis: 30_000, statement_timeout: 15_000 }),
  };
}

export function pools(): Pools {
  if (!g.__mePools) g.__mePools = make();
  return g.__mePools;
}

export type Tx = pg.PoolClient;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Run `fn` in a transaction scoped to one tenant (RLS enforced). */
export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(tenantId)) throw new Error("invalid tenant id");
  const client = await pools().app.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** System query (bypasses RLS). Keep usage narrow and audited. */
export async function sys<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) {
  return pools().sys.query<R>(text, params);
}

export async function sysTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pools().sys.connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

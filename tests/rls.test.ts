/**
 * Integration test: tenant isolation is enforced by Postgres itself (RLS), not by app code.
 * Requires DATABASE_URL (RLS-bound role) and DATABASE_ADMIN_URL with migrations applied.
 */
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const run = appUrl && adminUrl ? describe : describe.skip;

run("row level security", () => {
  const admin = new pg.Pool({ connectionString: adminUrl });
  const app = new pg.Pool({ connectionString: appUrl });
  afterAll(async () => {
    await admin.query(`delete from tenants where slug like 'rls-test-%'`);
    await admin.end();
    await app.end();
  });

  async function tenant(slug: string) {
    const t = await admin.query<{ id: string }>(`insert into tenants(name, slug) values ($1, $1) returning id`, [slug]);
    return t.rows[0]!.id;
  }
  async function asTenant<T>(id: string | null, fn: (c: pg.PoolClient) => Promise<T>) {
    const c = await app.connect();
    try {
      await c.query("begin");
      if (id) await c.query(`select set_config('app.tenant_id', $1, true)`, [id]);
      return await fn(c);
    } finally {
      await c.query("rollback").catch(() => {});
      c.release();
    }
  }

  it("isolates reads and writes between tenants", async () => {
    const sfx = Math.random().toString(36).slice(2, 8);
    const a = await tenant(`rls-test-a-${sfx}`);
    const b = await tenant(`rls-test-b-${sfx}`);
    await admin.query(`insert into signals(tenant_id, source, content, content_hash) values ($1,'other','secret of A','h-a-${sfx}')`, [a]);

    const seenByA = await asTenant(a, (c) => c.query(`select content from signals where tenant_id = $1`, [a]));
    expect(seenByA.rowCount).toBe(1);

    // B cannot read A's rows even when asking for them explicitly.
    const seenByB = await asTenant(b, (c) => c.query(`select content from signals where tenant_id = $1`, [a]));
    expect(seenByB.rowCount).toBe(0);

    // B cannot write rows into A.
    await expect(
      asTenant(b, (c) => c.query(`insert into signals(tenant_id, source, content, content_hash) values ($1,'other','x','h-x-${sfx}')`, [a])),
    ).rejects.toThrow(/row-level security/);

    // B cannot update or delete A's rows (silently affects zero rows).
    const upd = await asTenant(b, (c) => c.query(`update signals set content = 'pwned' where tenant_id = $1`, [a]));
    expect(upd.rowCount).toBe(0);

    // No tenant context means no rows at all.
    const none = await asTenant(null, (c) => c.query(`select 1 from signals`));
    expect(none.rowCount).toBe(0);
  });

  it("does not let the app role read the job queue or identity tables", async () => {
    await expect(asTenant(null, (c) => c.query(`select * from jobs`))).rejects.toThrow(/permission denied/);
    await expect(asTenant(null, (c) => c.query(`select * from sessions`))).rejects.toThrow(/permission denied/);
    await expect(asTenant(null, (c) => c.query(`select password_hash from users`))).rejects.toThrow(/permission denied/);
  });
});

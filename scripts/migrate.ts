/**
 * Applies SQL migrations in db/migrations in order, once each.
 * Runs with DATABASE_ADMIN_URL (schema owner). Optionally provisions the
 * RLS-bound application login when ME_APP_LOGIN_PASSWORD is set.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error("DATABASE_ADMIN_URL is required");

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const dir = path.join(process.cwd(), "db/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const done = new Set((await client.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name));
  for (const f of files) {
    if (done.has(f)) continue;
    process.stdout.write(`applying ${f} ... `);
    await client.query("begin");
    try {
      await client.query(readFileSync(path.join(dir, f), "utf8"));
      await client.query("insert into schema_migrations(name) values ($1)", [f]);
      await client.query("commit");
      console.log("ok");
    } catch (e) {
      await client.query("rollback");
      throw e;
    }
  }
  const pw = process.env.ME_APP_LOGIN_PASSWORD;
  if (pw) {
    const exists = await client.query("select 1 from pg_roles where rolname = 'me_app_login'");
    const q = client.escapeLiteral(pw);
    await client.query(exists.rowCount ? `alter role me_app_login with login password ${q}` : `create role me_app_login login password ${q} in role me_app`);
    console.log("app login role ready");
  }
} finally {
  await client.end();
}

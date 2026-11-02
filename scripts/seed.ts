/**
 * Creates a demo account with sample data.
 *   pnpm db:seed [email] [password]          create if missing
 *   pnpm db:seed -- --reset --run            recreate from scratch and run every agent once
 */
import { sys, pools } from "@/lib/db";
import { signup } from "@/server/services/tenants";
import { loadDemo } from "@/server/demo";
import { listAgents, runAgent } from "@/server/services/agents";
import { drain } from "@/server/worker-core";
import type { Ctx } from "@/lib/ctx";

const args = process.argv.slice(2).filter((a) => a !== "--");
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [email = "demo@dispatchly.test", password = "demo-password-123"] = args.filter((a) => !a.startsWith("--"));

if (flags.has("--reset")) {
  const t = await sys<{ tenant_id: string }>(`select m.tenant_id from memberships m join users u on u.id = m.user_id where u.email = $1 and m.role = 'owner'`, [email]);
  for (const r of t.rows) await sys(`delete from tenants where id = $1`, [r.tenant_id]);
  await sys(`delete from users where email = $1`, [email]);
  await sys(`delete from users u where external_ref is not null and not exists (select 1 from memberships m where m.user_id = u.id)`);
  console.log(`Reset ${email}`);
}

const existing = await sys(`select 1 from users where email = $1`, [email]);
if (existing.rowCount) {
  console.log(`${email} already exists`);
} else {
  const { userId, tenantId } = await signup({ name: "Maya Chen", email, password, company: "Dispatchly" });
  const ctx: Ctx = { tenantId, userId, role: "owner", actor: { type: "user", id: userId } };
  const res = await loadDemo(ctx);
  console.log(`Created ${email} / ${password}; ${res.inserted} sample signals.`);
  if (flags.has("--run")) {
    for (const a of await listAgents(ctx)) {
      await runAgent(ctx, a.id);
      await drain("seed", 1);
      console.log(`  ran ${a.name}`);
    }
  }
}
await pools().app.end();
await pools().sys.end();

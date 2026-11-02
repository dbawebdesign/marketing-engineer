/** Creates a demo account with sample data. Usage: pnpm db:seed [email] [password] */
import { sys } from "@/lib/db";
import { signup } from "@/server/services/tenants";
import { loadDemo } from "@/server/demo";
import { pools } from "@/lib/db";

const email = process.argv[2] ?? "demo@dispatchly.test";
const password = process.argv[3] ?? "demo-password-123";

const existing = await sys(`select 1 from users where email = $1`, [email]);
if (existing.rowCount) {
  console.log(`${email} already exists`);
} else {
  const { userId, tenantId } = await signup({ name: "Maya Chen", email, password, company: "Dispatchly" });
  const res = await loadDemo({ tenantId, userId, role: "owner", actor: { type: "user", id: userId } });
  console.log(`Created ${email} / ${password} in tenant ${tenantId}; ${res.inserted} sample signals.`);
}
await pools().app.end();
await pools().sys.end();

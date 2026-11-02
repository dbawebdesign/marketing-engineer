/** Operator tool: permanently delete a workspace and everything in it.
 *  pnpm tsx scripts/delete-tenant.ts <slug> --yes */
import { sys, pools } from "@/lib/db";
import { deleteTenantById } from "@/server/services/tenant-admin";

const [slug, yes] = process.argv.slice(2).filter((a) => a !== "--");
if (!slug || yes !== "--yes") {
  console.error("usage: tsx scripts/delete-tenant.ts <slug> --yes");
  process.exit(1);
}
const t = await sys<{ id: string }>(`select id from tenants where slug = $1`, [slug]);
if (!t.rows[0]) {
  console.error(`no workspace with slug ${slug}`);
  process.exit(1);
}
console.log(await deleteTenantById(t.rows[0].id));
await pools().app.end();
await pools().sys.end();

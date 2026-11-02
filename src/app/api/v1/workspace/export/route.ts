import { handler } from "@/lib/api";
import { exportTenant } from "@/server/services/tenant-admin";

/** GET /api/v1/workspace/export: everything the workspace owns, as JSON. Admin scope. */
export const GET = handler(async (_req, ctx) => {
  const body = await exportTenant(ctx);
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="workspace-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
});

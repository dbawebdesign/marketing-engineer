import { handler, intParam } from "@/lib/api";
import { badRequest } from "@/lib/errors";
import { listDrafts } from "@/server/services/drafts";

export const dynamic = "force-dynamic";

const STATUSES = ["pending", "approved", "rejected", "published"];
const SYSTEMS = ["customer_truth", "founder_content", "outbound_signal", "creative_testing", "ai_search", "growth_cockpit"];

/** GET /api/v1/drafts?status=&system=&limit= */
export const GET = handler(async (req, ctx) => {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") || undefined;
  const system = sp.get("system") || undefined;
  if (status && !STATUSES.includes(status)) throw badRequest(`status must be one of: ${STATUSES.join(", ")}`);
  if (system && !SYSTEMS.includes(system)) throw badRequest(`system must be one of: ${SYSTEMS.join(", ")}`);
  return { data: await listDrafts(ctx, { status, system, limit: intParam(sp.get("limit"), 50, 1, 200) }) };
});

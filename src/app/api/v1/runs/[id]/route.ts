import { handler } from "@/lib/api";
import { isUuid } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { getRun } from "@/server/services/agents";

export const dynamic = "force-dynamic";

/** GET /api/v1/runs/:id — status is queued | running | succeeded | failed | canceled. */
export const GET = handler<{ id: string }>(async (_req, ctx, { params }) => {
  if (!isUuid(params.id)) throw notFound("Run");
  return getRun(ctx, params.id);
});

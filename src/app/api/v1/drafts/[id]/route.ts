import { handler } from "@/lib/api";
import { isUuid } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { getDraft } from "@/server/services/drafts";

export const dynamic = "force-dynamic";

/** GET /api/v1/drafts/:id */
export const GET = handler<{ id: string }>(async (_req, ctx, { params }) => {
  if (!isUuid(params.id)) throw notFound("Draft");
  return getDraft(ctx, params.id);
});

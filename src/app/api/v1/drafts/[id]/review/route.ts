import { handler, readJson } from "@/lib/api";
import { isUuid } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { reviewDraft } from "@/server/services/drafts";

export const dynamic = "force-dynamic";

/** POST /api/v1/drafts/:id/review — { decision: "approve"|"reject", feedback?, remember?, body? } */
export const POST = handler<{ id: string }>(async (req, ctx, { params }) => {
  if (!isUuid(params.id)) throw notFound("Draft");
  return reviewDraft(ctx, params.id, await readJson(req, undefined, 500_000));
});

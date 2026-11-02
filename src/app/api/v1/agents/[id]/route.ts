import { handler, readJson } from "@/lib/api";
import { isUuid } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { getAgent, updateAgent } from "@/server/services/agents";

export const dynamic = "force-dynamic";

/** GET /api/v1/agents/:id — the agent, its active rules and its last 20 runs. */
export const GET = handler<{ id: string }>(async (_req, ctx, { params }) => {
  if (!isUuid(params.id)) throw notFound("Agent");
  return getAgent(ctx, params.id);
});

/** PATCH /api/v1/agents/:id — { name?, enabled?, schedule_cron?, model?, spec? } (admin). */
export const PATCH = handler<{ id: string }>(async (req, ctx, { params }) => {
  if (!isUuid(params.id)) throw notFound("Agent");
  await updateAgent(ctx, params.id, await readJson(req));
  return getAgent(ctx, params.id);
});

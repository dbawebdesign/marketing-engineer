import { handler } from "@/lib/api";
import { listAgents } from "@/server/services/agents";

export const dynamic = "force-dynamic";

/** GET /api/v1/agents */
export const GET = handler(async (_req, ctx) => ({ data: await listAgents(ctx) }));

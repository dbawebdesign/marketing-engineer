import { handler } from "@/lib/api";
import { listDocs } from "@/server/services/memory";

export const dynamic = "force-dynamic";

/** GET /api/v1/memory — every Growth OS document (key, title, folder, content, version). */
export const GET = handler(async (_req, ctx) => ({ data: await listDocs(ctx) }));

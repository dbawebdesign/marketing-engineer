import { z } from "zod";
import { handler, intParam, readJson } from "@/lib/api";
import { badRequest } from "@/lib/errors";
import { ingestSignals, listSignals, SIGNAL_SOURCES, type SignalInputT } from "@/server/services/signals";

export const dynamic = "force-dynamic";

/** GET /api/v1/signals?source=&q=&limit=&before= */
export const GET = handler(async (req, ctx) => {
  const sp = req.nextUrl.searchParams;
  const source = sp.get("source");
  if (source && !(SIGNAL_SOURCES as readonly string[]).includes(source)) throw badRequest(`source must be one of: ${SIGNAL_SOURCES.join(", ")}`);
  const before = sp.get("before");
  if (before && Number.isNaN(Date.parse(before))) throw badRequest("before must be an ISO 8601 timestamp");
  const data = await listSignals(ctx, {
    source: source ?? undefined,
    q: sp.get("q") ?? undefined,
    limit: intParam(sp.get("limit"), 50, 1, 200),
    before: before ? new Date(before).toISOString() : undefined,
  });
  const last = data.at(-1);
  return { data, next_before: data.length && last ? new Date(last.occurred_at).toISOString() : null };
});

const Body = z.union([z.object({ signals: z.array(z.record(z.string(), z.unknown())) }), z.record(z.string(), z.unknown())]);

/** POST /api/v1/signals  — one signal object, or { signals: [...] } (max 1,000). */
export const POST = handler(async (req, ctx) => {
  const body = await readJson(req, Body, 20_000_000);
  const list = Array.isArray((body as { signals?: unknown }).signals) ? (body as { signals: unknown[] }).signals : [body];
  if (list.length > 1000) throw badRequest("Send at most 1,000 signals per request");
  const res = await ingestSignals(ctx, list as SignalInputT[]);
  return Response.json(res, { status: 201 });
});

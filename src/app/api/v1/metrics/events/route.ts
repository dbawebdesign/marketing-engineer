import { z } from "zod";
import { handler, readJson } from "@/lib/api";
import { recordMetricEvents } from "@/server/services/metrics";

export const dynamic = "force-dynamic";

const Body = z.union([z.object({ events: z.array(z.unknown()) }), z.array(z.unknown())]);

/** POST /api/v1/metrics/events — { events: [...] } or a bare array (max 1,000). */
export const POST = handler(async (req, ctx) => {
  const body = await readJson(req, Body, 5_000_000);
  const res = await recordMetricEvents(ctx, Array.isArray(body) ? body : body.events);
  return Response.json(res, { status: 201 });
});

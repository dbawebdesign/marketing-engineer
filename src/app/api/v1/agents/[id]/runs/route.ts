import { after } from "next/server";
import { z } from "zod";
import { handler, readJson } from "@/lib/api";
import { isUuid } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { runAgent } from "@/server/services/agents";
import { drain } from "@/server/worker-core";

export const dynamic = "force-dynamic";

const Body = z
  .object({ input: z.record(z.string(), z.unknown()).optional().default({}) })
  .optional()
  .default({ input: {} })
  .refine((b) => JSON.stringify(b.input).length <= 20_000, "input is larger than 20 KB");

/** POST /api/v1/agents/:id/runs — queue a run. Returns 202 { run_id }. Poll GET /api/v1/runs/:id. */
export const POST = handler<{ id: string }>(async (req, ctx, { params }) => {
  if (!isUuid(params.id)) throw notFound("Agent");
  const hasBody = Number(req.headers.get("content-length") ?? "0") > 0 || req.headers.get("transfer-encoding") !== null;
  const body = hasBody ? await readJson(req, Body, 100_000) : { input: {} };
  const runId = await runAgent(ctx, params.id, body.input, "api");
  // Single-box deployments: process the queue right after responding, no separate worker needed.
  if (process.env.ME_INLINE_WORKER !== "false") {
    after(async () => {
      try {
        await drain(`inline:${process.pid}`, 5);
      } catch (e) {
        console.error("[inline-worker] drain failed", e);
      }
    });
  }
  return Response.json({ run_id: runId, status: "queued" }, { status: 202, headers: { location: `/api/v1/runs/${runId}` } });
});

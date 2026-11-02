import { z } from "zod";
import { handler, readJson } from "@/lib/api";
import { badRequest } from "@/lib/errors";
import { requireDoc, saveDoc } from "@/server/services/memory";

export const dynamic = "force-dynamic";

const KEY_RE = /^[a-z0-9][a-z0-9/_-]{1,120}$/;
function docKey(parts: string[]) {
  const key = parts.map((p) => decodeURIComponent(p)).join("/");
  if (!KEY_RE.test(key) || key.includes("//")) throw badRequest("Invalid document key");
  return key;
}

/** GET /api/v1/memory/:key (key may contain slashes, e.g. outbound/icp) */
export const GET = handler<{ key: string[] }>(async (_req, ctx, { params }) => requireDoc(ctx, docKey(params.key)));

const Body = z.object({ content: z.string().max(200_000), expected_version: z.number().int().positive().optional() });

/** PUT /api/v1/memory/:key — { content, expected_version? }. 400 if expected_version is stale. */
export const PUT = handler<{ key: string[] }>(async (req, ctx, { params }) => {
  const key = docKey(params.key);
  const b = await readJson(req, Body, 1_000_000);
  const r = await saveDoc(ctx, key, b.content, b.expected_version);
  return { key, ...r };
});

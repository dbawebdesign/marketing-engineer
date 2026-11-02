import { publicHandler, readText } from "@/lib/api";
import { sys } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { AppError, badRequest } from "@/lib/errors";
import { limit } from "@/lib/rate-limit";
import { verifySignature } from "@/lib/signing";
import type { Ctx } from "@/lib/ctx";
import { ingestSignals, SIGNAL_SOURCES, type SignalInputT } from "@/server/services/signals";

export const dynamic = "force-dynamic";

const invalid = () => new AppError(401, "invalid_signature", "Missing, stale or invalid signature");

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);

/**
 * Accept our own signal shape, plus the common field names tools like Gong, Zendesk and
 * HubSpot (or Zapier/Make in front of them) emit, so a light mapping step is usually enough.
 */
function normalize(item: Obj, defaultSource: string): SignalInputT {
  const content = str(item.content) ?? str(item.body) ?? str(item.text) ?? str(item.description) ?? str(item.transcript) ?? str(item.note);
  const source = str(item.source) ?? defaultSource;
  return {
    source: source as SignalInputT["source"],
    content: content ?? "",
    title: str(item.title) ?? str(item.subject) ?? str(item.name) ?? "",
    url: str(item.url) ?? null,
    author: str(item.author) ?? null,
    account: str(item.account) ?? str(item.company) ?? str(item.organization) ?? null,
    occurred_at: str(item.occurred_at) ?? str(item.created_at),
    metadata: typeof item.metadata === "object" && item.metadata !== null && !Array.isArray(item.metadata) ? (item.metadata as Obj) : {},
  };
}

/**
 * POST /api/v1/webhooks/signals/:tenantSlug[?source=support_ticket]
 * Headers: x-me-timestamp: <unix seconds>, x-me-signature: sha256=<hex HMAC of `${ts}.${rawBody}`>
 * Signed with the tenant's embed secret (Settings → Embed).
 */
export const POST = publicHandler<{ tenantSlug: string }>(async (req, { params }) => {
  const slug = params.tenantSlug;
  if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(slug)) throw invalid();
  const rl = await limit(`wh:${slug}`, { capacity: 120, refillPerSec: 2 });
  if (!rl.ok) throw new AppError(429, "rate_limited", "Too many requests, slow down", { retry_after: rl.retryAfter });

  // Read the exact bytes that were signed before parsing anything.
  const raw = await readText(req, 20_000_000);
  const t = await sys<{ id: string; embed_secret_enc: string | null }>(`select id, embed_secret_enc from tenants where slug = $1`, [slug]);
  const tenant = t.rows[0];
  // Unknown tenant and bad signature look identical to the caller (no slug enumeration).
  if (!tenant?.embed_secret_enc) throw invalid();
  const check = verifySignature(decrypt(tenant.embed_secret_enc), raw, {
    signature: req.headers.get("x-me-signature"),
    timestamp: req.headers.get("x-me-timestamp"),
  });
  if (!check.ok) throw invalid();

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new AppError(400, "invalid_json", "The request body isn't valid JSON");
  }
  const defaultSource = req.nextUrl.searchParams.get("source") ?? "other";
  if (!(SIGNAL_SOURCES as readonly string[]).includes(defaultSource)) throw badRequest(`source must be one of: ${SIGNAL_SOURCES.join(", ")}`);
  const items: unknown[] = Array.isArray(body) ? body : Array.isArray((body as Obj)?.signals) ? ((body as Obj).signals as unknown[]) : [body];
  if (items.length > 1000) throw badRequest("Send at most 1,000 signals per request");
  if (!items.every((i) => typeof i === "object" && i !== null && !Array.isArray(i))) throw badRequest("Each signal must be a JSON object");

  const ctx: Ctx = { tenantId: tenant.id, role: "editor", actor: { type: "system", id: `webhook:${slug}` }, userId: null };
  const res = await ingestSignals(ctx, items.map((i) => normalize(i as Obj, defaultSource)));
  return Response.json(res, { status: 202 });
});

/**
 * Route helper for the public REST API (/api/v1/*).
 *
 *   export const GET = handler(async (req, ctx, { params }) => listThings(ctx));
 *
 * Every request gets: a request id, authentication (Bearer API key, or the session
 * cookie for same-origin browser calls), rate limiting (per IP, per principal and per
 * tenant), JSON parsing with size limits, and one error shape:
 *
 *   { "error": { "code": "validation_error", "message": "...", "details": [...] } }
 *
 * Unexpected errors are logged with the request id and returned as a generic 500:
 * no stack traces, SQL or internal messages ever reach the client.
 */
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import type { Ctx } from "./ctx";
import { AppError, unauthorized } from "./errors";
import { authenticateApiKey } from "./apikeys";
import { getSession, ctxFromSession } from "./auth";
import { limit, type LimitOpts } from "./rate-limit";

export type RouteArgs<P> = { params: P; requestId: string; ip: string };
type RouteContext<P> = { params: Promise<P> };

export type HandlerOpts = {
  /** Per-principal bucket (API key or user). Default: burst 120, 2/s sustained. */
  rateLimit?: LimitOpts;
  /** Allow session-cookie auth (same-origin browser calls). Default true. */
  allowSession?: boolean;
};

const IP_LIMIT: LimitOpts = { capacity: 300, refillPerSec: 5 };
const PRINCIPAL_LIMIT: LimitOpts = { capacity: 120, refillPerSec: 2 };
const TENANT_LIMIT: LimitOpts = { capacity: 600, refillPerSec: 10 };
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// ---------- responses ----------

export function json(data: unknown, init: number | ResponseInit = 200): NextResponse {
  const ri = typeof init === "number" ? { status: init } : init;
  return NextResponse.json(data, ri);
}

export function errorResponse(status: number, code: string, message: string, details?: unknown): NextResponse {
  return json({ error: details === undefined ? { code, message } : { code, message, details } }, status);
}

type PgError = { code?: string; severity?: string; routine?: string };
const isPgError = (e: unknown): e is PgError => typeof e === "object" && e !== null && typeof (e as PgError).code === "string" && "severity" in e;

export function toErrorResponse(e: unknown, requestId: string): NextResponse {
  if (e instanceof ZodError) {
    const details = e.issues.map((i) => ({ path: i.path.join("."), code: i.code, message: i.message }));
    return errorResponse(400, "validation_error", details[0] ? `${details[0].path || "body"}: ${details[0].message}` : "Invalid request", details);
  }
  if (e instanceof AppError) return errorResponse(e.status, e.code, e.message, e.details);
  if (isPgError(e)) {
    switch (e.code) {
      case "22P02": // invalid_text_representation (e.g. a malformed uuid)
      case "22007": // invalid_datetime_format
      case "22008":
        return errorResponse(400, "bad_request", "A value in the request has the wrong format");
      case "23503":
        return errorResponse(400, "bad_request", "The request references something that doesn't exist");
      case "23505":
        return errorResponse(409, "conflict", "That already exists");
      case "23514":
        return errorResponse(400, "bad_request", "A value in the request isn't allowed");
      case "57014":
        return errorResponse(503, "timeout", "The request took too long. Try a smaller batch.");
    }
  }
  console.error(`[api] ${requestId} unhandled error`, e);
  return errorResponse(500, "internal_error", "Something went wrong on our side. Quote the request id if you contact support.");
}

// ---------- request helpers ----------

export function clientIp(req: NextRequest): string {
  // Only meaningful behind a proxy that sets these; used for rate limiting, never for auth.
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (xff || req.headers.get("x-real-ip") || "unknown").slice(0, 64);
}

function requestIdFor(req: NextRequest): string {
  const given = req.headers.get("x-request-id");
  return given && /^[A-Za-z0-9._-]{8,64}$/.test(given) ? given : crypto.randomUUID();
}

/** Read the raw body as text with a hard size cap. */
export async function readText(req: NextRequest, maxBytes = 1_000_000): Promise<string> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) throw new AppError(413, "payload_too_large", `Request body is larger than ${maxBytes} bytes`);
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new AppError(413, "payload_too_large", `Request body is larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Parse a JSON body (Content-Type must be application/json), optionally through a zod schema. */
export async function readJson<T = unknown>(req: NextRequest, schema?: ZodType<T>, maxBytes = 1_000_000): Promise<T> {
  const ct = req.headers.get("content-type") ?? "";
  if (!/^application\/(.+\+)?json\b/i.test(ct)) throw new AppError(415, "unsupported_media_type", "Send the body as JSON with Content-Type: application/json");
  const text = await readText(req, maxBytes);
  let data: unknown;
  try {
    data = text.length ? JSON.parse(text) : undefined;
  } catch {
    throw new AppError(400, "invalid_json", "The request body isn't valid JSON");
  }
  return schema ? schema.parse(data) : (data as T);
}

/**
 * For cookie-authenticated, state-changing requests: the browser must prove the call
 * came from our own pages. Modern browsers always send Origin on non-GET requests and
 * Sec-Fetch-Site everywhere; cross-site forms and fetches can't forge either.
 */
export function isSameOrigin(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set<string>();
  try {
    if (process.env.APP_URL) allowed.add(new URL(process.env.APP_URL).origin);
  } catch {
    /* ignore a malformed APP_URL */
  }
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? req.nextUrl.protocol.replace(":", "");
    allowed.add(`${proto}://${host}`);
  }
  return allowed.has(origin);
}

async function rateLimitOrThrow(key: string, o: LimitOpts) {
  const r = await limit(key, o);
  if (!r.ok) throw new AppError(429, "rate_limited", "Too many requests, slow down", { retry_after: r.retryAfter });
  return r;
}

async function authenticate(req: NextRequest, allowSession: boolean): Promise<Ctx> {
  const authz = req.headers.get("authorization");
  if (authz) {
    const ctx = await authenticateApiKey(authz);
    if (!ctx) throw new AppError(401, "unauthorized", "Invalid or revoked API key");
    return ctx;
  }
  if (allowSession) {
    const s = await getSession();
    const ctx = s ? ctxFromSession(s) : null;
    if (ctx) {
      if (!SAFE_METHODS.has(req.method) && !isSameOrigin(req)) throw new AppError(403, "forbidden", "Cross-origin request refused");
      return ctx;
    }
  }
  throw unauthorized();
}

function finish(res: Response, requestId: string, extra?: Record<string, string>): Response {
  res.headers.set("x-request-id", requestId);
  res.headers.set("cache-control", "no-store");
  if (extra) for (const [k, v] of Object.entries(extra)) res.headers.set(k, v);
  return res;
}

function toResponse(out: unknown): Response {
  if (out instanceof Response) return out;
  if (out === undefined) return new Response(null, { status: 204 });
  return json(out);
}

function errorFinish(e: unknown, requestId: string) {
  const res = toErrorResponse(e, requestId);
  const retry = e instanceof AppError && e.status === 429 ? (e.details as { retry_after?: number } | undefined)?.retry_after : undefined;
  return finish(res, requestId, retry !== undefined ? { "retry-after": String(retry) } : undefined);
}

/** An authenticated API route. */
export function handler<P = Record<string, never>>(
  fn: (req: NextRequest, ctx: Ctx, args: RouteArgs<P>) => Promise<unknown>,
  opts: HandlerOpts = {},
) {
  return async (req: NextRequest, route: RouteContext<P>): Promise<Response> => {
    const requestId = requestIdFor(req);
    const ip = clientIp(req);
    try {
      await rateLimitOrThrow(`ip:${ip}`, IP_LIMIT);
      const ctx = await authenticate(req, opts.allowSession ?? true);
      const principal = `${ctx.actor.type}:${ctx.actor.id}`;
      const r = await rateLimitOrThrow(`p:${principal}`, opts.rateLimit ?? PRINCIPAL_LIMIT);
      await rateLimitOrThrow(`t:${ctx.tenantId}`, TENANT_LIMIT);
      const params = ((await route?.params) ?? {}) as P;
      const out = await fn(req, ctx, { params, requestId, ip });
      return finish(toResponse(out), requestId, { "x-ratelimit-remaining": String(r.remaining) });
    } catch (e) {
      return errorFinish(e, requestId);
    }
  };
}

/** A route with no built-in auth (it authenticates itself, e.g. signed webhooks). Still rate limited per IP. */
export function publicHandler<P = Record<string, never>>(
  fn: (req: NextRequest, args: RouteArgs<P>) => Promise<unknown>,
  opts: { rateLimit?: LimitOpts } = {},
) {
  return async (req: NextRequest, route: RouteContext<P>): Promise<Response> => {
    const requestId = requestIdFor(req);
    const ip = clientIp(req);
    try {
      await rateLimitOrThrow(`ip:${ip}`, opts.rateLimit ?? IP_LIMIT);
      const params = ((await route?.params) ?? {}) as P;
      return finish(toResponse(await fn(req, { params, requestId, ip })), requestId);
    } catch (e) {
      return errorFinish(e, requestId);
    }
  };
}

/** Small query-string helpers. */
export function intParam(v: string | null, def: number, min: number, max: number): number {
  if (v === null || v === "") return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new AppError(400, "bad_request", `Expected an integer between ${min} and ${max}`);
  return n;
}

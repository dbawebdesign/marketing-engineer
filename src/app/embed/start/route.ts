import { NextResponse, type NextRequest } from "next/server";
import { clientIp } from "@/lib/api";
import { EMBED_ERROR_MESSAGES, EmbedTokenError, safeEmbedPath, verifyEmbedToken } from "@/lib/embed";
import { limit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const ORIGIN_RE = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i;

// The token sits in this URL: never send it onward in a Referer, never cache the response.
const HEADERS = { "referrer-policy": "no-referrer", "cache-control": "no-store" };

function errorPage(status: number, message: string) {
  const esc = message.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Can't open</title>
<style>body{font:14px/1.5 system-ui,sans-serif;color:#334155;background:#fff;margin:0;display:grid;place-items:center;min-height:160px}@media(prefers-color-scheme:dark){body{background:#0b1220;color:#cbd5e1}}p{max-width:440px;padding:16px;text-align:center}</style>
</head><body><p>${esc}</p></body></html>`;
  return new NextResponse(html, { status, headers: { ...HEADERS, "content-type": "text/html; charset=utf-8" } });
}

/**
 * GET /embed/start?token=<jwt>&path=/drafts&theme=dark&parent_origin=https://app.host.com
 * Verifies the embed token, starts an embed session (SameSite=None; Partitioned cookie)
 * and redirects to /embed{path} (default /embed/today).
 */
export async function GET(req: NextRequest) {
  const rl = await limit(`embed:${clientIp(req)}`, { capacity: 30, refillPerSec: 0.5 });
  if (!rl.ok) return errorPage(429, "Too many attempts. Try again in a minute.");

  const sp = req.nextUrl.searchParams;
  const token = sp.get("token");
  if (!token) return errorPage(400, "Missing embed token.");
  const path = safeEmbedPath(sp.get("path"));
  if (path === null) return errorPage(400, "Invalid path.");

  try {
    const start = await verifyEmbedToken(token, { referer: req.headers.get("referer"), secFetchDest: req.headers.get("sec-fetch-dest") });
    const dest = new URL(`/embed${path || "/today"}`, req.nextUrl);
    const theme = sp.get("theme");
    if (theme === "light" || theme === "dark" || theme === "auto") dest.searchParams.set("theme", theme);
    // The embedded pages use this as the postMessage targetOrigin for me:resize / me:event.
    const parent = sp.get("parent_origin")?.toLowerCase();
    if (parent && ORIGIN_RE.test(parent) && (!start.allowedOrigins.length || start.allowedOrigins.map((o) => o.toLowerCase()).includes(parent))) {
      dest.searchParams.set("parent_origin", parent);
    }
    return NextResponse.redirect(dest, { status: 303, headers: HEADERS });
  } catch (e) {
    if (e instanceof EmbedTokenError) return errorPage(401, EMBED_ERROR_MESSAGES[e.reason]);
    console.error("[embed/start] failed", e);
    return errorPage(500, "Something went wrong opening this view.");
  }
}

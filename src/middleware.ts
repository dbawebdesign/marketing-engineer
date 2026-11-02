import { CSP } from "@/lib/csp";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Framing policy for the embeddable surface (/embed/*).
 *
 * Ideally frame-ancestors would list exactly the requesting tenant's allowed_origins.
 * Middleware runs in the edge runtime, which can't reach Postgres through `pg`, and the
 * tenant isn't known until the embed token or session is resolved. So the tradeoff is:
 *
 *  1. Here (edge): a deployment-wide allow-list from ME_EMBED_FRAME_ANCESTORS, e.g.
 *     "https://app.customer-a.com https://*.customer-b.com". Defaults to * in development
 *     and to 'self' in production, so nothing can frame the app until an operator opts in.
 *  2. Server side, per tenant: /embed/start refuses tokens whose signed `origin` claim isn't
 *     in the tenant's allowed_origins, and cross-checks Referer and Sec-Fetch-Dest
 *     (see checkEmbedOrigin in src/lib/embed.ts).
 *  3. Browser: the embed session cookie is SameSite=None; Partitioned (CHIPS), so it is only
 *     ever sent under the top-level site where the session was started. A different site
 *     framing /embed/* sees a signed-out page, which limits clickjacking even when
 *     frame-ancestors is broad.
 *
 * Multi-tenant SaaS deployments with many customers should either keep the env list in sync
 * with tenant settings, or move this check into the /embed layout (Node runtime) where it can
 * set a per-tenant header from the session.
 *
 * Embed rendering: /embed/<path> (except /embed/start and /embed/expired) is REWRITTEN to
 * /<path> (/embed itself to /today) with the request header `x-me-embed: 1`, which the app
 * layout uses to render the compact embedded shell. The header is stripped from every other
 * incoming request so it can't be spoofed.
 *
 * All other routes keep the defaults from next.config.ts (X-Frame-Options: DENY etc.).
 */
const SOURCE_RE = /^(\*|'self'|'none'|https?:\/\/(\*\.)?[a-z0-9.-]+(:\d{1,5}|:\*)?|https?:|\*\.[a-z0-9.-]+)$/i;

function frameAncestors(): string {
  const raw = process.env.ME_EMBED_FRAME_ANCESTORS?.trim();
  if (!raw) return process.env.NODE_ENV === "production" ? "'self'" : "*";
  // Drop anything that isn't a plain CSP source so a typo can't inject other directives.
  const parts = raw.split(/[\s,]+/).filter((s) => SOURCE_RE.test(s));
  if (!parts.length) return "'self'";
  if (parts.includes("'none'")) return "'none'";
  if (parts.includes("*")) return "*";
  return ["'self'", ...parts.filter((p) => p !== "'self'")].join(" ");
}

/** Embed-mode marker read by the app layout. Only middleware may set it. */
const EMBED_HEADER = "x-me-embed";
// /embed/<these> are real routes, not rewritten app pages.
const EMBED_OWN_ROUTES = new Set(["start", "expired"]);

export function middleware(req: NextRequest) {
  // Never trust an incoming embed marker: strip it from every request.
  const headers = new Headers(req.headers);
  headers.delete(EMBED_HEADER);

  const { pathname } = req.nextUrl;
  if (pathname !== "/embed" && !pathname.startsWith("/embed/")) {
    return NextResponse.next({ request: { headers } });
  }

  const rest = pathname.slice("/embed".length); // "" | "/" | "/drafts/123"
  const first = rest.split("/")[1] ?? "";
  let res: NextResponse;
  if (EMBED_OWN_ROUTES.has(first)) {
    res = NextResponse.next({ request: { headers } });
  } else {
    // The embedded UI is the regular app, rendered in a compact shell (base path /embed).
    const url = req.nextUrl.clone();
    url.pathname = rest && rest !== "/" ? rest : "/today";
    headers.set(EMBED_HEADER, "1");
    res = NextResponse.rewrite(url, { request: { headers } });
  }
  res.headers.set("Content-Security-Policy", `${CSP}; frame-ancestors ${frameAncestors()}`);
  return res;
}

// Every page route (so the marker is always stripped), except Next internals, the API and
// public files with an extension (e.g. /embed/v1.js).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api/|.*\\.[A-Za-z0-9]+$).*)"],
};

import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

// Content Security Policy. The point is containment: agent output derives from untrusted
// customer text, so the page may only load images, fonts and data from this origin.
const dev = process.env.NODE_ENV !== "production";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  reactStrictMode: true,
  output: "standalone",
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["@node-rs/argon2", "pg"],
  async headers() {
    return [
      // App pages may not be framed, except the /embed surface (frame-ancestors set per tenant in middleware).
      {
        source: "/((?!embed).*)",
        headers: [...securityHeaders, { key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: `${csp}; frame-ancestors 'none'` }],
      },
      // frame-ancestors for /embed comes from middleware as a second policy; both are enforced.
      { source: "/embed/:path*", headers: [...securityHeaders, { key: "Content-Security-Policy", value: csp }] },
      // The start URL carries a (single-use) token: never leak it via Referer.
      { source: "/embed/start", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

export default config;

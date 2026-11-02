import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  reactStrictMode: true,
  output: "standalone",
  serverExternalPackages: ["@node-rs/argon2", "pg"],
  async headers() {
    return [
      // App pages may not be framed, except the /embed surface (frame-ancestors set per tenant in middleware).
      { source: "/((?!embed).*)", headers: [...securityHeaders, { key: "X-Frame-Options", value: "DENY" }] },
      { source: "/embed/:path*", headers: securityHeaders },
      // The start URL carries a (single-use) token: never leak it via Referer.
      { source: "/embed/start", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

export default config;

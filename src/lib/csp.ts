/**
 * Content Security Policy shared by next.config (app pages) and middleware (embed pages,
 * which add a per-deployment frame-ancestors). The point is containment: agent output
 * derives from untrusted customer text, so pages may only load images, fonts and data
 * from this origin.
 */
const dev = process.env.NODE_ENV !== "production";

export const CSP = [
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

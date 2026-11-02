#!/usr/bin/env node
/**
 * Mint a Marketing Engineer embed token on YOUR backend (never in the browser).
 *
 *   ME_TENANT=dispatchly ME_EMBED_SECRET=... node mint-token.mjs user-123 jane@host.com "Jane Doe" editor
 *   node mint-token.mjs --serve     # tiny demo host on http://localhost:5173 serving index.html + /token
 *
 * Requires `jose` (npm i jose). The embed secret is in Settings → Embed.
 */
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const tenant = process.env.ME_TENANT;
const secret = process.env.ME_EMBED_SECRET;
if (!tenant || !secret) {
  console.error("Set ME_TENANT (workspace slug) and ME_EMBED_SECRET");
  process.exit(1);
}

export async function mintEmbedToken({ userId, email, name, role = "editor", origin }) {
  return new SignJWT({ email, name, role, ...(origin ? { origin } : {}) })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(tenant) // workspace slug
    .setSubject(String(userId)) // your stable user id
    .setIssuedAt()
    .setExpirationTime("10m") // max 1h; tokens are single-use, mint one per page load
    .setJti(randomUUID())
    .sign(new TextEncoder().encode(secret));
}

if (process.argv[2] === "--serve") {
  const port = Number(process.env.PORT ?? 5173);
  const origin = `http://localhost:${port}`;
  createServer(async (req, res) => {
    if (req.url === "/token") {
      // In a real app: authenticate your user first, then mint for *them*.
      const token = await mintEmbedToken({ userId: "demo-user-1", email: "jane@host.example", name: "Jane (host app)", role: "editor", origin });
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(JSON.stringify({ token }));
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(readFileSync(new URL("./index.html", import.meta.url)));
  }).listen(port, () => console.log(`demo host on ${origin}`));
} else {
  const [userId = "user-123", email, name, role] = process.argv.slice(2);
  console.log(await mintEmbedToken({ userId, email, name, role, origin: process.env.ME_ORIGIN }));
}

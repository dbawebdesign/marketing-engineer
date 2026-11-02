import { sys } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/health — liveness + database reachability. No auth, no internals. */
export async function GET() {
  const headers = { "cache-control": "no-store" };
  try {
    await sys("select 1");
    return Response.json({ ok: true, db: "ok" }, { headers });
  } catch {
    return Response.json({ ok: false, db: "unreachable" }, { status: 503, headers });
  }
}

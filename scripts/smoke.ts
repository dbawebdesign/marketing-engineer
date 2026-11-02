/** End-to-end smoke test of the core loop without the web layer. */
import { sys, pools } from "@/lib/db";
import { listAgents, runAgent } from "@/server/services/agents";
import { listDrafts, reviewDraft } from "@/server/services/drafts";
import { getDoc } from "@/server/services/memory";
import { drain } from "@/server/worker-core";

const u = await sys<{ user_id: string; tenant_id: string }>(`select m.user_id, m.tenant_id from memberships m join users u on u.id=m.user_id where u.email=$1`, ["demo@dispatchly.test"]);
const { user_id, tenant_id } = u.rows[0]!;
const ctx = { tenantId: tenant_id, userId: user_id, role: "owner" as const, actor: { type: "user" as const, id: user_id } };
const agents = await listAgents(ctx);
console.log("agents:", agents.map((a) => `${a.name} (${a.system})`).join(", "));
const truth = agents.find((a) => a.system === "customer_truth")!;
const runId = await runAgent(ctx, truth.id);
console.log("drained", await drain("smoke"));
const drafts = await listDrafts(ctx, { status: "pending" });
console.log(drafts[0]?.title, "evidence:", drafts[0]?.evidence.length);
console.log(drafts[0]?.body.slice(0, 1500));
const r = await reviewDraft(ctx, drafts[0]!.id, { decision: "approve", feedback: "Always split by shop size (techs).", remember: true });
console.log(r);
console.log("truth file v", (await getDoc(ctx, "customer-truth/what-the-market-is-telling-us"))?.version, runId);
await pools().app.end(); await pools().sys.end();

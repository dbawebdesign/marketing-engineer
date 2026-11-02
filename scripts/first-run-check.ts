/** Dev tool: sign up a throwaway workspace, add a small set of signals, run every agent once and print what a new user would see.
 *  npx tsx scripts/first-run-check.ts -- <scenario: five|three|mixed> */
import { sys, withTenant, pools } from "@/lib/db";
import { signup } from "@/server/services/tenants";
import { ingestSignals, type SignalInputT } from "@/server/services/signals";
import { listAgents } from "@/server/services/agents";
import { executeRun } from "@/server/agents/runner";

const SCENARIOS: Record<string, SignalInputT[]> = {
  five: [
    { source: "sales_call", account: "Brightline Plumbing", title: "Discovery call", content: "Talked to Dana, ops manager at Brightline Plumbing. They have 12 techs and schedule everything on a whiteboard. Dana said jobs get double booked at least twice a week." },
    { source: "sales_call", account: "Brightline Plumbing", title: "Follow-up call", content: "Second call with Brightline. Dana wants techs to see the day's schedule on their phones. She asked whether we integrate with QuickBooks for invoicing." },
    { source: "sales_call", account: "Brightline Plumbing", title: "Demo", content: "Demo for Dana and the owner Mike. Mike liked the drag and drop schedule. Mike asked about price per tech and said the current tool is cheaper." },
    { source: "sales_call", account: "Brightline Plumbing", title: "Pricing call", content: "Pricing discussion with Mike at Brightline. He thinks per tech pricing is hard to justify for a 12 tech shop. Dana still worried about double booked jobs." },
    { source: "sales_call", account: "Brightline Plumbing", title: "Check-in", content: "Quick check-in with Dana. They are comparing us with Jobber. Dana said the whiteboard is a mess on Mondays when emergency calls come in." },
  ],
  three: [
    { source: "sales_call", account: "Northwind Electric", content: "Call with Sam at Northwind Electric, 8 electricians. Sam said customers keep calling to ask when the tech will arrive." },
    { source: "support_ticket", account: "Acme HVAC", content: "Customer reports that the mobile app logs techs out every morning. They have to sign in again before the first job." },
    { source: "sales_call", account: "Lakeside Roofing", content: "Spoke with Priya at Lakeside Roofing. Priya said quotes take two days to send because estimates are typed up at night." },
  ],
  mixed: [
    { source: "sales_call", account: "Northwind Electric", content: "Call with Sam at Northwind Electric, 8 electricians. Sam said customers keep calling to ask when the tech will arrive. He wants automatic arrival texts.", metadata: { outcome: "won" } },
    { source: "sales_call", account: "Lakeside Roofing", content: "Spoke with Priya at Lakeside Roofing. Priya said quotes take two days to send because estimates are typed up at night. She wants arrival texts too.", metadata: { outcome: "won" } },
    { source: "sales_call", account: "Pine Street Plumbing", content: "Pine Street Plumbing went with a cheaper tool. Owner said our price per tech was too high for a 5 person shop.", metadata: { outcome: "lost" } },
    { source: "support_ticket", account: "Acme HVAC", content: "Customer reports that the mobile app logs techs out every morning. They have to sign in again before the first job." },
    { source: "support_ticket", account: "Delta Mechanical", content: "Office manager cannot find where to invite teammates. She says the settings page is confusing." },
    { source: "review", title: "G2 review", content: "Arrival texts cut our where-is-my-tech calls in half. Setup took longer than expected but support was quick." },
    { source: "churn_note", account: "Oak Ridge HVAC", content: "Oak Ridge cancelled after three months. They said the office never adopted it because inviting the team was confusing." },
    { source: "social", account: "Summit Heating", title: "LinkedIn post", content: "Summit Heating is hiring two dispatchers for our new Denver branch. We are growing fast, now 30 techs.", metadata: { trigger: "hiring", role: "Dispatcher" } },
  ],
};

/** Docs a new user might have filled in by their first run (intro answers plus a couple of lists). */
const DOCS: Record<string, string> = {
  "ai-search/company-facts": "Fieldbook is scheduling and dispatch software for plumbing, HVAC and electrical shops.\nPricing: $29 per tech per month, no setup fee.\nFeatures: drag-and-drop schedule, automatic arrival texts, mobile app for techs.\nIntegrations: QuickBooks Online.",
  "outbound/icp": "Owners and office managers at trades shops with 5-40 techs. Not solo operators.",
  "outbound/approved-angles": "- Arrival texts stop the where-is-my-tech calls\n- A schedule the whole crew can see on their phones",
  "ai-search/buyer-questions": "What is the best scheduling software for a small plumbing company?\nDoes Fieldbook send arrival texts to customers?\nHow much does Fieldbook cost?\nDoes Fieldbook do payroll?",
};

const scenario = process.argv.slice(2).filter((a) => a !== "--")[0] ?? "five";
const withDocs = scenario.endsWith("+docs");
const signals = SCENARIOS[scenario.replace(/\+docs$/, "")];
if (!signals) throw new Error(`unknown scenario ${scenario}`);
const stamp = Date.now().toString(36);
const { userId, tenantId } = await signup({ name: "Test Owner", email: `firstrun-${scenario.replace("+", "-")}-${stamp}@example.test`, password: "correct-horse-battery", company: `Firstrun ${scenario.replace("+", " ")} ${stamp}` });
const slug = (await sys<{ slug: string }>(`select slug from tenants where id = $1`, [tenantId])).rows[0]!.slug;
const ctx = { tenantId, userId, role: "owner" as const, actor: { type: "user" as const, id: userId } };
await ingestSignals(ctx, signals);
if (withDocs) {
  const { saveDoc } = await import("@/server/services/memory");
  for (const [k, v] of Object.entries(DOCS)) await saveDoc(ctx, k, v);
}
console.log(`# workspace ${slug} (${signals.length} signals)\n`);
const agents = await listAgents(ctx, { readiness: true });
for (const a of agents) {
  console.log(`## ${a.name}: ready=${a.readiness?.ready} signals=${a.readiness?.signals} reason=${a.readiness?.reason ?? "-"}`);
  const runId = await withTenant(tenantId, async (tx) => (await tx.query<{ id: string }>(`insert into runs(tenant_id, agent_id, trigger, requested_by, input) values ($1,$2,'manual',$3,'{}') returning id`, [tenantId, a.id, userId])).rows[0]!.id);
  await executeRun(tenantId, runId);
  const r = await withTenant(tenantId, async (tx) => (await tx.query<{ status: string; summary: string; input: { stats?: unknown } }>(`select status, summary, input from runs where id = $1`, [runId])).rows[0]!);
  console.log(`status=${r.status} summary=${r.summary}\nstats=${JSON.stringify(r.input.stats)}`);
  const d = await withTenant(tenantId, async (tx) => (await tx.query<{ title: string; body: string; payload: Record<string, unknown> }>(`select title, body, payload from drafts where run_id = $1`, [runId])).rows);
  for (const x of d) console.log(`--- draft: ${x.title}\n${x.body}\n${x.payload.recommended_test ? `recommended_test=${JSON.stringify(x.payload.recommended_test)}` : ""}`);
  console.log();
}
await pools().app.end();
await pools().sys.end();

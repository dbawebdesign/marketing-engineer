import { withTenant } from "@/lib/db";
import type { Ctx } from "@/lib/ctx";
import { assertCan } from "@/lib/ctx";
import { ingestSignals, type SignalInputT } from "./services/signals";
import { writeDocTx } from "./services/memory";
import { audit } from "./services/audit";
import { SAMPLE_TAG } from "./services/sample";

/**
 * Sample data: a vertical SaaS company ("Dispatchly") selling field-service software to
 * commercial HVAC contractors. Lets anyone see every system working in under a minute.
 */
const d = (daysAgo: number, hour = 10) => {
  const t = new Date(Date.now() - daysAgo * 864e5);
  t.setUTCHours(hour, 0, 0, 0);
  return t;
};

export const DEMO_SIGNALS: SignalInputT[] = [
  { source: "sales_call", title: "Discovery: Polar Mechanical (34 techs)", account: "Polar Mechanical", occurred_at: d(1), metadata: { outcome: "won", techs: 34 },
    content: "Owner said dispatch is a mess on Mondays but they live with it. What actually got him leaning in: his techs spot failing rooftop units on service calls and the replacement quote never gets sent. He estimated they lose two or three replacement jobs a month that way. He asked if the tech can trigger the quote from the truck before leaving the site." },
  { source: "sales_call", title: "Demo: Brightline HVAC (22 techs)", account: "Brightline HVAC", occurred_at: d(2), metadata: { outcome: "won", techs: 22 },
    content: "Service manager opened with emergency dispatch, but the moment we showed the follow-up quote flow she said that's the money. Their techs write notes on paper and the office never turns them into quotes. She said every completed job should create the next quote. Wants a pilot with five techs." },
  { source: "sales_call", title: "Discovery: Kessler Air (8 techs)", account: "Kessler Air", occurred_at: d(2), metadata: { outcome: "lost", techs: 8 },
    content: "Small shop, owner does dispatch himself from his phone. Main complaint was emergency dispatch at night and juggling the on-call schedule. Price was a concern: he said anything per-tech is hard to justify with eight guys. Not interested in quoting features." },
  { source: "sales_call", title: "Demo: Summit Climate Services (41 techs)", account: "Summit Climate Services", occurred_at: d(3), metadata: { outcome: "won", techs: 41 },
    content: "CFO joined the call. Their problem is they have no idea which jobs were profitable until month end close. But what moved the decision was replacement revenue: their best tech generates most of their equipment sales because he's the only one who follows up. They want every tech to follow up like him." },
  { source: "sales_call", title: "Discovery: Ridgeway Heating (12 techs)", account: "Ridgeway Heating", occurred_at: d(4), metadata: { outcome: "open", techs: 12 },
    content: "Operations lead talked mostly about emergency dispatch and getting the right tech to the right job. Asked about integrations with QuickBooks. Said the follow-up quote idea is interesting but not urgent right now." },
  { source: "sales_call", title: "Demo: Ironclad Mechanical (27 techs)", account: "Ironclad Mechanical", occurred_at: d(5), metadata: { outcome: "won", techs: 27 },
    content: "Owner said they missed a $48,000 chiller replacement last quarter because the tech noted the compressor was failing and nobody followed up. A competitor got the job three weeks later. He wants follow-up quotes tracked like tickets so nothing falls through." },
  { source: "sales_call", title: "Discovery: Coastal Comfort (6 techs)", account: "Coastal Comfort", occurred_at: d(6), metadata: { outcome: "lost", techs: 6 },
    content: "Mostly residential with a few commercial accounts. Emergency dispatch on weekends is the pain. Went with a cheaper residential tool. Said our product felt built for bigger commercial shops." },
  { source: "support_ticket", title: "Quote created from job doesn't include photos", account: "Brightline HVAC", occurred_at: d(1, 14),
    content: "When a tech creates a follow-up quote from a completed job, the photos of the failing unit are not attached. Customers ask for the photos before approving a replacement. Please carry job photos into the quote automatically." },
  { source: "support_ticket", title: "Techs not inviting office staff", account: "Ridgeway Heating", occurred_at: d(2, 15),
    content: "Trial account. Owner set up three techs but never invited the office manager, so nobody is converting tech notes into quotes. Asked how to invite a teammate, the invite button is buried in settings." },
  { source: "support_ticket", title: "Invite teammate flow confusing", account: "Harbor Mechanical", occurred_at: d(3, 9),
    content: "Trial user stuck: could not find where to invite a teammate. Spent twenty minutes looking. Said the trial is pointless if the office can't see what the techs log." },
  { source: "support_ticket", title: "Emergency dispatch notifications delayed", account: "Polar Mechanical", occurred_at: d(4, 11),
    content: "Push notifications for emergency dispatch arrive two to three minutes late on Android. Night on-call techs are missing the first alert." },
  { source: "churn_note", title: "Churned: Valley Air Pros", account: "Valley Air Pros", occurred_at: d(5, 16),
    content: "Cancelled after four months. Said they used it only for scheduling and their old tool does scheduling fine. Never set up quotes. Their account manager noted they never invited the office team." },
  { source: "churn_note", title: "Churned: Metro Duct & Air", account: "Metro Duct & Air", occurred_at: d(6, 13),
    content: "Left for a competitor that bundles payroll. The owner said dispatch was fine but they didn't see the revenue upside. In the exit call: if we had shown them the replacement revenue they were missing, they would have stayed." },
  { source: "crm_note", title: "Inbound demo request: Northgate Facilities", account: "Northgate Facilities", occurred_at: d(1, 12),
    content: "Inbound from the lost replacement revenue calculator. 55 techs. Note on the form: we know we are leaving replacement jobs on the table, we just can't see how many." },
  { source: "crm_note", title: "Inbound demo request: Apex Refrigeration", account: "Apex Refrigeration", occurred_at: d(3, 10),
    content: "Came from a LinkedIn post about the hidden revenue leak in service businesses. 19 techs. Wants to see how follow-up quotes are tracked." },
  { source: "review", title: "G2 review, 5 stars", account: "Summit Climate Services", occurred_at: d(2, 18),
    content: "The follow-up quote feature paid for the whole year in the first month. Our techs flag replacement opportunities from the truck and the office sends the quote the same day." },
  { source: "review", title: "Capterra review, 3 stars", occurred_at: d(4, 19),
    content: "Dispatch board is solid. Setup took longer than expected and inviting the office staff was confusing. Reporting on job profitability needs work." },
  { source: "social", title: "Reddit r/HVAC thread", url: "https://www.reddit.com/r/HVAC/", occurred_at: d(2, 20),
    content: "Owner of a 20 truck commercial shop: biggest leak in our business is techs who see a dying unit and never tell anyone. The quote just never gets sent. How do you all track replacement opportunities?" },
  { source: "social", title: "LinkedIn post: hiring dispatcher", account: "Frontier Mechanical", url: "https://www.linkedin.com/", occurred_at: d(1, 9), metadata: { trigger: "hiring", role: "Dispatcher", techs: 30 },
    content: "Frontier Mechanical is hiring a full-time dispatcher for our commercial service team. Growing fast, 30 techs and counting. Experience with service scheduling software a plus." },
  { source: "social", title: "News: new branch opening", account: "Granite State HVAC", url: "https://example.com/news/granite-state-hvac", occurred_at: d(2, 9), metadata: { trigger: "new_location", techs: 25 },
    content: "Granite State HVAC announced a second branch in Manchester, adding 10 commercial service technicians to its current team of 25 by spring." },
  { source: "social", title: "Google review: 1 star", account: "Lakeside Comfort Systems", url: "https://maps.google.com/", occurred_at: d(3, 9), metadata: { trigger: "bad_review", techs: 18 },
    content: "Tech told us our rooftop unit was failing and said someone would send a quote. Nobody ever called. Three weeks later it died in a heat wave. Lakeside Comfort Systems lost our business." },
  { source: "social", title: "Funding announcement", account: "Copperline Services", url: "https://example.com/news/copperline", occurred_at: d(4, 9), metadata: { trigger: "funding", techs: 60 },
    content: "Copperline Services, a commercial HVAC and refrigeration contractor, raised growth capital to acquire regional service companies and standardize operations across 60 technicians." },
  { source: "interview", title: "Customer interview: Polar Mechanical service manager", account: "Polar Mechanical", occurred_at: d(5, 15),
    content: "The quote is the handoff that breaks. The tech knows the unit is dying, the customer trusts the tech, and then it goes into a black hole at the office. If the tech could hit one button and the customer got a quote with photos that afternoon, we'd close most of them." },
];

export const DEMO_DOCS: Record<string, string> = {
  "content/founder-voice": `# Founder voice: Maya Chen, CEO of Dispatchly

Maya ran dispatch at her family's commercial HVAC company for nine years before starting Dispatchly.

## How she sounds
- Direct, warm, a little dry. Talks like someone who has been on a rooftop in August.
- Uses numbers from the field, not from decks.
- Short paragraphs. One idea per post.

## Posts she loves
- "Your best tech isn't your best tech because he's fastest. It's because he follows up."
- "Every completed job should create the next quote. Most shops lose that handoff between the truck and the office."

## Never
- "Revolutionize", "game-changer", "unlock", "leverage", emojis in the first line, hashtags walls.
- Talking down to contractors. They run real businesses.`,
  "outbound/icp": `# Ideal customer profile

**Buy:** Commercial HVAC and refrigeration contractors with 15–80 technicians, doing maintenance contracts and service calls, with an office team (dispatcher, service manager) separate from the field.

**Don't buy:** Residential-first shops under 10 techs. Owner-dispatchers. New construction only.

**Triggers that make this week the right week:** hiring a dispatcher or service manager; opening a new branch; a public review complaining about missed follow-up; acquisition or funding to consolidate service companies.

**Who signs:** Owner or GM. Service manager is the champion. CFO joins above ~30 techs.`,
  "outbound/approved-angles": `- Lost replacement revenue after the service call
- Every completed job should create the next quote
- Make every tech follow up like your best tech`,
  "outbound/banned-language": `- "I hope this email finds you well"
- "Quick question"
- "I noticed you..." as an opener
- "Revolutionize", "synergy", "circle back"
- Fake familiarity: "Loved your recent post!" unless we quote the post
- Any claim about their revenue we can't back up`,
  "creative/offers": `# Offers
1. **Lost replacement revenue calculator**: techs × service calls × missed follow-ups × average replacement value.
2. **Five-tech pilot**: 30 days, follow-up quotes only, priced flat.`,
  "ai-search/company-facts": `Dispatchly is field-service software for commercial HVAC and refrigeration contractors with 15 to 80 technicians.
Core: dispatch board, maintenance contracts, mobile app for techs, and follow-up quotes created from completed jobs (with photos).
Pricing: per technician per month, with a flat-priced five-tech pilot.
Proof: Summit Climate Services (41 techs) reported the follow-up quote feature paid for the year in the first month.
Integrations: QuickBooks Online, QuickBooks Desktop.`,
  "ai-search/buyer-questions": `What is the best field service software for commercial HVAC contractors?
How do HVAC companies track replacement opportunities from service calls?
ServiceTitan alternatives for commercial HVAC
How can HVAC techs send quotes from the field?
What software helps HVAC contractors increase equipment replacement sales?`,
};

/**
 * Load the sample. Every row is tagged sample (see services/sample.ts) so it can be told
 * apart and cleared. Memory docs are only written for the dedicated demo workspace
 * (`docs: true`, used by the seed script): a real workspace never gets Dispatchly's
 * voice, ICP or facts in its memory, so agents run on the workspace's own (possibly empty) docs.
 */
export async function loadDemo(ctx: Ctx, opts: { docs?: boolean } = {}) {
  assertCan(ctx, "settings:manage");
  const res = await ingestSignals(
    ctx,
    DEMO_SIGNALS.map((s) => ({ ...s, metadata: { ...(s.metadata ?? {}), ...SAMPLE_TAG } })),
  );
  await withTenant(ctx.tenantId, async (tx) => {
    if (opts.docs) {
      for (const [key, content] of Object.entries(DEMO_DOCS)) {
        const cur = await tx.query<{ content: string }>(`select content from memory_docs where key = $1`, [key]);
        if (!cur.rows[0]?.content.trim()) await writeDocTx(tx, ctx, key, content, { note: "Sample data", authorKind: "system" });
      }
    }
    // Two weeks of channel results so the cockpit has something to read.
    const angles = [
      { angle: "Lost replacement revenue", clicks: 38, demos: 9, replies: 7 },
      { angle: "Emergency dispatch", clicks: 71, demos: 4, replies: 3 },
      { angle: "Job profitability", clicks: 22, demos: 2, replies: 1 },
    ];
    const existing = await tx.query(`select 1 from metric_events limit 1`);
    if (!existing.rowCount) {
      for (const a of angles) {
        for (const [kind, n] of [["click", a.clicks], ["demo_request", a.demos], ["qualified_reply", a.replies]] as const) {
          for (let i = 0; i < n; i++) {
            await tx.query(`insert into metric_events(tenant_id, kind, angle, source, occurred_at, metadata) values ($1,$2,$3,'sample', now() - make_interval(hours => $4), $5)`, [
              ctx.tenantId, kind, a.angle, Math.floor(Math.random() * 13 * 24), SAMPLE_TAG,
            ]);
          }
        }
      }
    }
    await audit(tx, ctx, "demo.load", undefined, { signals: res.inserted });
  });
  return res;
}

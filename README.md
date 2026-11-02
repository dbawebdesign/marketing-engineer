# Marketing Engineer

**Turn market signal into pipeline with AI agents, data, and taste.**

Marketing Engineer is a multi-tenant, embeddable platform that runs a company's "Growth OS": a shared marketing memory plus a team of AI agents, each with a written job spec, that turn what customers actually say into insight, content, outbound, creative tests and AI-search visibility. Nothing ships without a human approval, and every claim carries a verified receipt.

It implements the six systems of the marketing engineer role:

| System | Agent | What it produces | Approval effect |
|---|---|---|---|
| Customer truth | Market pulse | "What the market is telling us": what changed, buyers' own words, objections, converted vs. lost, one test to run this week | Becomes the truth file every other agent reads; queues the recommended test |
| Founder content | Content drafter | Posts in the founder's voice from real customer pain, plus asset ideas (calculators, landing lines) | Approved posts form the content library |
| Outbound signals | Signal outreach | Trigger-based outreach (hiring, new branch, bad review, funding), ICP fit scores, first lines tied to the trigger | Approved messages ready to send |
| Creative testing | Hook lab | 20 hooks across angles + 10 ad concepts for one offer | Starts an experiment with the variants |
| AI search visibility | AI visibility | Answer-ready copy for the questions buyers ask AI assistants, grounded only in company facts, plus FAQPage JSON-LD and a list of missing facts | Answer pack ready to publish |
| Growth cockpit | Weekly cockpit | The weekly eval: which angle drove clicks vs. demos and qualified replies, tests won, what to test next | Becomes the weekly brief |

## The loop

1. **Signals in.** Paste notes, upload CSV, call the API, or point Gong/Zendesk/HubSpot webhooks at it. Idempotent on content.
2. **Agents run** on their schedule (cron per agent) or on demand. Each reads the Growth OS memory, its standing rules, recent review feedback, and the signal window.
3. **Receipts are verified.** Every quote an agent cites is checked verbatim against the cited signal. Unverifiable quotes are discarded, and claims left without a receipt are dropped and counted.
4. **You review in the Inbox.** Approve, edit then approve, or reject with a reason. Tick "teach the agent" and the reason becomes a standing rule: corrections compound.
5. **Approval applies the effect**: the truth file updates (versioned), experiments start, the weekly brief publishes.
6. **The cockpit closes the loop** with business metrics (qualified replies, demo requests), not activity counts.

## Architecture

```
 Browser / host app iframe ──► Next.js (App Router)
                                 ├─ Server components + server actions (UI)
                                 ├─ /api/v1 REST (API keys, rate limited)
                                 ├─ /api/v1/webhooks/signals/:tenant (HMAC signed)
                                 └─ /embed/* (signed JWT → partitioned session)
                                        │
                              Service layer (Ctx: tenant, role, actor)
                                        │
          ┌─────────────────────────────┼──────────────────────────────┐
     Postgres (RLS)               jobs table (outbox,              Claude API
 tenant isolation enforced        FOR UPDATE SKIP LOCKED)    structured outputs
 by the database itself                 │                    claude-opus-5-5 (deep)
                                  Worker(s): scheduler +     claude-sonnet-5-5 (fast)
                                  agent runner, scale out
```

- **Multi-tenancy in the database.** The app connects as a non-owner role. Every tenant query runs in a transaction that sets `app.tenant_id`, and Row Level Security policies (`FORCE`d) refuse cross-tenant reads and writes even if application code has a bug. A separate owner pool is used only for identity lookups and the job queue.
- **Transactional outbox.** Runs and their jobs are written in the same tenant transaction, so a run is never lost or orphaned. Workers claim jobs with `SKIP LOCKED`, retry with exponential backoff, and reap stuck work. Add workers to scale; no extra infrastructure.
- **Agents as job specs.** Each template declares its data sources, schedule, filters, expected output, what good looks like, approval step, metric, and where it writes. Admins edit specs and schedules per tenant.
- **Structured outputs.** Agent output is schema-constrained JSON (zod → `output_config.format`), validated, then rendered. Prompts keep the stable system prompt cached.
- **Offline engine.** Without an API key every agent still runs on a deterministic engine (frequency and contrast analysis over the signals), so demos, tests and air-gapped evaluations work. Receipts are verified the same way.

## Security

- Argon2id passwords; opaque session tokens (only SHA-256 hashes stored), httpOnly cookies, SameSite=Lax (web) / None+Partitioned (embed).
- RBAC: owner, admin, editor, viewer; API key scopes map to roles and can never exceed their creator.
- API keys `me_live_<prefix>_<secret>`, hashed at rest, constant-time compared, revocable, usage tracked.
- Embed tokens: HS256 JWT signed by the host's server with a per-tenant secret (AES-256-GCM encrypted at rest), max 1h TTL, one-time `jti`, role capped at admin, optional origin allow-list.
- Webhooks: HMAC-SHA256 over `timestamp.body`, 5-minute tolerance.
- Agent output is rendered as Markdown with raw HTML disabled and link protocols restricted, because it derives from untrusted customer text. Prompts treat signals as data.
- Audit log for every write (who, what, when) per tenant. Security headers and frame-ancestors on every response.

See [docs/API.md](docs/API.md) for the REST API, webhooks and embedding.

## Run it

```bash
pnpm install
cp .env.example .env            # set DATABASE_URL, DATABASE_ADMIN_URL, APP_ENCRYPTION_KEY
ME_APP_LOGIN_PASSWORD=... pnpm db:migrate   # creates schema, RLS policies, and the app login role
pnpm db:seed                    # demo@dispatchly.test / demo-password-123 with sample data
pnpm dev                        # http://localhost:3000
pnpm worker                     # scheduler + agent runner (optional in dev: runs inline)
```

Or `docker compose up --build` for Postgres + web + worker.

Set `ANTHROPIC_API_KEY` to run agents on Claude. `ME_MODEL_DEEP` / `ME_MODEL_FAST` override the models.

## Embed it

```html
<div id="growth"></div>
<script src="https://YOUR-DEPLOYMENT/embed/v1.js"></script>
<script>
  MarketingEngineer.mount(document.getElementById("growth"), {
    baseUrl: "https://YOUR-DEPLOYMENT",
    token: TOKEN_MINTED_ON_YOUR_SERVER,
    path: "/inbox",
  });
</script>
```

See `examples/embed-host` for a working host page and token minting script.

## Layout

```
db/migrations         SQL schema, RLS policies
src/app/(app)         product UI (Today, Inbox, Signals, Systems, Memory, Agents, Settings)
src/app/api/v1        REST API
src/app/embed         embed entry
src/server/agents     agent templates, runner, receipts verification, offline engine
src/server/services   service layer (all permission checks live here)
src/worker            background worker
embed/                browser SDK
```

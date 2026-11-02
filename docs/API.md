# Marketing Engineer API

Base URL: `https://YOUR-HOST/api/v1`. All bodies are JSON (`Content-Type: application/json`). All responses carry `x-request-id` and `cache-control: no-store`.

## Authentication

**API keys** (server-to-server). An admin creates keys in Settings → API keys. The full key is shown once. Only its prefix and SHA-256 hash are stored.

```
Authorization: Bearer me_live_<12 chars>_<32 chars>
```

| Scope   | Acts as | Can                                                         |
|---------|---------|-------------------------------------------------------------|
| `read`  | viewer  | read everything                                             |
| `write` | editor  | + ingest signals, run agents, review drafts, write memory, record metrics |
| `admin` | admin   | + change agent settings (`PATCH /agents/:id`)               |

The highest scope on a key wins. Keys never act as owner. A revoked key returns `401` straight away.

**Browser sessions.** The app's own pages, including the embedded UI, can call the API with the session cookie. For state-changing methods the request must be same-origin: `Origin` must match the app, and `Sec-Fetch-Site` must be `same-origin` when it is sent. Other requests get a `403`. No CORS headers are sent, so pages on other sites can't call the API from a browser. Call it from your backend with a key instead.

## Errors

```json
{ "error": { "code": "validation_error", "message": "0.kind: ...", "details": [ { "path": "0.kind", "code": "invalid_format", "message": "..." } ] } }
```

| Status | code                                   | When |
|--------|----------------------------------------|------|
| 400    | `bad_request`, `validation_error`, `invalid_json` | Bad input. Also a batch over 1,000 items or a stale `expected_version`. |
| 401    | `unauthorized`, `invalid_signature`    | Missing, invalid or revoked key. Bad webhook signature. |
| 403    | `forbidden`                            | The role or scope isn't allowed, or the cookie request came from another origin. |
| 404    | `not_found`                            | The item doesn't exist, or it belongs to another workspace. |
| 409    | `conflict`                             | Uniqueness conflict. |
| 413    | `payload_too_large`                    | Body over the endpoint limit. |
| 415    | `unsupported_media_type`               | Body not sent as JSON. |
| 429    | `rate_limited`                         | See `Retry-After`. |
| 500    | `internal_error`                       | Our fault. Quote the `x-request-id`. Error responses never include stack traces. |

## Rate limits

Token buckets, shared across instances when `REDIS_URL` is set:

- per IP: burst 300, then 5 requests/s
- per API key or user: burst 120, then 2 requests/s (`x-ratelimit-remaining` tells you what's left)
- per workspace: burst 600, then 10 requests/s
- webhooks: burst 120, then 2 requests/s per workspace
- `/embed/start`: burst 30, then 1 request every 2 s per IP

## Endpoints

### Signals

`GET /signals?source=&q=&limit=50&before=<ISO time>` returns `{ data: Signal[], next_before }`. To get the next page, pass `next_before` back as `before`.

`POST /signals` takes one signal, or `{ "signals": [...] }` with up to 1,000. It is idempotent on `(source, normalized content)`, so a repeat counts as a duplicate. Returns `201 { received, inserted, duplicates, ids }`.

```json
{ "source": "sales_call", "content": "…", "title": "…", "url": "https://…", "author": "…", "account": "Acme", "occurred_at": "2026-10-01T10:00:00Z", "metadata": {} }
```

`source` is one of `sales_call, support_ticket, churn_note, crm_note, review, social, interview, product_event, survey, other`.

```bash
curl -X POST $ME/api/v1/signals -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"signals":[{"source":"support_ticket","content":"Office manager cannot find the invite button","account":"Harbor"}]}'
```

### Agents and runs

- `GET /agents` lists agents with their last run and approval rate.
- `GET /agents/:id` returns `{ agent, rules, runs }`.
- `PATCH /agents/:id` (admin) takes `{ name?, enabled?, schedule_cron?, model?, spec? }`.
- `POST /agents/:id/runs` takes `{ input?: {...} }` and returns `202 { run_id, status: "queued" }`. Returns `400` if the agent is already running.
- `GET /runs/:id` returns `{ id, agent_id, status, summary, error, created_at, finished_at }`. `status` is one of `queued | running | succeeded | failed | canceled`.

```bash
RUN=$(curl -s -X POST $ME/api/v1/agents/$AGENT/runs -H "Authorization: Bearer $KEY" | jq -r .run_id)
curl -s $ME/api/v1/runs/$RUN -H "Authorization: Bearer $KEY"
```

On a single box (`ME_INLINE_WORKER` unset or anything except `false`), the API processes the queue right after it responds. Set `ME_INLINE_WORKER=false` when you run `pnpm worker` separately.

### Drafts

- `GET /drafts?status=pending|approved|rejected|published&system=customer_truth|…&limit=` lists drafts.
- `GET /drafts/:id` returns one draft.
- `POST /drafts/:id/review` takes `{ "decision": "approve"|"reject", "feedback"?, "remember"?: bool, "body"?: "edited text" }` and returns `{ status, effect }`. With `remember: true`, the feedback becomes a standing rule for the agent.

### Memory (Growth OS)

- `GET /memory` lists all documents.
- `GET /memory/<key>` returns one document. The key can contain slashes, e.g. `/memory/outbound/icp`.
- `PUT /memory/<key>` takes `{ "content": "...", "expected_version"?: 3 }` and returns `{ key, id, version }`. Returns `400` if the document changed since `expected_version`.

### Metric events

`POST /metrics/events` takes `{ "events": [...] }` or a bare array, up to 1,000 items. Returns `201 { recorded }`.

```json
{ "kind": "demo_request", "value": 1, "angle": "missed replacement revenue", "experiment_id": "uuid", "variant": "b", "draft_id": "uuid", "source": "linkedin", "occurred_at": "…", "metadata": {} }
```

`kind` matches `^[a-z_]{2,40}$`. `experiment_id` and `draft_id` must belong to your workspace.

### Health

`GET /api/health` returns `200 { ok: true, db: "ok" }`, or `503` when the database is unreachable. No auth.

## Inbound webhooks (Gong, Zendesk, HubSpot, Zapier…)

```
POST /api/v1/webhooks/signals/<workspace-slug>?source=support_ticket
x-me-timestamp: <unix seconds>
x-me-signature: sha256=<hex HMAC-SHA256(embed_secret, "<timestamp>.<raw body>")>
```

- The secret is the workspace **embed secret** (Settings → Embed).
- The timestamp must be within 5 minutes of our clock.
- A replay inside that window is harmless, because ingestion is idempotent on content.
- The body can be one object, an array, or `{ "signals": [...] }`, with up to 1,000 items.
- Besides our own field names, these are mapped: `body/text/description/transcript/note` → `content`, `subject/name` → `title`, `company/organization` → `account`, `created_at` → `occurred_at`.
- Returns `202 { received, inserted, duplicates, ids }`.
- An unknown workspace and a bad signature both return the same `401`.

```bash
TS=$(date +%s); BODY='{"subject":"Ticket 4411","description":"Need SSO"}'
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$EMBED_SECRET" -hex | sed 's/^.* //')
curl -X POST "$ME/api/v1/webhooks/signals/acme?source=support_ticket" -H 'content-type: application/json' \
  -H "x-me-timestamp: $TS" -H "x-me-signature: sha256=$SIG" -d "$BODY"
```

## Embedding

1. Your backend mints a short-lived HS256 JWT for the signed-in user. The key is the UTF-8 bytes of the embed secret.
2. Your page loads `/embed/v1.js` and calls `MarketingEngineer.mount(el, { baseUrl, token, path, theme, onEvent })`.

| Claim    | Required | Notes |
|----------|----------|-------|
| `iss`    | yes | Workspace slug. |
| `sub`    | yes | Your stable user id. The user is keyed by `<workspace id>:<sub>` and is never matched to other accounts by email. |
| `exp`, `iat` | yes | `exp - iat` must be 1 hour or less. 60 s of clock skew is allowed. |
| `jti`    | yes | 8 to 200 characters. **Each token works once**, so mint a new one for every mount or page load. |
| `role`   | no  | `viewer`, `editor` (the default) or `admin`. `owner` is capped to `admin`. The role is updated on every login. |
| `email`, `name` | no | Shown as the user's display name. |
| `origin` | when the workspace has allowed origins | The host page origin. It must be in Settings → Embed → Allowed origins. |

Only `alg: HS256` is accepted. `none` and every other algorithm are refused.

```js
import { SignJWT } from "jose";
const token = await new SignJWT({ email, name, role: "editor", origin: "https://app.yourco.com" })
  .setProtectedHeader({ alg: "HS256" }).setIssuer("acme").setSubject(user.id)
  .setIssuedAt().setExpirationTime("10m").setJti(crypto.randomUUID())
  .sign(new TextEncoder().encode(process.env.ME_EMBED_SECRET));
```

```html
<div id="me"></div>
<script src="https://YOUR-HOST/embed/v1.js"></script>
<script>
  const h = MarketingEngineer.mount("#me", { baseUrl: "https://YOUR-HOST", token, path: "/inbox", theme: "auto",
    onEvent: (e) => console.log(e.name, e.data) });   // e.g. "draft.approved"
  // h.unmount()
</script>
```

A full example is in `examples/embed-host/`. Run `node mint-token.mjs --serve` for a demo host.

**Security model.**

- The iframe is sandboxed (`allow-scripts allow-same-origin allow-forms allow-popups`).
- The session cookie is `SameSite=None; Secure; Partitioned`. It lasts 8 hours and only exists under your site.
- When allowed origins are set, `/embed/start` checks the signed `origin` claim. If the browser sends `Referer`, its origin must match. If it sends `Sec-Fetch-Dest`, the value must be `iframe`.
- The `frame-ancestors` CSP comes from the deployment's `ME_EMBED_FRAME_ANCESTORS`. It defaults to `*` in development and `'self'` in production.
- The SDK only accepts `postMessage` events that come from `baseUrl`'s origin and from its own iframe.

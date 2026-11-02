-- Embed: one-time-use tracking for embed tokens, and fast lookup of embed-provisioned users.

-- Each embed JWT (jti) may start exactly one session. Rows only need to outlive the
-- token's exp (max 1h); src/lib/embed.ts prunes anything older than 2h.
-- Written only through the sys (owner) pool; the RLS-bound app role has no access.
create table if not exists embed_token_uses (
  tenant_id uuid not null references tenants(id) on delete cascade,
  jti text not null check (length(jti) between 8 and 200),
  used_at timestamptz not null default now(),
  primary key (tenant_id, jti)
);
create index if not exists embed_token_uses_used_at_idx on embed_token_uses(used_at);
alter table embed_token_uses enable row level security;
revoke all on embed_token_uses from me_app;

-- Embed users are keyed by `${tenant_id}:${external user id}`; never by email.
create unique index if not exists users_external_ref_key on users(external_ref) where external_ref is not null;

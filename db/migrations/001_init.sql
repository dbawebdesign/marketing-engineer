-- Marketing Engineer: core schema
-- Multi-tenancy is enforced in the database with Row Level Security.
-- The application connects as the non-owner role `me_app`; every tenant-scoped
-- query runs inside a transaction that sets `app.tenant_id`.

create extension if not exists citext;
create extension if not exists pgcrypto;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'me_app') then
    create role me_app nologin;
  end if;
end $$;

-- ---------- Identity (global, not tenant scoped) ----------
create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  plan text not null default 'free',
  settings jsonb not null default '{}'::jsonb,
  embed_secret_enc text,            -- AES-256-GCM encrypted, see src/lib/crypto.ts
  allowed_origins text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  name text not null default '',
  password_hash text,
  external_ref text,               -- set for users provisioned through embed tokens
  created_at timestamptz not null default now()
);

create table memberships (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner','admin','editor','viewer')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index on memberships(user_id);

create table sessions (
  id_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  tenant_id uuid references tenants(id) on delete cascade,
  kind text not null default 'web' check (kind in ('web','embed')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  ip inet,
  user_agent text
);
create index on sessions(user_id);
create index on sessions(expires_at);

create table api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  prefix text not null unique,
  key_hash text not null,
  scopes text[] not null default '{read,write}',
  created_by uuid references users(id) on delete set null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index on api_keys(tenant_id);

-- ---------- Tenant scoped ----------
create table signals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  source text not null check (source in ('sales_call','support_ticket','churn_note','crm_note','review','social','interview','product_event','survey','other')),
  title text not null default '',
  content text not null check (length(content) between 1 and 100000),
  url text,
  author text,
  account text,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, content_hash)
);
create index on signals(tenant_id, occurred_at desc);
create index on signals(tenant_id, source, occurred_at desc);

create table memory_docs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9][a-z0-9/_-]{1,120}$'),
  title text not null,
  folder text not null,
  content text not null default '',
  version int not null default 1,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, key)
);

create table memory_doc_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  doc_id uuid not null references memory_docs(id) on delete cascade,
  version int not null,
  content text not null,
  author_kind text not null check (author_kind in ('user','agent','system')),
  author_id uuid,
  note text,
  created_at timestamptz not null default now(),
  unique (doc_id, version)
);

create table agents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  template text not null,
  system text not null check (system in ('customer_truth','founder_content','outbound_signal','creative_testing','ai_search','growth_cockpit')),
  name text not null,
  spec jsonb not null,
  model text not null,
  schedule_cron text,
  timezone text not null default 'UTC',
  enabled boolean not null default true,
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on agents(tenant_id);
create index agents_due_idx on agents(next_run_at) where enabled and next_run_at is not null;

create table agent_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  rule text not null check (length(rule) between 3 and 2000),
  source text not null default 'manual' check (source in ('manual','correction','system')),
  active boolean not null default true,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on agent_rules(agent_id);

create table runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','canceled')),
  trigger text not null check (trigger in ('manual','schedule','api','event')),
  requested_by uuid references users(id) on delete set null,
  input jsonb not null default '{}'::jsonb,
  summary text,
  error text,
  model text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(12,6) not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index on runs(tenant_id, created_at desc);
create index on runs(agent_id, created_at desc);

create table drafts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  run_id uuid references runs(id) on delete set null,
  agent_id uuid references agents(id) on delete set null,
  system text not null,
  type text not null,
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected','published')),
  reviewer_id uuid references users(id) on delete set null,
  reviewed_at timestamptz,
  feedback text,
  created_at timestamptz not null default now()
);
create index on drafts(tenant_id, status, created_at desc);
create index on drafts(tenant_id, system, created_at desc);

create table experiments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  draft_id uuid references drafts(id) on delete set null,
  name text not null,
  hypothesis text not null default '',
  channel text not null default 'other',
  metric text not null default 'demo_request',
  status text not null default 'draft' check (status in ('draft','running','won','lost','inconclusive')),
  variants jsonb not null default '[]'::jsonb,
  learnings text,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index on experiments(tenant_id, created_at desc);

create table metric_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null check (kind ~ '^[a-z_]{2,40}$'),
  value numeric not null default 1,
  experiment_id uuid references experiments(id) on delete set null,
  variant text,
  draft_id uuid references drafts(id) on delete set null,
  angle text,
  source text,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index on metric_events(tenant_id, occurred_at desc);
create index on metric_events(tenant_id, kind, occurred_at desc);

create table audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  actor_type text not null check (actor_type in ('user','api_key','agent','system','embed')),
  actor_id text,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on audit_log(tenant_id, created_at desc);

-- ---------- System (worker only) ----------
create table jobs (
  id bigint generated always as identity primary key,
  tenant_id uuid references tenants(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  run_at timestamptz not null default now(),
  attempts int not null default 0,
  max_attempts int not null default 3,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now()
);
create index jobs_ready_idx on jobs(run_at) where status = 'queued';

-- ---------- Row Level Security ----------
do $$
declare t text;
begin
  foreach t in array array['signals','memory_docs','memory_doc_versions','agents','agent_rules','runs','drafts','experiments','metric_events','audit_log','api_keys']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    execute format('grant select, insert, update, delete on %I to me_app', t);
  end loop;
end $$;

alter table tenants enable row level security;
alter table tenants force row level security;
create policy tenant_self on tenants using (id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, update on tenants to me_app;
grant usage on all sequences in schema public to me_app;

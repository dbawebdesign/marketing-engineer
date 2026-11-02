-- Indexes found missing in the production-readiness review (EXPLAIN at 200k signals,
-- 90k drafts, 500k metric events). Foreign keys with ON DELETE actions need an index on
-- the referencing side, or deleting a tenant/run/draft scans whole tables.
-- (For an existing large database, create these CONCURRENTLY by hand before deploying.)
create index if not exists drafts_tenant_run_idx on drafts(tenant_id, run_id);
create index if not exists drafts_tenant_agent_idx on drafts(tenant_id, agent_id, status);
create index if not exists drafts_tenant_created_idx on drafts(tenant_id, created_at desc, id);
create index if not exists metric_events_draft_idx on metric_events(tenant_id, draft_id) where draft_id is not null;
create index if not exists metric_events_exp_idx on metric_events(tenant_id, experiment_id) where experiment_id is not null;
create index if not exists experiments_draft_idx on experiments(tenant_id, draft_id) where draft_id is not null;
create index if not exists runs_running_started_idx on runs(started_at) where status = 'running';
create index if not exists runs_requested_by_idx on runs(requested_by) where requested_by is not null;
create index if not exists drafts_reviewer_idx on drafts(reviewer_id) where reviewer_id is not null;
create index if not exists agent_rules_created_by_idx on agent_rules(created_by) where created_by is not null;
create index if not exists jobs_finished_created_idx on jobs(created_at) where status in ('done','failed');
create index if not exists embed_token_uses_used_idx on embed_token_uses(used_at);

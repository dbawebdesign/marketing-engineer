-- The audit trail is append-only for the application role.
revoke update, delete on audit_log from me_app;

-- Per-tenant concurrency check in the job claim query.
create index if not exists jobs_tenant_status_idx on jobs(tenant_id, status);

-- Embed sessions are revoked per tenant when the embed secret rotates.
create index if not exists sessions_tenant_kind_idx on sessions(tenant_id, kind);

-- Daily run budget per tenant.
create index if not exists runs_tenant_created_idx on runs(tenant_id, created_at desc);

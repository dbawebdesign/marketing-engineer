-- Let tenant transactions enqueue jobs atomically with the rows they create
-- (transactional outbox). The app role may only INSERT jobs for its own tenant.
alter table jobs enable row level security;
create policy jobs_tenant_insert on jobs for insert to me_app
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant insert on jobs to me_app;

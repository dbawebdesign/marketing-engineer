-- Sample data is marked by server-only columns, never by client-supplied metadata, so an
-- ingest can't make real data look like (and be cleared as) sample data.
alter table signals add column if not exists is_sample boolean not null default false;
alter table metric_events add column if not exists is_sample boolean not null default false;
alter table runs add column if not exists is_sample boolean not null default false;
alter table drafts add column if not exists is_sample boolean not null default false;
alter table experiments add column if not exists is_sample boolean not null default false;
alter table memory_doc_versions add column if not exists is_sample boolean not null default false;

-- Backfill rows loaded before this migration (they were tagged in metadata).
update signals set is_sample = true where metadata->>'sample' = 'true';
update metric_events set is_sample = true where metadata->>'sample' = 'true' or source = 'sample';
update signals set metadata = metadata - 'sample' where metadata ? 'sample';
update metric_events set metadata = metadata - 'sample' where metadata ? 'sample';

create index if not exists signals_sample_idx on signals(tenant_id) where is_sample;
create index if not exists metric_events_sample_idx on metric_events(tenant_id) where is_sample;
create index if not exists drafts_sample_idx on drafts(tenant_id) where is_sample;

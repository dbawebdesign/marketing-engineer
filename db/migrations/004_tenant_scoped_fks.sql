-- Foreign keys don't go through RLS, so a plain FK to `id` would let a tenant reference
-- (and probe for) another tenant's rows. Every cross-table reference is therefore
-- composite: (tenant_id, x_id) -> parent(tenant_id, id).
alter table agents add constraint agents_tenant_id_id_key unique (tenant_id, id);
alter table runs add constraint runs_tenant_id_id_key unique (tenant_id, id);
alter table drafts add constraint drafts_tenant_id_id_key unique (tenant_id, id);
alter table experiments add constraint experiments_tenant_id_id_key unique (tenant_id, id);
alter table memory_docs add constraint memory_docs_tenant_id_id_key unique (tenant_id, id);

alter table agent_rules drop constraint agent_rules_agent_id_fkey,
  add constraint agent_rules_agent_fk foreign key (tenant_id, agent_id) references agents(tenant_id, id) on delete cascade;
alter table runs drop constraint runs_agent_id_fkey,
  add constraint runs_agent_fk foreign key (tenant_id, agent_id) references agents(tenant_id, id) on delete cascade;
alter table memory_doc_versions drop constraint memory_doc_versions_doc_id_fkey,
  add constraint memory_doc_versions_doc_fk foreign key (tenant_id, doc_id) references memory_docs(tenant_id, id) on delete cascade;
alter table drafts drop constraint drafts_run_id_fkey,
  add constraint drafts_run_fk foreign key (tenant_id, run_id) references runs(tenant_id, id) on delete set null (run_id);
alter table drafts drop constraint drafts_agent_id_fkey,
  add constraint drafts_agent_fk foreign key (tenant_id, agent_id) references agents(tenant_id, id) on delete set null (agent_id);
alter table experiments drop constraint experiments_draft_id_fkey,
  add constraint experiments_draft_fk foreign key (tenant_id, draft_id) references drafts(tenant_id, id) on delete set null (draft_id);
alter table metric_events drop constraint metric_events_experiment_id_fkey,
  add constraint metric_events_experiment_fk foreign key (tenant_id, experiment_id) references experiments(tenant_id, id) on delete set null (experiment_id);
alter table metric_events drop constraint metric_events_draft_id_fkey,
  add constraint metric_events_draft_fk foreign key (tenant_id, draft_id) references drafts(tenant_id, id) on delete set null (draft_id);

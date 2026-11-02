-- Fast substring search over signals at scale.
-- ILIKE is not leakproof, so under RLS the planner will not use a trigram index for it.
-- This function runs as the owner and applies the tenant filter itself, from the same
-- transaction-local setting the RLS policies use, so isolation is unchanged.
create extension if not exists pg_trgm;

create index if not exists signals_search_trgm_idx
  on signals using gin ((title || ' ' || coalesce(account, '') || ' ' || content) gin_trgm_ops);

create or replace function search_signal_ids(pattern text, lim int)
returns table (id uuid)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select s.id
    from signals s
   where s.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
     and (s.title || ' ' || coalesce(s.account, '') || ' ' || s.content) ilike pattern
   order by s.occurred_at desc, s.id desc
   limit least(greatest(lim, 1), 1000)
$$;

revoke all on function search_signal_ids(text, int) from public;
grant execute on function search_signal_ids(text, int) to me_app;

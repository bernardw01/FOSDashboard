-- Clockify time-entry facts for dashboard labor / utilization / P&L cost.
-- Owned by the separate Clockify → Supabase sync (not Fibery hydrate).
-- Feature 036 notes this table as out of Fibery hydrate scope.

begin;

create table if not exists public.labor_costs (
  clockify_time_log_id text primary key,
  fetched_at timestamptz,
  start_date_time timestamptz,
  end_date_time timestamptz,
  seconds integer,
  clockify_hours numeric,
  task text,
  task_id text,
  project_id text,
  billable text,
  time_entry_status text,
  user_id text,
  time_entry_user_name text,
  time_entry_project_name text,
  fibery_payload_json jsonb,
  synced_at timestamptz not null default now()
);

comment on table public.labor_costs is
  'Clockify labor rows mirrored for dashboards; upsert key clockify_time_log_id. Owned by Clockify→Supabase sync.';

create index if not exists labor_costs_fetched_at_idx
  on public.labor_costs (fetched_at);
create index if not exists labor_costs_status_idx
  on public.labor_costs (time_entry_status);
create index if not exists labor_costs_project_id_idx
  on public.labor_costs (project_id);
create index if not exists labor_costs_user_id_idx
  on public.labor_costs (user_id);
create index if not exists labor_costs_synced_at_idx
  on public.labor_costs (synced_at);

-- Service role (Apps Script) bypasses RLS. Deny anon/authenticated client access.
alter table public.labor_costs enable row level security;
revoke all on table public.labor_costs from anon, authenticated;

commit;

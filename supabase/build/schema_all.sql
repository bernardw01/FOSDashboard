-- FinOps Performance Hub - combined Supabase schema
-- Generated: 2026-07-22T15:57:27Z
-- Source: C:/code/FOSDashboard/supabase/migrations
-- Idempotent: migrations use IF NOT EXISTS where possible.

-- ========== BEGIN 035_labor_costs.sql ==========
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
-- ========== END 035_labor_costs.sql ==========

-- ========== BEGIN 036_fos_dashboard_schema.sql ==========
-- Feature 036: FOS Dashboard Supabase serving schema
-- Apply to the target Supabase/Postgres project before enabling DASHBOARD_READ_SOURCE=supabase.
-- Service role from Apps Script bypasses RLS; do not expose anon keys to the Web App client.
--
-- public.labor_costs is owned by the separate Clockify → Supabase sync (see 035_labor_costs.sql).
-- public.fos_labor_costs is the hourly-rate dimension table (also Clockify-owned; Fibery hydrate skips it).

begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.fos_sync_runs (
  id uuid primary key default gen_random_uuid(),
  run_id text not null unique,
  trigger_kind text not null,
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  dataset_cursor text,
  datasets_done integer not null default 0,
  datasets_total integer not null default 0,
  notes text,
  summary jsonb
);

create index if not exists fos_sync_runs_started_at_idx on public.fos_sync_runs (started_at desc);
create index if not exists fos_sync_runs_status_idx on public.fos_sync_runs (status);

create table if not exists public.fos_sync_watermarks (
  dataset_key text primary key,
  cursor_json jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.fos_dataset_as_of (
  dataset_key text primary key,
  as_of timestamptz not null,
  updated_at timestamptz not null default now()
);

-- Materialized Live panel payloads (built from Fibery during hydrate).
create table if not exists public.fos_panel_payloads (
  panel_key text primary key,
  as_of timestamptz not null,
  synced_at timestamptz not null default now(),
  cache_schema_version integer,
  payload jsonb not null
);

create index if not exists fos_panel_payloads_synced_at_idx on public.fos_panel_payloads (synced_at desc);

create table if not exists public.fos_delivery_pnl (
  agreement_id text primary key,
  agreement_name text,
  as_of timestamptz not null,
  synced_at timestamptz not null default now(),
  cache_schema_version integer,
  payload jsonb not null
);

create index if not exists fos_delivery_pnl_synced_at_idx on public.fos_delivery_pnl (synced_at desc);
create index if not exists fos_delivery_pnl_name_idx on public.fos_delivery_pnl (agreement_name);

create table if not exists public.fos_status_updates (
  fibery_id text primary key,
  agreement_id text not null,
  status_key text,
  status_label text,
  content text,
  created_at timestamptz,
  author_email text,
  synced_at timestamptz not null default now(),
  raw jsonb
);

create index if not exists fos_status_updates_agreement_idx
  on public.fos_status_updates (agreement_id, created_at desc);

-- Dimension stubs for future SQL builders / joins (hydrate may populate selectively).
create table if not exists public.fos_companies (
  fibery_id text primary key,
  name text,
  public_id text,
  synced_at timestamptz not null default now(),
  raw jsonb
);

create index if not exists fos_companies_name_idx on public.fos_companies (name);

create table if not exists public.fos_agreements (
  fibery_id text primary key,
  name text,
  status text,
  agreement_type text,
  company_fibery_id text,
  synced_at timestamptz not null default now(),
  raw jsonb
);

create index if not exists fos_agreements_status_idx on public.fos_agreements (status);
create index if not exists fos_agreements_company_idx on public.fos_agreements (company_fibery_id);
create index if not exists fos_agreements_type_idx on public.fos_agreements (agreement_type);

create table if not exists public.fos_hubspot_deals (
  fibery_id text primary key,
  hubspot_deal_id text,
  name text,
  stage text,
  amount numeric,
  weighted_amount numeric,
  synced_at timestamptz not null default now(),
  raw jsonb
);

create unique index if not exists fos_hubspot_deals_hubspot_id_uidx
  on public.fos_hubspot_deals (hubspot_deal_id)
  where hubspot_deal_id is not null;
create index if not exists fos_hubspot_deals_stage_idx on public.fos_hubspot_deals (stage);

create table if not exists public.fos_ai_usage_rows (
  fibery_id text primary key,
  usage_date date,
  actor_email text,
  product text,
  cost_usd numeric,
  synced_at timestamptz not null default now(),
  raw jsonb
);

create index if not exists fos_ai_usage_rows_date_idx on public.fos_ai_usage_rows (usage_date);
create index if not exists fos_ai_usage_rows_email_idx on public.fos_ai_usage_rows (actor_email);

-- Hourly rate dimension. Owned by Clockify → Supabase sync (NOT written by Fibery hydrate).
create table if not exists public.fos_labor_costs (
  id bigserial primary key,
  clockify_user_id text,
  email text,
  effective_date date,
  hourly_cost numeric,
  currency text default 'USD',
  synced_at timestamptz not null default now(),
  raw jsonb
);

comment on table public.fos_labor_costs is
  'Owned by separate Clockify→Supabase sync. Feature 036 Fibery hydrate skips this table.';

create index if not exists fos_labor_costs_email_date_idx
  on public.fos_labor_costs (email, effective_date desc);
create index if not exists fos_labor_costs_user_date_idx
  on public.fos_labor_costs (clockify_user_id, effective_date desc);

commit;
-- ========== END 036_fos_dashboard_schema.sql ==========

-- ========== BEGIN 037_labor_costs_date_range_indexes.sql ==========
-- Speed up utilization / P&L labor date-range reads on public.labor_costs.
-- Without these, filters on start_date_time seq-scan the full table.

begin;

create index if not exists labor_costs_start_date_time_idx
  on public.labor_costs (start_date_time);

create index if not exists labor_costs_user_start_idx
  on public.labor_costs (user_id, start_date_time);

create index if not exists labor_costs_project_start_idx
  on public.labor_costs (project_id, start_date_time);

create index if not exists labor_costs_status_start_idx
  on public.labor_costs (time_entry_status, start_date_time);

analyze public.labor_costs;

commit;
-- ========== END 037_labor_costs_date_range_indexes.sql ==========

-- ========== BEGIN 038_fos_labor_costs_time_entries.sql ==========
-- Feature 036 follow-on: fos_labor_costs becomes the Hub time-entry labor table
-- (same shape as public.labor_costs). Clockify sync continues writing labor_costs;
-- a trigger mirrors changes into fos_labor_costs.
-- Prior empty rate-shaped fos_labor_costs is renamed aside if present.

begin;

-- Preserve prior rate dimension DDL if the table exists and still uses the old shape.
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'fos_labor_costs'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'fos_labor_costs'
      and column_name = 'hourly_cost'
  ) then
    alter table public.fos_labor_costs rename to fos_labor_costs_rates_legacy;
  end if;
end $$;

create table if not exists public.fos_labor_costs (
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

comment on table public.fos_labor_costs is
  'Hub mirror of Clockify time-entry labor facts (same shape as labor_costs). Clockify sync writes labor_costs; trigger keeps this table current.';

create index if not exists fos_labor_costs_fetched_at_idx
  on public.fos_labor_costs (fetched_at);
create index if not exists fos_labor_costs_status_idx
  on public.fos_labor_costs (time_entry_status);
create index if not exists fos_labor_costs_project_id_idx
  on public.fos_labor_costs (project_id);
create index if not exists fos_labor_costs_user_id_idx
  on public.fos_labor_costs (user_id);
create index if not exists fos_labor_costs_synced_at_idx
  on public.fos_labor_costs (synced_at);
create index if not exists fos_labor_costs_start_date_time_idx
  on public.fos_labor_costs (start_date_time);
create index if not exists fos_labor_costs_user_start_idx
  on public.fos_labor_costs (user_id, start_date_time);
create index if not exists fos_labor_costs_project_start_idx
  on public.fos_labor_costs (project_id, start_date_time);
create index if not exists fos_labor_costs_status_start_idx
  on public.fos_labor_costs (time_entry_status, start_date_time);

-- One-time backfill from Clockify sync SoT.
insert into public.fos_labor_costs (
  clockify_time_log_id,
  fetched_at,
  start_date_time,
  end_date_time,
  seconds,
  clockify_hours,
  task,
  task_id,
  project_id,
  billable,
  time_entry_status,
  user_id,
  time_entry_user_name,
  time_entry_project_name,
  fibery_payload_json,
  synced_at
)
select
  clockify_time_log_id,
  fetched_at,
  start_date_time,
  end_date_time,
  seconds,
  clockify_hours,
  task,
  task_id,
  project_id,
  billable,
  time_entry_status,
  user_id,
  time_entry_user_name,
  time_entry_project_name,
  fibery_payload_json,
  synced_at
from public.labor_costs
on conflict (clockify_time_log_id) do nothing;

create or replace function public.mirror_labor_costs_to_fos_labor_costs_()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.fos_labor_costs
    where clockify_time_log_id = old.clockify_time_log_id;
    return old;
  end if;

  insert into public.fos_labor_costs (
    clockify_time_log_id,
    fetched_at,
    start_date_time,
    end_date_time,
    seconds,
    clockify_hours,
    task,
    task_id,
    project_id,
    billable,
    time_entry_status,
    user_id,
    time_entry_user_name,
    time_entry_project_name,
    fibery_payload_json,
    synced_at
  )
  values (
    new.clockify_time_log_id,
    new.fetched_at,
    new.start_date_time,
    new.end_date_time,
    new.seconds,
    new.clockify_hours,
    new.task,
    new.task_id,
    new.project_id,
    new.billable,
    new.time_entry_status,
    new.user_id,
    new.time_entry_user_name,
    new.time_entry_project_name,
    new.fibery_payload_json,
    coalesce(new.synced_at, now())
  )
  on conflict (clockify_time_log_id) do update set
    fetched_at = excluded.fetched_at,
    start_date_time = excluded.start_date_time,
    end_date_time = excluded.end_date_time,
    seconds = excluded.seconds,
    clockify_hours = excluded.clockify_hours,
    task = excluded.task,
    task_id = excluded.task_id,
    project_id = excluded.project_id,
    billable = excluded.billable,
    time_entry_status = excluded.time_entry_status,
    user_id = excluded.user_id,
    time_entry_user_name = excluded.time_entry_user_name,
    time_entry_project_name = excluded.time_entry_project_name,
    fibery_payload_json = excluded.fibery_payload_json,
    synced_at = excluded.synced_at;

  return new;
end;
$$;

drop trigger if exists labor_costs_mirror_fos_labor_costs_trg on public.labor_costs;
create trigger labor_costs_mirror_fos_labor_costs_trg
after insert or update or delete on public.labor_costs
for each row
execute function public.mirror_labor_costs_to_fos_labor_costs_();

alter table public.fos_labor_costs enable row level security;
revoke all on table public.fos_labor_costs from anon, authenticated;

analyze public.fos_labor_costs;

commit;
-- ========== END 038_fos_labor_costs_time_entries.sql ==========

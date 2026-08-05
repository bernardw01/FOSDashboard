-- FinOps Performance Hub - combined Supabase schema
-- Generated: 2026-08-04T23:10:56Z
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

-- ========== BEGIN 039_engagement_reviews.sql ==========
-- Feature 037: Engagement Review (Supabase-only Hub data)
-- Reviews, agreement links, participants, updates, Drive recording metadata.
-- Service role from Apps Script bypasses RLS; revoke anon/authenticated.

begin;

alter table if exists public.fos_agreements
  add column if not exists owner_email text,
  add column if not exists owner_name text;

create index if not exists fos_agreements_owner_email_idx
  on public.fos_agreements (owner_email);

create table if not exists public.fos_engagement_reviews (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  target_date date not null,
  status text not null default 'draft',
  call_summary_html text,
  notes text,
  question_set_version integer not null default 1,
  calendar_event_id text,
  created_by_email text not null,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fos_engagement_reviews_status_chk
    check (status in ('draft', 'scheduled', 'in_progress', 'completed'))
);

create index if not exists fos_engagement_reviews_target_date_idx
  on public.fos_engagement_reviews (target_date desc);
create index if not exists fos_engagement_reviews_status_idx
  on public.fos_engagement_reviews (status);

create table if not exists public.fos_engagement_review_agreements (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.fos_engagement_reviews(id) on delete cascade,
  agreement_fibery_id text not null,
  agreement_name text,
  company_name text,
  owner_email text,
  owner_name text,
  suggested_from_alert boolean not null default false,
  alert_snapshot jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (review_id, agreement_fibery_id)
);

create index if not exists fos_engagement_review_agreements_agreement_idx
  on public.fos_engagement_review_agreements (agreement_fibery_id);
create index if not exists fos_engagement_review_agreements_owner_idx
  on public.fos_engagement_review_agreements (owner_email);
create index if not exists fos_engagement_review_agreements_review_idx
  on public.fos_engagement_review_agreements (review_id);

create table if not exists public.fos_engagement_review_participants (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.fos_engagement_reviews(id) on delete cascade,
  email text not null,
  display_name text,
  participant_role text not null default 'owner',
  suggested boolean not null default false,
  invite_status text not null default 'pending',
  invite_sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (review_id, email)
);

create index if not exists fos_engagement_review_participants_email_idx
  on public.fos_engagement_review_participants (email);
create index if not exists fos_engagement_review_participants_review_idx
  on public.fos_engagement_review_participants (review_id);

create table if not exists public.fos_engagement_updates (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.fos_engagement_reviews(id) on delete cascade,
  agreement_fibery_id text not null,
  submitted_by_email text not null,
  executive_summary text not null,
  traffic_light text,
  answers jsonb not null default '{}'::jsonb,
  question_set_version integer not null,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists fos_engagement_updates_review_agreement_idx
  on public.fos_engagement_updates (review_id, agreement_fibery_id, submitted_at desc);
create index if not exists fos_engagement_updates_agreement_idx
  on public.fos_engagement_updates (agreement_fibery_id, submitted_at desc);

create table if not exists public.fos_engagement_review_recordings (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.fos_engagement_reviews(id) on delete cascade,
  drive_file_id text not null,
  file_name text,
  mime_type text,
  byte_size bigint,
  uploaded_by_email text not null,
  uploaded_at timestamptz not null default now()
);

create index if not exists fos_engagement_review_recordings_review_idx
  on public.fos_engagement_review_recordings (review_id);

-- Match sibling Hub fos_* tables: grant anon/authenticated (Apps Script must still
-- prefer SUPABASE_SERVICE_ROLE_KEY). Do not revoke anon here; that breaks PostgREST
-- when Script Properties hold the anon key by mistake.
grant all on table public.fos_engagement_reviews to postgres, service_role, anon, authenticated;
grant all on table public.fos_engagement_review_agreements to postgres, service_role, anon, authenticated;
grant all on table public.fos_engagement_review_participants to postgres, service_role, anon, authenticated;
grant all on table public.fos_engagement_updates to postgres, service_role, anon, authenticated;
grant all on table public.fos_engagement_review_recordings to postgres, service_role, anon, authenticated;

-- Note: sibling Hub tables from 036 still grant anon/authenticated by default.
-- If Apps Script hits permission denied, apply 040_engagement_reviews_grants.sql
-- (align grants with fos_panel_payloads). Prefer SUPABASE_SERVICE_ROLE_KEY = service_role secret.

commit;
-- ========== END 039_engagement_reviews.sql ==========

-- ========== BEGIN 040_engagement_reviews_grants.sql ==========
-- Feature 037 follow-up: Engagement Review table grants
-- Match privilege pattern of working fos_* Hub tables from 036
-- (service_role for Apps Script; anon/authenticated present on sibling tables).

grant all on table public.fos_engagement_reviews to postgres, service_role, anon, authenticated;
grant all on table public.fos_engagement_review_agreements to postgres, service_role, anon, authenticated;
grant all on table public.fos_engagement_review_participants to postgres, service_role, anon, authenticated;
grant all on table public.fos_engagement_updates to postgres, service_role, anon, authenticated;
grant all on table public.fos_engagement_review_recordings to postgres, service_role, anon, authenticated;
-- ========== END 040_engagement_reviews_grants.sql ==========

-- ========== BEGIN 041_agreement_management_mirror.sql ==========
-- Feature 036 extension: Agreement Management relational mirror (Fibery → Supabase).
-- Soft FK columns (text fibery_id) - no hard REFERENCES so hydrate can upsert out of order.
-- Does NOT replace Clockify-owned labor_costs / fos_labor_costs; Fibery Labor Costs → fos_am_labor_costs.
-- Admin Settings secrets are intentionally not mirrored.

begin;

-- ---------------------------------------------------------------------------
-- Shared enum / workflow dimension (all Agreement Management enum DBs)
-- ---------------------------------------------------------------------------
create table if not exists public.fos_am_enums (
  enum_type text not null,
  fibery_id text not null,
  public_id text,
  name text,
  color text,
  is_final boolean,
  workflow_type text,
  rank numeric,
  created_at timestamptz,
  synced_at timestamptz not null default now(),
  raw jsonb,
  primary key (enum_type, fibery_id)
);

create index if not exists fos_am_enums_type_name_idx
  on public.fos_am_enums (enum_type, name);

comment on table public.fos_am_enums is
  'Fibery Agreement Management enums and workflow states. enum_type is a stable hydrate key.';

-- ---------------------------------------------------------------------------
-- Team Member Roles
-- ---------------------------------------------------------------------------
create table if not exists public.fos_team_member_roles (
  fibery_id text primary key,
  public_id text,
  name text,
  bill_rate numeric,
  cost_rate numeric,
  created_at timestamptz,
  modified_at timestamptz,
  synced_at timestamptz not null default now(),
  raw jsonb
);

create index if not exists fos_team_member_roles_name_idx
  on public.fos_team_member_roles (name);

-- ---------------------------------------------------------------------------
-- Companies (extend stub)
-- ---------------------------------------------------------------------------
alter table if exists public.fos_companies
  add column if not exists website text,
  add column if not exists qbo_customer_id text,
  add column if not exists company_size integer,
  add column if not exists market_cap numeric,
  add column if not exists nda_completed boolean,
  add column if not exists stock_symbol text,
  add column if not exists financial_brief text,
  add column if not exists total_customer_contract_value numeric,
  add column if not exists hq_location jsonb,
  add column if not exists funnel_stage_id text,
  add column if not exists funnel_stage_name text,
  add column if not exists lead_source_id text,
  add column if not exists lead_source_name text,
  add column if not exists account_lead_id text,
  add column if not exists created_at timestamptz,
  add column if not exists modified_at timestamptz;

create index if not exists fos_companies_public_id_idx
  on public.fos_companies (public_id);
create index if not exists fos_companies_account_lead_idx
  on public.fos_companies (account_lead_id);

create table if not exists public.fos_company_segments (
  company_fibery_id text not null,
  segment_fibery_id text not null,
  segment_name text,
  synced_at timestamptz not null default now(),
  primary key (company_fibery_id, segment_fibery_id)
);

create index if not exists fos_company_segments_segment_idx
  on public.fos_company_segments (segment_fibery_id);

-- ---------------------------------------------------------------------------
-- Clockify Users
-- ---------------------------------------------------------------------------
create table if not exists public.fos_clockify_users (
  fibery_id text primary key,
  public_id text,
  name text,
  clockify_user_id text,
  clockify_user_email text,
  ai_usage_tracker boolean,
  company_enum_id text,
  company_enum_name text,
  department_id text,
  department_name text,
  work_status_id text,
  work_status_name text,
  team_member_role_id text,
  team_member_role_bill_rate numeric,
  team_member_role_cost_rate numeric,
  manager_id text,
  created_at timestamptz,
  modified_at timestamptz,
  synced_at timestamptz not null default now(),
  raw jsonb
);

create index if not exists fos_clockify_users_email_idx
  on public.fos_clockify_users (clockify_user_email);
create index if not exists fos_clockify_users_clockify_id_idx
  on public.fos_clockify_users (clockify_user_id);
create index if not exists fos_clockify_users_manager_idx
  on public.fos_clockify_users (manager_id);
create index if not exists fos_clockify_users_role_idx
  on public.fos_clockify_users (team_member_role_id);

-- ---------------------------------------------------------------------------
-- Contacts
-- ---------------------------------------------------------------------------
create table if not exists public.fos_contacts (
  fibery_id text primary key,
  public_id text,
  name text,
  first_name text,
  last_name text,
  email text,
  cell_phone text,
  role text,
  linkedin_url text,
  birthday date,
  location jsonb,
  company_primary_contact boolean,
  customer_id text,
  manager_id text,
  created_at timestamptz,
  modified_at timestamptz,
  synced_at timestamptz not null default now(),
  raw jsonb
);

create index if not exists fos_contacts_customer_idx
  on public.fos_contacts (customer_id);
create index if not exists fos_contacts_email_idx
  on public.fos_contacts (email);
create index if not exists fos_contacts_manager_idx
  on public.fos_contacts (manager_id);

-- ---------------------------------------------------------------------------
-- Services Estimates
-- ---------------------------------------------------------------------------
create table if not exists public.fos_services_estimates (
  fibery_id text primary key,
  public_id text,
  name text,
  company_id text,
  start_date date,
  end_date date,
  gross_margin numeric,
  total_revenue numeric,
  total_adjusted_revenue numeric,
  total_target_revenue numeric,
  total_labor_costs numeric,
  created_at timestamptz,
  modified_at timestamptz,
  synced_at timestamptz not null default now(),
  raw jsonb
);

create index if not exists fos_services_estimates_company_idx
  on public.fos_services_estimates (company_id);

-- ---------------------------------------------------------------------------
-- Agreements (extend stub)
-- ---------------------------------------------------------------------------
alter table if exists public.fos_agreements
  add column if not exists public_id text,
  add column if not exists clockify_project_id text,
  add column if not exists execution_date date,
  add column if not exists duration_start date,
  add column if not exists duration_end date,
  add column if not exists state_id text,
  add column if not exists state_name text,
  add column if not exists agreement_type_id text,
  add column if not exists agreement_progress_id text,
  add column if not exists agreement_progress_name text,
  add column if not exists customer_id text,
  add column if not exists contact_id text,
  add column if not exists assigned_owner_id text,
  add column if not exists customer_lead_source_id text,
  add column if not exists customer_lead_source_name text,
  add column if not exists allocated_resource_margin numeric,
  add column if not exists current_margin numeric,
  add column if not exists target_margin numeric,
  add column if not exists target_planned_margin_at_complete numeric,
  add column if not exists target_costs numeric,
  add column if not exists target_revenue numeric,
  add column if not exists rev_recognized numeric,
  add column if not exists total_allocated_labor_costs numeric,
  add column if not exists total_expenses numeric,
  add column if not exists total_labor_costs numeric,
  add column if not exists total_materials_odc numeric,
  add column if not exists total_planned_revenue numeric,
  add column if not exists created_at timestamptz,
  add column if not exists modified_at timestamptz;

-- Align legacy stub columns: status/agreement_type/company_fibery_id remain denorm names.
create index if not exists fos_agreements_public_id_idx
  on public.fos_agreements (public_id);
create index if not exists fos_agreements_customer_idx
  on public.fos_agreements (customer_id);
create index if not exists fos_agreements_owner_idx
  on public.fos_agreements (assigned_owner_id);
create index if not exists fos_agreements_state_idx
  on public.fos_agreements (state_name);
create index if not exists fos_agreements_modified_idx
  on public.fos_agreements (modified_at desc);

create table if not exists public.fos_agreement_assigned_resources (
  agreement_fibery_id text not null,
  clockify_user_fibery_id text not null,
  synced_at timestamptz not null default now(),
  primary key (agreement_fibery_id, clockify_user_fibery_id)
);

create index if not exists fos_agreement_assigned_resources_user_idx
  on public.fos_agreement_assigned_resources (clockify_user_fibery_id);

-- ---------------------------------------------------------------------------
-- Resource Allocations
-- ---------------------------------------------------------------------------
create table if not exists public.fos_resource_allocations (
  fibery_id text primary key,
  public_id text,
  allocation_name text,
  agreement_id text,
  clockify_user_id text,
  clockify_user_company_id text,
  clockify_user_role_id text,
  allocated_billable boolean,
  allocated_cost numeric,
  allocated_hours numeric,
  percent_allocated numeric,
  work_days integer,
  notes text,
  duration_start date,
  duration_end date,
  created_at timestamptz,
  modified_at timestamptz,
  synced_at timestamptz not null default now(),
  raw jsonb
);

create index if not exists fos_resource_allocations_agreement_idx
  on public.fos_resource_allocations (agreement_id);
create index if not exists fos_resource_allocations_user_idx
  on public.fos_resource_allocations (clockify_user_id);

-- ---------------------------------------------------------------------------
-- Estimated Allocations
-- ---------------------------------------------------------------------------
create table if not exists public.fos_estimated_allocations (
  fibery_id text primary key,
  public_id text,
  name text,
  services_estimate_id text,
  clockify_user_id text,
  generic_resource_id text,
  allocated_hours numeric,
  allocation numeric,
  allocation_cost_generic numeric,
  adjusted_revenue numeric,
  bill_rate_adjustment numeric,
  generic_resource_bill_rate numeric,
  planned_bill_rate numeric,
  to_be_hired boolean,
  duration_start date,
  duration_end date,
  created_at timestamptz,
  modified_at timestamptz,
  synced_at timestamptz not null default now(),
  raw jsonb
);

create index if not exists fos_estimated_allocations_estimate_idx
  on public.fos_estimated_allocations (services_estimate_id);
create index if not exists fos_estimated_allocations_user_idx
  on public.fos_estimated_allocations (clockify_user_id);

-- ---------------------------------------------------------------------------
-- Fibery Labor Costs (relational mirror; separate from Clockify fos_labor_costs)
-- ---------------------------------------------------------------------------
create table if not exists public.fos_am_labor_costs (
  fibery_id text primary key,
  public_id text,
  name text,
  time_log_id text,
  agreement_id text,
  agreement_customer_id text,
  agreement_name text,
  clockify_user_id text,
  clockify_user_manager_id text,
  clockify_user_company_id text,
  user_role_id text,
  approval_id text,
  approval_name text,
  time_entry_status_id text,
  time_entry_status_name text,
  approved_by text,
  date_of_approval date,
  date_of_creation date,
  bill_rate numeric,
  cost_rate numeric,
  clockify_bill_rate numeric,
  clockify_cost_rate numeric,
  user_role_bill_rate numeric,
  user_role_cost_rate numeric,
  cost numeric,
  hours numeric,
  clockify_hours numeric,
  seconds integer,
  billable text,
  project_id text,
  task text,
  task_id text,
  time_entry_project_name text,
  time_entry_user_name text,
  user_id text,
  start_date_time timestamptz,
  end_date_time timestamptz,
  created_at timestamptz,
  modified_at timestamptz,
  synced_at timestamptz not null default now(),
  raw jsonb
);

create unique index if not exists fos_am_labor_costs_time_log_uidx
  on public.fos_am_labor_costs (time_log_id)
  where time_log_id is not null;
create index if not exists fos_am_labor_costs_agreement_idx
  on public.fos_am_labor_costs (agreement_id);
create index if not exists fos_am_labor_costs_user_idx
  on public.fos_am_labor_costs (clockify_user_id);
create index if not exists fos_am_labor_costs_start_idx
  on public.fos_am_labor_costs (start_date_time);
create index if not exists fos_am_labor_costs_modified_idx
  on public.fos_am_labor_costs (modified_at desc);

comment on table public.fos_am_labor_costs is
  'Fibery Agreement Management/Labor Costs entity mirror. Distinct from Clockify fos_labor_costs.';

-- ---------------------------------------------------------------------------
-- Other Direct Costs
-- ---------------------------------------------------------------------------
create table if not exists public.fos_other_direct_costs (
  fibery_id text primary key,
  public_id text,
  name text,
  agreement_id text,
  amount numeric,
  bill_rate numeric,
  cost_rate numeric,
  hours numeric,
  cost_date date,
  status_id text,
  status_name text,
  type_id text,
  type_name text,
  created_at timestamptz,
  modified_at timestamptz,
  synced_at timestamptz not null default now(),
  raw jsonb
);

create index if not exists fos_other_direct_costs_agreement_idx
  on public.fos_other_direct_costs (agreement_id);

-- ---------------------------------------------------------------------------
-- Invoice Requests
-- ---------------------------------------------------------------------------
create table if not exists public.fos_invoice_requests (
  fibery_id text primary key,
  public_id text,
  name text,
  agreement_id text,
  state_id text,
  state_name text,
  qbo_invoice_number text,
  qbo_invoice_status text,
  created_at timestamptz,
  modified_at timestamptz,
  synced_at timestamptz not null default now(),
  raw jsonb
);

create index if not exists fos_invoice_requests_agreement_idx
  on public.fos_invoice_requests (agreement_id);

-- ---------------------------------------------------------------------------
-- Revenue Items
-- ---------------------------------------------------------------------------
create table if not exists public.fos_revenue_items (
  fibery_id text primary key,
  public_id text,
  name text,
  agreement_id text,
  invoice_request_id text,
  agreement_customer_id text,
  agreement_type_id text,
  agreement_type_name text,
  customer_lead_source_id text,
  state_id text,
  state_name text,
  milestone_title text,
  target_amount numeric,
  actual_amount numeric,
  amount_variance numeric,
  target_date date,
  actual_date date,
  target_month text,
  revenue_recognized boolean,
  qbo_invoice_id text,
  qbo_invoice_url text,
  invoice_error text,
  notes text,
  created_at timestamptz,
  modified_at timestamptz,
  synced_at timestamptz not null default now(),
  raw jsonb
);

create index if not exists fos_revenue_items_agreement_idx
  on public.fos_revenue_items (agreement_id);
create index if not exists fos_revenue_items_invoice_idx
  on public.fos_revenue_items (invoice_request_id);
create index if not exists fos_revenue_items_target_date_idx
  on public.fos_revenue_items (target_date);

-- ---------------------------------------------------------------------------
-- Status Updates (extend existing dual-write table)
-- ---------------------------------------------------------------------------
alter table if exists public.fos_status_updates
  add column if not exists public_id text,
  add column if not exists name text,
  add column if not exists agreement_status_id text,
  add column if not exists submitted_by text,
  add column if not exists modified_at timestamptz;

-- ---------------------------------------------------------------------------
-- Agreement P&L Items + junctions
-- ---------------------------------------------------------------------------
create table if not exists public.fos_agreement_pnl_items (
  fibery_id text primary key,
  public_id text,
  agreement_id text,
  agreement_name text,
  agreement_type_id text,
  month_year text,
  pnl_month_year text,
  duration_start date,
  duration_end date,
  contractor_cogs numeric,
  employee_cogs numeric,
  duration_costs numeric,
  duration_odc numeric,
  duration_revenue numeric,
  margin_amount numeric,
  margin_pct numeric,
  created_at timestamptz,
  modified_at timestamptz,
  synced_at timestamptz not null default now(),
  raw jsonb
);

create index if not exists fos_agreement_pnl_items_agreement_idx
  on public.fos_agreement_pnl_items (agreement_id);
create index if not exists fos_agreement_pnl_items_month_idx
  on public.fos_agreement_pnl_items (month_year);

create table if not exists public.fos_pnl_labor_costs (
  pnl_fibery_id text not null,
  labor_cost_fibery_id text not null,
  synced_at timestamptz not null default now(),
  primary key (pnl_fibery_id, labor_cost_fibery_id)
);

create index if not exists fos_pnl_labor_costs_labor_idx
  on public.fos_pnl_labor_costs (labor_cost_fibery_id);

create table if not exists public.fos_pnl_revenue_items (
  pnl_fibery_id text not null,
  revenue_item_fibery_id text not null,
  synced_at timestamptz not null default now(),
  primary key (pnl_fibery_id, revenue_item_fibery_id)
);

create index if not exists fos_pnl_revenue_items_revenue_idx
  on public.fos_pnl_revenue_items (revenue_item_fibery_id);

-- Match sibling Hub fos_* tables (036 / 040): grant anon/authenticated too.
-- Do not revoke anon; that breaks PostgREST upserts (see 043_am_mirror_grants.sql).
-- Prefer SUPABASE_SERVICE_ROLE_KEY = service_role secret.
grant all on table public.fos_am_enums to postgres, service_role, anon, authenticated;
grant all on table public.fos_team_member_roles to postgres, service_role, anon, authenticated;
grant all on table public.fos_company_segments to postgres, service_role, anon, authenticated;
grant all on table public.fos_clockify_users to postgres, service_role, anon, authenticated;
grant all on table public.fos_contacts to postgres, service_role, anon, authenticated;
grant all on table public.fos_services_estimates to postgres, service_role, anon, authenticated;
grant all on table public.fos_agreement_assigned_resources to postgres, service_role, anon, authenticated;
grant all on table public.fos_resource_allocations to postgres, service_role, anon, authenticated;
grant all on table public.fos_estimated_allocations to postgres, service_role, anon, authenticated;
grant all on table public.fos_am_labor_costs to postgres, service_role, anon, authenticated;
grant all on table public.fos_other_direct_costs to postgres, service_role, anon, authenticated;
grant all on table public.fos_invoice_requests to postgres, service_role, anon, authenticated;
grant all on table public.fos_revenue_items to postgres, service_role, anon, authenticated;
grant all on table public.fos_agreement_pnl_items to postgres, service_role, anon, authenticated;
grant all on table public.fos_pnl_labor_costs to postgres, service_role, anon, authenticated;
grant all on table public.fos_pnl_revenue_items to postgres, service_role, anon, authenticated;

commit;
-- ========== END 041_agreement_management_mirror.sql ==========

-- ========== BEGIN 042_am_mirror_foreign_keys.sql ==========
-- Feature 036 cutover: soft-to-hard FK constraints for the core Agreement
-- Management mirror graph (see 041_agreement_management_mirror.sql).
-- All FKs are DEFERRABLE INITIALLY DEFERRED so hydrate can upsert dimension
-- rows and fact rows in the same page without a strict topological order.
-- ON DELETE SET NULL is used everywhere (soft dimension deletes should not
-- cascade-delete facts); junction-table FKs use ON DELETE CASCADE since a
-- junction row is meaningless once either side is gone.
--
-- Does NOT touch fos_am_labor_costs (deprecated; Fibery Labor Costs are not
-- mirrored as of v3.4.0 - labor facts are Clockify-owned via fos_labor_costs).
-- If a FK would fail validation against existing dirty data, it is added
-- NOT VALID (accepted for new/updated rows immediately) and left unvalidated
-- here; run a follow-up `VALIDATE CONSTRAINT` once the mirror has a clean
-- backfill.

begin;

-- ---------------------------------------------------------------------------
-- fos_agreements -> fos_companies / fos_clockify_users
-- ---------------------------------------------------------------------------
alter table public.fos_agreements
  add constraint fos_agreements_customer_id_fkey
    foreign key (customer_id) references public.fos_companies (fibery_id)
    on delete set null deferrable initially deferred
    not valid;

alter table public.fos_agreements
  add constraint fos_agreements_assigned_owner_id_fkey
    foreign key (assigned_owner_id) references public.fos_clockify_users (fibery_id)
    on delete set null deferrable initially deferred
    not valid;

-- ---------------------------------------------------------------------------
-- fos_contacts -> fos_companies
-- ---------------------------------------------------------------------------
alter table public.fos_contacts
  add constraint fos_contacts_customer_id_fkey
    foreign key (customer_id) references public.fos_companies (fibery_id)
    on delete set null deferrable initially deferred
    not valid;

-- ---------------------------------------------------------------------------
-- fos_resource_allocations -> fos_agreements / fos_clockify_users / fos_team_member_roles
-- ---------------------------------------------------------------------------
alter table public.fos_resource_allocations
  add constraint fos_resource_allocations_agreement_id_fkey
    foreign key (agreement_id) references public.fos_agreements (fibery_id)
    on delete set null deferrable initially deferred
    not valid;

alter table public.fos_resource_allocations
  add constraint fos_resource_allocations_clockify_user_id_fkey
    foreign key (clockify_user_id) references public.fos_clockify_users (fibery_id)
    on delete set null deferrable initially deferred
    not valid;

alter table public.fos_resource_allocations
  add constraint fos_resource_allocations_role_id_fkey
    foreign key (clockify_user_role_id) references public.fos_team_member_roles (fibery_id)
    on delete set null deferrable initially deferred
    not valid;

-- ---------------------------------------------------------------------------
-- fos_revenue_items -> fos_agreements / fos_invoice_requests / fos_companies
-- ---------------------------------------------------------------------------
alter table public.fos_revenue_items
  add constraint fos_revenue_items_agreement_id_fkey
    foreign key (agreement_id) references public.fos_agreements (fibery_id)
    on delete set null deferrable initially deferred
    not valid;

alter table public.fos_revenue_items
  add constraint fos_revenue_items_invoice_request_id_fkey
    foreign key (invoice_request_id) references public.fos_invoice_requests (fibery_id)
    on delete set null deferrable initially deferred
    not valid;

alter table public.fos_revenue_items
  add constraint fos_revenue_items_agreement_customer_id_fkey
    foreign key (agreement_customer_id) references public.fos_companies (fibery_id)
    on delete set null deferrable initially deferred
    not valid;

-- ---------------------------------------------------------------------------
-- fos_other_direct_costs -> fos_agreements
-- ---------------------------------------------------------------------------
alter table public.fos_other_direct_costs
  add constraint fos_other_direct_costs_agreement_id_fkey
    foreign key (agreement_id) references public.fos_agreements (fibery_id)
    on delete set null deferrable initially deferred
    not valid;

-- ---------------------------------------------------------------------------
-- fos_invoice_requests -> fos_agreements
-- ---------------------------------------------------------------------------
alter table public.fos_invoice_requests
  add constraint fos_invoice_requests_agreement_id_fkey
    foreign key (agreement_id) references public.fos_agreements (fibery_id)
    on delete set null deferrable initially deferred
    not valid;

-- ---------------------------------------------------------------------------
-- fos_status_updates -> fos_agreements
-- Soft reference only: Delivery status dual-write may insert before AM mirror
-- has the agreement row. Do not add a hard FK here.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- fos_agreement_pnl_items -> fos_agreements
-- ---------------------------------------------------------------------------
alter table public.fos_agreement_pnl_items
  add constraint fos_agreement_pnl_items_agreement_id_fkey
    foreign key (agreement_id) references public.fos_agreements (fibery_id)
    on delete set null deferrable initially deferred
    not valid;

-- ---------------------------------------------------------------------------
-- fos_company_segments -> fos_companies (junction; cascade both directions)
-- ---------------------------------------------------------------------------
alter table public.fos_company_segments
  add constraint fos_company_segments_company_fkey
    foreign key (company_fibery_id) references public.fos_companies (fibery_id)
    on delete cascade deferrable initially deferred
    not valid;

-- ---------------------------------------------------------------------------
-- fos_agreement_assigned_resources -> fos_agreements / fos_clockify_users (junction)
-- ---------------------------------------------------------------------------
alter table public.fos_agreement_assigned_resources
  add constraint fos_agreement_assigned_resources_agreement_fkey
    foreign key (agreement_fibery_id) references public.fos_agreements (fibery_id)
    on delete cascade deferrable initially deferred
    not valid;

alter table public.fos_agreement_assigned_resources
  add constraint fos_agreement_assigned_resources_user_fkey
    foreign key (clockify_user_fibery_id) references public.fos_clockify_users (fibery_id)
    on delete cascade deferrable initially deferred
    not valid;

-- ---------------------------------------------------------------------------
-- fos_pnl_revenue_items -> fos_agreement_pnl_items / fos_revenue_items (junction)
-- ---------------------------------------------------------------------------
alter table public.fos_pnl_revenue_items
  add constraint fos_pnl_revenue_items_pnl_fkey
    foreign key (pnl_fibery_id) references public.fos_agreement_pnl_items (fibery_id)
    on delete cascade deferrable initially deferred
    not valid;

alter table public.fos_pnl_revenue_items
  add constraint fos_pnl_revenue_items_revenue_item_fkey
    foreign key (revenue_item_fibery_id) references public.fos_revenue_items (fibery_id)
    on delete cascade deferrable initially deferred
    not valid;

comment on table public.fos_am_labor_costs is
  'DEPRECATED (v3.4.0): Fibery Labor Costs are no longer mirrored. Labor facts '
  'come only from Clockify via fos_labor_costs. This table receives no new '
  'rows from supabaseAmMirror.js and is not FK-constrained. Safe to drop in a '
  'future migration once confirmed unused by any report or export.';

commit;
-- ========== END 042_am_mirror_foreign_keys.sql ==========

-- ========== BEGIN 043_am_mirror_grants.sql ==========
-- Feature 036 follow-up: Agreement Management mirror table grants
-- Migration 041 revoked anon/authenticated from AM mirror tables. Working Hub
-- tables (fos_panel_payloads, fos_agreements, fos_companies) and engagement
-- reviews (040) grant anon/authenticated as well so PostgREST upserts from
-- Apps Script succeed. Align AM mirror privileges with that pattern.
-- Prefer SUPABASE_SERVICE_ROLE_KEY = service_role secret.

grant all on table public.fos_am_enums to postgres, service_role, anon, authenticated;
grant all on table public.fos_team_member_roles to postgres, service_role, anon, authenticated;
grant all on table public.fos_company_segments to postgres, service_role, anon, authenticated;
grant all on table public.fos_clockify_users to postgres, service_role, anon, authenticated;
grant all on table public.fos_contacts to postgres, service_role, anon, authenticated;
grant all on table public.fos_services_estimates to postgres, service_role, anon, authenticated;
grant all on table public.fos_agreement_assigned_resources to postgres, service_role, anon, authenticated;
grant all on table public.fos_resource_allocations to postgres, service_role, anon, authenticated;
grant all on table public.fos_estimated_allocations to postgres, service_role, anon, authenticated;
grant all on table public.fos_am_labor_costs to postgres, service_role, anon, authenticated;
grant all on table public.fos_other_direct_costs to postgres, service_role, anon, authenticated;
grant all on table public.fos_invoice_requests to postgres, service_role, anon, authenticated;
grant all on table public.fos_revenue_items to postgres, service_role, anon, authenticated;
grant all on table public.fos_agreement_pnl_items to postgres, service_role, anon, authenticated;
grant all on table public.fos_pnl_labor_costs to postgres, service_role, anon, authenticated;
grant all on table public.fos_pnl_revenue_items to postgres, service_role, anon, authenticated;
-- ========== END 043_am_mirror_grants.sql ==========

-- ========== BEGIN 044_fos_labor_costs_grants.sql ==========
-- Feature 036 follow-up: fos_labor_costs / labor_costs grants + RLS policies
-- Migrations 035/038 revoked anon/authenticated. Apps Script Pull / Live
-- Utilization then hit "permission denied for table fos_labor_costs" (same
-- class of fix as 040 / 043). Prefer SUPABASE_SERVICE_ROLE_KEY.

grant all on table public.fos_labor_costs to postgres, service_role, anon, authenticated;
grant all on table public.labor_costs to postgres, service_role, anon, authenticated;

-- RLS is enabled on both tables; service_role bypasses RLS. Allow anon /
-- authenticated when Script Properties hold the anon key by mistake.
drop policy if exists fos_labor_costs_all_access on public.fos_labor_costs;
create policy fos_labor_costs_all_access on public.fos_labor_costs
  for all to anon, authenticated
  using (true)
  with check (true);

drop policy if exists labor_costs_all_access on public.labor_costs;
create policy labor_costs_all_access on public.labor_costs
  for all to anon, authenticated
  using (true)
  with check (true);
-- ========== END 044_fos_labor_costs_grants.sql ==========

-- ========== BEGIN 045_engagement_updates_status_pack.sql ==========
-- Feature 037 extension: Engagement Updates as DEAP status packs
-- Notes table, update snapshot/RAG/sort columns, AI synopsis on reviews.
-- Service role from Apps Script; grant anon/authenticated like sibling Hub tables.

begin;

alter table public.fos_engagement_reviews
  add column if not exists ai_synopsis_json jsonb,
  add column if not exists ai_synopsis_generated_at timestamptz,
  add column if not exists ai_synopsis_generated_by text;

create table if not exists public.fos_engagement_review_notes (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.fos_engagement_reviews(id) on delete cascade,
  title text,
  body_html text not null default '',
  sort_order integer not null default 0,
  created_by_email text not null,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fos_engagement_review_notes_review_idx
  on public.fos_engagement_review_notes (review_id, sort_order, created_at);

-- Expand Engagement Updates into status packs (keep legacy questionnaire columns).
alter table public.fos_engagement_updates
  add column if not exists reporting_period date,
  add column if not exists sort_order integer not null default 0,
  add column if not exists overall_rag text,
  add column if not exists assigned_owner_email text,
  add column if not exists assigned_owner_name text,
  add column if not exists agreement_name text,
  add column if not exists company_name text,
  add column if not exists qualitative jsonb not null default '{}'::jsonb,
  add column if not exists quantitative_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists metrics_pulled_at timestamptz,
  add column if not exists updated_by_email text,
  add column if not exists updated_at timestamptz not null default now();

-- Legacy questionnaire required executive_summary; status packs may use '' placeholder.
alter table public.fos_engagement_updates
  alter column executive_summary set default '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fos_engagement_updates_overall_rag_chk'
  ) then
    alter table public.fos_engagement_updates
      add constraint fos_engagement_updates_overall_rag_chk
      check (
        overall_rag is null
        or overall_rag in ('on_track', 'at_risk', 'off_track')
      );
  end if;
end $$;

-- Unique status pack per review + agreement + reporting month (partial: legacy rows may lack period).
create unique index if not exists fos_engagement_updates_review_agreement_period_uidx
  on public.fos_engagement_updates (review_id, agreement_fibery_id, reporting_period)
  where reporting_period is not null;

create index if not exists fos_engagement_updates_review_sort_idx
  on public.fos_engagement_updates (review_id, sort_order, created_at);

-- Backfill meeting notes from legacy single call summary.
insert into public.fos_engagement_review_notes (
  review_id, title, body_html, sort_order, created_by_email, updated_by_email
)
select
  r.id,
  'Call summary',
  r.call_summary_html,
  0,
  r.created_by_email,
  r.updated_by_email
from public.fos_engagement_reviews r
where r.call_summary_html is not null
  and length(trim(r.call_summary_html)) > 0
  and not exists (
    select 1
    from public.fos_engagement_review_notes n
    where n.review_id = r.id
  );

grant all on table public.fos_engagement_review_notes
  to postgres, service_role, anon, authenticated;

grant all on table public.fos_engagement_reviews
  to postgres, service_role, anon, authenticated;
grant all on table public.fos_engagement_updates
  to postgres, service_role, anon, authenticated;

commit;
-- ========== END 045_engagement_updates_status_pack.sql ==========

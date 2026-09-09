-- FinOps Performance Hub - combined Supabase schema
-- Generated: 2026-09-09T20:11:27Z
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

-- ========== BEGIN 046_fos_labor_costs_util_dims.sql ==========
-- Utilization / RA labor dimensions: Clockify project -> agreement customer,
-- Clockify user -> team member role. Live Apps Script joins the same tables;
-- this view is the Datastore-side contract for SQL and future RPCs.

create or replace view public.fos_labor_costs_util_dims
with (security_invoker = true) as
select
  lc.clockify_time_log_id,
  lc.start_date_time,
  lc.project_id,
  lc.user_id,
  a.fibery_id as agreement_id,
  a.name as agreement_name,
  co.name as customer_name,
  r.name as user_role_name,
  r.bill_rate as user_role_bill_rate,
  r.cost_rate as user_role_cost_rate
from public.fos_labor_costs lc
left join lateral (
  select agr.fibery_id, agr.name, agr.customer_id
  from public.fos_agreements agr
  where agr.clockify_project_id is not null
    and agr.clockify_project_id = lc.project_id
  order by agr.fibery_id
  limit 1
) a on true
left join public.fos_companies co on co.fibery_id = a.customer_id
left join lateral (
  select u.team_member_role_id
  from public.fos_clockify_users u
  where (
      u.clockify_user_id is not null
      and u.clockify_user_id = lc.user_id
    )
    or (
      u.clockify_user_email is not null
      and lower(u.clockify_user_email) = lower(lc.user_id)
    )
  order by
    case when u.clockify_user_id = lc.user_id then 0 else 1 end,
    u.fibery_id
  limit 1
) u on true
left join public.fos_team_member_roles r on r.fibery_id = u.team_member_role_id;

comment on view public.fos_labor_costs_util_dims is
  'One row per fos_labor_costs time entry with agreement customer and team-member role (LATERAL 1:1 joins).';

grant select on table public.fos_labor_costs_util_dims to postgres, service_role, anon, authenticated;
-- ========== END 046_fos_labor_costs_util_dims.sql ==========

-- ========== BEGIN 047_drop_unused_indexes.sql ==========
-- Feature 047 workstream A3: drop indexes that have never been used.
--
-- Measured 2026-08-24 against pg_stat_user_indexes with 40 days of statistics
-- (stats_reset 2026-07-15). Every index below had idx_scan = 0 over that
-- window. None is unique, primary, or backing a constraint.
--
-- This is write-path relief for the nightly hydrate and the Clockify mirror
-- trigger, not a read win. Read performance on the hot paths is already fine:
-- the 90-day utilization aggregate completes in about 18 ms warm on
-- fos_labor_costs_start_date_time_idx.
--
-- Follow-up (not done here): fos_labor_costs still carries three index pairs
-- where the single-column index is a prefix of a composite one
-- (project_id / project_start, user_id / user_start, status / status_start).
-- All six have non-zero scans, so consolidating them needs a query review
-- rather than a stats read.
--
-- Deliberately NOT dropped:
--   * public.labor_costs indexes (labor_costs_project_start_idx 1856 kB,
--     labor_costs_fetched_at_idx 912 kB, labor_costs_project_id_idx 552 kB).
--     That table is owned by the Clockify sync project, not this repo. They
--     are unused by the dashboard, but the owning project should drop them.
--   * fos_hubspot_deals_hubspot_id_uidx. Unique, and it protects against
--     duplicate deal mirrors even though no read currently seeks on it.
--   * 16 kB indexes on small dimension tables. On tables of 10 to 150 rows the
--     planner correctly prefers a sequential scan, so these will always show
--     zero scans. They cost almost nothing and churning them adds risk.

begin;

-- fos_labor_costs: 22,343 rows, written by the mirror trigger on every
-- Clockify sync. These two are the only meaningful write overhead in the set.
drop index if exists public.fos_labor_costs_fetched_at_idx;   -- 936 kB
drop index if exists public.fos_labor_costs_synced_at_idx;    -- 528 kB

-- Mirror tables rewritten in full on each nightly hydrate.
drop index if exists public.fos_ai_usage_rows_email_idx;      -- 96 kB
drop index if exists public.fos_pnl_revenue_items_revenue_idx; -- 72 kB
drop index if exists public.fos_revenue_items_target_date_idx; -- 40 kB
drop index if exists public.fos_agreement_pnl_items_month_idx; -- 40 kB

analyze public.fos_labor_costs;
analyze public.fos_ai_usage_rows;
analyze public.fos_revenue_items;

commit;
-- ========== END 047_drop_unused_indexes.sql ==========

-- ========== BEGIN 048_perf_diagnostic_runs.sql ==========
-- Feature 047: persist performance harness output.
--
-- The harness runs inside Apps Script, but the numbers are needed outside it to
-- compare a workstream against its baseline. `clasp run` is not usable on this
-- project without linking a standard GCP project and issuing a private OAuth
-- client, so results are written here instead and read back over PostgREST.
--
-- Rows are small (one JSON document per run) and are kept indefinitely: the
-- point is to compare workstream B, C, and D against the workstream A numbers
-- months from now.

begin;

create table if not exists public.fos_perf_runs (
  run_id       text primary key,
  kind         text not null check (kind in ('baseline', 'parity')),
  captured_at  timestamptz not null default now(),
  prd_version  text,
  label        text,
  passed       boolean,
  flags        jsonb,
  result       jsonb not null
);

create index if not exists fos_perf_runs_captured_idx
  on public.fos_perf_runs (captured_at desc);

comment on table public.fos_perf_runs is
  'Feature 047 performance harness output (_diag_capturePerfBaseline, _diag_comparePerfParity*). One JSON document per run.';

commit;
-- ========== END 048_perf_diagnostic_runs.sql ==========

-- ========== BEGIN 049_perf_runs_kind_constraint.sql ==========
-- Feature 047: allow new performance-harness kinds without a migration.
--
-- Migration 048 pinned `kind` to the two values that existed at the time,
-- `baseline` and `parity`. Workstream B1 added a third, `codec`, and the insert
-- failed against `fos_perf_runs_kind_check`. The failure is quiet by design:
-- `perfPersistRun_` logs a warning and returns null, so the diagnostic still
-- printed a correct result to the execution log and only the persisted copy was
-- lost. That is exactly the kind of gap that is noticed late, and workstreams B,
-- C, and D are each expected to add further kinds.
--
-- Trade-off, stated plainly: this swaps an allow-list for a shape check. It
-- still rejects nulls, empty strings, uppercase, whitespace, and overlong text,
-- so the column cannot become a free-text dumping ground. It no longer catches a
-- typo such as 'paritty', which the allow-list would have. That is accepted
-- deliberately. This table is written by a single internal code path and read by
-- diagnostics, so a mistyped kind is a nuisance to be filtered out, whereas a
-- rejected insert silently loses a measurement we ran a full hydrate to get.

begin;

alter table public.fos_perf_runs
  drop constraint if exists fos_perf_runs_kind_check;

alter table public.fos_perf_runs
  add constraint fos_perf_runs_kind_check
  check (kind ~ '^[a-z][a-z0-9_-]{0,31}$');

comment on column public.fos_perf_runs.kind is
  'Harness family, lowercase slug: baseline, parity, codec, and future workstream kinds. Shape-checked rather than enumerated so a new diagnostic does not require a migration.';

commit;
-- ========== END 049_perf_runs_kind_constraint.sql ==========

-- ========== BEGIN 050_fos_rpc_ra_week_grid.sql ==========
-- Feature 047 Workstream B2: Resource assignments week grid RPC.
--
-- Replaces a full-table PostgREST read of public.fos_resource_allocations plus
-- four dimension-table reads with one call that filters allocation overlap in
-- SQL and resolves the display joins there too.
--
-- The returned `allocations` array is byte-for-byte the shape
-- `mapFosResourceAllocationRowToRaw_` produces in
-- src/supabasePanelBuilders.js, so every downstream aggregation helper in
-- src/resourceAssignmentDashboard.js runs unchanged. Nothing about the panel
-- payload shape changes; only where the rows come from.
--
-- Overlap semantics deliberately mirror `allocationOverlapsRangeYmd_`:
--
--   * A row with both duration bounds null is IN range. The implementation
--     plan sketched `duration_start < p_end and duration_end >= p_start`,
--     which silently drops those rows. One of the 149 mirrored allocations is
--     exactly that case, so the sketch would have changed a KPI.
--   * A single null bound falls back to the other bound.
--   * A reversed pair is swapped before comparison (least/greatest).
--   * Both ends are inclusive: start <= p_end and end >= p_start.
--
-- Row order matters. Alert ties are broken by input order in JavaScript, so
-- the dimension lookups are scalar subqueries rather than joins: the planner
-- keeps the heap order of the sequential scan, which is what an unordered
-- PostgREST select returns today. Do not add an ORDER BY without re-running
-- _diag_comparePerfParity('resource-assignments', ...).

create or replace function public.fos_rpc_ra_week_grid(
  p_start date,
  p_end   date
) returns jsonb
language sql
stable
set statement_timeout = '20s'
as $$
  select jsonb_build_object(
    'rangeStart', p_start,
    'rangeEnd', p_end,
    'totalCount', (select count(*) from public.fos_resource_allocations),
    'matchedCount', count(*),
    'allocations', coalesce(jsonb_agg(alloc), '[]'::jsonb)
  )
  from (
    select jsonb_build_object(
      'id', a.fibery_id,
      'duration', jsonb_build_object('start', a.duration_start, 'end', a.duration_end),
      'allocationName', a.allocation_name,
      'percentAllocated', a.percent_allocated,
      'clockifyUserId', a.clockify_user_id,
      'clockifyUserName', (
        select u.name from public.fos_clockify_users u
        where u.fibery_id = a.clockify_user_id
      ),
      'clockifyUserCompany', (
        select u.company_enum_name from public.fos_clockify_users u
        where u.fibery_id = a.clockify_user_id
      ),
      'roleName', (
        select r.name from public.fos_team_member_roles r
        where r.fibery_id = a.clockify_user_role_id
      ),
      'agreementId', a.agreement_id,
      'agreementName', (
        select ag.name from public.fos_agreements ag
        where ag.fibery_id = a.agreement_id
      ),
      'customerName', (
        select c.name from public.fos_companies c
        where c.fibery_id = (
          select ag.customer_id from public.fos_agreements ag
          where ag.fibery_id = a.agreement_id
        )
      ),
      'allocatedAndBillable', a.allocated_billable,
      'allocatedHours', a.allocated_hours
    ) as alloc
    from public.fos_resource_allocations a
    where a.fibery_id is not null
      and (
        (a.duration_start is null and a.duration_end is null)
        or (
          least(
            coalesce(a.duration_start, a.duration_end),
            coalesce(a.duration_end, a.duration_start)
          ) <= p_end
          and greatest(
            coalesce(a.duration_start, a.duration_end),
            coalesce(a.duration_end, a.duration_start)
          ) >= p_start
        )
      )
  ) filtered;
$$;

comment on function public.fos_rpc_ra_week_grid(date, date) is
  'Feature 047 B2. Resource allocations overlapping [p_start, p_end] with display joins resolved. Mirrors allocationOverlapsRangeYmd_ exactly, including all-null durations being in range. Called behind the PERF_USE_RA_RPC kill switch.';

grant execute on function public.fos_rpc_ra_week_grid(date, date)
  to postgres, service_role, anon, authenticated;
-- ========== END 050_fos_rpc_ra_week_grid.sql ==========

-- ========== BEGIN 051_fos_viz_range_payloads.sql ==========
-- Feature 047 Workstream B4: range-keyed visualization cache.
--
-- Every Utilization load rebuilds from fos_labor_costs today. The stored panel
-- blob in fos_panel_payloads is only a fallback, and it carries exactly one
-- window (the default range at hydrate time), so no other range can ever be
-- served from it. This table caches the normalized row bundle for a
-- day-aligned window so a repeated window is one read instead of eleven.
--
-- WHY DAY-ALIGNED, AND WHY THE PLAN'S DDL WAS NOT USABLE AS WRITTEN
--
-- The implementation plan proposed `primary key (panel_key, range_start,
-- range_end, cache_schema_version)` with both bounds typed `date`. Measured
-- against the live table, labor timestamps are intra-day: of 22,546 rows only
-- 168 sit exactly on midnight and there are 1,163 distinct times of day. The
-- client also never sends a day boundary for a preset window; it sends
-- `new Date()` instants, so the default 60-day window differs by milliseconds
-- on every request. A `date`-keyed entry would therefore be served to requests
-- whose real instant bounds differ from the ones it was built for. On today's
-- data that is 51 rows at the start edge of the default window, which moves
-- every KPI on the panel.
--
-- So the date columns here are deliberately a SUPERSET key, not the answer:
--
--   range_start = floor(requested start to UTC day)
--   range_end   = ceil (requested end   to UTC day)
--
-- The cached bundle holds every row in that superset. Apps Script then filters
-- it to the exact requested instants before computing anything, which is the
-- same re-slice `applyUtilizationRequestedRange_` already performs on the
-- stored panel blob. Numbers cannot move, and the default window becomes
-- cacheable even though its instants never repeat.
--
-- KEY DESIGN
--
--   panel_key            which panel's bundle this is
--   range_start/_end     the day-aligned superset described above
--   cache_schema_version the panel's cacheSchemaVersion, so a panel bump
--                        orphans every old entry with no explicit purge
--   key_hash             fingerprint of every other input that can change the
--                        stored rows: the resolved threshold object and the
--                        PERF_* flags that affect row content. Deliberately
--                        over-keyed. An ADMIN retuning a threshold costs one
--                        rebuild; a key that missed a threshold would serve
--                        wrong numbers silently.
--
-- INVALIDATION
--
-- source_watermark and source_row_count fingerprint the inputs. The watermark
-- is the greatest synced_at across fos_labor_costs and the four dimension
-- tables whose values land inside a normalized row (users, roles, agreements,
-- companies). The row count is carried separately because an upstream DELETE
-- does not advance any synced_at.
--
-- Note that fos_labor_costs is written by the Clockify sync project, not by
-- this repo's nightly hydrate: on 2026-08-25 its max synced_at was 05:35 while
-- the hydrate ran 08:57 to 10:04. "Last completed hydrate" is therefore NOT a
-- sufficient epoch, which is why the watermark is computed from the source
-- tables themselves. Measured cost of the whole fingerprint expression: 19.5 ms
-- warm, entirely from shared buffers, so no new index is required.
--
-- Apps Script reads the watermark BEFORE fetching rows and stamps that value on
-- the write. If an upstream sync lands mid-build, the entry is stamped with the
-- pre-build watermark and is treated as stale on the next read. The failure
-- direction is a wasted rebuild, never a stale serve.

begin;

create table if not exists public.fos_viz_range_payloads (
  panel_key            text        not null,
  range_start          date        not null,
  range_end            date        not null,
  cache_schema_version int         not null,
  key_hash             text        not null,
  payload              jsonb       not null,
  row_count            int         not null default 0,
  payload_chars        int         not null default 0,
  built_at             timestamptz not null default now(),
  source_watermark     timestamptz,
  source_row_count     int,
  primary key (panel_key, range_start, range_end, cache_schema_version, key_hash)
);

create index if not exists fos_viz_range_payloads_gc_idx
  on public.fos_viz_range_payloads (panel_key, source_watermark);

comment on table public.fos_viz_range_payloads is
  'Feature 047 B4. Day-aligned superset row bundles per panel and window. Read behind the PERF_USE_RANGE_CACHE kill switch and re-sliced to the exact requested instants in Apps Script, so the date bounds are a cache key and never the answer.';

-- Fingerprint of every input that can change a cached bundle's rows.
-- Kept as its own function so the read RPC, the writer, and the garbage
-- collector cannot disagree about what "unchanged" means.
create or replace function public.fos_viz_source_fingerprint()
returns jsonb
language sql
stable
set statement_timeout = '20s'
as $$
  select jsonb_build_object(
    'watermark', greatest(
      (select max(synced_at) from public.fos_labor_costs),
      (select max(synced_at) from public.fos_clockify_users),
      (select max(synced_at) from public.fos_team_member_roles),
      (select max(synced_at) from public.fos_agreements),
      (select max(synced_at) from public.fos_companies)
    ),
    'rowCount', (select count(*) from public.fos_labor_costs)
  );
$$;

comment on function public.fos_viz_source_fingerprint() is
  'Feature 047 B4. Greatest synced_at across fos_labor_costs and the four dimension tables a normalized utilization row draws from, plus the labor row count so an upstream delete is detected. ~19.5 ms warm.';

-- One round trip for the whole read decision: does an entry exist, is it still
-- fresh against the current fingerprint, and what is the current fingerprint so
-- the caller can stamp a write on a miss.
--
-- `payload` is returned ONLY when the entry is fresh. Shipping ~900 kB that the
-- caller is about to discard would make a miss more expensive than no cache.
create or replace function public.fos_rpc_viz_range_get(
  p_panel_key            text,
  p_range_start          date,
  p_range_end            date,
  p_cache_schema_version int,
  p_key_hash             text
) returns jsonb
language plpgsql
stable
set statement_timeout = '20s'
as $$
declare
  v_fp    jsonb := public.fos_viz_source_fingerprint();
  v_row   public.fos_viz_range_payloads;
  v_hit   boolean := false;
  v_fresh boolean := false;
begin
  select * into v_row
  from public.fos_viz_range_payloads
  where panel_key = p_panel_key
    and range_start = p_range_start
    and range_end = p_range_end
    and cache_schema_version = p_cache_schema_version
    and key_hash = p_key_hash;
  v_hit := found;

  if v_hit then
    v_fresh :=
      v_row.source_watermark is not null
      and (v_fp->>'watermark') is not null
      and v_row.source_watermark >= (v_fp->>'watermark')::timestamptz
      and v_row.source_row_count is not null
      and v_row.source_row_count = (v_fp->>'rowCount')::int;
  end if;

  return jsonb_build_object(
    'hit', v_hit,
    'fresh', v_fresh,
    'payload', case when v_fresh then v_row.payload else null end,
    'builtAt', v_row.built_at,
    'rowCount', v_row.row_count,
    'storedWatermark', v_row.source_watermark,
    'storedRowCount', v_row.source_row_count,
    'currentWatermark', v_fp->>'watermark',
    'currentRowCount', (v_fp->>'rowCount')::int
  );
end;
$$;

comment on function public.fos_rpc_viz_range_get(text, date, date, int, text) is
  'Feature 047 B4. Returns the cached bundle only when its stored fingerprint still matches the live one, plus the current fingerprint so a miss can be stamped correctly. Called behind PERF_USE_RANGE_CACHE.';

-- Drops entries that can never be served again because the sources moved on.
-- Exact rather than heuristic: no TTL, no size cap, no guessing which windows
-- matter. Run at the end of hydrate.
create or replace function public.fos_rpc_viz_range_gc(p_panel_key text)
returns jsonb
language plpgsql
volatile
set statement_timeout = '20s'
as $$
declare
  v_fp      jsonb := public.fos_viz_source_fingerprint();
  v_deleted int;
begin
  delete from public.fos_viz_range_payloads
  where panel_key = p_panel_key
    and (
      source_watermark is null
      or source_watermark < (v_fp->>'watermark')::timestamptz
      or source_row_count is null
      or source_row_count <> (v_fp->>'rowCount')::int
    );
  get diagnostics v_deleted = row_count;
  return jsonb_build_object(
    'deleted', v_deleted,
    'remaining', (
      select count(*) from public.fos_viz_range_payloads where panel_key = p_panel_key
    )
  );
end;
$$;

comment on function public.fos_rpc_viz_range_gc(text) is
  'Feature 047 B4. Deletes range-cache entries whose source fingerprint is behind the live one, which are exactly the entries that can never be served again.';

grant execute on function public.fos_viz_source_fingerprint()
  to postgres, service_role, anon, authenticated;
grant execute on function public.fos_rpc_viz_range_get(text, date, date, int, text)
  to postgres, service_role, anon, authenticated;
grant execute on function public.fos_rpc_viz_range_gc(text)
  to postgres, service_role, anon, authenticated;

commit;
-- ========== END 051_fos_viz_range_payloads.sql ==========

-- ========== BEGIN 052_fos_agreements_bid_program_fields.sql ==========
-- Feature 049: Bid / Program / Initial Planned Hours on Agreements
-- Mirrors new Fibery Agreement Management/Agreements fields into Datastore
-- and adds fos_programs for Program entity joins.

begin;

create table if not exists public.fos_programs (
  fibery_id text primary key,
  public_id text,
  name text,
  created_at timestamptz,
  modified_at timestamptz,
  synced_at timestamptz not null default now(),
  raw jsonb
);

create index if not exists fos_programs_name_idx on public.fos_programs (name);
create index if not exists fos_programs_public_id_idx on public.fos_programs (public_id);

comment on table public.fos_programs is
  'Fibery Agreement Management/Program entities mirrored for agreement program joins.';

alter table public.fos_agreements
  add column if not exists bid_cost numeric,
  add column if not exists bid_margin numeric,
  add column if not exists bid_revenue numeric,
  add column if not exists initial_planned_hours numeric,
  add column if not exists program_id text,
  add column if not exists program_name text;

create index if not exists fos_agreements_program_idx
  on public.fos_agreements (program_id);

comment on column public.fos_agreements.bid_cost is 'Fibery Agreement Management/Bid Cost';
comment on column public.fos_agreements.bid_margin is 'Fibery Agreement Management/Bid Margin (formula)';
comment on column public.fos_agreements.bid_revenue is 'Fibery Agreement Management/Bid Revenue';
comment on column public.fos_agreements.initial_planned_hours is 'Fibery Agreement Management/Initial Planned Hours';
comment on column public.fos_agreements.program_id is 'Fibery Agreement Management/Program relation id';
comment on column public.fos_agreements.program_name is 'Program display name (Program Name lookup, else relation Name)';

grant all on table public.fos_programs to postgres, service_role, anon, authenticated;

commit;
-- ========== END 052_fos_agreements_bid_program_fields.sql ==========

-- ========== BEGIN 053_fos_ra_range_cache_fingerprint.sql ==========
-- Feature 047 follow-on: Resource assignments range payload cache.
--
-- Reuses fos_viz_range_payloads (migration 051) with panel_key =
-- 'resource-assignments'. Unlike Utilization (row bundles re-sliced in GAS),
-- RA stores the fully assembled panel payload for an exact From/To YMD window
-- so Live open / Reload is one Postgres read instead of a full Apps Script
-- rebuild.
--
-- The B4 get/gc RPCs used fos_viz_source_fingerprint() for every panel_key.
-- That fingerprint ignores fos_resource_allocations, so an RA entry would stay
-- "fresh" after allocation edits. This migration adds an RA fingerprint and
-- makes get/gc choose the fingerprint by panel_key.

begin;

create or replace function public.fos_ra_source_fingerprint()
returns jsonb
language sql
stable
set statement_timeout = '20s'
as $$
  select jsonb_build_object(
    'watermark', greatest(
      (select max(synced_at) from public.fos_labor_costs),
      (select max(synced_at) from public.fos_resource_allocations),
      (select max(synced_at) from public.fos_clockify_users),
      (select max(synced_at) from public.fos_team_member_roles),
      (select max(synced_at) from public.fos_agreements),
      (select max(synced_at) from public.fos_companies)
    ),
    'rowCount',
      coalesce((select count(*) from public.fos_labor_costs), 0)
      + coalesce((select count(*) from public.fos_resource_allocations), 0)
  );
$$;

comment on function public.fos_ra_source_fingerprint() is
  'Feature 047 RA range cache. Greatest synced_at across labor, allocations, and RA dimension tables, plus labor+allocation row counts so deletes invalidate.';

create or replace function public.fos_panel_source_fingerprint(p_panel_key text)
returns jsonb
language sql
stable
set statement_timeout = '20s'
as $$
  select case
    when p_panel_key = 'resource-assignments' then public.fos_ra_source_fingerprint()
    else public.fos_viz_source_fingerprint()
  end;
$$;

comment on function public.fos_panel_source_fingerprint(text) is
  'Feature 047. Dispatches to the Utilization or Resource assignments source fingerprint by panel_key.';

create or replace function public.fos_rpc_viz_range_get(
  p_panel_key            text,
  p_range_start          date,
  p_range_end            date,
  p_cache_schema_version int,
  p_key_hash             text
) returns jsonb
language plpgsql
stable
set statement_timeout = '20s'
as $$
declare
  v_fp    jsonb := public.fos_panel_source_fingerprint(p_panel_key);
  v_row   public.fos_viz_range_payloads;
  v_hit   boolean := false;
  v_fresh boolean := false;
begin
  select * into v_row
  from public.fos_viz_range_payloads
  where panel_key = p_panel_key
    and range_start = p_range_start
    and range_end = p_range_end
    and cache_schema_version = p_cache_schema_version
    and key_hash = p_key_hash;
  v_hit := found;

  if v_hit then
    v_fresh :=
      v_row.source_watermark is not null
      and (v_fp->>'watermark') is not null
      and v_row.source_watermark >= (v_fp->>'watermark')::timestamptz
      and v_row.source_row_count is not null
      and v_row.source_row_count = (v_fp->>'rowCount')::int;
  end if;

  return jsonb_build_object(
    'hit', v_hit,
    'fresh', v_fresh,
    'payload', case when v_fresh then v_row.payload else null end,
    'builtAt', v_row.built_at,
    'rowCount', v_row.row_count,
    'storedWatermark', v_row.source_watermark,
    'storedRowCount', v_row.source_row_count,
    'currentWatermark', v_fp->>'watermark',
    'currentRowCount', (v_fp->>'rowCount')::int
  );
end;
$$;

comment on function public.fos_rpc_viz_range_get(text, date, date, int, text) is
  'Feature 047 B4 (+ RA follow-on). Returns the cached bundle only when its stored fingerprint still matches the live one for that panel_key.';

create or replace function public.fos_rpc_viz_range_gc(p_panel_key text)
returns jsonb
language plpgsql
volatile
set statement_timeout = '20s'
as $$
declare
  v_fp      jsonb := public.fos_panel_source_fingerprint(p_panel_key);
  v_deleted int;
begin
  delete from public.fos_viz_range_payloads
  where panel_key = p_panel_key
    and (
      source_watermark is null
      or source_watermark < (v_fp->>'watermark')::timestamptz
      or source_row_count is null
      or source_row_count <> (v_fp->>'rowCount')::int
    );
  get diagnostics v_deleted = row_count;
  return jsonb_build_object(
    'deleted', v_deleted,
    'remaining', (
      select count(*) from public.fos_viz_range_payloads where panel_key = p_panel_key
    )
  );
end;
$$;

comment on function public.fos_rpc_viz_range_gc(text) is
  'Feature 047 B4 (+ RA follow-on). Deletes range-cache entries whose panel fingerprint is behind the live one.';

grant execute on function public.fos_ra_source_fingerprint()
  to postgres, service_role, anon, authenticated;
grant execute on function public.fos_panel_source_fingerprint(text)
  to postgres, service_role, anon, authenticated;
grant execute on function public.fos_rpc_viz_range_get(text, date, date, int, text)
  to postgres, service_role, anon, authenticated;
grant execute on function public.fos_rpc_viz_range_gc(text)
  to postgres, service_role, anon, authenticated;

commit;
-- ========== END 053_fos_ra_range_cache_fingerprint.sql ==========

-- ========== BEGIN 054_fos_mirror_reconcile.sql ==========
-- Feature 036 / 047: ghost-row reconcile after full Fibery AM mirror scans.
-- Apps Script records fibery_ids seen during a full-scan step, then deletes
-- Supabase rows not in that snapshot (and stale junction rows).

create table if not exists public.fos_reconcile_snapshot (
  run_id text not null,
  step_key text not null,
  fibery_id text not null,
  primary key (run_id, step_key, fibery_id)
);

create index if not exists fos_reconcile_snapshot_run_step_idx
  on public.fos_reconcile_snapshot (run_id, step_key);

comment on table public.fos_reconcile_snapshot is
  'Transient fibery_id sets for AM mirror ghost reconcile; cleared per step after reconcile.';

create table if not exists public.fos_reconcile_junction_snapshot (
  run_id text not null,
  step_key text not null,
  parent_fibery_id text not null,
  child_fibery_id text not null,
  primary key (run_id, step_key, parent_fibery_id, child_fibery_id)
);

create index if not exists fos_reconcile_junction_snapshot_run_step_idx
  on public.fos_reconcile_junction_snapshot (run_id, step_key);

comment on table public.fos_reconcile_junction_snapshot is
  'Transient M2M pairs seen during a full-scan AM mirror step (company segments, etc.).';

grant all on table public.fos_reconcile_snapshot to postgres, service_role, anon, authenticated;
grant all on table public.fos_reconcile_junction_snapshot to postgres, service_role, anon, authenticated;

-- Allowlisted mirror tables only (security definer; called from Apps Script service role).
create or replace function public.fos_reconcile_mirror_step(
  p_run_id text,
  p_step_key text,
  p_table_name text,
  p_enum_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int := 0;
  v_sql text;
begin
  if p_run_id is null or length(trim(p_run_id)) = 0 then
    raise exception 'run_id required';
  end if;
  if p_step_key is null or length(trim(p_step_key)) = 0 then
    raise exception 'step_key required';
  end if;

  if p_table_name = 'fos_am_enums' then
    if p_enum_type is null or length(trim(p_enum_type)) = 0 then
      raise exception 'enum_type required for fos_am_enums';
    end if;
    delete from public.fos_am_enums t
    where t.enum_type = p_enum_type
      and t.fibery_id not in (
        select s.fibery_id
        from public.fos_reconcile_snapshot s
        where s.run_id = p_run_id
          and s.step_key = p_step_key
      );
    get diagnostics v_deleted = row_count;
  elsif p_table_name in (
    'fos_team_member_roles',
    'fos_companies',
    'fos_clockify_users',
    'fos_contacts',
    'fos_services_estimates',
    'fos_programs',
    'fos_agreements',
    'fos_resource_allocations',
    'fos_estimated_allocations',
    'fos_other_direct_costs',
    'fos_invoice_requests',
    'fos_status_updates',
    'fos_revenue_items',
    'fos_agreement_pnl_items',
    'fos_hubspot_deals',
    'fos_ai_usage_rows'
  ) then
    v_sql := format(
      'delete from public.%I t where t.fibery_id not in (
         select s.fibery_id from public.fos_reconcile_snapshot s
         where s.run_id = $1 and s.step_key = $2
       )',
      p_table_name
    );
    execute v_sql using p_run_id, p_step_key;
    get diagnostics v_deleted = row_count;
  else
    raise exception 'table not allowed: %', p_table_name;
  end if;

  delete from public.fos_reconcile_snapshot
  where run_id = p_run_id and step_key = p_step_key;

  return jsonb_build_object(
    'deleted', v_deleted,
    'table', p_table_name,
    'enumType', p_enum_type
  );
end;
$$;

comment on function public.fos_reconcile_mirror_step(text, text, text, text) is
  'Deletes mirror rows whose fibery_id was not recorded in fos_reconcile_snapshot for this run/step.';

create or replace function public.fos_reconcile_mirror_junction_step(
  p_run_id text,
  p_step_key text,
  p_table_name text,
  p_parent_column text,
  p_child_column text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int := 0;
  v_sql text;
begin
  if p_table_name not in (
    'fos_company_segments',
    'fos_agreement_assigned_resources',
    'fos_pnl_revenue_items'
  ) then
    raise exception 'junction table not allowed: %', p_table_name;
  end if;
  if p_parent_column not in ('company_fibery_id', 'agreement_fibery_id', 'pnl_fibery_id') then
    raise exception 'parent column not allowed: %', p_parent_column;
  end if;
  if p_child_column not in ('segment_fibery_id', 'clockify_user_fibery_id', 'revenue_item_fibery_id') then
    raise exception 'child column not allowed: %', p_child_column;
  end if;

  v_sql := format(
    'delete from public.%I j
     where j.%I not in (
       select s.fibery_id from public.fos_reconcile_snapshot s
       where s.run_id = $1 and s.step_key = $2
     )
     or not exists (
       select 1 from public.fos_reconcile_junction_snapshot s
       where s.run_id = $1 and s.step_key = $2
         and s.parent_fibery_id = j.%I
         and s.child_fibery_id = j.%I
     )',
    p_table_name,
    p_parent_column,
    p_parent_column,
    p_child_column
  );
  execute v_sql using p_run_id, p_step_key;
  get diagnostics v_deleted = row_count;

  delete from public.fos_reconcile_junction_snapshot
  where run_id = p_run_id and step_key = p_step_key;

  return jsonb_build_object('deleted', v_deleted, 'table', p_table_name);
end;
$$;

comment on function public.fos_reconcile_mirror_junction_step(text, text, text, text, text) is
  'Deletes stale M2M rows after a full parent-entity mirror step.';

create or replace function public.fos_reconcile_snapshot_gc(p_run_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids int := 0;
  v_junc int := 0;
begin
  if p_run_id is not null and length(trim(p_run_id)) > 0 then
    delete from public.fos_reconcile_snapshot where run_id = p_run_id;
    get diagnostics v_ids = row_count;
    delete from public.fos_reconcile_junction_snapshot where run_id = p_run_id;
    get diagnostics v_junc = row_count;
  else
    return jsonb_build_object('snapshotRows', 0, 'junctionRows', 0);
  end if;
  return jsonb_build_object('snapshotRows', v_ids, 'junctionRows', v_junc);
end;
$$;

grant execute on function public.fos_reconcile_mirror_step(text, text, text, text)
  to postgres, service_role, anon, authenticated;
grant execute on function public.fos_reconcile_mirror_junction_step(text, text, text, text, text)
  to postgres, service_role, anon, authenticated;
grant execute on function public.fos_reconcile_snapshot_gc(text)
  to postgres, service_role, anon, authenticated;
-- ========== END 054_fos_mirror_reconcile.sql ==========

-- ========== BEGIN 055_lookback_reviews.sql ==========
-- Feature 056: Monthly Client Financial Performance Review (Lookback)
-- Locked month archive, selected/green projects, narrative evidence.

begin;

create table if not exists public.fos_lookback_months (
  id uuid primary key default gen_random_uuid(),
  reporting_period date not null,
  locked_at timestamptz,
  lock_timezone text not null default 'America/Los_Angeles',
  status text not null default 'locking',
  threshold_pct numeric not null default 50,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fos_lookback_months_period_uidx unique (reporting_period),
  constraint fos_lookback_months_status_chk
    check (status in ('locking', 'open_for_narratives', 'archived'))
);

create table if not exists public.fos_lookback_projects (
  id uuid primary key default gen_random_uuid(),
  month_id uuid not null references public.fos_lookback_months(id) on delete cascade,
  agreement_fibery_id text not null,
  agreement_name text,
  company_name text,
  assigned_owner_email text,
  assigned_owner_name text,
  selected boolean not null default false,
  review_type text,
  criteria jsonb not null default '[]'::jsonb,
  selected_by_email text,
  reason text,
  narrative jsonb not null default '{}'::jsonb,
  narrative_status text not null default 'not_started',
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_email text,
  unique (month_id, agreement_fibery_id),
  constraint fos_lookback_projects_type_chk
    check (review_type is null or review_type in ('automatic', 'manual')),
  constraint fos_lookback_projects_status_chk
    check (narrative_status in ('not_started', 'in_progress', 'complete'))
);

create index if not exists fos_lookback_projects_month_sel_idx
  on public.fos_lookback_projects (month_id, selected, narrative_status);
create index if not exists fos_lookback_projects_owner_idx
  on public.fos_lookback_projects (assigned_owner_email);

create table if not exists public.fos_lookback_evidence (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.fos_lookback_projects(id) on delete cascade,
  drive_file_id text not null,
  file_name text,
  mime_type text,
  byte_size bigint,
  uploaded_by_email text not null,
  uploaded_at timestamptz not null default now()
);

create index if not exists fos_lookback_evidence_project_idx
  on public.fos_lookback_evidence (project_id, uploaded_at desc);

grant all on table public.fos_lookback_months to postgres, service_role, anon, authenticated;
grant all on table public.fos_lookback_projects to postgres, service_role, anon, authenticated;
grant all on table public.fos_lookback_evidence to postgres, service_role, anon, authenticated;

commit;
-- ========== END 055_lookback_reviews.sql ==========

-- ========== BEGIN 056_lookback_projects_sort_order.sql ==========
-- Feature 056 / FEATURE-056-07: persisted Ready for Review order.

begin;

alter table public.fos_lookback_projects
  add column if not exists sort_order integer not null default 0;

create index if not exists fos_lookback_projects_month_sort_idx
  on public.fos_lookback_projects (month_id, sort_order);

commit;
-- ========== END 056_lookback_projects_sort_order.sql ==========

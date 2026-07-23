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

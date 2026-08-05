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

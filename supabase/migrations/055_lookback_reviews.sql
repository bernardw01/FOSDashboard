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

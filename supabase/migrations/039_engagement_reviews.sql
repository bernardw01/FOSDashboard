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

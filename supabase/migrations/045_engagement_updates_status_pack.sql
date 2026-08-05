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

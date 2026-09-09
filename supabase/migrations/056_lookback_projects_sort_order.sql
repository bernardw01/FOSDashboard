-- Feature 056 / FEATURE-056-07: persisted Ready for Review order.

begin;

alter table public.fos_lookback_projects
  add column if not exists sort_order integer not null default 0;

create index if not exists fos_lookback_projects_month_sort_idx
  on public.fos_lookback_projects (month_id, sort_order);

commit;

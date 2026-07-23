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

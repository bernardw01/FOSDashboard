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

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

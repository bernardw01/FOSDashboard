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

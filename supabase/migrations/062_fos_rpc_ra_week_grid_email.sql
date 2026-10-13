-- Feature: resource allocation person key via clockify_user_email (parity with Apps Script).

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
      'clockifyUserEmail', a.clockify_user_email,
      'clockifyUserName', coalesce(
        (
          select u.name from public.fos_clockify_users u
          where a.clockify_user_email is not null
            and lower(u.clockify_user_email) = lower(a.clockify_user_email)
          limit 1
        ),
        (
          select u.name from public.fos_clockify_users u
          where u.fibery_id = a.clockify_user_id
        )
      ),
      'clockifyUserCompany', coalesce(
        (
          select u.company_enum_name from public.fos_clockify_users u
          where a.clockify_user_email is not null
            and lower(u.clockify_user_email) = lower(a.clockify_user_email)
          limit 1
        ),
        (
          select u.company_enum_name from public.fos_clockify_users u
          where u.fibery_id = a.clockify_user_id
        )
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
  'Resource allocations overlapping [p_start, p_end] with display joins. Person resolution prefers clockify_user_email, then Clockify User fibery_id.';

grant execute on function public.fos_rpc_ra_week_grid(date, date)
  to postgres, service_role, anon, authenticated;

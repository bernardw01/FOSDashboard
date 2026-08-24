-- Utilization / RA labor dimensions: Clockify project -> agreement customer,
-- Clockify user -> team member role. Live Apps Script joins the same tables;
-- this view is the Datastore-side contract for SQL and future RPCs.

create or replace view public.fos_labor_costs_util_dims
with (security_invoker = true) as
select
  lc.clockify_time_log_id,
  lc.start_date_time,
  lc.project_id,
  lc.user_id,
  a.fibery_id as agreement_id,
  a.name as agreement_name,
  co.name as customer_name,
  r.name as user_role_name,
  r.bill_rate as user_role_bill_rate,
  r.cost_rate as user_role_cost_rate
from public.fos_labor_costs lc
left join lateral (
  select agr.fibery_id, agr.name, agr.customer_id
  from public.fos_agreements agr
  where agr.clockify_project_id is not null
    and agr.clockify_project_id = lc.project_id
  order by agr.fibery_id
  limit 1
) a on true
left join public.fos_companies co on co.fibery_id = a.customer_id
left join lateral (
  select u.team_member_role_id
  from public.fos_clockify_users u
  where (
      u.clockify_user_id is not null
      and u.clockify_user_id = lc.user_id
    )
    or (
      u.clockify_user_email is not null
      and lower(u.clockify_user_email) = lower(lc.user_id)
    )
  order by
    case when u.clockify_user_id = lc.user_id then 0 else 1 end,
    u.fibery_id
  limit 1
) u on true
left join public.fos_team_member_roles r on r.fibery_id = u.team_member_role_id;

comment on view public.fos_labor_costs_util_dims is
  'One row per fos_labor_costs time entry with agreement customer and team-member role (LATERAL 1:1 joins).';

grant select on table public.fos_labor_costs_util_dims to postgres, service_role, anon, authenticated;

-- Feature 047 Workstream B7 / B1: Utilization aggregates RPC.
--
-- Returns KPIs plus the precomputed aggregate slices that
-- buildUtilizationAggregates_ produces in Apps Script (excluding byPersonWeek,
-- which stays row-local in JS). Uses fos_labor_costs_util_dims (migration 046)
-- for agreement/customer/role joins.

create or replace function public.fos_rpc_util_aggregates(
  p_start timestamptz,
  p_end   timestamptz
) returns jsonb
language sql
stable
set statement_timeout = '20s'
as $$
  with bounds as (
    select p_start as start_ts, p_end as end_ts
  ),
  norm as (
    select
      coalesce(
        nullif(lc.clockify_hours, 0),
        case when lc.seconds is not null then lc.seconds::numeric / 3600.0 else 0 end,
        0
      ) as hours,
      (
        lower(trim(coalesce(lc.billable, ''))) in ('yes', 'y', 'true', '1')
      ) as billable,
      coalesce(
        nullif(
          coalesce(
            nullif(
              coalesce(
                nullif(lc.clockify_hours, 0),
                case when lc.seconds is not null then lc.seconds::numeric / 3600.0 else 0 end,
                0
              ),
              0
            ) * coalesce(d.user_role_cost_rate, 0),
            0
          ),
          0
        ),
        0
      ) as cost,
      coalesce(nullif(trim(d.customer_name), ''), '(Unassigned)') as customer,
      coalesce(nullif(trim(lc.time_entry_project_name), ''), '(No Project)') as project_name,
      lc.project_id,
      coalesce(nullif(trim(lc.time_entry_user_name), ''), '(Unknown user)') as user_name,
      lc.user_id,
      coalesce(nullif(trim(d.user_role_name), ''), '(No role)') as role_name,
      coalesce(d.user_role_bill_rate, null) as user_role_bill_rate,
      (
        to_char(lc.start_date_time at time zone 'UTC', 'IYYY')
        || '-W'
        || to_char(lc.start_date_time at time zone 'UTC', 'IW')
      ) as week_key
    from public.fos_labor_costs lc
    cross join bounds b
    left join public.fos_labor_costs_util_dims d
      on d.clockify_time_log_id = lc.clockify_time_log_id
    where lc.start_date_time >= b.start_ts
      and lc.start_date_time < b.end_ts
  ),
  kpis as (
    select jsonb_build_object(
      'totalHours', coalesce(sum(hours), 0),
      'billableHours', coalesce(sum(hours) filter (where billable), 0),
      'nonBillableHours', greatest(
        0,
        coalesce(sum(hours), 0) - coalesce(sum(hours) filter (where billable), 0)
      ),
      'utilizationPct', case
        when coalesce(sum(hours), 0) > 0 then
          (coalesce(sum(hours) filter (where billable), 0) / sum(hours)) * 100
        else 0
      end,
      'totalCost', coalesce(sum(cost), 0),
      'effectiveCostRate', case
        when coalesce(sum(hours), 0) > 0 then coalesce(sum(cost), 0) / sum(hours)
        else 0
      end,
      'effectiveBillRate', case
        when coalesce(sum(hours) filter (where user_role_bill_rate is not null), 0) > 0 then
          sum(hours * user_role_bill_rate) filter (where user_role_bill_rate is not null)
          / sum(hours) filter (where user_role_bill_rate is not null)
        else null
      end,
      'effectiveBillRateCoverage', case
        when coalesce(sum(hours), 0) > 0 then
          coalesce(sum(hours) filter (where user_role_bill_rate is not null), 0) / sum(hours)
        else 0
      end,
      'distinctPersons', count(distinct coalesce(user_id, user_name)),
      'distinctProjects', count(distinct coalesce(project_id, project_name)),
      'distinctCustomers', count(distinct customer),
      'rowCount', count(*)
    ) as doc
    from norm
  ),
  by_customer as (
    select jsonb_build_object(
      'name', customer,
      'hours', sum(hours),
      'billableHours', sum(hours) filter (where billable),
      'cost', sum(cost)
    ) as row_json,
    sum(hours) as sort_hours
    from norm
    group by customer
  ),
  by_project as (
    select jsonb_build_object(
      'name', project_name,
      'id', project_id,
      'customer', customer,
      'hours', sum(hours),
      'billableHours', sum(hours) filter (where billable),
      'cost', sum(cost)
    ) as row_json,
    sum(hours) as sort_hours
    from norm
    group by project_id, project_name, customer
  ),
  by_person as (
    select jsonb_build_object(
      'name', user_name,
      'id', user_id,
      'hours', sum(hours),
      'billableHours', sum(hours) filter (where billable),
      'cost', sum(cost),
      'utilizationPct', case
        when sum(hours) > 0 then (sum(hours) filter (where billable) / sum(hours)) * 100
        else 0
      end
    ) as row_json,
    sum(hours) as sort_hours
    from norm
    group by user_id, user_name
  ),
  by_role as (
    select jsonb_build_object(
      'name', role_name,
      'hours', sum(hours),
      'billableHours', sum(hours) filter (where billable)
    ) as row_json,
    sum(hours) as sort_hours
    from norm
    group by role_name
  ),
  by_week as (
    select jsonb_build_object(
      'week', week_key,
      'hours', sum(hours),
      'billableHours', sum(hours) filter (where billable),
      'nonBillableHours', sum(hours) filter (where not billable)
    ) as row_json,
    week_key
    from norm
    where week_key is not null
    group by week_key
  ),
  billable_mix as (
    select jsonb_build_object(
      'week', week_key,
      'billable', sum(hours) filter (where billable),
      'nonBillable', sum(hours) filter (where not billable)
    ) as row_json,
    week_key
    from norm
    where week_key is not null
    group by week_key
  )
  select jsonb_build_object(
    'kpis', (select doc from kpis),
    'aggregates', jsonb_build_object(
      'byCustomer', coalesce(
        (
          select jsonb_agg(row_json order by sort_hours desc)
          from by_customer
        ),
        '[]'::jsonb
      ),
      'byProject', coalesce(
        (
          select jsonb_agg(row_json order by sort_hours desc)
          from by_project
        ),
        '[]'::jsonb
      ),
      'byPerson', coalesce(
        (
          select jsonb_agg(row_json order by sort_hours desc)
          from by_person
        ),
        '[]'::jsonb
      ),
      'byRole', coalesce(
        (
          select jsonb_agg(row_json order by sort_hours desc)
          from by_role
        ),
        '[]'::jsonb
      ),
      'byWeek', coalesce(
        (
          select jsonb_agg(row_json order by week_key asc)
          from by_week
        ),
        '[]'::jsonb
      ),
      'billableVsNonBillable', coalesce(
        (
          select jsonb_agg(row_json order by week_key asc)
          from billable_mix
        ),
        '[]'::jsonb
      )
    )
  );
$$;

comment on function public.fos_rpc_util_aggregates(timestamptz, timestamptz) is
  'Date-bounded utilization KPIs and aggregate slices for feature 047 B7. byPersonWeek stays in Apps Script.';

grant execute on function public.fos_rpc_util_aggregates(timestamptz, timestamptz)
  to postgres, service_role, anon, authenticated;

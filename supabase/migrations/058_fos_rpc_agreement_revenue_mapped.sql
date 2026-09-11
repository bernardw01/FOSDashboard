-- Feature 047 Workstream B7 pilot: map fos_revenue_items to the raw revenue
-- shape buildAgreementDashboardPayloadFromSupabase_ assembles in JS before
-- normalizeRevenueItems_. Historical vs future split mirrors the JS loop.

create or replace function public.fos_rpc_agreement_revenue_mapped(
  p_today date
) returns jsonb
language sql
stable
set statement_timeout = '20s'
as $$
  with mapped as (
    select
      jsonb_build_object(
        'id', r.fibery_id,
        'name', r.name,
        'targetAmount', r.target_amount,
        'actualAmount', r.actual_amount,
        'targetDate', r.target_date,
        'recognized', r.revenue_recognized,
        'state', r.state_name,
        'agreement', a.name,
        'agreementId', r.agreement_id,
        'customer', c.name
      ) as row_json,
      r.revenue_recognized,
      r.target_date
    from public.fos_revenue_items r
    left join public.fos_agreements a on a.fibery_id = r.agreement_id
    left join public.fos_companies c on c.fibery_id = a.customer_id
  )
  select jsonb_build_object(
    'historicalRaw', coalesce(
      (
        select jsonb_agg(row_json)
        from mapped
        where revenue_recognized is true
      ),
      '[]'::jsonb
    ),
    'futureRaw', coalesce(
      (
        select jsonb_agg(row_json)
        from mapped
        where revenue_recognized is not true
          and target_date is not null
          and target_date > p_today
      ),
      '[]'::jsonb
    )
  );
$$;

comment on function public.fos_rpc_agreement_revenue_mapped(date) is
  'Agreement hydrate pilot: revenue item rows pre-mapped for buildAgreementDashboardPayloadFromSupabase_.';

grant execute on function public.fos_rpc_agreement_revenue_mapped(date)
  to postgres, service_role, anon, authenticated;

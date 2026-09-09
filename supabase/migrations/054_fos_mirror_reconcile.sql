-- Feature 036 / 047: ghost-row reconcile after full Fibery AM mirror scans.
-- Apps Script records fibery_ids seen during a full-scan step, then deletes
-- Supabase rows not in that snapshot (and stale junction rows).

create table if not exists public.fos_reconcile_snapshot (
  run_id text not null,
  step_key text not null,
  fibery_id text not null,
  primary key (run_id, step_key, fibery_id)
);

create index if not exists fos_reconcile_snapshot_run_step_idx
  on public.fos_reconcile_snapshot (run_id, step_key);

comment on table public.fos_reconcile_snapshot is
  'Transient fibery_id sets for AM mirror ghost reconcile; cleared per step after reconcile.';

create table if not exists public.fos_reconcile_junction_snapshot (
  run_id text not null,
  step_key text not null,
  parent_fibery_id text not null,
  child_fibery_id text not null,
  primary key (run_id, step_key, parent_fibery_id, child_fibery_id)
);

create index if not exists fos_reconcile_junction_snapshot_run_step_idx
  on public.fos_reconcile_junction_snapshot (run_id, step_key);

comment on table public.fos_reconcile_junction_snapshot is
  'Transient M2M pairs seen during a full-scan AM mirror step (company segments, etc.).';

grant all on table public.fos_reconcile_snapshot to postgres, service_role, anon, authenticated;
grant all on table public.fos_reconcile_junction_snapshot to postgres, service_role, anon, authenticated;

-- Allowlisted mirror tables only (security definer; called from Apps Script service role).
create or replace function public.fos_reconcile_mirror_step(
  p_run_id text,
  p_step_key text,
  p_table_name text,
  p_enum_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int := 0;
  v_sql text;
begin
  if p_run_id is null or length(trim(p_run_id)) = 0 then
    raise exception 'run_id required';
  end if;
  if p_step_key is null or length(trim(p_step_key)) = 0 then
    raise exception 'step_key required';
  end if;

  if p_table_name = 'fos_am_enums' then
    if p_enum_type is null or length(trim(p_enum_type)) = 0 then
      raise exception 'enum_type required for fos_am_enums';
    end if;
    delete from public.fos_am_enums t
    where t.enum_type = p_enum_type
      and t.fibery_id not in (
        select s.fibery_id
        from public.fos_reconcile_snapshot s
        where s.run_id = p_run_id
          and s.step_key = p_step_key
      );
    get diagnostics v_deleted = row_count;
  elsif p_table_name in (
    'fos_team_member_roles',
    'fos_companies',
    'fos_clockify_users',
    'fos_contacts',
    'fos_services_estimates',
    'fos_programs',
    'fos_agreements',
    'fos_resource_allocations',
    'fos_estimated_allocations',
    'fos_other_direct_costs',
    'fos_invoice_requests',
    'fos_status_updates',
    'fos_revenue_items',
    'fos_agreement_pnl_items',
    'fos_hubspot_deals',
    'fos_ai_usage_rows'
  ) then
    v_sql := format(
      'delete from public.%I t where t.fibery_id not in (
         select s.fibery_id from public.fos_reconcile_snapshot s
         where s.run_id = $1 and s.step_key = $2
       )',
      p_table_name
    );
    execute v_sql using p_run_id, p_step_key;
    get diagnostics v_deleted = row_count;
  else
    raise exception 'table not allowed: %', p_table_name;
  end if;

  delete from public.fos_reconcile_snapshot
  where run_id = p_run_id and step_key = p_step_key;

  return jsonb_build_object(
    'deleted', v_deleted,
    'table', p_table_name,
    'enumType', p_enum_type
  );
end;
$$;

comment on function public.fos_reconcile_mirror_step(text, text, text, text) is
  'Deletes mirror rows whose fibery_id was not recorded in fos_reconcile_snapshot for this run/step.';

create or replace function public.fos_reconcile_mirror_junction_step(
  p_run_id text,
  p_step_key text,
  p_table_name text,
  p_parent_column text,
  p_child_column text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int := 0;
  v_sql text;
begin
  if p_table_name not in (
    'fos_company_segments',
    'fos_agreement_assigned_resources',
    'fos_pnl_revenue_items'
  ) then
    raise exception 'junction table not allowed: %', p_table_name;
  end if;
  if p_parent_column not in ('company_fibery_id', 'agreement_fibery_id', 'pnl_fibery_id') then
    raise exception 'parent column not allowed: %', p_parent_column;
  end if;
  if p_child_column not in ('segment_fibery_id', 'clockify_user_fibery_id', 'revenue_item_fibery_id') then
    raise exception 'child column not allowed: %', p_child_column;
  end if;

  v_sql := format(
    'delete from public.%I j
     where j.%I not in (
       select s.fibery_id from public.fos_reconcile_snapshot s
       where s.run_id = $1 and s.step_key = $2
     )
     or not exists (
       select 1 from public.fos_reconcile_junction_snapshot s
       where s.run_id = $1 and s.step_key = $2
         and s.parent_fibery_id = j.%I
         and s.child_fibery_id = j.%I
     )',
    p_table_name,
    p_parent_column,
    p_parent_column,
    p_child_column
  );
  execute v_sql using p_run_id, p_step_key;
  get diagnostics v_deleted = row_count;

  delete from public.fos_reconcile_junction_snapshot
  where run_id = p_run_id and step_key = p_step_key;

  return jsonb_build_object('deleted', v_deleted, 'table', p_table_name);
end;
$$;

comment on function public.fos_reconcile_mirror_junction_step(text, text, text, text, text) is
  'Deletes stale M2M rows after a full parent-entity mirror step.';

create or replace function public.fos_reconcile_snapshot_gc(p_run_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids int := 0;
  v_junc int := 0;
begin
  if p_run_id is not null and length(trim(p_run_id)) > 0 then
    delete from public.fos_reconcile_snapshot where run_id = p_run_id;
    get diagnostics v_ids = row_count;
    delete from public.fos_reconcile_junction_snapshot where run_id = p_run_id;
    get diagnostics v_junc = row_count;
  else
    return jsonb_build_object('snapshotRows', 0, 'junctionRows', 0);
  end if;
  return jsonb_build_object('snapshotRows', v_ids, 'junctionRows', v_junc);
end;
$$;

grant execute on function public.fos_reconcile_mirror_step(text, text, text, text)
  to postgres, service_role, anon, authenticated;
grant execute on function public.fos_reconcile_mirror_junction_step(text, text, text, text, text)
  to postgres, service_role, anon, authenticated;
grant execute on function public.fos_reconcile_snapshot_gc(text)
  to postgres, service_role, anon, authenticated;

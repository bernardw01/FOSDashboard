-- Feature 047 follow-on: Resource assignments range payload cache.
--
-- Reuses fos_viz_range_payloads (migration 051) with panel_key =
-- 'resource-assignments'. Unlike Utilization (row bundles re-sliced in GAS),
-- RA stores the fully assembled panel payload for an exact From/To YMD window
-- so Live open / Reload is one Postgres read instead of a full Apps Script
-- rebuild.
--
-- The B4 get/gc RPCs used fos_viz_source_fingerprint() for every panel_key.
-- That fingerprint ignores fos_resource_allocations, so an RA entry would stay
-- "fresh" after allocation edits. This migration adds an RA fingerprint and
-- makes get/gc choose the fingerprint by panel_key.

begin;

create or replace function public.fos_ra_source_fingerprint()
returns jsonb
language sql
stable
set statement_timeout = '20s'
as $$
  select jsonb_build_object(
    'watermark', greatest(
      (select max(synced_at) from public.fos_labor_costs),
      (select max(synced_at) from public.fos_resource_allocations),
      (select max(synced_at) from public.fos_clockify_users),
      (select max(synced_at) from public.fos_team_member_roles),
      (select max(synced_at) from public.fos_agreements),
      (select max(synced_at) from public.fos_companies)
    ),
    'rowCount',
      coalesce((select count(*) from public.fos_labor_costs), 0)
      + coalesce((select count(*) from public.fos_resource_allocations), 0)
  );
$$;

comment on function public.fos_ra_source_fingerprint() is
  'Feature 047 RA range cache. Greatest synced_at across labor, allocations, and RA dimension tables, plus labor+allocation row counts so deletes invalidate.';

create or replace function public.fos_panel_source_fingerprint(p_panel_key text)
returns jsonb
language sql
stable
set statement_timeout = '20s'
as $$
  select case
    when p_panel_key = 'resource-assignments' then public.fos_ra_source_fingerprint()
    else public.fos_viz_source_fingerprint()
  end;
$$;

comment on function public.fos_panel_source_fingerprint(text) is
  'Feature 047. Dispatches to the Utilization or Resource assignments source fingerprint by panel_key.';

create or replace function public.fos_rpc_viz_range_get(
  p_panel_key            text,
  p_range_start          date,
  p_range_end            date,
  p_cache_schema_version int,
  p_key_hash             text
) returns jsonb
language plpgsql
stable
set statement_timeout = '20s'
as $$
declare
  v_fp    jsonb := public.fos_panel_source_fingerprint(p_panel_key);
  v_row   public.fos_viz_range_payloads;
  v_hit   boolean := false;
  v_fresh boolean := false;
begin
  select * into v_row
  from public.fos_viz_range_payloads
  where panel_key = p_panel_key
    and range_start = p_range_start
    and range_end = p_range_end
    and cache_schema_version = p_cache_schema_version
    and key_hash = p_key_hash;
  v_hit := found;

  if v_hit then
    v_fresh :=
      v_row.source_watermark is not null
      and (v_fp->>'watermark') is not null
      and v_row.source_watermark >= (v_fp->>'watermark')::timestamptz
      and v_row.source_row_count is not null
      and v_row.source_row_count = (v_fp->>'rowCount')::int;
  end if;

  return jsonb_build_object(
    'hit', v_hit,
    'fresh', v_fresh,
    'payload', case when v_fresh then v_row.payload else null end,
    'builtAt', v_row.built_at,
    'rowCount', v_row.row_count,
    'storedWatermark', v_row.source_watermark,
    'storedRowCount', v_row.source_row_count,
    'currentWatermark', v_fp->>'watermark',
    'currentRowCount', (v_fp->>'rowCount')::int
  );
end;
$$;

comment on function public.fos_rpc_viz_range_get(text, date, date, int, text) is
  'Feature 047 B4 (+ RA follow-on). Returns the cached bundle only when its stored fingerprint still matches the live one for that panel_key.';

create or replace function public.fos_rpc_viz_range_gc(p_panel_key text)
returns jsonb
language plpgsql
volatile
set statement_timeout = '20s'
as $$
declare
  v_fp      jsonb := public.fos_panel_source_fingerprint(p_panel_key);
  v_deleted int;
begin
  delete from public.fos_viz_range_payloads
  where panel_key = p_panel_key
    and (
      source_watermark is null
      or source_watermark < (v_fp->>'watermark')::timestamptz
      or source_row_count is null
      or source_row_count <> (v_fp->>'rowCount')::int
    );
  get diagnostics v_deleted = row_count;
  return jsonb_build_object(
    'deleted', v_deleted,
    'remaining', (
      select count(*) from public.fos_viz_range_payloads where panel_key = p_panel_key
    )
  );
end;
$$;

comment on function public.fos_rpc_viz_range_gc(text) is
  'Feature 047 B4 (+ RA follow-on). Deletes range-cache entries whose panel fingerprint is behind the live one.';

grant execute on function public.fos_ra_source_fingerprint()
  to postgres, service_role, anon, authenticated;
grant execute on function public.fos_panel_source_fingerprint(text)
  to postgres, service_role, anon, authenticated;
grant execute on function public.fos_rpc_viz_range_get(text, date, date, int, text)
  to postgres, service_role, anon, authenticated;
grant execute on function public.fos_rpc_viz_range_gc(text)
  to postgres, service_role, anon, authenticated;

commit;

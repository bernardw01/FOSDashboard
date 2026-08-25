-- Feature 047 Workstream B4: range-keyed visualization cache.
--
-- Every Utilization load rebuilds from fos_labor_costs today. The stored panel
-- blob in fos_panel_payloads is only a fallback, and it carries exactly one
-- window (the default range at hydrate time), so no other range can ever be
-- served from it. This table caches the normalized row bundle for a
-- day-aligned window so a repeated window is one read instead of eleven.
--
-- WHY DAY-ALIGNED, AND WHY THE PLAN'S DDL WAS NOT USABLE AS WRITTEN
--
-- The implementation plan proposed `primary key (panel_key, range_start,
-- range_end, cache_schema_version)` with both bounds typed `date`. Measured
-- against the live table, labor timestamps are intra-day: of 22,546 rows only
-- 168 sit exactly on midnight and there are 1,163 distinct times of day. The
-- client also never sends a day boundary for a preset window; it sends
-- `new Date()` instants, so the default 60-day window differs by milliseconds
-- on every request. A `date`-keyed entry would therefore be served to requests
-- whose real instant bounds differ from the ones it was built for. On today's
-- data that is 51 rows at the start edge of the default window, which moves
-- every KPI on the panel.
--
-- So the date columns here are deliberately a SUPERSET key, not the answer:
--
--   range_start = floor(requested start to UTC day)
--   range_end   = ceil (requested end   to UTC day)
--
-- The cached bundle holds every row in that superset. Apps Script then filters
-- it to the exact requested instants before computing anything, which is the
-- same re-slice `applyUtilizationRequestedRange_` already performs on the
-- stored panel blob. Numbers cannot move, and the default window becomes
-- cacheable even though its instants never repeat.
--
-- KEY DESIGN
--
--   panel_key            which panel's bundle this is
--   range_start/_end     the day-aligned superset described above
--   cache_schema_version the panel's cacheSchemaVersion, so a panel bump
--                        orphans every old entry with no explicit purge
--   key_hash             fingerprint of every other input that can change the
--                        stored rows: the resolved threshold object and the
--                        PERF_* flags that affect row content. Deliberately
--                        over-keyed. An ADMIN retuning a threshold costs one
--                        rebuild; a key that missed a threshold would serve
--                        wrong numbers silently.
--
-- INVALIDATION
--
-- source_watermark and source_row_count fingerprint the inputs. The watermark
-- is the greatest synced_at across fos_labor_costs and the four dimension
-- tables whose values land inside a normalized row (users, roles, agreements,
-- companies). The row count is carried separately because an upstream DELETE
-- does not advance any synced_at.
--
-- Note that fos_labor_costs is written by the Clockify sync project, not by
-- this repo's nightly hydrate: on 2026-08-25 its max synced_at was 05:35 while
-- the hydrate ran 08:57 to 10:04. "Last completed hydrate" is therefore NOT a
-- sufficient epoch, which is why the watermark is computed from the source
-- tables themselves. Measured cost of the whole fingerprint expression: 19.5 ms
-- warm, entirely from shared buffers, so no new index is required.
--
-- Apps Script reads the watermark BEFORE fetching rows and stamps that value on
-- the write. If an upstream sync lands mid-build, the entry is stamped with the
-- pre-build watermark and is treated as stale on the next read. The failure
-- direction is a wasted rebuild, never a stale serve.

begin;

create table if not exists public.fos_viz_range_payloads (
  panel_key            text        not null,
  range_start          date        not null,
  range_end            date        not null,
  cache_schema_version int         not null,
  key_hash             text        not null,
  payload              jsonb       not null,
  row_count            int         not null default 0,
  payload_chars        int         not null default 0,
  built_at             timestamptz not null default now(),
  source_watermark     timestamptz,
  source_row_count     int,
  primary key (panel_key, range_start, range_end, cache_schema_version, key_hash)
);

create index if not exists fos_viz_range_payloads_gc_idx
  on public.fos_viz_range_payloads (panel_key, source_watermark);

comment on table public.fos_viz_range_payloads is
  'Feature 047 B4. Day-aligned superset row bundles per panel and window. Read behind the PERF_USE_RANGE_CACHE kill switch and re-sliced to the exact requested instants in Apps Script, so the date bounds are a cache key and never the answer.';

-- Fingerprint of every input that can change a cached bundle's rows.
-- Kept as its own function so the read RPC, the writer, and the garbage
-- collector cannot disagree about what "unchanged" means.
create or replace function public.fos_viz_source_fingerprint()
returns jsonb
language sql
stable
set statement_timeout = '20s'
as $$
  select jsonb_build_object(
    'watermark', greatest(
      (select max(synced_at) from public.fos_labor_costs),
      (select max(synced_at) from public.fos_clockify_users),
      (select max(synced_at) from public.fos_team_member_roles),
      (select max(synced_at) from public.fos_agreements),
      (select max(synced_at) from public.fos_companies)
    ),
    'rowCount', (select count(*) from public.fos_labor_costs)
  );
$$;

comment on function public.fos_viz_source_fingerprint() is
  'Feature 047 B4. Greatest synced_at across fos_labor_costs and the four dimension tables a normalized utilization row draws from, plus the labor row count so an upstream delete is detected. ~19.5 ms warm.';

-- One round trip for the whole read decision: does an entry exist, is it still
-- fresh against the current fingerprint, and what is the current fingerprint so
-- the caller can stamp a write on a miss.
--
-- `payload` is returned ONLY when the entry is fresh. Shipping ~900 kB that the
-- caller is about to discard would make a miss more expensive than no cache.
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
  v_fp    jsonb := public.fos_viz_source_fingerprint();
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
  'Feature 047 B4. Returns the cached bundle only when its stored fingerprint still matches the live one, plus the current fingerprint so a miss can be stamped correctly. Called behind PERF_USE_RANGE_CACHE.';

-- Drops entries that can never be served again because the sources moved on.
-- Exact rather than heuristic: no TTL, no size cap, no guessing which windows
-- matter. Run at the end of hydrate.
create or replace function public.fos_rpc_viz_range_gc(p_panel_key text)
returns jsonb
language plpgsql
volatile
set statement_timeout = '20s'
as $$
declare
  v_fp      jsonb := public.fos_viz_source_fingerprint();
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
  'Feature 047 B4. Deletes range-cache entries whose source fingerprint is behind the live one, which are exactly the entries that can never be served again.';

grant execute on function public.fos_viz_source_fingerprint()
  to postgres, service_role, anon, authenticated;
grant execute on function public.fos_rpc_viz_range_get(text, date, date, int, text)
  to postgres, service_role, anon, authenticated;
grant execute on function public.fos_rpc_viz_range_gc(text)
  to postgres, service_role, anon, authenticated;

commit;

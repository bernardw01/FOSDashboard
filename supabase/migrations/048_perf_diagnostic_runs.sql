-- Feature 047: persist performance harness output.
--
-- The harness runs inside Apps Script, but the numbers are needed outside it to
-- compare a workstream against its baseline. `clasp run` is not usable on this
-- project without linking a standard GCP project and issuing a private OAuth
-- client, so results are written here instead and read back over PostgREST.
--
-- Rows are small (one JSON document per run) and are kept indefinitely: the
-- point is to compare workstream B, C, and D against the workstream A numbers
-- months from now.

begin;

create table if not exists public.fos_perf_runs (
  run_id       text primary key,
  kind         text not null check (kind in ('baseline', 'parity')),
  captured_at  timestamptz not null default now(),
  prd_version  text,
  label        text,
  passed       boolean,
  flags        jsonb,
  result       jsonb not null
);

create index if not exists fos_perf_runs_captured_idx
  on public.fos_perf_runs (captured_at desc);

comment on table public.fos_perf_runs is
  'Feature 047 performance harness output (_diag_capturePerfBaseline, _diag_comparePerfParity*). One JSON document per run.';

commit;

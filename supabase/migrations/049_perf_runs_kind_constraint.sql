-- Feature 047: allow new performance-harness kinds without a migration.
--
-- Migration 048 pinned `kind` to the two values that existed at the time,
-- `baseline` and `parity`. Workstream B1 added a third, `codec`, and the insert
-- failed against `fos_perf_runs_kind_check`. The failure is quiet by design:
-- `perfPersistRun_` logs a warning and returns null, so the diagnostic still
-- printed a correct result to the execution log and only the persisted copy was
-- lost. That is exactly the kind of gap that is noticed late, and workstreams B,
-- C, and D are each expected to add further kinds.
--
-- Trade-off, stated plainly: this swaps an allow-list for a shape check. It
-- still rejects nulls, empty strings, uppercase, whitespace, and overlong text,
-- so the column cannot become a free-text dumping ground. It no longer catches a
-- typo such as 'paritty', which the allow-list would have. That is accepted
-- deliberately. This table is written by a single internal code path and read by
-- diagnostics, so a mistyped kind is a nuisance to be filtered out, whereas a
-- rejected insert silently loses a measurement we ran a full hydrate to get.

begin;

alter table public.fos_perf_runs
  drop constraint if exists fos_perf_runs_kind_check;

alter table public.fos_perf_runs
  add constraint fos_perf_runs_kind_check
  check (kind ~ '^[a-z][a-z0-9_-]{0,31}$');

comment on column public.fos_perf_runs.kind is
  'Harness family, lowercase slug: baseline, parity, codec, and future workstream kinds. Shape-checked rather than enumerated so a new diagnostic does not require a migration.';

commit;

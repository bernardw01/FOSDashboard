-- Feature 047 workstream A3: drop indexes that have never been used.
--
-- Measured 2026-08-24 against pg_stat_user_indexes with 40 days of statistics
-- (stats_reset 2026-07-15). Every index below had idx_scan = 0 over that
-- window. None is unique, primary, or backing a constraint.
--
-- This is write-path relief for the nightly hydrate and the Clockify mirror
-- trigger, not a read win. Read performance on the hot paths is already fine:
-- the 90-day utilization aggregate completes in about 18 ms warm on
-- fos_labor_costs_start_date_time_idx.
--
-- Follow-up (not done here): fos_labor_costs still carries three index pairs
-- where the single-column index is a prefix of a composite one
-- (project_id / project_start, user_id / user_start, status / status_start).
-- All six have non-zero scans, so consolidating them needs a query review
-- rather than a stats read.
--
-- Deliberately NOT dropped:
--   * public.labor_costs indexes (labor_costs_project_start_idx 1856 kB,
--     labor_costs_fetched_at_idx 912 kB, labor_costs_project_id_idx 552 kB).
--     That table is owned by the Clockify sync project, not this repo. They
--     are unused by the dashboard, but the owning project should drop them.
--   * fos_hubspot_deals_hubspot_id_uidx. Unique, and it protects against
--     duplicate deal mirrors even though no read currently seeks on it.
--   * 16 kB indexes on small dimension tables. On tables of 10 to 150 rows the
--     planner correctly prefers a sequential scan, so these will always show
--     zero scans. They cost almost nothing and churning them adds risk.

begin;

-- fos_labor_costs: 22,343 rows, written by the mirror trigger on every
-- Clockify sync. These two are the only meaningful write overhead in the set.
drop index if exists public.fos_labor_costs_fetched_at_idx;   -- 936 kB
drop index if exists public.fos_labor_costs_synced_at_idx;    -- 528 kB

-- Mirror tables rewritten in full on each nightly hydrate.
drop index if exists public.fos_ai_usage_rows_email_idx;      -- 96 kB
drop index if exists public.fos_pnl_revenue_items_revenue_idx; -- 72 kB
drop index if exists public.fos_revenue_items_target_date_idx; -- 40 kB
drop index if exists public.fos_agreement_pnl_items_month_idx; -- 40 kB

analyze public.fos_labor_costs;
analyze public.fos_ai_usage_rows;
analyze public.fos_revenue_items;

commit;

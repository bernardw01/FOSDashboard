# Feature: Dashboard performance and responsiveness

> **Teamwork:** Create this spec first as a notebook in [FOS Dashboard Development](https://win.godeap.io/app/projects/1615262) using these sections. Sync to `docs/features/0NN-<slug>.md` at approval and again at ship. See `docs/teamwork-workflow.md`.
> **Teamwork notebook:** [Feature 047 - Dashboard performance and responsiveness](https://win.godeap.io/app/projects/1615262/notebooks/313457)  
> **Implementation plan notebook:** [Feature 047 - Implementation plan (Performance)](https://win.godeap.io/app/projects/1615262/notebooks/313458)  
> **Release task:** [Feature 047 - Dashboard performance and responsiveness](https://win.godeap.io/app/tasks/40839335) (re-scoped from Feature 044)
>
> **Status:** Spec Approved
> **PRD version:** 3.9.2 (workstream A shipped as **FR-144**, **AC-105**; later workstreams bump again)
> **Feature id:** 047 | **Task list:** Data platform
> **Release type:** Enhancement
> **Supersedes:** [044 - Live visualization serve performance](044-live-visualization-serve-performance.md) (Spec Draft, never implemented). Workstream B below absorbs 044 phases A-D. See **Relationship to feature 044**.
> **Extends:** [036 - Supabase dashboard data layer](036-supabase-dashboard-data-layer.md), [005 - Utilization](005-utilization-management-dashboard.md), [027 - Resource assignments](027-resource-assignment-dashboard.md), [022 - Portfolio P&L](022-portfolio-project-pnl.md), [025 - Portfolio load-source UX](025-portfolio-pnl-performance-and-load-source-ux.md), [034 - Warm cache and batching](034-live-dashboard-warm-cache-and-portfolio-batching.md), [009 - Historical snapshots](009-dashboard-historical-snapshots.md), [029 - Mobile shell](029-mobile-shell-phase-ab.md)
> **Implementation plan:** [047-dashboard-performance-and-responsiveness-implementation-plan.md](047-dashboard-performance-and-responsiveness-implementation-plan.md)

## Goal

Make Live dashboard panels open in about **2 seconds or less** instead of the current tens of seconds, by moving aggregation work **into Postgres**, shipping **small payloads** instead of raw fact rows, and cutting the client shell and render cost.

The guiding finding: **the Datastore is not the bottleneck, and it is almost entirely idle.** The database is being used as a dumb row store while Apps Script does work that Postgres would do roughly a thousand times faster. This feature changes **where the work happens**, not what the numbers mean.

**Primary audience:** All authorized dashboard users (faster panel loads). ADMIN operators (faster, more reliable nightly hydrate).

## Problem statement

### Measured baseline

All figures measured **2026-08-24** against the live `FinOps Performance Hub` Datastore (project `jpcbugdpdvyutlusicxa`, Postgres 17.6, region `us-east-1`) and the code at PRD **3.9.1**.

**The database has enormous headroom:**

| Metric | Measured value |
| --- | --- |
| Total database size | **101 MB** |
| Largest table (`fos_labor_costs`) | **22,343 rows / 36 MB** |
| Buffer cache hit ratio | **100.00%** (entire working set is in RAM) |
| `shared_buffers` | 224 MB |
| CPU benchmark (1M `sqrt` iterations) | **181 ms** (healthy, not throttled) |
| Dashboard queries in top 25 of `pg_stat_statements` by total time | **none** |

**Yet the work Postgres could do instantly is being done in Apps Script.** Measured over a 90-day Utilization window:

| Path | Rows | Bytes over the wire | Round trips | Time |
| --- | --- | --- | --- | --- |
| **Today:** `fetchFosLaborCostsByRange_` pages rows, aggregates in GAS | 9,508 | ~10 MB | **10 sequential** PostgREST pages | seconds to tens of seconds |
| **Postgres doing the same aggregation** | 901 result rows | ~50 KB | 1 | **17.8 ms** warm |

The 17.8 ms figure is a real `EXPLAIN (ANALYZE, BUFFERS)` run of the per-person-per-week group-by over the same window. A first, cold touch of the table measured 2,225 ms; every warm run after was under 20 ms.

### The seven concrete causes

1. **Row shipping instead of aggregation.** `fetchFosLaborCostsByRange_` (`src/fiberyUtilizationDashboard.js` lines 197-246) pulls up to 60 pages of 1,000 rows and reduces them in JavaScript. `supabaseRpc_` exists (`src/supabaseClient.js` lines 176-178) but **has no callers**. `fos_labor_costs_util_dims` (migration 046) exists but is **never queried**; GAS rebuilds the same joins in memory.

2. **Column over-fetch of a large JSON blob.** That same select requests `fibery_payload_json`. Measured as **JSON wire bytes**, which is what actually crosses the network:

   | Window | With the blob | Without it | Removed |
   | --- | --- | --- | --- |
   | **Default (60 days, 6,173 rows)** | **6,966 kB** | **2,353 kB** | **66%** |
   | 90 days (9,508 rows) | 10 MB | 3,598 kB | 66% |

   The default Utilization window is **60 days**, not 90: `UTILIZATION_DEFAULTS_.DEFAULT_RANGE_DAYS` is 60, overridable per environment by the `UTILIZATION_DEFAULT_RANGE_DAYS` Script Property. Earlier drafts of this spec called the 90-day row the default. The proportion is the same either way, so the 66% conclusion is unaffected, but the default-window absolute is the smaller pair.

   An earlier draft also put the saving at 91%. That number came from `pg_column_size`, which reports TOAST-compressed on-disk size and badly understates how timestamps and ids expand as JSON text. The 66% figure is the honest one.

   **Two thirds of the transfer is a raw mirror blob**, and it is `JSON.parse`d once per row in GAS. The same blob is pulled again per project by the Delivery P&L builder (`src/supabasePanelBuilders.js` line 1347).

   Worse, the parsing recovers nothing new. Measured across all 22,343 mirrored rows, the blob holds exactly **13 keys**, uniform on every row, and **each one duplicates a typed column already in the select**: billable, clockify hours, start and end date time, project id, seconds, task, task id, time entry project name, time entry status, time entry user name, time log id, user id.

   The keys the mappers actually reach for and that would change a number, `Agreement Management/Cost`, `Cost`, the role keys, `Clockify User Company`, `Clockify User` (work status), `Agreement`, and `Customer`, are present on **zero** rows. Those lookups already fall through to the `fos_clockify_users` and `fos_team_member_roles` dimension maps. So the column can simply be dropped from both selects with no migration and no behavior change.

3. **Everything is serial.** `UrlFetchApp.fetchAll` is used **nowhere**. Every PostgREST page, every Fibery page, and every per-project P&L build is a sequential blocking round trip. `SUPABASE_HTTP_TIMEOUT_MS_` is defined but never passed to `UrlFetchApp` (`src/supabaseClient.js` line 15).

4. **Deployment lag, surfacing as stale panel blobs.** Stored `cache_schema_version` in `fos_panel_payloads` versus the **git** constants:

   | Panel | Stored | Git | Result |
   | --- | --- | --- | --- |
   | `utilization` | **5** | 6 | Schema gate fails, blob unusable |
   | `resource-assignments` | **2** | 3 | Schema gate fails, blob unusable |
   | agreement / delivery / pipeline / ai-usage / portfolio-pnl | 4 / 2 / 3 / 4 / 1 | match | Blob served |

   **The root cause is not the database.** Pulling the deployed project and diffing it against `src/` showed the *deployed script* was the stale artifact. `resource-assignments` was bumped to 3 in commit `ddc61c6` on **2026-08-15**, but the hydrate kept writing 2 through 2026-08-24, which is only possible if the running script still had 2. Four "Ship PRD" commits (**3.7.4, 3.7.5, 3.7.6, 3.8.2**) plus a feature commit were committed to git and **never pushed to Apps Script** until 2026-08-24. Users were running pre-3.7.4 code while git and the PRD claimed 3.8.2.

   An important correction to the first draft of this spec: this was **not** nine days of degraded panel performance. While the deploy lagged, the running script was internally consistent, so its blobs matched its own expectations and the cheap path worked. The real degradation window opens at each `clasp push` and closes at the next nightly hydrate, roughly a day. The nine-day defect was a **silent deployment gap**, which is worse but different.

   There is no alert for either condition, and no runtime check can add one: the script only knows its own constants and cannot see git. Detection has to live outside Apps Script.

5. **Payloads are too large to cache in the browser.** The `utilization` blob is **5,331 kB**, which exceeds the practical `sessionStorage` quota (~5 MB). The client already documents the fallback at `src/DashboardShell.html` lines 14641-14648: the write fails silently and only the in-memory copy survives, so **every new tab refetches**. Other blobs: agreement 748 kB, portfolio-pnl 633 kB, ai-usage 579 kB, resource-assignments 464 kB.

6. **Nightly hydrate is slow and unreliable.** Recent `fos_sync_runs`:

   | Date | Duration | Status |
   | --- | --- | --- |
   | 2026-08-24 | 61.7 min | complete |
   | 2026-08-23 | 65.3 min | complete |
   | 2026-08-22 | 60.2 min | complete |
   | 2026-08-21 | 22.3 min | **failed** (`clockify_users` fetch) |
   | 2026-08-20 | 70.0 min | complete |
   | 2026-08-16 | 30.9 min | **failed** (`agreements` fetch) |

   That is **60 to 70 minutes to mirror 45 agreements, 10 companies, 148 resource allocations, and 874 revenue items**, and **2 of the last 10 runs failed**. The mirror re-scans every Fibery entity every night: `fos_sync_watermarks` exists in the schema but is **never read or written** by any code.

7. **N+1 per-project P&L.** Portfolio and snapshot builders loop projects and issue 3 to 7+ round trips each (`src/portfolioPnlDashboardCache.js` line 316, `src/dashboardSnapshotJob.js` lines 552-555).

### Client-side causes

8. **A 1.45 MB monolithic HTML shell ships on every page load.** `src/DashboardShell.html` contains all CSS, all JS, and the markup for every panel, with no `include()` fragments and no code splitting. Roughly **130 KB of base64 images** are inlined into the response (hero ~107 KB with `decoding="sync"`, which blocks paint; logo ~23 KB).

9. **No render virtualization.** The utilization heatmap builds up to ~1,200 cells one `createElement` at a time; the resource-assignment grid is unbounded across persons x weeks x expanded projects.

**What is explicitly not a problem:** index coverage on the hot paths (the 90-day scan uses a `start_date_time` index correctly), compute sizing, disk, and connection limits. Adding indexes or upgrading the instance would **not** help. Six droppable indexes have **zero scans** over 40 days and are pure write overhead, but they cost read performance nothing.

## Relationship to feature 044

Feature **044 - Live visualization serve performance** is a Spec Draft from 2026-08-19 (Teamwork task [40839335](https://win.godeap.io/app/tasks/40839335)) that was never implemented. Its diagnosis (RPCs, slim payloads, Refresh semantics, range cache) is correct and is **absorbed here as Workstream B**.

047 supersedes it because 044 does not cover the causes that measurement surfaced as equally or more important: the `fibery_payload_json` over-fetch, the schema-version drift that disables the cheap path, hydrate duration and reliability, and the client shell weight.

**Decision required at review:** either re-scope task 40839335 to this feature and close the 044 notebooks, or keep 044 open as the Workstream B sub-release. Recommendation: **re-scope 40839335 to 047** so there is one performance program with one release task.

## Locked product decisions

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Numbers must not move | Every KPI, chart, and grid total MUST match the current builders within documented rounding. Any diff is a bug, not a new formula. Enforced by a parity harness before each workstream ships. |
| 2 | Ship order | Workstreams ship **independently** in the order A, B, C, D. Each is a releasable PATCH or MINOR. No big-bang release. |
| 3 | Fibery remains system of record | This feature changes how Live **reads** the Datastore and how hydrate **writes** it. It does not change who owns the data. |
| 4 | Secrets | `SUPABASE_SERVICE_ROLE_KEY` stays in Script Properties. No browser-direct Datastore reads in this feature. |
| 5 | Refresh vs Pull | **Refresh** = re-read Datastore. **Pull from Fibery** = hydrate typed tables and rewrite blobs. Refresh must never trigger a Fibery extract. |
| 6 | Historical mode | Snapshot / Data source date mode stays on Drive (009 / 010) and is out of scope except where a shared builder changes. |
| 7 | Load-source vocabulary | Keep FR-120 Datastore wording. Do not surface "RPC", "Postgres", or "Supabase" outside ADMIN Settings. |
| 8 | Mobile | Every workstream applies at `< 768px`. No desktop-only fast path. |
| 9 | Rollback | Each new fast path sits behind a Script Property kill switch that restores the current builder. |

## User Stories

- As a **dashboard user**, I want Utilization and Resource assignments to open in about two seconds so that I can answer a question without losing my train of thought.
- As a **dashboard user**, I want charts to paint before large tables finish loading so that the panel is useful immediately.
- As a **dashboard user**, I want a panel I already visited to reopen instantly in a new tab, not refetch from scratch.
- As a **finance reviewer**, I want the numbers after this work to be identical to the numbers before it so that I can trust the dashboard through the change.
- As an **ADMIN**, I want the nightly hydrate to finish in minutes rather than an hour, and to tell me when it fails.
- As an **ADMIN**, I want an alert when a stored panel blob's schema version drifts from the code so that a panel does not silently fall back to the slow path for weeks.
- As a **mobile user**, I want the same load improvements at viewport width **&lt; 768px**, including filter sheets and **Show charts**.

## Acceptance Criteria (testable)

### A. Stop over-fetching and stop drifting (Workstream A, quick wins)

- [x] **Given** Live Utilization with any date range, **when** the server queries `fos_labor_costs`, **then** the select does **not** include `fibery_payload_json`; cost rate, user role, and user company come from typed columns and the role-rate dimension maps.
- [x] **Given** the default window, **when** the labor fetch runs, **then** wire bytes drop by at least **60%**. *(Measured 6,966 kB to 2,353 kB, 66%, on the 60-day default; the same 66% holds over 90 days. Getting under 1 MB needs Postgres-side aggregation and is Workstream B's target, not A's.)*
- [x] **Given** the deployed Apps Script project differs from `src/` in any file, **when** `scripts/check_deployed_matches_git.py` runs, **then** it exits non-zero and names every missing, extra, and differing file. *(Exits 0 against the 3.9.4 push.)*
- [x] **Given** a nightly hydrate completes, **when** the run row is written, **then** `fos_sync_runs.summary.scriptVersion` records the `FOS_PRD_VERSION` of the script that produced the blobs. *(Run `supabase:2026-08-24T22:49:38.477Z:1da17fb0` records `scriptVersion: "3.9.4"` at both start and finish.)*
- [x] **Given** a stored blob's `cache_schema_version` does not match the code constant, **when** an ADMIN opens Settings, **then** a warning names the panel and both versions. *(Flagged utilization 5 against 6 and resource-assignments 2 against 3 during the post-push window.)*
- [x] **Given** a `clasp push` that bumped a panel's schema version, **when** the next hydrate completes, **then** the drift warning for that panel clears without manual intervention. *(After the 2026-08-24 hydrate all seven match: agreement 4, ai-usage 4, delivery 2, pipeline 3, portfolio-pnl 1, resource-assignments 3, utilization 6.)*
- [x] **Given** the utilization and resource-assignments blobs are re-hydrated at the current schema, **when** a user opens either panel, **then** the blob path is used and no full typed rebuild runs.
- [x] **Given** parity fixtures for a known range, **when** `fibery_payload_json` is dropped from the selects, **then** hours, cost, billable mix, and role and customer attribution match the previous builder **exactly**, not merely within rounding. *(Run `perf:parity:2026-08-24T22:38:07.097Z:6d1a79ba`: zero diffs on `q2-2026`, `single-week`, and `empty`. The `default-window` fixture reported four diffs, all of them the window bounds themselves, because that range is derived from `new Date()` and the two arms ran 7 seconds apart. The harness now tolerates sub-5-minute ISO drift on derived-window fixtures only and reports it under `tolerated`; explicit ranges still require exact equality.)*
- [x] **Given** `PERF_USE_NORMALIZED_LABOR_COLS` is set to `false`, **when** either labor path runs, **then** blob parsing resumes and results are unchanged. *(This is the baseline arm of every parity run above.)*

### B. Aggregate in Postgres (Workstream B, absorbs 044 phases A-D)

- [ ] **Given** Live Datastore is configured, **when** a user opens Utilization or Labor hours with a date range, **then** the server calls a Postgres RPC (or reads a range-cache row built from one) and does **not** page raw `fos_labor_costs` as the primary path.
- [ ] **Given** Live Resource assignments with From/To, **when** the panel loads, **then** allocation overlap is filtered **in SQL**; GAS does not download the full allocation table and filter in memory.
- [ ] **Given** any RPC-backed panel, **when** totals are compared against the current GAS builder on fixture ranges, **then** they match within documented rounding.
- [ ] **Given** Agreements, Utilization, or Pipeline Live, **when** the panel opens, **then** Chart.js can paint from a slim chart payload **under 100 KB** without waiting on `rows[]`, `financialTable`, or Sankey nodes.
- [ ] **Given** a valid, schema-current blob, **when** the user clicks **Refresh**, **then** the server re-reads that row and does not run a typed rebuild.
- [ ] **Given** a custom From/To window requested a second time within a hydrate epoch, **when** the panel loads, **then** it is served from the range cache in one read.
- [ ] **Given** an RPC is unavailable or times out, **when** the panel loads, **then** the user sees the existing safe error copy; no Fibery Live fallback.

### C. Fix hydrate (Workstream C)

- [ ] **Given** a nightly hydrate with no Fibery changes since the last run, **when** it executes, **then** it completes in **under 10 minutes** (baseline: 60 to 70 minutes).
- [ ] **Given** the AM mirror runs, **when** it fetches each entity type, **then** it requests only entities modified since the stored watermark in `fos_sync_watermarks`, and advances that watermark on success.
- [ ] **Given** a hydrate step fails, **when** the run ends, **then** the run is recorded as failed **and** a notification reaches ADMIN through the existing notification path.
- [ ] **Given** a hydrate step fails transiently, **when** it is retried, **then** the run resumes from the failed step rather than restarting the dataset.
- [ ] **Given** hydrate completes, **when** panel blobs are written, **then** default-range viz caches are rebuilt or invalidated in the same run.

### D. Client responsiveness (Workstream D)

- [ ] **Given** a cold page load, **when** the shell is served, **then** the HTML response is **at least 40% smaller** than the current ~1.45 MB.
- [ ] **Given** the Home hero image, **when** the page loads, **then** it is not a render-blocking inline base64 data URI with `decoding="sync"`.
- [ ] **Given** the utilization payload exceeds the `sessionStorage` quota, **when** the user opens a new tab, **then** the panel loads from a client store that survives the tab (or from a payload small enough to fit), and does not refetch from the server.
- [ ] **Given** the utilization heatmap or resource-assignment grid renders, **when** the dataset is at its maximum supported size, **then** the main thread is not blocked for more than 200 ms in a single task.
- [ ] **Given** any panel is loading, **when** the user is waiting, **then** a skeleton or progress state is shown rather than an empty zeroed layout.
- [ ] **Mobile:** **Given** viewport **&lt; 768px**, **when** the user opens any changed panel, **then** the same improvements apply; filter sheets, **Show charts**, and 44px touch targets are unchanged.

### Cross-cutting

- [ ] **Given** any workstream ships, **when** an ADMIN sets that workstream's kill-switch Script Property, **then** the previous builder path is restored without a redeploy.
- [ ] **Given** snapshot / historical mode, **when** a user selects a past date, **then** behavior is unchanged (Drive artifacts, 009 / 010).
- [ ] **Given** load-source overlays, **when** any new path serves data, **then** FR-120 Datastore vocabulary still applies.

## UI Notes

- **Routes / panels:** Utilization and Labor hours, Resource assignments (primary). Agreements, Pipeline, Portfolio P&L, AI Usage, Delivery P&L (payload and Refresh semantics). Home (hero asset). Expenses unchanged (Sheets).
- **Desktop:** No new nav routes. Charts may appear before tables. Skeleton loaders replace zeroed-KPI empty states. Refresh copy unchanged.
- **Mobile (`DashboardShell.html`, &lt; 768px):** Same APIs and same gains. **Show charts** renders from the slim payload. Date range and filters stay in `openMobileFilterSheet_`. No new bottom-nav item. Per `.cursor/rules/mobile-ui-shell.mdc`, verify at ~390px in the same change set as each desktop change.
- **Settings (ADMIN only):** New read-only **Datastore health** block showing last hydrate duration and status, per-panel stored vs expected `cache_schema_version`, and viz cache watermark.
- **Activity events:** Reuse existing panel refresh events. Whitelist any new slim-load event in `userActivityLog.js`.

## Data Model

Exact DDL in the implementation plan. Migrations **047+**.

| Object | Purpose | Workstream |
| --- | --- | --- |
| *(no schema change for the blob over-fetch)* | Workstream A needs none. The values the blob was parsed for are already in typed columns or the role-rate dimension maps, so A1 is a select-list change. | A |
| `fos_rpc_util_aggregates(start, end)` | Date-bounded utilization aggregates (by week, customer, project, person, role, billable mix) plus KPIs. | B |
| `fos_rpc_ra_week_grid(start, end)` | Resource assignment week grid with SQL-side allocation overlap. | B |
| `fos_rpc_agreement_chart_data()` | Slim Agreements chart slice. | B |
| `fos_viz_range_payloads` | Range-keyed JSON cache: `panel_key`, `range_start`, `range_end`, `cache_schema_version`, `payload`, `built_at`, `source_watermark`. | B |
| `fos_sync_watermarks` | **Already exists, currently unused.** Wire it up for incremental AM mirror. | C |
| Drop 6 zero-scan indexes | Remove write overhead. Migration `047_drop_unused_indexes.sql`. | A |

Existing date indexes (`fos_labor_costs_start_date_time_idx`, `fos_labor_costs_status_start_idx`, migration 037) already serve the hot paths and MUST be used by the new RPCs.

**Out of scope:** browser-direct Datastore reads with RLS (044 phase E), Postgres-side historical snapshot partitions, moving Expenses off Sheets.

## Operations

- **Queries (Live):** RPC or range cache for date-bound panels; blob read for the rest. Slim chart call may precede the full table call on the same panel.
- **Queries (Historical):** Drive snapshots unchanged.
- **Actions:** Refresh re-reads the Datastore. Pull from Fibery hydrates typed tables, rewrites blobs, and invalidates the viz range cache.
- **Jobs:** Nightly hydrate becomes incremental via watermarks and notifies ADMIN on failure.
- **Monitoring:** Settings surfaces hydrate duration, last status, and schema-drift warnings. Server timing for each Live path is logged so regressions are visible.
- **Secrets:** Unchanged. Service role key stays server-side.

## Edge Cases

- **Statement timeout on an RPC:** return the existing safe error; never hang the 6-minute script on unbounded SQL.
- **Cold first query after idle:** measured at 2,225 ms versus 17.8 ms warm. Default-range viz caches should be warmed at the end of hydrate so the first user of the day does not pay it.
- **Truncation:** if an RPC caps rows, keep surfacing `partial` and the warning banner as today.
- **Blob rows that do carry cost keys:** none exist today, but if the mirror trigger ever starts writing `Agreement Management/...` keys, dropping the column would silently change cost attribution. The parity harness compares totals for every fixture, and `PERF_USE_NORMALIZED_LABOR_COLS=false` restores the old path.
- **Schema bump during a hydrate:** ignore range-cache and blob rows whose `cache_schema_version` does not match; do not serve mixed-version data.
- **Concurrent Refresh and Pull:** Pull's lock wins; Refresh serves the pre-Pull blob and the next Refresh picks up the new one.
- **Range longer than the RA 52-week clamp:** keep the existing clamp.
- **Watermark gaps:** if a Fibery entity is deleted rather than modified, incremental mirror will miss it. Keep a weekly full reconcile.
- **Snapshot mode:** ignores `fos_viz_range_payloads` entirely.

## Verification Steps

Each workstream must pass parity before it ships.

1. **Parity harness (all workstreams):** run `_diag_comparePerfParity('<panel>', '<start>', '<end>')` against fixture ranges; confirm zero material diffs versus the pre-change builder, with rounding tolerances documented in the plan.
2. **Workstream A [done 2026-08-24]:** run `_diag_verifyWorkstreamA()` and confirm parity green on all four fixtures; measure wire bytes for the default window and confirm at least a 60% drop; run `scripts/check_deployed_matches_git.py` after `clasp push` and confirm exit 0; re-hydrate and confirm stored `cache_schema_version` equals code constants for all seven panels.
3. **Workstream B, Utilization:** open with the default range and a custom range; confirm server logs show an RPC or range-cache hit and no `supabaseSelectAll_` paging of labor; reopen the same custom range and confirm the cache hit.
4. **Workstream B, Resource assignments:** change From/To; confirm the week grid matches the prior builder and that allocation filtering happened in SQL.
5. **Workstream B, charts:** confirm Agreements, Utilization, and Pipeline charts paint before the full table payload arrives; confirm CSV export is still complete.
6. **Workstream B, Refresh:** click Refresh on Agreements and confirm no typed rebuild is logged; run ADMIN Pull, then Refresh, and confirm `synced_at` advances.
7. **Workstream C:** run a hydrate with no upstream changes and confirm it completes in under 10 minutes; force a step failure and confirm the run is marked failed, ADMIN is notified, and the retry resumes from that step.
8. **Workstream D:** measure the served HTML size and compare to the 1.45 MB baseline; open Utilization, close the tab, open a new tab, and confirm no server refetch; profile the heatmap render and confirm no task over 200 ms.
9. **Snapshot regression:** pick a historical date and confirm all panels still load from Drive.
10. **Mobile (~390px):** on the deployed Web App in device mode, confirm each changed panel loads, filter sheets work, and **Show charts** renders from the slim payload.
11. **Kill switches:** set each workstream's Script Property and confirm the previous path is restored.

## Implementation Checklist

- [ ] Update feature spec checkboxes as implemented
- [ ] **Mobile UI** per `.cursor/rules/mobile-ui-shell.mdc` (same change set as desktop)
- [ ] SQL migrations 047+ and `docs/supabase-data-model.md` updated
- [ ] Snapshot cache-sync rule per `.cursor/rules/dashboard-snapshot-cache-sync.mdc`: bump server and client `cacheSchemaVersion` together; confirm `dashboardSnapshotJob.js` builders still return the expected shape
- [ ] Parity harness `_diag_comparePerfParity` added and green
- [ ] `_diag_` coverage for RPC vs blob vs range cache
- [ ] Kill-switch Script Properties registered in `src/adminSettingsRegistry.js`
- [ ] Run local smoke test
- [ ] After `clasp push`, `scripts/check_deployed_matches_git.py` exits 0
- [ ] Commit with message: feat: ...
- [ ] At ship: PRD FR-144 / AC-105, `FOS_PRD_VERSION`, all `src/*` headers, Teamwork rename and notebook sync

## Change requests

Post-approval customer edits land here until ship (Teamwork notebook). Merge into the body at ship.

## Changelog

| Date | PRD | Notes |
| --- | --- | --- |
| 2026-08-24 | 3.9.3 | Harness results persist to **`fos_perf_runs`** (migration `048`) so later workstreams can be compared against the workstream A baseline with SQL. `clasp run` is not viable here: it needs a linked standard GCP project and a private OAuth client, and satisfying its scope requirements would mean adding explicit `oauthScopes` to the manifest, which re-prompts every Web App user for consent. Adds `_diag_verifyWorkstreamA()` and a 4.5-minute budget so batch runs report partial results instead of being killed at the 6-minute limit. |
| 2026-08-24 | 3.9.2 | **Workstream A shipped.** See the PRD changelog for scope. Two corrections to this spec are recorded in the rows below. |
| 2026-08-24 | 3.9.1 | Spec Draft. Measured baseline against the live Datastore: DB is 101 MB with 100% cache hits and Postgres aggregates the 90-day utilization window in 17.8 ms, while GAS pages 9,508 rows over ~10 MB in 10 serial round trips. Four workstreams: stop over-fetching and schema drift, aggregate in Postgres (absorbs 044), fix hydrate, client responsiveness. |
| 2026-08-24 | 3.9.1 | Two problem-statement corrections after implementing workstream A. **(1)** The `fibery_payload_json` over-fetch needs no migration: the blob holds 13 keys that all duplicate typed columns, and carries none of the cost, role, company, or customer keys the mappers read, so A1 is a select-list change. **(2)** The schema drift was a symptom of **deployment lag**, not a database problem. Four "Ship PRD" commits were never pushed to Apps Script; the running script was internally consistent throughout, so panels were not degraded for nine days as first stated. |

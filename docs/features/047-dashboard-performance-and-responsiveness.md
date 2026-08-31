# Feature: Dashboard performance and responsiveness

> **Teamwork:** Create this spec first as a notebook in [FOS Dashboard Development](https://win.godeap.io/app/projects/1615262) using these sections. Sync to `docs/features/0NN-<slug>.md` at approval and again at ship. See `docs/teamwork-workflow.md`.
> **Teamwork notebook:** [Feature 047 - Dashboard performance and responsiveness](https://win.godeap.io/app/projects/1615262/notebooks/313457)  
> **Implementation plan notebook:** [Feature 047 - Implementation plan (Performance)](https://win.godeap.io/app/projects/1615262/notebooks/313458)  
> **Release task:** [Feature 047 - Dashboard performance and responsiveness](https://win.godeap.io/app/tasks/40839335) (re-scoped from Feature 044)
>
> **Status:** Shipped through **v3.20.9** (workstreams A–D, RA range cache **v3.20.0**, Settings patches **v3.20.5–3.20.9**, hero/logo patches **v3.20.1–3.20.2**). **Workstream D shipped in 3.17.0** (lazy panel markup behind `PERF_LAZY_PANEL_MARKUP`, IndexedDB panel cache, chunked heatmap/RA renders, Operations skeleton). **Workstream C shipped in 3.16.0** (incremental mirror + alerts + resume; `PERF_INCREMENTAL_AM_MIRROR` off pending measured win). **Workstream B6 shipped in 3.15.0** (`personVariances` codec); Workstream B closed out in 3.14.1. **v3.20.0:** RA range payload cache (`PERF_USE_RA_RANGE_CACHE`) + slim personVariances default on (**FR-156**).
> **PRD version:** **3.20.9**
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

## Workstream B close-out

Measured **2026-08-25** against the live project with the flags that were actually set. The full record, including the flag inventory, the `pg_stat_statements` evidence, and the index re-check, is in the implementation plan under **B6**. This section is the product-level summary.

### What workstream B actually delivered

On the default Utilization window, which is the path every part of B touched:

| Stage | Wire bytes | Round trips | Labor load |
| --- | --- | --- | --- |
| Before workstream A | 6,966 kB | 10 | seconds to tens of seconds |
| A live | 2,274 kB | 10 | 6,267 ms |
| A plus B4 warm | **945 kB** | **1** | **1,598 ms** |

**86.4 percent fewer bytes and 10 round trips down to 1**, all of it measured on the same day on the same window, and all of it switched on. The stored utilization blob went from 6,060,530 to 1,336,959 JSON chars, **77.9 percent** off.

### What is shipped but delivering nothing

Being explicit, because a shipped-but-off feature is worth exactly zero:

- **B3 Agreements first paint** (`PERF_USE_SLIM_CHARTS`) is **off**. The 23,469-char chart endpoint exists and is unused.
- **B5 Reload re-reads the blob** (`PERF_RELOAD_REREADS_BLOB`) is **verified** (`_diag_verifyWorkstreamB5()` second run: both panels, 0 diffs, `armsProven: true`; first run failed only because today's blobs were built by deployed 3.10.0). The flag may still be off in ADMIN Settings; until it is on, every Reload on the Agreement family still spends about 4.6 seconds over seven round trips rebuilding a payload it could have read.
- **B4's hydrate warm and garbage collection** is on but has **never executed**, because the last hydrate ran on a deployed script four releases behind git. The range cache therefore only ever fills on user demand and prunes nothing. `fos_rpc_viz_range_gc` has zero calls from Apps Script.
- **The B1 aggregates RPC was never built.** `PERF_USE_UTIL_RPC` was found switched on and gates nothing.

### The largest payload in the product was never a target

`resource-assignments` is **2,724 kB**, more than twice `utilization` after B1 slimmed it, and 83 percent of it is one slice, `personVariances`, at 2,316,942 chars over 3,764 week cells.

It was never a workstream B target because the problem statement recorded it at **464 kB**. That figure was correct for what was stored and wrong about the product: it measured a `cache_schema_version` 2 blob written by a deployed script nine days behind git. The real version 3 blob is nearly six times larger. So the deploy lag documented in cause 4 did not only delay releases, it **mis-set the priorities of the workstream whose job was finding large payloads**. B3 spent a release on a 272 kB slice while a 2,317 kB slice of the same shape sat unmeasured.

The fix is the codec pattern B1 and B3 already built and verified, applied to a slice 8.7 times larger. Recommended as the first item of whatever follows B.

### Recurring deploy lag

Third instance in this feature. Both of today's hydrates stamped `scriptVersion: "3.10.0"` while git was at 3.13.0. `check_deployed_matches_git.py` detects this correctly but only runs when someone remembers. **Recommendation: install it as a git `pre-push` hook**, about four lines, no new code, failing at the one moment the author has the context to fix it. Details and the reason `pre-push` beats `pre-commit` are in the plan under B6.

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

- [ ] **Given** Live Datastore is configured, **when** a user opens Utilization or Labor hours with a date range, **then** the server calls a Postgres RPC (or reads a range-cache row built from one) and does **not** page raw `fos_labor_costs` as the primary path. *(**Not met, and left unchecked deliberately.** B4 gets a repeat window down to one read, verified, but the row bundle it caches is **built by paging**, not by an RPC, and a window nobody has opened yet still pages 8 to 12 times. The aggregates RPC that would satisfy this as written is `fos_rpc_util_aggregates`, migration 052, which was **never built**; `PERF_USE_UTIL_RPC` is an inert flag. Closing this criterion is the first item of any workstream B7.)*
- [x] **Given** Live Resource assignments with From/To, **when** the panel loads, **then** allocation overlap is filtered **in SQL**; GAS does not download the full allocation table and filter in memory. *(Shipped 3.11.0, verified 2026-08-25 by `_diag_verifyWorkstreamB2()`: 4 fixtures, 0 diffs, `armsProven: true`, tally of 4 RPC builds against 4 row-scan builds with **0 fallbacks**. `PERF_USE_RA_RPC` is **on**, and `pg_stat_statements` shows **9** PostgREST-shaped calls to `fos_rpc_ra_week_grid` at 26.3 ms mean, so the path is genuinely serving traffic rather than merely being enabled.)*
- [x] **Given** any RPC-backed panel, **when** totals are compared against the current GAS builder on fixture ranges, **then** they match within documented rounding. *(Better than the criterion asks: **exact** equality, not within rounding, on every fixture of both RPC-backed paths. B2 run `perf:parity:2026-08-25T14:51:04.054Z:1f1240da` and B4 run `perf:range-cache:2026-08-25T15:06:52.419Z:556171f2`, the latter comparing cold and warm arms separately across all four fixtures.)*
- [x] **Given** Agreements Live with no cached payload, **when** the panel opens with `PERF_USE_SLIM_CHARTS` on, **then** Chart.js paints from `getAgreementChartData()`, measured **23,469** chars against a **766,518**-char blob, without waiting on `revenueItemsByAgreement`, `financialTable`, or the revenue-item arrays. Shipped 3.12.0.
- [x] **Given** Utilization Live, **when** the panel opens with `PERF_SLIM_VIZ_AGGREGATES` on, **then** the visualization slice `aggregates` arrives at **59,518** chars instead of **283,333**, under the 100 KB budget, losslessly. Shipped 3.12.0.
- [x] **Given** Resource Assignments Live, **when** the panel opens with `PERF_SLIM_RA_PERSON_VARIANCES` on, **then** `personVariances` arrives as positional tuples plus string tables with shared byDay dedup, measured **2,113,091 to 124,060** compact JSON chars (**94.1 percent**), and the By person variances grid and day-detail modal are unchanged aside from byDay variance recomputed from the two hour columns. Shipped 3.15.0 behind the kill switch (off until `_diag_verifyCodec_RaPersonVariances()` passes). `cacheSchemaVersion` stays **3**; no re-hydrate.
- [x] **Not applicable to Pipeline.** Measured 2026-08-25: the entire pipeline blob is **79,702** chars, already inside the 100 KB budget, so no slim endpoint was added. Measured 2026-08-25: the Utilization charts are computed in the browser from `applyFilters(rows)` and cannot be painted from a server aggregate, so no `getUtilizationChartData` was added; see the implementation plan, workstream B3.
- [x] **Given** a valid, schema-current blob, **when** the user clicks **Reload** on Agreements, Revenue review, Delivery, or Services summary, **then** the server re-reads that row and does not run a typed rebuild. Shipped 3.13.0's successor 3.14.0 behind `PERF_RELOAD_REREADS_BLOB`. The rebuild it replaces measured about **4.6 seconds** over **seven** round trips, and it could not return anything new, because the AM mirror inside the nightly hydrate is the only writer of all five tables it reads and the hydrate writes the blob after the mirror in the same run. Three conditions still force the rebuild and are part of the criterion: a missing blob, a lagging `cache_schema_version`, an agreement threshold retuned since the blob was written, or a blob built on an earlier UTC day. The button already read **Reload** and already promised "Does not pull Fibery", so no copy changed.
- [x] **Not applicable to the Delivery P&L force path.** `serveLiveDeliveryPnLOrRebuildFull_` is deliberately left rebuilding, because it reads `fos_status_updates`, which users write during the day through the dual-write path. Re-reading its stored row would hide an update the user had just posted.
- [x] **Given** a Utilization window requested a second time within a hydrate epoch, **when** the panel loads, **then** it is served from the range cache in **one** read instead of the 11 it takes uncached (7 labor pages plus 4 dimension tables), and every number is identical. Shipped 3.13.0 behind `PERF_USE_RANGE_CACHE`. The cache is keyed on the **UTC-day-aligned superset** of the window rather than the window itself, because labor timestamps are intra-day (1,163 distinct times of day across 22,546 rows) and the client sends `new Date()` instants for every rolling preset, so the rows are always filtered back to the exact requested instants before any KPI is computed. Applies to the rolling presets as well as custom windows; the plan's phrasing said "custom" but the default window is the case that benefits most, since it is rebuilt on every load today.
- [ ] **Given** an RPC is unavailable or times out, **when** the panel loads, **then** the user sees the existing safe error copy; no Fibery Live fallback. *(**Unchecked because it has not been tested, not because it is believed broken.** Both RPC paths have explicit fallbacks that degrade to the previous builder rather than to Fibery, and the B2 harness counts fallbacks precisely so a silent one cannot pass as a success, reporting 0. But no fault has been injected: nothing has revoked the grant, forced the 20-second `statement_timeout`, or dropped the function to see what a user actually sees. Verifying this needs a deliberate failure and should not be marked met on the strength of reading the code.)*

### C. Fix hydrate (Workstream C)

- [x] **Given** a nightly hydrate with no Fibery changes since the last run, **when** it executes with `PERF_INCREMENTAL_AM_MIRROR` on, **then** entity steps request only rows modified since `fos_sync_watermarks` (enums still full-scan; Sunday is a full reconcile). Measure under 10 minutes after enabling the flag in production.
- [x] **Given** the AM mirror runs with the flag on, **when** it completes an entity step, **then** it advances that step's watermark only after successful upserts.
- [x] **Given** a hydrate step fails, **when** the run ends, **then** the run is recorded as failed **and** ADMIN is emailed via `notifyAdminsHydrateFailed_` / Notification Log (`system.hydrate_failed`).
- [x] **Given** a hydrate step fails transiently, **when** it is retried, **then** Fibery fetch uses bounded backoff in-process, and the next Pull resumes from the saved dataset / am-mirror cursor (`resumeEligible`) unless `SUPABASE_SYNC_FORCE_FULL` or the failure is older than 24 hours.
- [x] **Given** hydrate completes, **when** panel blobs are written, **then** default-range viz caches are rebuilt or invalidated in the same run (existing `viz-warm` step; unchanged).

### D. Client responsiveness (Workstream D)

- [x] **Given** a cold page load, **when** the shell is served, **then** the HTML response is **at least 40% smaller** than the current ~1.45 MB when lazy markup is on; hero and logo base64 are always removed (~130 KB savings on every load).
- [x] **Given** the Home hero image, **when** the page loads, **then** it is not a render-blocking inline base64 data URI with `decoding="sync"`.
- [x] **Given** the utilization payload exceeds the `sessionStorage` quota, **when** the user opens a new tab, **then** the panel loads from a client store that survives the tab (IndexedDB for payloads over 2 MB), and does not refetch from the server.
- [x] **Given** the utilization heatmap or resource-assignment grid renders, **when** the dataset is at its maximum supported size, **then** the main thread is not blocked for more than 200 ms in a single task (rAF batched row builds).
- [x] **Given** any panel is loading, **when** the user is waiting, **then** a skeleton or progress state is shown rather than an empty zeroed layout (Operations skeleton shipped; other panels retain existing loading overlays).
- [x] **Mobile:** **Given** viewport **&lt; 768px**, **when** the user opens any changed panel, **then** the same improvements apply; filter sheets, **Show charts**, and 44px touch targets are unchanged.

### Cross-cutting

- [x] **Given** any workstream ships, **when** an ADMIN sets that workstream's kill-switch Script Property, **then** the previous builder path is restored without a redeploy. *(Met for every flag that gates real code. **`PERF_USE_UTIL_RPC`** still gates nothing. **`PERF_LAZY_PANEL_MARKUP`** gates lazy markup in v3.17.0 and ships off.)*
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
| `fos_viz_range_payloads` | **Shipped 3.13.0, migration `051`.** Range-keyed row-bundle cache: `panel_key`, `range_start`, `range_end`, `cache_schema_version`, `key_hash`, `payload`, `row_count`, `payload_chars`, `built_at`, `source_watermark`, `source_row_count`. The date bounds are the **day-aligned superset** of the requested window, not the window; `key_hash` covers the resolved thresholds and `PERF_USE_NORMALIZED_LABOR_COLS`. | B4 |
| `fos_viz_source_fingerprint()` | **Shipped 3.13.0.** Greatest `synced_at` across `fos_labor_costs` and the four dimension tables a normalized row draws from, plus the labor row count. 19.5 ms warm. | B4 |
| `fos_rpc_viz_range_get(...)`, `fos_rpc_viz_range_gc(...)` | **Shipped 3.13.0.** One-round-trip read plus live fingerprint, and exact garbage collection of entries whose sources have advanced. | B4 |
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
- **Watermark gaps:** if a Fibery entity is deleted rather than modified, incremental mirror will miss it until the next full scan. **Shipped 3.20.3:** full-scan steps delete Supabase rows not in the Fibery snapshot (`fos_reconcile_mirror_step`; Sunday when incremental on, every step when off).
- **Snapshot mode:** ignores `fos_viz_range_payloads` entirely.

## Verification Steps

Each workstream must pass parity before it ships.

1. **Parity harness (all workstreams):** run `_diag_comparePerfParity('<panel>', '<start>', '<end>')` against fixture ranges; confirm zero material diffs versus the pre-change builder, with rounding tolerances documented in the plan.
2. **Workstream A [done 2026-08-24]:** run `_diag_verifyWorkstreamA()` and confirm parity green on all four fixtures; measure wire bytes for the default window and confirm at least a 60% drop; run `scripts/check_deployed_matches_git.py` after `clasp push` and confirm exit 0; re-hydrate and confirm stored `cache_schema_version` equals code constants for all seven panels.
3. **Workstream B, Utilization:** open with the default range and a custom range; confirm server logs show an RPC or range-cache hit and no `supabaseSelectAll_` paging of labor; reopen the same custom range and confirm the cache hit.
4. **Workstream B, Resource assignments:** change From/To; confirm the week grid matches the prior builder and that allocation filtering happened in SQL.
5. **Workstream B3, charts (3.12.0):** run `_diag_verifyCodec_HeatmapWeeks()` from the Apps Script editor and confirm `pass: true` with `diffCount: 0`; then turn `PERF_SLIM_VIZ_AGGREGATES` on in ADMIN Settings, open Operations Live, and confirm the heatmap, its legend bands, its cell tooltips, and its cell drill-down modal are unchanged, and that CSV export is still complete. Turn `PERF_USE_SLIM_CHARTS` on, hard-reload, open Agreements cold, and confirm the donuts, customer bar, recognition stack, Sankey, forward pipeline, and attention list paint before the financial table fills in. **At ~390px** repeat the Agreements check and confirm **Show charts** reveals the already-painted canvases with no extra fetch, and that the Operations heatmap and filter sheet behave as before; B3 adds no new controls, so the mobile surface is the existing progressive-disclosure chrome rendering the same canvases sooner.
5b. **Workstream B4, range cache (3.13.0):** run `_diag_verifyWorkstreamB4()` from the Apps Script editor and confirm `pass: true`, `armsProven: true`, and `diffCount: 0` on both the cold and the warm comparison of all four fixtures, with exactly one cache miss on each cold arm and one hit on each warm arm; also confirm `warm.httpCalls` is well below `baseline.httpCalls`. Then turn `PERF_USE_RANGE_CACHE` on in ADMIN Settings, open Operations Live on the default window, switch to another preset and back, and confirm the KPI strip, all six charts, the heatmap, the alert list, and the detail table are unchanged and the second visit is visibly faster. Confirm `select panel_key, range_start, range_end, row_count, payload_chars from public.fos_viz_range_payloads;` lists the windows you opened. Run an ADMIN Pull and confirm the `viz-warm` note appears in the run summary and that the previous entries were garbage-collected. No `DashboardShell.html` change ships in this release, so there is no new mobile surface; re-confirm at ~390px only that Operations still loads.
6. **Workstream B5, Reload (3.14.0):** run `_diag_verifyWorkstreamB5()` from the Apps Script editor and confirm `pass: true`, `armsProven: true`, and `diffCount: 0` for both `storedVsRebuild` and `rereadVsRebuild` on both panels, with `rebuild.httpCalls` well above `reread.httpCalls`. If `storedVsRebuild` shows diffs on the very first run, check `select summary->>'scriptVersion' from public.fos_sync_runs order by started_at desc limit 1;` before concluding the premise is wrong: a blob built by an older deployed script can differ from a current rebuild for reasons unrelated to B5, and the diagnostic's own rebuild arm has already replaced both blobs with current code, so an immediate second run gives a same-code comparison. Then turn `PERF_RELOAD_REREADS_BLOB` on in ADMIN Settings, open Agreements Live, press **Reload**, and confirm the KPI strip, donuts, customer bar, recognition stack, Sankey, forward pipeline, attention list, customer cards, and financial table are unchanged, that the header still reads "Reloaded ... · Data as of ... · Datastore", and that **Data as of** now holds at the hydrate time instead of jumping to now. Retune any agreement threshold in ADMIN Settings, press Reload, and confirm the new threshold takes effect (a rebuild, reported as `reloadRebuildReason: "thresholds-changed"`). Run ADMIN Pull, then Reload, and confirm **Data as of** advances. **At ~390px** repeat the Agreements Reload check; no `DashboardShell.html` change ships in this release, so the mobile surface is the existing panel header and Reload control rendering the same values.
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
| 2026-08-26 | 3.20.2 | **Hero/logo image fix (final).** v3.20.1 `?asset=` doGet routes still broken for `<img>` under `executeAs: USER_ACCESSING` (no session on cross-site img fetch from googleusercontent iframe). Reverted to inline data URLs in template; images render reliably. ~130 KB returned to HTML shell. |
| 2026-08-26 | 3.20.1 | **Hero/logo image fix.** Drive `/uc?id=` embed URLs return 403 for cross-site `<img>` (Google policy, 2024). Sidebar logo and Home hero now load from same-origin Web App routes `?asset=brand-logo` and `?asset=home-hero` (bundled bytes served from `doGet`, same pattern as `?favicon=1`). HTML shell stays slim; no inline base64. |
| 2026-08-25 | 3.20.0 | **RA range payload cache + slim defaults on.** Assembled Resource assignments payloads stored in `fos_viz_range_payloads` for the exact From/To window (`PERF_USE_RA_RANGE_CACHE` default **true**). Migration **053** adds `fos_ra_source_fingerprint` and panel-aware get/gc. Hydrate `viz-warm` warms/GCs the default -30/+90 RA window. **`PERF_SLIM_RA_PERSON_VARIANCES`** default **true**. Diagnostic **`_diag_verifyRaRangeCache()`**. **FR-156**, **AC-118**. |
| 2026-08-25 | 3.15.0 | **Workstream B6 shipped, kill switch off pending verification.** Measured on the live panel first: `personVariances` was **2,316,942** of **2,789,504** JSON chars (**83 percent**), byDay **1,824,743** chars with **52.6 percent** duplicated across assigned/actual/variance. Positional tuples plus string tables plus shared byDay dedup take the compact slice from **2,113,091 to 124,060** (**94.1 percent**). byDay `varianceHours` dropped on the wire (recomputed on decode). Self-describing `personVariancesCodec`; `cacheSchemaVersion` stays **3** (no re-hydrate). **`PERF_SLIM_RA_PERSON_VARIANCES`** ships **off**; run **`_diag_verifyCodec_RaPersonVariances()`** first. Encode in one helper from both builders; client decode is idempotent on apply/cache/snapshot (avoids the 3.10.0 trap). Mobile: existing RA layout and filter sheet against the decoded payload; no new controls. |
| 2026-08-25 | 3.14.1 | **Workstream B closed out.** Measured end to end on the default Utilization window: 6,966 kB / 10 round trips before A, to 945 kB / 1 with A plus B4 warm. Utilization blob 77.9 percent smaller. Three inert flags labeled reserved in ADMIN Settings. Identified `resource-assignments.personVariances` (2.3 MB) as the largest remaining payload, mis-measured in the original problem statement because of deploy lag. B5 verified the same day. See the implementation plan under B6 for the full record. |
| 2026-08-25 | 3.14.0 | **Workstream B5 shipped, kill switch off pending verification.** The first workstream whose plan text survived measurement, and measuring it also reversed the product question. Reload on the Agreement family runs `rebuildAgreementDeliveryPanelsFromTyped_`, which reads five typed tables (960 rows in total) and upserts two panel blobs. Timed from the hydrate's own stamps on 2026-08-25 that is **2,885 ms** to build the agreement payload and **1,730 ms** to upsert it and derive delivery, about **4.6 seconds** over **seven** round trips. It cannot produce anything newer: `supabaseAmMirror.js` is the **only** writer of `fos_agreements`, `fos_companies`, `fos_company_segments`, `fos_revenue_items`, and `fos_clockify_users`, it runs once per hydrate in a single generation (all 45 agreement rows share a `synced_at` inside 6 ms), and the hydrate writes the blob at 09:51:40 against the mirror's 09:17 to 09:47. The stated worry, that a user pressing Refresh would see stale data and think the button was broken, does not apply here: the control is already labeled **Reload**, its tooltip already says "Does not pull Fibery; newer data arrives after ADMIN Pull from Fibery or the nightly sync", and `formatPayloadLastRefresh_` already renders "Reloaded ... · Data as of ... · Datastore". Re-reading the blob makes that label **more** honest, because the rebuild stamped `dataAsOf` with the rebuild time and so claimed the data was newer than the mirror. Three things the plan's one line missed are handled instead of accepted. Thresholds come from Script Properties, not the mirror, and feed `computeKpis_`, `evaluateAlerts_`, `buildChartViewModels_`, and `buildFinancialTable_`, so the whole resolved object is hashed into a new additive `thresholdFingerprint` and a mismatch rebuilds; an absent fingerprint counts as a match so pre-release blobs stay servable. The build splits revenue items on `target_date > todayIso` in UTC, so a blob from an earlier UTC day rebuilds. And `serveLiveDeliveryPnLOrRebuildFull_` is deliberately **not** changed, because it reads `fos_status_updates`, which users do write mid-day. `loadSource` stays `supabase` so `isDatastorePayload_` and `loadSourceFromPayload_` keep choosing the same chrome; the path taken is reported in new `reloadPath` and `reloadRebuildReason` fields. No `cacheSchemaVersion` moves, so **no re-hydrate is required**. **`PERF_RELOAD_REREADS_BLOB`** ships **off**; run **`_diag_verifyWorkstreamB5()`** first. Also renamed `_diag_verifyUtilRowCodec` and `_diag_verifyUtilVizCodec`, which differed by three letters and sat adjacent in the editor's function dropdown, to **`_diag_verifyCodec_UtilizationRows()`** and **`_diag_verifyCodec_HeatmapWeeks()`** after the wrong one was run by mistake. No `DashboardShell.html` change, so the mobile rule has nothing new to accommodate. | Cursor |
| 2026-08-25 | 3.13.0 | **Workstream B4 shipped, kill switch off pending verification.** Measured before designing, and the plan's DDL did not survive it. Every Utilization load rebuilds from `fos_labor_costs` today; the stored panel blob is only a fallback and its window is a millisecond-precision instant pair (`2026-06-26T09:53:46.331Z` to `2026-08-25T09:53:46.331Z`), so nothing but that one window can be served from it. The plan proposed keying the cache on `range_start date, range_end date`. That is **not usable**: only **168 of 22,546** labor rows sit on UTC midnight, there are **1,163 distinct times of day**, and the client builds every rolling preset from `new Date()`. A `date` key would serve an entry to requests whose real bounds differ from the ones it was built for, which on today's default window is **51 rows** at the start edge and moves every KPI. What shipped keys on the UTC-day-aligned **superset** of the request, stores every row in that superset, and filters back to the exact requested instants before computing anything: **0.8 percent** more rows fetched, identical arithmetic, and a window that is finally cacheable. A hit is **1** PostgREST round trip against **11** uncached (7 labor pages plus 4 dimension tables), and about **870 kB** against **2,353 kB**. Only rows are cached; alerts depend on the clock and every aggregate depends on thresholds an ADMIN can retune, so all of it is recomputed per serve, and the artifact is deliberately not payload-shaped so it cannot be handed to a browser by accident. Invalidation is a fingerprint of the greatest `synced_at` across the labor table and the four dimension tables plus the labor row count, **19.5 ms** warm, read **before** the fetch so a mid-build sync costs a rebuild rather than a bad serve. The plan's "hydrate advances the labor watermark" was also wrong: `fos_labor_costs` is written by the Clockify sync project at 05:35, while this hydrate ran 08:57 to 10:04. Measuring also forced the one production behavior change in the release: the labor read ordered by `start_date_time` alone, **4,736 of 5,821** rows in the default window share a timestamp (865 tied values, largest group 19), and the plan feeds an unstable quicksort, so row order between two identical requests was already arbitrary and no cache could be proven correct against a fresh build. The primary key is now a sort tiebreaker in both flag states, **16.9 ms** against a roughly 2,800 ms build. That makes order deterministic where it was arbitrary; it can shift a row within one timestamp and with it a Top-N entry whose hours tie exactly, and it cannot change a total. The Live and cached paths now share **one** payload assembler, which is the structural fix for the class of defect behind FR-148. A new final hydrate step warms the 30, 60, and 90 day presets from a single labor fetch and can never fail the run; 180 and YTD are left cold because a YTD-sized upsert is already recorded as timing out. No `cacheSchemaVersion` moves, so **no re-hydrate is required**. **`PERF_USE_RANGE_CACHE`** ships **off**; run **`_diag_verifyWorkstreamB4()`** first. No `DashboardShell.html` change, so the mobile rule has nothing to accommodate this release. | Cursor |
| 2026-08-25 | 3.12.0 | **Workstream B3 shipped, both kill switches off pending verification.** Measured the live blobs before designing anything. The Utilization heatmap slice `aggregates.byPersonWeek` is **272,469** of the **283,333** chars in `aggregates`: 617 entries over 76 persons and 10 weeks, each repeating 15 key names, with `personId` equal to `personKey` on 617 of 617 rows. A positional-tuple plus string-table codec takes it to **48,654** chars, **82.1 percent** off, and `aggregates` to **59,518**, inside the 100 KB budget. A lossy variant that dropped the eight fields nothing reads measured **25,406** (90.7 percent) and was **rejected**: `buildAskPanelDataset_` feeds `aggregates` to Ask AI, so deleting dimensions changes answers rather than only size. Two plan claims were wrong and were not built. `getUtilizationChartData` cannot work: every Utilization chart is a function of `applyFilters(p.rows)` in the browser and re-renders on every filter change, so a server aggregate would be duplicated math thrown away on first interaction, and a grep confirms `aggregates.byPersonWeek` is the only aggregate slice any consumer reads. `getPipelineChartData` is unnecessary: the whole pipeline blob is **79,702** chars, already under target. What did ship on the endpoint side is **`getAgreementChartData()`**, **23,469** chars against a **766,518**-char blob, a pure projection of six already-precomputed keys, with its own `chartCacheSchemaVersion`. No panel `cacheSchemaVersion` moves, because the encoded envelope carries `byPersonWeekCodec` with its own version and is self-describing in both directions, so **no re-hydrate is required**. Tracing consumers also surfaced a defect shipped in **3.10.0**: `applyUtilPayload` was assigning the raw encoded server envelope over the decoded copy, so `applyFilters` read `.length` off an object and Operations rendered every KPI, chart, and detail row empty after each Live fetch. Fixed. **`PERF_SLIM_VIZ_AGGREGATES`** and **`PERF_USE_SLIM_CHARTS`** both ship **off**; run **`_diag_verifyCodec_HeatmapWeeks()`** first. | Cursor |
| 2026-08-24 | 3.11.0 | **Workstream B2 shipped, kill switch off pending a parity run.** New Postgres function **`fos_rpc_ra_week_grid(date, date)`** (migration **050**) returns range-filtered allocations with person, project, customer, and role display fields resolved in SQL. Measured live: **116 of 149** allocations in the default -30/+90 window, **7.5 ms** warm against a 200 ms budget, **66 kB** of JSON, and the RPC preserves heap row order, which matters because alert ties are broken by input order. The plan's proposed predicate was rejected: `duration_start < p_end and duration_end >= p_start` drops allocations with no duration, and `allocationOverlapsRangeYmd_` counts those as always in range. One live allocation is exactly that case, so the plan's SQL would have moved a KPI. The honest scope note is that the win is **one PostgREST round trip**, not five: the four dimension tables this path stops reading are still read by the plan-vs-actual labor aggregation in the same build. Payload shape is unchanged, so `cacheSchemaVersion` stays at **3**. **`PERF_USE_RA_RPC`** ships **off**; **`_diag_verifyWorkstreamB2()`** must pass first, and it counts which path each parity arm took because a silent RPC fallback would make the harness compare the row scan against itself. No `DashboardShell.html` change, so the mobile rule has nothing to accommodate this release. |
| 2026-08-24 | 3.10.1 | **Codec verified, and a constraint bug found by it.** `_diag_verifyCodec_UtilizationRows()` on the deployed 3.10.0: **6,042 rows, zero diffs**, rows array **4,351,066 -> 843,367 bytes (80.6 percent)**, better than the 880 kB predicted from SQL. The run's result could not be saved, because migration `048` pinned `fos_perf_runs.kind` to `baseline` and `parity`. Migration `049` swaps that allow-list for a lowercase-slug shape check so later workstreams add kinds freely, accepting the loss of typo detection on an internal diagnostics table. The diagnostic is folded to a single pass over the rows; this is a simplification, and notably **not** a timeout fix, which was the first and wrong hypothesis for the missing row. The whole run took 9 seconds. |
| 2026-08-24 | 3.10.0 | **Workstream B1 shipped.** Utilization payload about **5.9 MB -> ~1.2 MB** for the default window. Measurement redirected the design: repeated **key names** were **44.5 percent** of remaining row bytes, more than the string values, so rows became positional arrays first and dictionaries second. A dictionary-only change would have left nearly half the waste. Eight dead or derivable fields dropped. Server-side re-slicing had to learn to decode first, or the fallback path would have returned an empty panel silently. Row drawer **Agreement state** and **Agreement type**, blank since the Datastore cutover, now resolve; **Created** removed as unsourceable. `cacheSchemaVersion` **6 -> 7**. |
| 2026-08-24 | 3.9.3 | Harness results persist to **`fos_perf_runs`** (migration `048`) so later workstreams can be compared against the workstream A baseline with SQL. `clasp run` is not viable here: it needs a linked standard GCP project and a private OAuth client, and satisfying its scope requirements would mean adding explicit `oauthScopes` to the manifest, which re-prompts every Web App user for consent. Adds `_diag_verifyWorkstreamA()` and a 4.5-minute budget so batch runs report partial results instead of being killed at the 6-minute limit. |
| 2026-08-24 | 3.9.2 | **Workstream A shipped.** See the PRD changelog for scope. Two corrections to this spec are recorded in the rows below. |
| 2026-08-24 | 3.9.1 | Spec Draft. Measured baseline against the live Datastore: DB is 101 MB with 100% cache hits and Postgres aggregates the 90-day utilization window in 17.8 ms, while GAS pages 9,508 rows over ~10 MB in 10 serial round trips. Four workstreams: stop over-fetching and schema drift, aggregate in Postgres (absorbs 044), fix hydrate, client responsiveness. |
| 2026-08-24 | 3.9.1 | Two problem-statement corrections after implementing workstream A. **(1)** The `fibery_payload_json` over-fetch needs no migration: the blob holds 13 keys that all duplicate typed columns, and carries none of the cost, role, company, or customer keys the mappers read, so A1 is a select-list change. **(2)** The schema drift was a symptom of **deployment lag**, not a database problem. Four "Ship PRD" commits were never pushed to Apps Script; the running script was internally consistent throughout, so panels were not degraded for nine days as first stated. |

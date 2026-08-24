# Feature 047 - Implementation plan (Dashboard performance and responsiveness)

> **Spec:** [047-dashboard-performance-and-responsiveness.md](047-dashboard-performance-and-responsiveness.md)
> **Teamwork notebook:** [Feature 047 - Implementation plan (Performance)](https://win.godeap.io/app/projects/1615262/notebooks/313458)  
> **Feature notebook:** [Feature 047 - Dashboard performance and responsiveness](https://win.godeap.io/app/projects/1615262/notebooks/313457)  
> **Release task:** [Feature 047 - Dashboard performance and responsiveness](https://win.godeap.io/app/tasks/40839335)
>
> **PRD version:** 3.9.2. Each workstream ships its own version bump.
> **Status:** Approved 2026-08-24. **Workstream A shipped in 3.9.2.** B, C, D pending.

## How to read this plan

Four workstreams, ordered by **value per unit of risk**. Each is independently shippable and independently revertible. Do not start a later workstream before the earlier one is verified in production, because each one changes the baseline the next one is measured against.

| WS | Name | Est. effort | Expected gain | Risk |
| --- | --- | --- | --- | --- |
| **A** | Stop over-fetching and stop drifting | 0.5 to 1 day | Large, immediate | Low |
| **B** | Aggregate in Postgres | 5 to 8 days | Largest | Medium |
| **C** | Fix hydrate | 3 to 4 days | Operational | Medium |
| **D** | Client responsiveness | 4 to 6 days | Perceived load | Low to medium |

**Workstream A is the single best first move.** It is almost entirely deletion, it needs no new API surface, and on the measured numbers it removes about two thirds of the bytes on the hottest query and restores the cheap blob path on the two most expensive panels.

## Global rules for every workstream

1. **Parity before performance.** Build the harness first (step 0 below). No workstream merges without a green parity run.
2. **One kill switch per workstream**, registered in `src/adminSettingsRegistry.js`, defaulting to the **new** path once verified, and restoring the old path when set.
3. **Measure before and after** with the same script and record both numbers in that workstream's PR description and in the feature changelog.
4. **Do not change a formula.** If parity fails, the new path is wrong until proven otherwise.
5. **Mobile in the same change set** per `.cursor/rules/mobile-ui-shell.mdc`.
6. **PRD bump per ship** per `.cursor/rules/google-apps-script-core.mdc`: `docs/FOS-Dashboard-PRD.md` header, version line, section 13 changelog row, `FOS_PRD_VERSION`, `FOS_RELEASE_DESCRIPTION`, and the header line in **every** `src/*` file.

## Step 0: Parity and measurement harness (prerequisite, ~0.5 day)

Nothing else starts until this exists.

**New file:** `src/perfParityDiagnostics.js`

```javascript
// _diag_comparePerfParity('utilization', '2026-05-26', '2026-08-24')
// Runs the current builder and the candidate builder over the same range,
// deep-compares KPI/aggregate leaf numbers, and reports diffs above tolerance.
function _diag_comparePerfParity(panelKey, startIso, endIso) { /* ... */ }

// _diag_measurePanelLoad('utilization', '2026-05-26', '2026-08-24')
// Returns { elapsedMs, httpCalls, bytesReceived, rowsFetched, payloadBytes }.
function _diag_measurePanelLoad(panelKey, startIso, endIso) { /* ... */ }
```

**Tolerances:** currency to `0.01`, hours to `0.01`, percentages to `0.1`. Counts must match exactly. Any leaf outside tolerance fails the run and prints the JSON path.

**Fixture ranges** (cover a quarter boundary, a partial week, and an empty window):

| Fixture | Range | Why |
| --- | --- | --- |
| `default-90d` | rolling 90 days | The default Utilization window, ~9,500 rows |
| `q2-2026` | 2026-04-01 to 2026-06-30 | Quarter boundary and month rollups |
| `single-week` | 2026-08-17 to 2026-08-24 | Partial-week edges |
| `empty` | 2020-01-01 to 2020-01-08 | Zero-row rendering |

**Where results live (changed in 3.9.3).** Batch entry points write their JSON to **`fos_perf_runs`** (migration `048`) as well as the log, so a later workstream can be compared against the workstream A baseline with a query rather than a file kept in sync by hand.

The harness runs inside Apps Script and `clasp run` is **not** available on this project. It needs a linked standard GCP project plus a private Desktop OAuth client, and its `--use-project-scopes` flow expects explicit `oauthScopes` in `appsscript.json`. This manifest has none, and adding them would re-trigger the consent screen for every Web App user. Persisting to Postgres sidesteps all of that.

**To verify a workstream:** run **`_diag_verifyWorkstreamA()`** from the Apps Script editor, then read the results:

```sql
select run_id, kind, label, passed, prd_version, captured_at
from fos_perf_runs order by captured_at desc limit 10;
```

Batch entry points stop at **4.5 minutes** and return `complete: false` with the panels they skipped. A full baseline is 17 panel loads and does not fit in one 6-minute execution, so scope it: `_diag_capturePerfBaseline(['utilization'])`.

---

## Workstream A: Stop over-fetching and stop drifting

**Goal:** remove wasted bytes and restore the cheap blob path. No new query patterns, no new API surface.

**Ship as:** PATCH (for example 3.9.2).
**Kill switch:** `PERF_USE_NORMALIZED_LABOR_COLS` (default `true` after verification; `false` restores `fibery_payload_json` parsing).

### A1. Stop selecting `fibery_payload_json` (no migration needed)

The blob is about 6.4 MB of the ~10 MB of JSON pulled for a 90-day window and is `JSON.parse`d once per row in GAS.

**The original plan here was wrong and the simpler answer is better.** This section first proposed a migration to normalize a cost amount, a user role, and a user company out of the blob. Querying the blob showed there is nothing to normalize.

Across all 22,343 mirrored rows the blob holds exactly **13 keys**, present on every row, and each duplicates a typed column already in the select:

`Billable`, `Clockify Hours`, `End Date Time`, `Project ID`, `Seconds`, `Start Date Time`, `Task`, `Task ID`, `Time Entry Project Name`, `Time Entry Status`, `Time Entry User Name`, `Time Log ID`, `User ID` (all `Agreement Management/`-prefixed).

The keys that would actually change a number are on **zero** rows: `Agreement Management/Cost`, `Cost`, the role keys, `Clockify User Company`, `Clockify User` (work status), `Agreement`, and `Customer`. Those lookups already fall through to the `fos_clockify_users` and `fos_team_member_roles` dimension maps.

**Every remaining fallback was checked for equivalence, not assumed:**

| Mapper fallback | Finding | Result after dropping the blob |
| --- | --- | --- |
| `hours` from blob when `clockify_hours` is null | 155 rows are null; on all 155 the blob value is JSON `null` and `seconds` is `0` | `Number(null)` is `0` today; `0/3600` is `0` after. Same |
| `time_entry_user_name` vs blob user name | **0 mismatches** across 22,343 rows | Same |
| `start_date_time`, `end_date_time` | Typed columns never null; string forms identical | Same |
| `user_id`, `project_id` | Typed columns never null | Same |
| `customerNameFromFiberyLaborPayload_(p)` | Reads `Agreement` / `Customer`, absent on all rows, so it already returns null | Same |

The fix is therefore a select-list change, not a schema change. No migration, no backfill, no trigger edit, and no window where mirrored rows and normalized columns can disagree.

**Code changes (all behind `PERF_USE_NORMALIZED_LABOR_COLS`):**

| File | Change |
| --- | --- |
| `src/fiberyUtilizationDashboard.js` `fetchFosLaborCostsByRange_` | Drop `fibery_payload_json` from `selectCols` |
| `src/supabasePanelBuilders.js` `fetchLaborCostsForAgreementFromSupabase_` | Drop `fibery_payload_json`, add `time_entry_user_name` |
| `src/supabasePanelBuilders.js` `mapFosLaborCostRowToDeliveryPnlRaw_` | Prefer `row.time_entry_user_name`; leave the blob lookup as the revert path |

Both mappers keep their blob lookups so that flipping the switch to `false` restores byte-identical behavior. With the switch on, `p` is simply an empty object.

**Measured after shipping:** the 90-day labor read drops from **10 MB to 3,598 kB** of JSON (**66%**) and sheds **9,508** per-row `JSON.parse` calls. Getting under 1 MB requires Postgres-side aggregation and is Workstream B's job.

### A2. Fix the schema-version drift and make it impossible to miss

**Root cause found (2026-08-24), and it was not what this section assumed.**

The check: pull the deployed project into a temp directory and diff it against `src/`. Result: the *deployed script* was the stale artifact, not the database. `resource-assignments` went to 3 in commit `ddc61c6` on 2026-08-15, yet every hydrate through 2026-08-24 wrote 2, which is only possible if the running script still had 2. Four "Ship PRD" commits (3.7.4, 3.7.5, 3.7.6, 3.8.2) and a feature commit were committed but **never pushed to Apps Script**. The Web App served pre-3.7.4 code for nine days while git and the PRD claimed 3.8.2.

**Correcting the premise:** this was not nine days of slow panels. A script whose constants are old writes blobs its own serve path accepts, so the cheap path kept working. Degradation is a post-push window that closes at the next hydrate, about a day. The nine-day problem was an invisible deployment gap, which is worse but different.

**Consequence for the design:** a post-hydrate assertion cannot catch this. The written version and the expected version are both read from the same running script, so they agree by construction whenever the script is old. Detection must compare against git, which only something outside Apps Script can do.

1. **`scripts/check_deployed_matches_git.py` (new).** Pulls the deployed project and diffs it against `src/`. Exits 1 on any missing, extra, or differing file. **Add to the ship checklist immediately after `clasp push`** so a skipped or partial push fails loudly.
2. **Record the running version.** `supabaseSyncJob.js` stamps `scriptVersion: FOS_PRD_VERSION` into the run state, which `fos_sync_runs.summary` persists. "Which code produced this blob" becomes answerable after the fact.
3. **Drift check** in `getSupabaseSyncStatus()` comparing each stored `cache_schema_version` against its code constant, surfaced in ADMIN Settings. This is a **serve-path** check: it correctly flags the post-push window and is expected to clear at the next hydrate rather than indicating a defect.
4. **Keep `assertPanelSchemaVersionFresh_`** but scoped honestly: it catches a builder stamping a hardcoded literal the registry does not expect. It cannot catch deploy lag, and its docstring says so.
5. **Re-hydrate** utilization and resource-assignments after the Workstream A push so both blobs land at the current schema instead of waiting for the nightly run.

### A3. Apply the HTTP timeout and drop dead indexes

- `src/supabaseClient.js`: `SUPABASE_HTTP_TIMEOUT_MS_` is defined but never passed to `UrlFetchApp`. Wire it in as `timeoutSeconds` so a hung request fails fast instead of consuming the 6-minute budget.
- **Migration `047_drop_unused_indexes.sql`:** drop six indexes with zero scans over 40 days of statistics: `fos_labor_costs_fetched_at_idx` (936 kB), `fos_labor_costs_synced_at_idx` (528 kB), `fos_ai_usage_rows_email_idx`, `fos_pnl_revenue_items_revenue_idx`, `fos_revenue_items_target_date_idx`, `fos_agreement_pnl_items_month_idx`. Write-path relief for the hydrate, not a read win.

  Three larger zero-scan indexes on `public.labor_costs` (`labor_costs_project_start_idx` 1,856 kB, `labor_costs_fetched_at_idx` 912 kB, `labor_costs_project_id_idx` 552 kB) are **out of scope**: that table belongs to the Clockify sync project. Raise them with that project rather than dropping them from here.

  Also skipped: `fos_hubspot_deals_hubspot_id_uidx` (unique, guards against duplicate deal mirrors) and roughly 40 16 kB indexes on small dimension tables, where the planner correctly prefers a sequential scan and always will. Re-check `pg_stat_user_indexes` after a week before dropping anything else.

### A4. Verify

Run the parity harness on all four fixtures, then `_diag_measurePanelLoad` and compare to baseline. **Exit criteria:** parity green, 90-day labor wire bytes down at least 60% from ~10 MB, all seven stored schema versions matching after a re-hydrate, root cause of the drift documented.

---

## Workstream B: Aggregate in Postgres

**Goal:** stop shipping fact rows to Apps Script. Absorbs feature 044 phases A-D.

**Ship as:** MINOR (for example 3.10.0). May split into B1 (RPCs) and B2 (slim charts and range cache) as two releases.
**Kill switches:** `PERF_USE_UTIL_RPC`, `PERF_USE_RA_RPC`, `PERF_USE_SLIM_CHARTS`, `PERF_USE_RANGE_CACHE`.

### B1. Utilization aggregates RPC

**Migration `049_fos_rpc_util_aggregates.sql`.** One `plpgsql` function returning a single `jsonb` document containing KPIs, `byWeek`, `byCustomer`, `byProject`, `byPerson`, `byRole`, `billableMix`, and `byPersonWeek`. It must reuse `fos_labor_costs_util_dims` (migration 046, currently unqueried) for the agreement, customer, and role joins rather than re-implementing them.

```sql
create or replace function public.fos_rpc_util_aggregates(
  p_start timestamptz,
  p_end   timestamptz
) returns jsonb
language plpgsql stable
set statement_timeout = '20s'
as $$ /* full body in the migration */ $$;
```

Set an explicit `statement_timeout` so a bad range fails fast rather than burning the Apps Script budget.

**Baseline to beat:** the equivalent group-by measured **17.8 ms** warm, 2,225 ms on a cold first touch. Budget the full RPC at **under 200 ms** warm. If it exceeds that, `EXPLAIN (ANALYZE, BUFFERS)` each CTE before adding indexes; the current date index is already correct for the scan.

**Server:** add `fetchUtilAggregatesViaRpc_(startIso, endIso)` in `src/fiberyUtilizationDashboard.js` using the existing but currently uncalled `supabaseRpc_` (`src/supabaseClient.js` lines 176-178). `buildUtilizationPayloadFromFosLaborCosts_` calls it when the kill switch allows, and falls back to the row-paging builder otherwise.

**Keep `rows[]` out of the aggregate response.** The detail table paginates at 100 rows client-side; it should fetch its own page rather than riding along in the panel payload. This is what takes the utilization blob from 5,331 kB to something that fits in `sessionStorage`.

### B2. Resource assignments week grid RPC

**Migration `050_fos_rpc_ra_week_grid.sql`.** Filter allocation overlap in SQL:

```sql
where a.duration_start < p_end and a.duration_end >= p_start
```

Today `buildResourceAssignmentDashboardPayloadFromSupabase_` reads the **entire** `fos_resource_allocations` table and filters in JS with `allocationOverlapsRangeYmd_`. At 148 rows this is not itself expensive, but it is the same anti-pattern and it removes a full-table read per load.

### B3. Slim chart payloads

Add `getUtilizationChartData(start, end)`, `getAgreementChartData()`, and `getPipelineChartData()` returning **under 100 KB** each. The client fires the slim call first, paints Chart.js, then fires the full table call. This is the single biggest win for *perceived* speed and it directly serves mobile **Show charts**.

Give slim envelopes their **own** `cacheSchemaVersion` field so a chart-shape change does not invalidate full panel blobs.

### B4. Range-keyed cache

**Migration `051_fos_viz_range_payloads.sql`:**

```sql
create table if not exists public.fos_viz_range_payloads (
  panel_key            text        not null,
  range_start          date        not null,
  range_end            date        not null,
  cache_schema_version int         not null,
  payload              jsonb       not null,
  built_at             timestamptz not null default now(),
  source_watermark     timestamptz,
  primary key (panel_key, range_start, range_end, cache_schema_version)
);
```

Read-through on panel load; invalidated when hydrate advances the labor watermark. Warm the default ranges at the end of hydrate so the first user of the day does not pay the 2,225 ms cold-start penalty measured above.

### B5. Refresh semantics

Change `serveLiveAgreementFamilyOrRebuild_` so `forceRefresh` re-reads the stored blob and only rebuilds on schema mismatch or a missing row. Refresh must not rebuild the warehouse inside a user's request.

### B6. Verify

Parity on all fixtures for every RPC. Confirm via `pg_stat_statements` that the RPCs appear and that `supabaseSelectAll_` paging of labor no longer does. Re-run `_diag_measurePanelLoad`.

---

## Workstream C: Fix hydrate

**Goal:** 60 to 70 minutes and a 20% failure rate becomes under 10 minutes and alerting on failure.

**Ship as:** MINOR (for example 3.11.0).
**Kill switch:** `PERF_INCREMENTAL_AM_MIRROR`.

### C1. Use the watermarks table that already exists

`fos_sync_watermarks` is defined in migration 036 and is **never read or written**. The AM mirror re-scans every Fibery entity every night to move a handful of changed rows.

For each step in `src/supabaseAmMirror.js`, add a Fibery `q/where` on the entity's modification timestamp against the stored watermark, and advance the watermark only after the step's upserts succeed. Keep a **weekly full reconcile** (Sunday) because incremental sync cannot see deletions.

Confirm the modification field path against Fibery MCP `describe_database` before coding, per `.cursor/rules/fibery-api-fields.mdc`.

### C2. Batch the round trips

The mirror upserts in chunks of 50, one sequential `UrlFetchApp.fetch` each. Raise `AM_MIRROR_UPSERT_CHUNK_SIZE_` toward 500 (PostgREST handles it comfortably at this row count) and use `UrlFetchApp.fetchAll` for independent upserts. `fetchAll` is currently used **nowhere in the codebase** and is the main lever for parallelism inside a single Apps Script execution.

### C3. Alert on failure

2 of the last 10 nightly runs failed silently. On a failed run, write the failure through the existing `notificationJobs.js` path so an ADMIN is told. Surface last run status and duration in the Settings Datastore health block.

### C4. Resume instead of restart

Both observed failures were transient Fibery fetch errors that aborted the run with `datasets_done: 0`. Add bounded retry with backoff per step, and on permanent failure resume from the failed step on the next trigger rather than restarting the dataset.

### C5. Verify

Run a hydrate with no upstream changes and confirm under 10 minutes. Force a step failure and confirm the failed status, the ADMIN notification, and a resuming retry. Confirm the weekly reconcile catches a deletion made directly in Fibery.

---

## Workstream D: Client responsiveness

**Goal:** cut shell weight and stop blocking the main thread.

**Ship as:** MINOR (for example 3.12.0).
**Kill switch:** `PERF_LAZY_PANEL_MARKUP`.

### D1. Get the images out of the HTML

About 130 KB of base64 ships in every response, and the hero uses `decoding="sync"`, which blocks paint. The favicon already solves this: `src/faviconAsset.js` mirrors bytes to Drive once and serves an HTTPS URL because Apps Script rejects `data:` URLs for `setFaviconUrl`.

Apply the same pattern to the hero and the logo: mirror to Drive on first use, cache the file id in Script Properties, and emit a URL. Change `decoding="sync"` to `decoding="async"` and add `loading="lazy"` on the hero. **Saves ~130 KB per load and unblocks first paint.** This is the cheapest item in the whole plan.

### D2. Reduce shell weight

`src/DashboardShell.html` is 1,446,967 bytes with every panel's markup inline. Two options, in order of preference:

1. **Split panel markup into `include()` fragments** and inject only the active panel's markup on demand. This is the real fix and it also makes the file maintainable.
2. If splitting proves too invasive for one release, at minimum move the largest rarely-used panels (Engagement Review, Admin Settings, Ask AI) behind lazy includes.

Target: **at least 40% smaller** served HTML.

### D3. Survive the sessionStorage quota

The utilization payload at 5,331 kB exceeds the ~5 MB quota, so the write fails silently and only the in-memory copy survives; every new tab refetches. Workstream B3 should shrink the payload enough to fit, but add **IndexedDB** as the store for payloads over ~2 MB regardless, so the fix does not depend on payload size staying small.

### D4. Chunk the heavy renders

The utilization heatmap builds up to ~1,200 cells and the resource-assignment grid is unbounded. Build rows into a `DocumentFragment` in batches across `requestAnimationFrame` so no single task exceeds 200 ms, and render only visible rows for the RA grid.

### D5. Skeletons instead of zeroed layouts

Panels currently render an empty zeroed payload while loading, which reads as "no data" rather than "loading". Replace with skeleton placeholders sized to the real layout.

### D6. Verify

Measure served HTML size against baseline. Profile heatmap and RA renders in DevTools and confirm no long task over 200 ms. Confirm the new-tab case does not refetch. Verify all of it at ~390px per the mobile rule.

---

## Sequencing and rollout

```
Step 0  Parity harness + baseline          [0.5 day]  <- blocks everything
  |
  A     Over-fetch + drift + timeout        [1-2 days] -> ship PATCH, observe 1 week
  |
  B     Postgres aggregation + slim charts  [5-8 days] -> ship MINOR (may split B1 / B2)
  |
  C     Hydrate incremental + alerting      [3-4 days] -> ship MINOR
  |
  D     Client weight + render              [4-6 days] -> ship MINOR
```

C and D are independent of each other and of B once A is in, so they can run in parallel if there are two people. **A must be first** in all cases, because it changes the byte counts every later measurement is compared against.

## Success metrics

Recorded in `docs/features/047-baseline-measurements.json` before, and re-measured after each workstream.

| Metric | Baseline (measured 2026-08-24) | Target | Workstream |
| --- | --- | --- | --- |
| Utilization 90-day wire bytes | ~10 MB | 3,598 kB in A; under 1 MB in B | A, B |
| Utilization panel blob size | 5,331 kB | under 1,000 kB | B |
| Utilization Live load, warm | seconds to tens of seconds | under 2 s | A + B |
| Labor round trips per load | 10 sequential pages | 1 | B |
| Panels with drifted schema version | 2 of 7 | 0 | A |
| Nightly hydrate duration | 60 to 70 min | under 10 min | C |
| Nightly hydrate failure rate | 2 of 10 runs | under 1 in 30, alerted | C |
| Served HTML size | 1,446,967 bytes | under 870,000 bytes | D |
| Longest render task | unmeasured, suspected over 500 ms | under 200 ms | D |

## Risks and mitigations

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Dropping `fibery_payload_json` changes cost or attribution | Low | Analysis shows the blob carries none of the keys the mappers read; parity harness compares totals to the cent per fixture; `PERF_USE_NORMALIZED_LABOR_COLS=false` restores blob parsing |
| RPC results diverge from GAS math on edge weeks | Medium | Parity harness with a partial-week and a quarter-boundary fixture; ship behind a kill switch |
| Incremental mirror misses Fibery deletions | High if unmitigated | Weekly full reconcile; the watermark only governs the nightly path |
| Splitting `DashboardShell.html` breaks a panel | Medium | Split one panel at a time; each split is its own commit with a mobile check |
| Cold-start latency masks a real regression | Medium | Always measure warm; warm default ranges at end of hydrate |
| Deploy lag is the true cause of schema drift | Medium | A2 requires root-causing before any workaround, because it would affect every future release |

## Open questions for review

1. **Feature 044:** re-scope task [40839335](https://win.godeap.io/app/tasks/40839335) to 047 and close the 044 notebooks, or keep 044 as the Workstream B sub-release? Recommendation: re-scope to 047.
2. **Workstream A alone** removes most of the wasted bytes for one to two days of work. Ship it on its own first and re-measure before committing to B, or approve the full program now?
3. **`DashboardShell.html` splitting (D2)** is the highest-effort item and touches every panel. Worth doing properly, or limit this release to the image and render fixes and treat the split as its own feature?
4. **Detail-table rows out of the panel payload (B1):** acceptable for the utilization detail table to fetch its own page on demand, given it already paginates at 100 rows client-side?

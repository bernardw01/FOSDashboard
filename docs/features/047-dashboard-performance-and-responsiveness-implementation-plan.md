# Feature 047 - Implementation plan (Dashboard performance and responsiveness)

> **Spec:** [047-dashboard-performance-and-responsiveness.md](047-dashboard-performance-and-responsiveness.md)
> **Teamwork notebook:** [Feature 047 - Implementation plan (Performance)](https://win.godeap.io/app/projects/1615262/notebooks/313458)  
> **Feature notebook:** [Feature 047 - Dashboard performance and responsiveness](https://win.godeap.io/app/projects/1615262/notebooks/313457)  
> **Release task:** [Feature 047 - Dashboard performance and responsiveness](https://win.godeap.io/app/tasks/40839335)
>
> **PRD version:** 3.14.0. Each workstream ships its own version bump.
> **Status:** Approved 2026-08-24. **Workstream A shipped in 3.9.2. B1 shipped in 3.10.0 / 3.10.1. B2 shipped in 3.11.0 with its kill switch off pending a parity run. B3 shipped in 3.12.0 with both kill switches off pending `_diag_verifyCodec_HeatmapWeeks()`. B4 shipped in 3.13.0 with its kill switch off pending `_diag_verifyWorkstreamB4()`. B5 shipped in 3.14.0 with its kill switch off pending `_diag_verifyWorkstreamB5()`.** B1 RPC, C, D pending.

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
| `default-window` | rolling default (60 days) | The default Utilization window, ~6,200 rows. Derived from the clock, so the two arms see bounds a few seconds apart; the walk tolerates ISO drift under `PERF_PARITY_CLOCK_TOLERANCE_MS_` for this fixture only and reports it under `tolerated`. |
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

**Measured after shipping:** the default 60-day labor read drops from **6,966 kB to 2,353 kB** of JSON (**66%**) and sheds **6,173** per-row `JSON.parse` calls; over 90 days it is 10 MB to 3,598 kB, the same 66%. Getting under 1 MB requires Postgres-side aggregation and is Workstream B's job.

**Wall clock, from two parity runs** (each measures flag off then on in one execution):

| Fixture | Flag off, run 1 / run 2 | Flag on, run 1 / run 2 | Speedup |
| --- | --- | --- | --- |
| `default-window` | 7,516 / 4,773 ms | **2,789 / 2,777 ms** | **2.7x / 1.7x** |
| `q2-2026` | 4,292 / 3,972 ms | 3,351 / 3,679 ms | 1.3x / 1.1x |
| `single-week` | 1,192 / 1,302 ms | 1,134 / 1,329 ms | none |
| `empty` | 1,031 / 1,311 ms | 1,056 / 1,272 ms | none |

Two things worth reading off this. The saving tracks row count, as a per-row parse should: real on the default window, marginal on a quarter, absent on a single week and an empty range. And the flag-on path is **stable across runs** (2,789 then 2,777 ms) while the flag-off path swings by 2.7 seconds, which is what shipping 6,966 kB over a shared network looks like. The honest claim is that the default window goes from **variable 5 to 7.5 seconds down to a consistent 2.8 seconds**, not a single fixed multiple.

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

Run `_diag_verifyWorkstreamA()` from the Apps Script editor; it does all four parity fixtures plus a Utilization baseline in one execution and writes both to `fos_perf_runs`. **Exit criteria:** parity green, default-window labor wire bytes down at least 60%, all seven stored schema versions matching after a re-hydrate, root cause of the drift documented.

**Result (2026-08-24).** On 3.9.3 the three explicit fixtures were green with zero diffs, and `default-window` reported four diffs that were all `range.start/end` and `dataWindow.start/end` differing by the 7 seconds between the two arms, because that window is derived from `new Date()` inside the builder. A harness artifact, not a data regression; the fix was to tolerate bounded ISO drift on derived-window fixtures rather than to loosen the comparison generally.

On 3.9.4 all four fixtures pass with **zero diffs**, and the tolerance is confirmed to be narrowly scoped: **4 tolerated leaves on `default-window` and 0 on every explicit fixture**, so it is not quietly absorbing anything elsewhere. Bytes and wall clock are above.

---

## Workstream B: Aggregate in Postgres

**Goal:** stop shipping fact rows to Apps Script. Absorbs feature 044 phases A-D.

**Ship as:** MINOR (for example 3.10.0). May split into B1 (RPCs) and B2 (slim charts and range cache) as two releases.
**Kill switches:** `PERF_USE_UTIL_RPC`, `PERF_USE_RA_RPC`, `PERF_USE_SLIM_CHARTS`, `PERF_USE_RANGE_CACHE`.

> **Resequenced during implementation.** B1 below assumed the payload could stop
> carrying `rows[]`. It cannot, at least not yet: the client filters and
> re-aggregates those rows in the browser, so removing them breaks Operations
> rather than speeding it up. B1 was therefore split. **B1a/B1b shipped first as
> v3.10.0**, slimming the row payload in place with no parity risk: eight dead or
> derivable fields removed, rows sent as positional arrays, and repeating strings
> dictionary-encoded, together **80.6 percent** off the rows array, verified
> lossless at zero diffs over 6,042 rows. The RPC described below is still worth
> doing, but it is now an aggregate-side optimization rather than the thing that
> makes the payload fit in `sessionStorage`, which the codec already achieved.
>
> **Migration numbers shifted, then settled.** `049` was consumed by the
> `fos_perf_runs.kind` constraint fix. An earlier revision of this plan then
> moved the RPC migrations to `050` and `051` while still listing `051` for the
> range-cache table as well, so `051` was claimed twice. Resolved at B2's ship
> by numbering in the order the migrations are actually applied:
>
> | Migration | Scope | State |
> | --- | --- | --- |
> | **`050_fos_rpc_ra_week_grid.sql`** | B2 resource assignments week grid | **Applied 2026-08-24** |
> | **`051_fos_viz_range_payloads.sql`** | B4 range-keyed cache table and RPCs | **Applied 2026-08-25** |
> | `052_fos_rpc_util_aggregates.sql` | B1 utilization aggregates RPC | Pending |
>
> **Renumbered again at B4's ship, and for the same reason as last time:** number in
> the order migrations are actually applied, not the order the plan lists sections.
> B4 shipped before the B1 aggregates RPC, so B4 took `051` and the aggregates RPC
> moves to `052`. Nothing outside this table referenced either number.

### B1. Utilization aggregates RPC

**Migration `052_fos_rpc_util_aggregates.sql`** (renumbered from `051`, which B4 took at ship). One `plpgsql` function returning a single `jsonb` document containing KPIs, `byWeek`, `byCustomer`, `byProject`, `byPerson`, `byRole`, `billableMix`, and `byPersonWeek`. It must reuse `fos_labor_costs_util_dims` (migration 046, currently unqueried) for the agreement, customer, and role joins rather than re-implementing them.

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

**`rows[]` stays for now.** The original plan dropped it from the response, but the client filters and re-aggregates those rows in the browser, so removing them changes behavior rather than just size. The v3.10.0 codec already brought the payload under the `sessionStorage` quota, which was the real objective. Serving the detail table its own page remains a sound idea, but it is a client-architecture change and should be scoped on its own rather than smuggled into an RPC release.

### B2. Resource assignments week grid RPC (shipped 3.11.0)

**Migration `050_fos_rpc_ra_week_grid.sql`, applied 2026-08-24.**

`buildResourceAssignmentDashboardPayloadFromSupabase_` read the **entire** `fos_resource_allocations` table and filtered in JS with `allocationOverlapsRangeYmd_`. `fos_rpc_ra_week_grid(p_start date, p_end date)` now returns the overlapping allocations with their person, project, customer, and role display fields already resolved, in exactly the shape `mapFosResourceAllocationRowToRaw_` produced, so every downstream helper in `resourceAssignmentDashboard.js` is untouched and the payload shape does not change.

**The predicate this section originally proposed is wrong and was not used.**

```sql
-- proposed, and incorrect
where a.duration_start < p_end and a.duration_end >= p_start
```

That drops every allocation with no duration. `allocationOverlapsRangeYmd_` returns `true` for those, meaning they appear in **every** range. One of the 149 mirrored allocations has both bounds null, so shipping the proposed SQL would have silently changed `assignmentCount` and the week grid. It is also exclusive on the upper bound where the JS is inclusive. The migration mirrors the JS instead: null-both is always in range, a single null bound falls back to the other, `least`/`greatest` handle a reversed pair, and both ends are inclusive.

**Row order is load-bearing.** `buildResourceAssignmentAlerts_` sorts by severity then title, and `Array.prototype.sort` is stable, so ties between two `Assignment ending soon` alerts keep input order. The dimension lookups are therefore scalar subqueries rather than joins, which keeps the sequential scan's heap order, the same order an unordered PostgREST select returns. Verified: 116 of 116 matched rows in the same position. Do not add an `ORDER BY` without re-running parity.

**Measured (2026-08-24, live project `jpcbugdpdvyutlusicxa`):**

| Metric | Value |
| --- | --- |
| Allocations in table | 149 |
| Matched in default -30/+90 window | 116 |
| RPC execution time, warm | **7.5 ms** (budget 200 ms) |
| Response JSON | 66,023 chars |
| Position-for-position order match vs heap scan | 116 of 116 |

**Scope honesty.** The win is **one PostgREST round trip per panel load**, not five. Skipping `loadFosAgreementsMetaMap_`, `loadFosCompaniesMap_`, `loadFosClockifyUsersMap_`, and `loadFosTeamMemberRolesMap_` on this path saves nothing, because `aggregateResourceAssignmentLaborByProjectFromSupabase_` loads the same four dimension caches later in the same build. Removing those requires pushing the labor plan-vs-actual aggregation into SQL too, which is a separate change with real parity risk because `normalizeLaborRows_` applies threshold-driven exclusions.

**Verification:** `_diag_verifyWorkstreamB2()`. It runs all four fixtures through `_diag_comparePerfParityAllFixtures('resource-assignments')`, which flips `PERF_USE_RA_RPC` between arms, **and** tallies which path each build actually took. This matters: the builder falls back to the row scan if the RPC errors, and without the tally a failed RPC would make the harness compare the old path against itself and report a pass. A good run is `pass: true`, `armsProven: true`, and a tally of 4 RPC builds, 4 row-scan builds, 0 fallbacks.

**`PERF_USE_RA_RPC` ships `false`.** Flip it to `true` in ADMIN Settings only after that diagnostic passes.

### B3. Slim chart payloads (shipped 3.12.0)

The original text proposed `getUtilizationChartData(start, end)`, `getAgreementChartData()`, and `getPipelineChartData()`, each under **100 KB**, with the client firing the slim call first and the full table call second.

**Two of those three were wrong, and the measurement said the bytes are somewhere else.** What shipped is below.

#### Where the bytes actually are (measured 2026-08-25, live project `jpcbugdpdvyutlusicxa`)

| Panel | Stored blob | Largest keys |
| --- | --- | --- |
| `resource-assignments` | 2,789,504 | (workstream B2 / D scope) |
| `utilization` | 1,336,959 | `rows` 1,019,541 · **`aggregates` 283,333** |
| `agreement` | 766,518 | `revenueItemsByAgreement` 347,935 · `futureRevenueItems` 235,725 · `historicalRevenueItems` 110,866 |
| `pipeline` | **79,702** | `deals` 76,718 |

#### Correction 1: a slim Utilization chart endpoint cannot paint the Utilization charts

`renderUtilDashboard()` builds `globalRows = applyFilters(p.rows)` and then calls `renderUtilCustomerBar`, `renderUtilProjectBar`, `renderUtilWeeklyLine`, `renderUtilBillableStack`, `renderUtilRoleDonut`, and `renderUtilPersonBar` **on that array**. KPIs come from `computeKpisClient(globalRows)`. Every chart is a function of the filtered rows and must re-render on every filter change.

A grep for `aggregates.` across `DashboardShell.html` returns exactly one read: `aggregates.byPersonWeek`, used by the heatmap. The six precomputed slices the server ships (`byCustomer`, `byProject`, `byPerson`, `byRole`, `byWeek`, `billableVsNonBillable`, together 10,864 chars) are read by **no** client code and no server code. They were built in v1.x for a "first paint doesn't depend on client aggregation" design that the panel no longer uses.

So `getUtilizationChartData` would have to re-implement six aggregations server-side, ship them, paint from them, and then have every one of those canvases replaced the moment the rows land or a filter moves. That is duplicated math with a real parity surface, in exchange for a first paint that is immediately thrown away. Not built.

The six dead slices were also **not deleted**, despite being provably unread by the dashboard. `buildAskPanelDataset_` clones the whole payload into Ask AI context, so `aggregates` is a compact per-customer / per-project / per-role summary an LLM uses instead of re-deriving from 6,000 rows. Deleting 10,864 chars there would degrade Ask answers to save 0.8 percent of the panel.

#### Correction 2: Pipeline is already inside the budget

The entire stored pipeline blob is **79,702** chars. `getPipelineChartData()` would return a few kB out of a payload that already fits in the 100 KB target with 20 KB to spare. Not built.

#### What shipped: the Utilization heatmap slice codec

`aggregates.byPersonWeek` is **272,469** of the 283,333 chars in `aggregates`, and it is the only slice anything reads. Measured shape: 617 entries over **76** persons and **10** weeks, so every string field repeats about eight times, and each entry repeats all 15 key names. `personId` equals `personKey` on **617 of 617** rows, and `personKey` maps 1:1 to `personName` across all 76 persons.

Encoding mirrors B1: positional tuples, plus per-field string tables for the six scalar string fields, plus index arrays for the `roles` and `customers` string arrays, plus 0/1 for the two booleans.

| Variant | Chars | Reduction | Shipped |
| --- | --- | --- | --- |
| Today (plain objects) | 272,469 | - | - |
| **Lossless: all 15 fields** | **48,654** | **82.1%** | **yes** |
| Lossy: drop the 8 fields nothing reads | 25,406 | 90.7% | no |

The lossy variant was measured and rejected. The extra 8.6 points costs the ability to say the transform is lossless, and it deletes dimensions Ask AI reads. 82.1 percent takes `aggregates` from 283,333 to **59,518** chars, inside the 100 KB target, and the whole utilization blob from 1,336,959 to about **1,113,000**.

**No `cacheSchemaVersion` moves.** The encoded envelope carries `aggregates.byPersonWeekCodec` with its own `version`, so it is self-describing: a blob or snapshot written before the codec decodes as a pass-through, and one written after decodes regardless of the panel version. Bumping `UTILIZATION_DASHBOARD_CACHE_SCHEMA_VERSION_` would force a ~71 minute re-hydrate and would make version 8 mean two different shapes depending on the flag. This is a deliberate deviation from the literal reading of `dashboard-snapshot-cache-sync.mdc`; the discriminator is the codec descriptor, not the panel version.

Kill switch **`PERF_SLIM_VIZ_AGGREGATES`**, ships **false**. Only the **encoder** is gated; the decoder always runs, so a client can always read an encoded blob it finds. Encoding happens after `buildUtilizationAlerts_` on all three builders, because the alert rules read the object form.

Verification: **`_diag_verifyCodec_HeatmapWeeks()`**. It builds `byPersonWeek` from live rows, encodes, decodes, and compares every field of every entry against the pre-encoding reference, with `roles` and `customers` compared element by element. A good result is `pass: true`, `diffCount: 0`, roughly 600 entries, `reductionPct` near 82.

#### What shipped: the Agreements slim chart endpoint

This is the one panel where the original model is right. `charts`, `sankey`, `forwardPipeline`, `customerCards`, `kpis`, and `alerts` are all precomputed server-side and read verbatim by the client (`renderAllCharts(data.charts)` and friends). Together they measure **23,469** chars against a **766,518**-char blob, so Chart.js can paint from about 3 percent of the bytes with **no** recomputation and therefore no parity surface.

`getAgreementChartData()` returns exactly those keys plus `chartCacheSchemaVersion` (**1**), which is separate from `AGREEMENT_DASHBOARD_CACHE_SCHEMA_VERSION_` so a chart-shape change never invalidates the stored panel blob.

Client wiring is deliberately narrow: cold Agreements load only, best-effort, and a slim response that arrives after `agreementRenderState.lastRenderedFetchedAt` is set is discarded. Kill switch **`PERF_USE_SLIM_CHARTS`**, ships **false**, surfaced on the navigation model so an off flag costs no round trip.

#### Defect found while tracing consumers

`fetchUtilizationFromServer` calls `writeUtilizationCache(data)` (which decodes into `utilState.payload`) and then `applyUtilPayload(data)`, which assigns the **raw encoded envelope** straight over it. Since the B1 codec shipped in 3.10.0, `applyFilters` has been reading `.length` off `{d, r}`, getting `undefined`, and returning an empty array, so every Operations KPI, chart, and detail row rendered empty after a Live fetch with no error surfaced. Present in `198b9c1` and every commit since. `applyUtilPayload` now decodes defensively; `decodeUtilPayload_` is idempotent so the cached and snapshot call sites are unaffected.

This is the same failure mode B1 caught on the server path, one call site later.

### B4. Range-keyed cache (shipped 3.13.0)

**Migration `051_fos_viz_range_payloads.sql`, applied 2026-08-25.**

#### The premise was right and the DDL was wrong

The section above proposed:

```sql
-- proposed, and not usable as written
primary key (panel_key, range_start, range_end, cache_schema_version)
-- with range_start and range_end typed `date`
```

Two measurements kill the `date` key.

| Measurement | Value | Consequence |
| --- | --- | --- |
| Labor rows sitting exactly on UTC midnight | **168 of 22,546** | Timestamps are intra-day |
| Distinct times of day in `start_date_time` | **1,163** | A day is never all-in or all-out |
| Rows between the day floor and the requested start, default window | **51 of 6,246** | A `date` key moves every KPI |

The client compounds it. `resolveRangeFromPreset()` builds every rolling preset from `new Date()`, so the default window is a millisecond-precision instant pair that never repeats. The stored panel blob shows the same thing from the other side: its window is `2026-06-26T09:53:46.331Z` to `2026-08-25T09:53:46.331Z`, which is why nothing but that one window can ever be served from it. A key on the exact instants would therefore never hit, and a key that rounded the *request* to a day would silently include or drop about 51 rows.

#### What shipped: a superset key, an exact slice

The key is the UTC-day-aligned **superset** of the request:

```
range_start = floor(requested start to UTC day)
range_end   = ceil (requested end   to UTC day)
```

The bundle holds every row in that superset. Apps Script then filters it to the exact requested instants before computing anything, which is the same re-slice `applyUtilizationRequestedRange_` has always performed on the stored blob. The window becomes cacheable and the arithmetic is untouched. Cost of the extra rows: **51 of 6,246**, about **0.8 percent**.

`normalizeLaborRows_` was checked, not assumed: it is strictly row-local, with no dedupe and no cross-row state, which is what makes normalize-then-filter equal to filter-then-normalize.

**Rows only.** A bundle stores normalized rows in the B1 wire encoding and nothing derived. Alerts are a function of `new Date()` and every aggregate is a function of the resolved thresholds, so caching either would age or would survive an ADMIN retune. It also means the artifact is deliberately **not** payload-shaped and cannot be handed to a browser by accident, which is the same class of bug as FR-148.

#### Key design, stated in full

| Component | Why |
| --- | --- |
| `panel_key` | One table, more panels later |
| `range_start`, `range_end` | The day-aligned superset above |
| `cache_schema_version` | The bundle stores rows in the codec whose field list is tied to `UTILIZATION_DASHBOARD_CACHE_SCHEMA_VERSION_`, so a panel bump must orphan every entry. In the primary key, so it does that with no purge step |
| `key_hash` | MD5 of the whole resolved threshold object plus `PERF_USE_NORMALIZED_LABOR_COLS` |

The hash is **deliberately over-keyed**. Only `internalCompanyNames` provably reaches a stored row today, through `isInternal`; everything else feeds an aggregate that is recomputed per serve. Hashing the whole object means an ADMIN retuning any utilization knob costs one rebuild, whereas a hash that omitted a threshold which later began feeding a row would serve wrong numbers with no symptom. `PERF_SLIM_VIZ_AGGREGATES` is excluded on purpose: a bundle stores no aggregates, so the flag cannot change one.

#### Invalidation

`fos_viz_source_fingerprint()` returns the greatest `synced_at` across `fos_labor_costs`, `fos_clockify_users`, `fos_team_member_roles`, `fos_agreements`, and `fos_companies`, plus the labor row count. Measured **19.5 ms** warm, entirely from shared buffers, so no new index is needed (migration `047` dropped the `synced_at` index as unused and it stays dropped).

Three things about it are worth stating.

1. **"Last completed hydrate" would not work.** The plan says "invalidated when hydrate advances the labor watermark", but `fos_labor_costs` is written by the **Clockify sync project**, not by this repo's hydrate. On 2026-08-25 its max `synced_at` was 05:35 while this hydrate ran 08:57 to 10:04. The fingerprint has to come from the source tables.
2. **The row count is carried separately** because an upstream delete advances no `synced_at`. It is also a live signal: two reads twelve minutes apart returned 22,546 and 22,111, which is the upstream mirror rewriting rows. During a rewrite the cache correctly refuses to serve.
3. **The fingerprint is read before the row fetch**, and that value is what gets stamped on the write. If a sync lands mid-build, the new entry is stale immediately. The failure direction is a wasted rebuild, never a stale serve.

`fos_rpc_viz_range_gc(panel_key)` deletes every entry whose fingerprint is behind the live one, which is exactly the set that can never be served again. No TTL, no size cap, no guessing which windows matter.

#### One payload assembler, not two paths

`assembleUtilizationPayload_(rows, range, thresholds, now, opts)` is extracted from `buildUtilizationPayloadFromFosLaborCosts_` and is now the only place a Live utilization payload is constructed. Both the fresh build and the cache serve call it.

This is the structural fix for the failure mode that produced **FR-148** and its v3.10.0 server-side twin: two call sites handling the same payload where only one applied a transform. With one assembler there is no second key set, no second key order, and no second encoding step to keep in sync. `loadSource` is the only intentional difference (`fos_labor_costs`, `fos_viz_range_cache`, `fos_viz_range_cache_build`) and it is in the parity walk's ignore list, so it doubles as the "which path served this" signal the spec's verification step asks for.

Every non-serve outcome in `serveUtilizationFromRangeCache_` returns **null**, so a cache read error, an unresolvable range, a failed fetch, or a truncated fetch all fall through to the unchanged exact-range build. A truncated superset is refused rather than stored, because it is missing rows by definition and would poison every later request for that window.

#### Round trips and bytes

| | Uncached | Cache hit |
| --- | --- | --- |
| PostgREST round trips | **11** (7 labor pages + 4 dimension tables) | **1** |
| JSON received | **2,353 kB** labor + dimensions | **~870 kB** bundle |

The round-trip and byte figures are arithmetic from measured values (page size 1,000 against 6,195 rows in the default window; the 3.10.1 codec measurement of 843,367 bytes for 6,042 encoded rows). **Wall clock is not yet measured**; `_diag_verifyWorkstreamB4()` reports it.

#### Warming

New final hydrate dataset **`viz-warm`** -> `hydrateSupabaseVizRangeCache_()` -> `warmUtilizationRangeCache_()`.

It warms the **30, 60, and 90** day presets from a **single** labor fetch, by fetching and normalizing the widest window once and slicing the narrower bundles out of it in memory. Five separate builds would have cost roughly fifteen seconds; this costs roughly four. The 180-day and YTD presets are deliberately **not** warmed: `hydrateSupabaseUtilization_` records that a YTD-sized JSON upsert times out in Postgres, and those two options would spend the most hydrate time on the least used windows. They still populate on first use, subject to `VIZ_RANGE_CACHE_MAX_CHARS_` (3 MB), above which a bundle is simply not written and the panel builds fresh.

The step **cannot fail the hydrate**. A cache has no downstream consumer, so a warm failure is recorded as a note. Marking a 60-minute run failed because a cache did not fill would be worse than a cold cache, and would also mask the real failures workstream C is meant to alert on.

A warmed key only helps requests on the same UTC day, because the day-aligned end bound moves at UTC midnight. Accepted: a request that misses writes its own entry.

#### No schema bump, and why the B3 pattern only half applies

No panel `cacheSchemaVersion` moves, so **no re-hydrate is required** (a bump would cost roughly 71 minutes to take effect).

B3 made its codec self-describing specifically so a payload change would **not** force a re-hydrate. B4 has an envelope version too (`VIZ_RANGE_CACHE_BUNDLE_VERSION_`), but the trade is different and worth stating rather than copying: the panel version is *also* part of the primary key here, because the bundle stores rows in a codec whose field list is pinned to `UTILIZATION_DASHBOARD_CACHE_SCHEMA_VERSION_`, so a future panel bump **must** orphan every bundle. The envelope version covers changes to the wrapper around those rows, which the panel version would not catch. Two versions, two jobs, neither redundant.

#### Verification

**`_diag_verifyWorkstreamB4()`**, three arms per fixture:

1. flag off, the unchanged exact-range build
2. flag on, cold, with the entry deleted first so the superset is fetched, stored, and sliced
3. flag on, warm, the same request served from the stored bundle

Arms 2 and 3 are both compared against arm 1. Comparing only arm 3 would miss a superset-slicing bug; comparing only arm 2 would miss an encode / store / decode bug. The outcome tally is load-bearing for the same reason as B2's: every failure path falls back to the exact-range build, so without the tally a cache that never worked would compare the old path against itself and pass. A good run is `pass: true`, `armsProven: true`, `diffCount: 0` on both comparisons for all four fixtures, exactly one `miss` on each cold arm and one `hit` on each warm arm, and `warm.httpCalls` well below `baseline.httpCalls`. Results persist to `fos_perf_runs` under kind `range-cache`.

**`PERF_USE_RANGE_CACHE` ships `false`.**

#### Row order had to be made deterministic first

This was found by measuring rather than by reasoning, and it is the one production behavior change in the release.

`fetchFosLaborCostsByRange_` ordered by `start_date_time.asc` alone. On the default window, **4,736 of 5,821** rows share their timestamp with at least one other row: **865** tied timestamps, largest group **19**. The plan is an index scan feeding a **quicksort**, which is unstable, so two identical requests could already return tied rows in different positions. A cache cannot be verified against a freshly built window under those conditions, and the parity run would have failed for reasons that were not defects.

The fix is the primary key as a tiebreaker: `order: 'start_date_time.asc,clockify_time_log_id.asc'`, on both paths, in both flag states. Measured cost of the second sort key: **16.9 ms** against a roughly 2,800 ms panel build.

Stated plainly for a reviewer: this makes production row order **deterministic where it was previously arbitrary**. It can shift a row's position within a single timestamp, and with it a Top-N entry whose summed hours tie exactly. It cannot change any total. The alternative was leaving a latent nondeterminism in place and being unable to prove the cache correct, which is worse.

### B5. Reload semantics (shipped 3.14.0)

The original text was three sentences: change `serveLiveAgreementFamilyOrRebuild_` so `forceRefresh` re-reads the stored blob and only rebuilds on schema mismatch or a missing row, because Refresh must not rebuild the warehouse inside a user's request.

**This is the first workstream where the plan's proposal survived measurement.** It is directionally right and it shipped essentially as written. What measurement changed was the *product framing* and three cases the three sentences did not cover.

#### The premise, measured rather than assumed

`forceRefresh` calls `rebuildAgreementDeliveryPanelsFromTyped_`, which is the same function `hydrateSupabaseAgreement_` calls. It reads five typed tables and upserts two panel blobs.

| Table the rebuild reads | Rows | Only writer |
| --- | --- | --- |
| `fos_agreements` | 45 | `supabaseAmMirror.js` |
| `fos_companies` | 10 | `supabaseAmMirror.js` |
| `fos_company_segments` | 3 | `supabaseAmMirror.js` |
| `fos_revenue_items` | 797 | `supabaseAmMirror.js` |
| `fos_clockify_users` | 105 | `supabaseAmMirror.js` |

The mirror runs only inside the nightly hydrate, and it full-replaces: all 45 agreement rows share a `synced_at` within **6 ms**. A grep for every `supabaseUpsert_` call site in `src/` confirms no other writer exists. The hydrate then writes the panel blob **after** the mirror in the same run, at **09:51:40** against the mirror's 09:17 to 09:47.

So between hydrates the rebuild re-derives identical numbers from identical rows. Its cost, timed from the hydrate's own stamps rather than estimated:

| Step | Measured |
| --- | --- |
| Agreement payload build (`fetchedAt` 09:51:37.958 to `synced_at` 09:51:40.843) | **2,885 ms** |
| Agreement upsert plus delivery derive (to delivery `synced_at` 09:51:42.573) | **1,730 ms** |
| Delivery upsert (24,112 chars) | not separately stamped |
| Total | **about 4.6 s** over **7** PostgREST round trips |

#### The product framing was backwards

The concern going in was that a user pressing Refresh would see stale data and conclude the button was broken. Reading the client says otherwise. `applyLiveDataModeChrome_` already labels every one of these buttons **Reload**, with the tooltip *"Reload from Datastore. Does not pull Fibery; newer data arrives after ADMIN Pull from Fibery or the nightly sync."* And `formatPayloadLastRefresh_` already renders **"Reloaded: ... · Data as of ... · Datastore"** for Datastore payloads.

The stored blob's as-of time is therefore already surfaced, and the promise the button makes is already exactly Datastore semantics. The rebuild was over-delivering against its own tooltip and charging 4.6 seconds for it.

It was also **less** honest, not more: the rebuild path tags `dataAsOf` with `fresh.dataAsOf || fresh.fetchedAt`, which is the rebuild instant, so "Data as of" jumped to now even though the upstream mirror was hours old. The blob re-read reports the hydrate time the data actually came from. **No UI change was required or made**, which is also why the mobile rule has nothing new to accommodate.

#### Three cases the three sentences missed

1. **ADMIN thresholds.** `getAgreementThresholds_()` reads Script Properties, not the mirror, and feeds `computeKpis_`, `evaluateAlerts_`, `buildChartViewModels_`, `buildFinancialTable_`, and the customer order and palette. An ADMIN who retunes a knob and presses Reload gets the new numbers today. Fixed by hashing the whole resolved object into a new additive `thresholdFingerprint` field, stamped in `rebuildAgreementDeliveryPanelsFromTyped_` (the only writer of both blobs), and rebuilding on a mismatch. Over-keyed on purpose, exactly as the B4 range-cache hash is: a fingerprint that omitted a knob which later began feeding a stored field would serve wrong numbers with no symptom. An **absent** fingerprint counts as a match, so blobs written before this release stay servable for one hydrate cycle instead of making the flag useless until the next hydrate.
2. **The UTC day boundary.** The build splits revenue items on `target_date > todayIso`, and `formatDateOnlyIso_` is UTC. A blob built on an earlier UTC day classifies for that day, so Reload rebuilds when the blob's build day is not today. In practice this costs one rebuild on the first Reload after UTC midnight, because the hydrate writes today's blob before business hours.
3. **The Delivery P&L force path is deliberately untouched.** `serveLiveDeliveryPnLOrRebuildFull_` has the same `forceRefresh` shape, and the plan's wording invites changing it too. It reads **`fos_status_updates`**, which users write during the day through `upsertSupabaseStatusUpdate_`. Its max `synced_at` on 2026-08-25 was **09:34**, inside business hours and independent of the hydrate. Re-reading its stored row would hide a status update the user had just posted, which is the exact "button looks broken" failure the framing above was worried about. Only the Agreement family changed.

#### No second way to obtain a payload

Worth stating explicitly, because this is the trap that produced FR-148 and its v3.10.0 server-side twin. B5 introduces **no** new payload source. The blob-read branch of `serveLiveAgreementFamilyOrRebuild_` already existed and is already the default cold-load path; B5 only routes the forced call into it. Both branches end at the same `tagPayloadFromSupabase_`, so the client receives an identically shaped object either way.

`loadSource` deliberately stays `supabase`. B4 used `loadSource` as its which-path signal and added it to the parity ignore list, but that cannot be copied here: on this panel the client reads `loadSource` through `isDatastorePayload_` and `loadSourceFromPayload_` to choose the Reload chrome and the "Data as of" label, so a new value would change the panel header. The path is reported in additive `reloadPath` and `reloadRebuildReason` fields instead, which nothing renders.

#### No schema bump

No panel `cacheSchemaVersion` moves, so **no re-hydrate is required** (a bump would cost roughly 71 minutes to take effect and, worse here, would force every Reload to rebuild until it finished). `thresholdFingerprint` is additive and its absence is handled, which is what makes that safe.

#### Verification

**`_diag_verifyWorkstreamB5()`**, three arms per panel, run in a deliberate order because an agreement rebuild also rewrites the delivery blob:

1. `stored`, flag on, forced. Reads the blob the **hydrate** wrote, before anything in the run touches it.
2. `rebuild`, flag off, forced. Unchanged production behavior. Rewrites both blobs.
3. `reread`, flag on, forced. Reads the blob arm 2 just wrote.

`storedVsRebuild` tests the **premise** of the workstream: the stored blob already equals what a rebuild would produce. `rereadVsRebuild` tests the store-and-read round trip. Serve-time provenance keys (`dataAsOf`, `servedAt`, `supabaseSyncedAt`, `cacheDateKey`, `reloadPath`, `reloadRebuildReason`, `thresholdFingerprint`) are ignored per run rather than globally, so the other workstreams' runs still compare them.

The arm tally is load-bearing for the same reason as B2's and B4's: every non-serve outcome falls back to a rebuild, so without checking `reloadPath` per arm a flag that never took effect would compare the rebuild against itself and pass. A good run is `pass: true`, `armsProven: true`, `diffCount: 0` on both comparisons for both panels, and `rebuild.httpCalls` well above `reread.httpCalls`. Results persist to `fos_perf_runs` under kind `reload-reread`.

One caveat for whoever runs it first. `fos_sync_runs.summary` records that the 2026-08-25 08:57 hydrate ran **`scriptVersion: "3.10.0"`** while git was already several releases ahead, so today's stored blobs were built by older code than what will serve them. If `storedVsRebuild` shows diffs on the first run, check that field before concluding the premise is false; arm 2 has already rewritten both blobs with current code, so an immediate second run gives a same-code comparison.

**`PERF_RELOAD_REREADS_BLOB` ships `false`.**

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

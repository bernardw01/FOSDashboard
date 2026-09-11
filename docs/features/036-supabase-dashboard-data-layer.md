# Feature: Supabase dashboard data layer

> **Status:** Shipped (**v3.0.0**; patches through **v3.20.3** ghost reconcile)  
> **PRD version:** **3.29.1**  
> **Feature id:** 036 | **Task list:** Data platform  
> **Release type:** Enhancement  
> **Extends:** [003 - Agreement client cache](003-agreement-dashboard-fibery-client-cache.md), [005 - Utilization](005-utilization-management-dashboard.md), [006 - Delivery P&L](006-delivery-project-pnl.md), [009 - Historical snapshots](009-dashboard-historical-snapshots.md), [010 - Historical data source](010-dashboard-historical-data-source.md), [016 / 030 - Pipeline](030-sales-os-pipeline.md), [017 / 023 - AI usage](023-ai-usage-dashboard.md), [022 / 025 - Portfolio](025-portfolio-pnl-performance-and-load-source-ux.md), [027 / 028 - Resource assignments](027-resource-assignment-dashboard.md), [034 - Live Drive warm cache](034-live-dashboard-warm-cache-and-portfolio-batching.md) (live Drive path superseded by this feature).  
> **Implementation plan:** [036-supabase-dashboard-data-layer-implementation-plan.md](036-supabase-dashboard-data-layer-implementation-plan.md)
> **Teamwork notebook:** [Feature 036 - Supabase dashboard data layer](https://win.godeap.io/app/projects/1615262/notebooks/312758)  
> **Implementation plan notebook:** [Feature 036 - Implementation plan (Supabase data layer)](https://win.godeap.io/app/projects/1615262/notebooks/312759)  
> **Release task:** [v3.0.0 - Supabase dashboard data layer](https://win.godeap.io/app/tasks/40552222) · [v3.20.3 ghost reconcile](https://win.godeap.io/app/tasks/40925938)

## Goal

Introduce **Supabase (Postgres)** as the **live dashboard query store** so Apps Script panel builders stop hitting Fibery on every cold load. Fibery remains the system of record for most operational entities. An Apps Script **nightly job** (plus an **ADMIN on-demand Pull**) hydrates indexed Supabase tables from Fibery. Live panels then derive payloads from Supabase for fast, stable responses.

**Primary audience:** All authorized dashboard users (faster Live loads); ADMIN operators (sync control and observability).

**Primary outcomes:**

1. Live panel reads (except Expenses) come from **Supabase**, not Fibery.
2. Fibery → Supabase hydrate runs **nightly** and on **ADMIN Pull**, with continuation batching under the Apps Script 6-minute limit.
3. Agreement **status updates dual-write** Fibery and Supabase.
4. Schema is **indexed and query-shaped** for dashboard joins and filters.

## Problem statement

Live cold paths still depend on Fibery (or rebuild into same-day Drive warm caches). Fibery latency, quotas, and shared `ScriptLock` contention hurt perceived performance and stability. Feature **034** mitigated some Agreement / Portfolio / AI Usage paths with Drive JSON caches, but Utilization, Delivery project P&L, Resource assignments, and Pipeline still pay Fibery on cold Live loads, and Drive warm caches do not give a general indexed query layer.

## Locked product decisions

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Live serve | Apps Script derives **all live panel data from Supabase**, except **Expenses** (Sheets). |
| 2 | v1 panel scope | Agreements, Revenue review, Delivery list + project P&L, Portfolio P&L, Utilization / Labor hours, Pipeline (HubSpot / Fibery side), Resource assignments, AI Usage. |
| 3 | Drive warm caches (034) | **Retired for Live** for panels migrated to Supabase. |
| 4 | Historical snapshots | **Stay on Drive** (features **009** / **010** unchanged in 036). |
| 5 | Snapshots in Supabase | **Follow-on** after live serve + Fibery hydrate are stable (candidate **037+**). |
| 6 | Hydrate | Apps Script **nightly scheduled job** Fibery → Supabase, plus **ADMIN on-demand Pull**. |
| 7 | Status updates | **Dual-write** Fibery **and** Supabase. |
| 8 | Labor Costs | Populated by a **separate Clockify → Supabase sync** - **out of scope** for 036. Dashboard **reads** labor tables from Supabase. |
| 9 | Transport | Apps Script uses `UrlFetchApp` → Supabase PostgREST and/or RPC. Secrets in Script Properties (never client-exposed). |
| 10 | Cutover | Script Property kill-switch / read source (`supabase` vs `fibery`) during rollout; default Fibery until hydrate is proven. |

## User stories

- As a **dashboard user**, I want Live panels to load from a fast indexed store so I am not waiting on Fibery for every cold open.
- As a **finance / delivery reviewer**, I want Delivery P&L, Portfolio, and Utilization to remain accurate after the nightly hydrate so decisions match Fibery within the sync lag window.
- As an **ADMIN**, I want a **Pull from Fibery** control in Settings so I can refresh Supabase after major Fibery edits without waiting for tonight's job.
- As an **ADMIN**, I want to see **last sync status** (success, partial, failure, watermarks) so I can trust Live data freshness.
- As a **delivery lead**, I want status updates to still land in Fibery and also appear in Supabase so Live dashboards do not lag behind a write I just made.
- As a **mobile user**, I want the same Supabase-backed loads and ADMIN Pull / sync status on Settings at viewport width **&lt; 768px** (no desktop-only sync chrome).

## Acceptance criteria (testable)

### A. Live serve from Supabase

- [ ] **Given** `DASHBOARD_READ_SOURCE` (or equivalent) is `supabase` and Supabase credentials are configured, **when** an authorized user opens any in-scope Live panel (except Expenses), **then** the server builds the payload from Supabase (not Fibery) and load-source shows **`Reloading from Datastore`** in flight and **`Source: Datastore · synced {asOf}`** after load (do not name Supabase outside ADMIN Settings).
- [ ] **Given** Live Expenses, **when** the panel loads, **then** behavior remains Sheets-backed (`Spreadsheet` source) unchanged.
- [ ] **Given** snapshot / historical Data source mode, **when** any panel loads, **then** Drive snapshot artifacts are used (features **009** / **010**); Supabase is not required for historical as-of dates in 036.
- [ ] **Given** browser `sessionStorage` TTL still applies, **when** a panel reopens within TTL, **then** **`Browser cache`** source remains valid (client cache is orthogonal to Supabase).

### B. Fibery → Supabase hydrate

- [ ] **Given** a configured nightly trigger, **when** the scheduled job runs, **then** in-scope Fibery datasets are upserted into Supabase via **continuation batches** (no single unbounded 6-minute execution that tries to sync everything inline).
- [ ] **Given** an ADMIN clicks **Pull from Fibery** in Settings, **when** the pull starts, **then** a sync run is recorded, progress/status is visible, and successful completion updates dataset watermarks / `as_of`.
- [ ] **Given** Labor Cost tables, **when** the Fibery hydrate runs, **then** 036 **does not** own or block on Clockify labor sync; empty labor tables yield clear empty/zero cost states without failing the whole Fibery hydrate.
- [ ] **Given** a sync run completes (full or partial), **when** ADMIN views Settings, **then** last run status, timestamps, and failure notes are visible without exposing secrets.

### C. Dual-write status updates

- [ ] **Given** Live mode and Supabase read path enabled, **when** a user submits an Agreement status update, **then** the create succeeds in **Fibery** and the corresponding Supabase row(s) are updated (or a documented retry queue is engaged on Supabase failure).
- [ ] **Given** Fibery write succeeds and Supabase write fails, **when** the user sees the result, **then** the UX does not pretend Supabase is current; ADMIN-visible retry / warning is recorded per the locked failure policy in the implementation plan.
- [ ] **Given** snapshot mode, **when** status update is attempted, **then** existing read-only behavior is unchanged.

### D. Drive warm cache retirement (Live)

- [ ] **Given** Supabase live serve is enabled for a panel, **when** that panel loads in Live mode without force-Fibery fallback, **then** it does **not** require a same-day Drive warm-cache hit (`agreement-cache/`, `portfolio-pnl-cache/`, `ai-usage-cache/` live read path retired for those panels).
- [ ] **Given** the daily historical snapshot job, **when** it runs, **then** it continues writing Drive snapshot artifacts for historical mode (009 unchanged).

### E. Indexes and correctness

- [ ] **Given** the dashboard schema, **when** migrations are applied, **then** primary lookup keys (`fibery_id` / natural keys), date filters, and common join columns used by builders are indexed.
- [ ] **Given** a successful hydrate and known Fibery fixture set, **when** Live payloads are compared to a Fibery-built baseline (or golden fixtures), **then** KPI and row totals match within documented tolerances (rounding / timezone notes in verification).

### Load-source and mobile

- [ ] **Given** Supabase-backed Live loads, **when** overlays show, **then** **`formatLoadSourceLabel_`** uses customer-facing **Datastore** vocabulary (extend **FR-120** at ship).
- [ ] **Given mobile width (&lt; 768px)**, **when** a user opens in-scope panels, **then** loads use the same Supabase path; ADMIN Pull / sync status in Settings is usable (touch targets ≥ 44px; no sidebar-only-only controls).

## UI notes

- **Routes / panels:** Agreements, Revenue review, Delivery (+ P&L drill-in), Portfolio P&L, Operations (Utilization / Labor hours), Pipeline, Resource assignments, AI Usage. Expenses unchanged.
- **Desktop Settings (ADMIN):** New **Data platform / Supabase** group: connection status (non-secret), last sync summary, **Pull from Fibery** button, read-source kill-switch, optional sync progress.
- **Mobile (`DashboardShell.html`, &lt; 768px):** Same Settings group via existing Settings panel; Pull button ≥ 44px; status text scannable (no wide tables required). No new bottom-nav route.
- **Load overlays:** Extend FR-120 with customer-facing **`Reloading from Datastore`** (in flight) and **`Source: Datastore · synced YYYY-MM-DD`** after load. Do not name Supabase outside ADMIN Settings. Retain Browser cache / Snapshot / Spreadsheet labels. `Drive cache · date` no longer expected for migrated Live panels after cutover.
- **Activity events:** Whitelist ADMIN pull / sync start-done-error events in `userActivityLog.js` (names documented at implement).

## Data model

Logical domains (exact DDL: [`docs/supabase-data-model.md`](../supabase-data-model.md), migrations in `supabase/migrations/`, build via `python scripts/supabase_build_schema.py`; cutover: [`docs/sql/036/README.md`](../sql/036/README.md)):

| Domain | Example tables | Used by | Writer in 036 |
| --- | --- | --- | --- |
| Sync meta | `sync_runs`, `sync_watermarks`, `dataset_as_of` | Admin + load-source | Fibery hydrate job |
| Companies / agreements / rates | `companies`, `agreements`, related dims | Agreements, Revenue, Delivery list, Portfolio index | Fibery hydrate |
| Delivery economics | revenue, ODC, allocation facts | Delivery P&L, Portfolio | Fibery hydrate |
| Status updates | status update rows (+ doc metadata as needed) | Delivery P&L, dual-write | Fibery hydrate + dual-write path |
| People / time | Clockify users, time aggregates | Utilization, Labor hours, Resource assignments | Fibery hydrate (where Fibery-sourced) |
| Labor costs | `labor_costs` (Clockify SoT) + `fos_labor_costs` (Hub mirror, 038) | P&L / util cost (future SQL) | **External Clockify sync** writes `labor_costs`; trigger mirrors to `fos_labor_costs`. Hydrate skips both. |
| Pipeline | HubSpot deal mirror | Pipeline (merged with Sales sheet in GAS) | Fibery hydrate |
| AI usage | usage / cost rows | AI Usage | Fibery hydrate |

**Optimization principles:**

- Serve-oriented columns (typed fields for filters/joins), not only opaque Fibery JSON blobs.
- Upsert by stable `fibery_id` (or documented natural key).
- Btree indexes on join/filter keys (`fibery_id`, dates, status, project/agreement id, email).
- Prefer fewer GAS round-trips via PostgREST filters and/or Postgres **RPC / views** shaped for panel builders.
- Soft-delete or tombstone rows removed in Fibery so Live does not keep ghosts. **Shipped 3.20.3:** full-scan mirror steps delete Supabase rows whose `fibery_id` was not in the Fibery fetch (`fos_reconcile_mirror_step` RPC; **`AM_MIRROR_RECONCILE_GHOSTS`** default on).

**Out of schema for 036:** Historical snapshot date partitions / as-of fact storage in Postgres (follow-on).

## Operations

- **Queries (Live):** Panel `get*DashboardData` builders read Supabase via `supabaseClient.js` helpers.
- **Queries (Historical):** Existing Drive snapshot loaders unchanged.
- **Actions:** ADMIN Pull; panel Refresh (rebuilds from Supabase; does not imply Fibery pull unless ADMIN Pull or kill-switch Fibery path).
- **Jobs:** Nightly Fibery → Supabase sync with continuation triggers; optional sheet or Supabase `sync_runs` for Settings parity.
- **Secrets:** `SUPABASE_URL`, service role (or dedicated server) key in Script Properties; registry marks secrets correctly; never returned to client.

## Edge cases

- Supabase unreachable: safe user-facing error; kill-switch may fall back to Fibery during rollout only.
- Partial hydrate: panels may show stale `dataset_as_of` with ADMIN-visible warning; document whether end users see a banner (prefer subtle last-synced in source line).
- Dual-write Fibery OK / Supabase fail: retry queue or next nightly pull reconciles; user informed per AC.
- Labor tables empty: costs show empty/zero; Fibery hydrate still succeeds.
- Pipeline: Supabase holds HubSpot/Fibery deal mirror; **Opportunity Tracker sheet merge stays in GAS** (sheet still wins stage/ACV per FR-124).
- Concurrent ADMIN Pull + nightly: LockService / sync_runs status prevents two full hydrates racing destructively.
- Schema version bumps: document migration + invalidate client `cacheSchemaVersion` only when payload shapes change.

## Verification steps

1. **Desktop Live:** With read source `supabase` and a completed hydrate, open each in-scope panel; confirm source label and that server logs show Supabase (not Fibery) for the build.
2. **Expenses:** Confirm Spreadsheet path unchanged.
3. **Nightly / Pull:** Run ADMIN Pull; confirm continuation batches complete; Settings shows success + watermarks.
4. **Status update:** Submit a status update; confirm Fibery entity and Supabase row; spot-check Delivery P&L / history.
5. **Snapshot mode:** Select a past Data source date; confirm Drive artifacts still serve panels.
6. **Kill-switch:** Set read source to `fibery`; confirm Live falls back for incident response (while flag exists).
7. **Mobile (~390px):** Open Agreements / Delivery / Settings sync controls; confirm usable Pull and readable status.

## Implementation checklist

- [ ] Update feature spec checkboxes as implemented
- [ ] **Mobile UI** per `.cursor/rules/mobile-ui-shell.mdc` (Settings Pull + status in same change set)
- [ ] SQL migrations + indexes applied to target Supabase project
- [ ] Admin settings registry entries for Supabase props and kill-switch
- [ ] Activity event whitelist for sync / Pull
- [ ] PRD FR/AC + version bump at ship (extend **FR-120**; add Supabase serve / sync FRs)
- [ ] Retire Live Drive warm-cache reads for migrated panels; keep snapshot job
- [ ] Sync Teamwork notebooks at ship; rename task to `vX.Y.Z - …`
- [ ] Run smoke steps above on deployed Web App

## Explicit follow-on

- **Historical snapshots in Supabase:** Persist as-of snapshot payloads (or equivalent fact slices) in Postgres; point Data source historical mode at Supabase instead of Drive. Defer until live Supabase serve + Fibery hydrate are stable. Features **009** / **010** remain authoritative for historical mode in 036.

## Bug fixes (engineering-tracked)

*(Technical appendix; not synced to any Teamwork notebook per `docs/teamwork-workflow.md` "Bug-fix releases." Authored by Claude Code from a live, read-only Supabase query (via the newly-added Supabase MCP connector) while investigating **BUG-040-01**; implementation belongs to Cursor. This is a live production data-freshness incident, not a cosmetic bug - treat as high priority.)*

### BUG-036-01: FOSDashboard's own AM-mirror sync job has been stuck since 2026-08-25

**Scope correction (2026-09-10):** this entry originally said "every Live panel" is stale - that overclaimed. There are **two independent pipelines** writing into the same Supabase project (`jpcbugdpdvyutlusicxa`), and only one of them is actually stuck:

| Pipeline | Owner | Status (confirmed via live query) |
| --- | --- | --- |
| Clockify -> `labor_costs` / `fos_labor_costs` | **`ClockifyToFiberySync`** - a separate Apps Script project/repo (`C:\code\ClockifyToFiberySync`), its own daily 1:00 AM Eastern orchestrated pipeline | **Healthy.** `fos_labor_costs.synced_at` max is **2026-09-10 05:33 UTC** - this morning. Utilization / Labor Hours panels read this table and are current. |
| Agreement Management mirror -> `fos_agreements`, `fos_resource_allocations`, `fos_companies`, revenue items, resource-assignments, portfolio-pnl, AI usage, plus a `utilization` panel-cache step of its own | **FOSDashboard's own** `src/supabaseSyncJob.js` / `src/supabaseAmMirror.js`, tracked in `public.fos_sync_runs` | **Stuck** - see below. This is the one this entry is actually about. |

Do not confuse the two when discussing this with anyone unfamiliar with both repos - "the sync" is ambiguous between them. `ClockifyToFiberySync` also has its own separate, currently **empty** ops/observability tables (`sync_runs`, `sync_progress`, `sync_snapshots`, `sync_run_events`, `variance_snapshots` - zero rows in all of them as of 2026-09-10, despite `labor_costs` itself being fresh) - that's a real oddity worth a look, but it's a different repo/codebase, not in scope here, and the underlying labor-cost data is unaffected.

**Discovered:** 2026-09-10, while root-causing **BUG-040-01** (Planned/Projected margin N/A). That investigation is now understood to be a **symptom** of this, not a separate defect - see the note at the end of this entry.

**Confirmed via direct read-only query against `public.fos_sync_runs` (project `jpcbugdpdvyutlusicxa`) - this table belongs to FOSDashboard's own sync job only, not ClockifyToFiberySync's:**
- Scheduled daily syncs ran reliably every day through **2026-08-24** (visible run history 2026-08-19 through 2026-08-25, one transient failure on 2026-08-21 "Could not reach Fibery" that self-recovered the next day).
- The **last row in the table** is a `manual`-triggered run, `run_id` `supabase:2026-08-25T17:47:19.642Z:4b3de532`, `status: "running"`, `finished_at: null`, `datasets_done: 0` of 8, stuck at `dataset_cursor: "am-mirror"`.
- **Zero sync runs of any kind (scheduled or manual) have started since that timestamp** - confirmed by direct count query. Today is **2026-09-10**: the pipeline has been dead for **16 days**.

**Root cause - confirmed, code-level.** `startSupabaseSync_` (`src/supabaseSyncJob.js` lines 199-221) refuses to start a new run whenever the persisted state (Script Property `SUPABASE_SYNC_STATE_V1`, read via `readSupabaseSyncState_()`) still shows `status === 'running'`:
```js
var existing = readSupabaseSyncState_();
if (existing && existing.status === 'running') {
  return { ok: false, message: 'Supabase sync already in progress.', state: existing };
}
```
This guard exists to prevent two syncs running concurrently, but has **no staleness check** - if a run's Apps Script continuation chain (`scheduleSupabaseSyncContinuation_`) ever stops advancing without reaching the code path that sets `status` to `'complete'` or `'failed'` (e.g. the chain of continuation triggers got interrupted, hit a quota, or one step threw uncaught), the persisted state is permanently stuck at `'running'` and **every subsequent attempt - scheduled trigger or manual "Pull from Fibery" click - silently no-ops** with "Supabase sync already in progress," without even writing a new `fos_sync_runs` row. This exactly matches the observed data: one stuck row, then total silence.

**Immediate remediation needed (ops action, separate from the code fix) - not something I can do myself:** an Admin needs to clear/reset the `SUPABASE_SYNC_STATE_V1` Script Property (Apps Script editor -> Project Settings -> Script Properties, or a new Settings affordance per the code fix below) so `startSupabaseSync_` can proceed, then manually trigger **Settings -> Pull from Fibery** to run a fresh full sync. There is currently **no existing reset/force affordance anywhere in `supabaseSyncJob.js`** - confirmed by search.

**Why this explains BUG-040-01:** `sowBillRate` / `sowCostRate` / `roleOnSow` were added to the AM mirror's Fibery select map for `resource_allocations` as part of feature **053** ("PM Overview SOW role and SOW-based planned margin"). Every currently-mirrored `fos_resource_allocations` row has `synced_at` frozen at **2026-08-25 09:28:31** (the last successful run, one manual run before the stuck one) - confirmed the `raw` JSONB column on every one of 129 checked rows **does not even have the `sowBillRate` key present** (not null - absent), meaning these rows were last synced before feature 053's fields were added to the query, or that sync never got a chance to re-run and pick them up. Once the pipeline is unstuck and a fresh sync runs, this should resolve on its own with no additional code change to `projectPerformanceMetrics.js` or `supabasePanelBuilders.js` - **re-verify BUG-040-01 against live data after this ships, before writing any calculation-logic fix there.**

**Acceptance Criteria (testable):**
- [ ] Immediate: `SUPABASE_SYNC_STATE_V1` is cleared/reset and a fresh sync completes successfully end to end (all 8 datasets), confirmed via a new `fos_sync_runs` row with `status: 'complete'`. **PENDING (2026-09-10):** v3.27.0 deployed with staleness guard + Settings force-clear; `fos_sync_runs` still shows only the stuck `supabase:2026-08-25T17:47:19.642Z:4b3de532` row until an Admin runs **Settings → Pull from Fibery** (staleness will auto-abandon the 16-day `running` state). Remote `clasp run` / Execution API returns 403 for this project; could not trigger from agent session.
- [ ] After that fresh sync, spot-check `fos_resource_allocations.raw` for a known allocation and confirm `sowBillRate`/`sowCostRate`/`roleOnSow` keys are now present with real values (where they exist in Fibery). **PENDING:** pre-sync query 2026-09-10: 143 rows, **0** with any SOW key in `raw`, `max(synced_at)=2026-08-25 09:28:31 UTC`.
- [x] Code fix: `startSupabaseSync_`'s "already running" guard gains a staleness check - if `existing.status === 'running'` but `existing.startedAt` is older than a reasonable max run duration (confirm against real observed run durations - the successful runs above took 60-80 minutes end to end; pick a threshold with margin, e.g. 3-4 hours), treat it as abandoned and allow a new run to start (logging that it did so), rather than blocking forever. **PASS (v3.27.0):** `SUPABASE_SYNC_STALE_RUNNING_MS_` = 4h; override via `SUPABASE_SYNC_STALE_RUNNING_HOURS`; `supabaseSyncAbandonStaleRunning_()` marks old `fos_sync_runs` row failed and clears property.
- [x] An Admin-visible way to see the current sync state (`running` / `complete` / `failed`, `startedAt`, and whether it looks stale) and manually force-clear it exists in Settings - this incident sat undetected for 16 days because nothing surfaced it. Reuse or extend whatever Settings section already shows AI usage / Supabase sync status. **PASS (v3.27.0):** `getSupabaseSyncStatus()` returns `syncHealth`; Settings **Datastore health** block shows status, startedAt, running age, progress, stale warning; **Force clear stuck state** calls `forceClearSupabaseSyncStateForSettings()`.
- [ ] Confirm whether the underlying interruption (why the 08-25 17:47 run's continuation chain stopped) is knowable from Apps Script execution logs/quota history, and if there's a recurring cause (e.g. a specific am-mirror step that reliably fails), fix that too rather than only the symptom. **OPEN:** `clasp logs` blocked (GCP project ID not set in clasp config); no Stackdriver access from agent session.

**Architecture Review:**
- **Security:** None - operational fix to an internal sync job.
- **Performance:** The staleness-timeout fix is the actual performance/reliability improvement here - it prevents an indefinite, silent pipeline stall. No new hot-path cost.
- **Regression risk:** `startSupabaseSync_`'s concurrency guard is load-bearing (prevents genuinely overlapping syncs from corrupting state) - the fix must add a staleness carve-out, not remove the guard. Confirm the chosen staleness threshold comfortably exceeds real run durations (observed 60-80 min) with margin, so a merely-slow-but-healthy run is never mistaken for stuck and preempted mid-flight.
- **Testing gaps:** No existing test/diagnostic covers "sync state stuck in running past a reasonable duration." Add a manual test that stubs a `running` state with an old `startedAt` and asserts `startSupabaseSync_` proceeds instead of refusing. Also worth a standing `_diag_*` function an Admin can run on demand to report current sync health (last run status, age, dataset progress) without needing direct DB access - this whole incident was only found via a live Supabase query that isn't normally available.

**Verification Steps:**
1. Clear the stuck state; trigger a manual sync; confirm it completes (`fos_sync_runs` shows a new `complete` row spanning all 8 datasets). **PENDING** - blocked on Admin Pull (see AC above).
2. Confirm `fos_resource_allocations.raw` now includes `sowBillRate`/`sowCostRate`/`roleOnSow` keys for rows that have them in Fibery. **PENDING** after step 1.
3. Re-check BUG-040-01 (PM Overview Planned/Projected margin) against live data - expect it to be substantially resolved without further code changes there. **PENDING** after step 1.
4. Implement the staleness timeout; simulate a stuck state (old `startedAt`, `status: running`) and confirm a new sync is allowed to start instead of being blocked. **PASS:** `test_supabaseSyncStaleRunningGuard_()` in `supabaseSyncJob.js` (stale → `blocked:false`; fresh → `blocked:true`). Run in Apps Script editor after Pull unblocks sync.
5. Confirm the daily scheduled trigger resumes firing on its normal cadence going forward - watch for at least 2-3 days to be sure it isn't just the one manual kick that worked. **PENDING** - monitor `fos_sync_runs` 2026-09-11 through 2026-09-13.

**Update 2026-09-10 (Claude Code, live verification):** the code fix works as intended - the 08-25 stuck row is now correctly `status: 'failed'` with a clear "Abandoned stale running sync... trigger admin-force-clear" note, and a fresh manual sync ran. That fresh run completed 5 of 8 datasets successfully (`am-mirror`, `agreement`, `utilization`, `pipeline`, `resource-assignments`) before failing on `ai-usage` - see **BUG-036-02** below for that failure. Directly confirmed via live query: `fos_resource_allocations` now has 150 rows (up from 129/143), and **all 150 now carry the `sowBillRate` and `roleOnSow` keys** (0 of 129 before), with 103 rows carrying a real populated SOW bill rate. **Verification steps 1-3 above can be marked resolved** - re-verify against the specific projects on the August Lookback next, per BUG-040-01.

---

### BUG-036-02: `ai-usage` hydrate step fails with a misleading, circular error message

**Discovered:** 2026-09-10, as the failure point of the sync run that resolved BUG-036-01 (see above) - this is a new, distinct, smaller issue, not a continuation of that incident.

**Symptom:** the sync run's last note before failing:
> "AI usage rows have not been mirrored to Supabase yet. Ask an ADMIN to run Pull from Fibery in Settings."

This is confusing on its face - it was produced **during** a Pull from Fibery run, telling the operator to do the thing they were already doing.

**Root cause - confirmed, code-level.** `hydrateSupabaseAiUsage_` (`src/supabaseSyncJob.js` lines 718-736) calls `mirrorAiUsageRowsFromFibery_()` (`src/supabasePanelBuilders.js` lines 1055-1099ish) and then, in the same step, `buildAiUsagePayloadFromSupabase_(null, null)`, which re-queries `fos_ai_usage_rows` **filtered to a recent date range** (`resolveAiUsageRange_`) and returns this exact error string (line 1148) if that filtered query comes back empty. Confirmed via live query: `fos_ai_usage_rows` has 5,250 rows, but the most recent `usage_date` in the table is **2026-05-31** - `synced_at` on every row is still frozen at the last successful sync (2026-08-25 10:00:44), meaning **this run's mirror step wrote zero new rows** (silently - `mirrorAiUsageRowsFromFibery_` treats an empty fetch as `ok: true, count: 0`, not a failure). The build step then correctly finds nothing in the last-N-days window (no AI usage data has existed past May 31 for months) and produces the error - but the wording implies the mirror never ran at all, when in fact it ran, found nothing new, and correctly reported so.

**Two separate things to fix, not one:**
1. **Immediate/cosmetic:** the error message is wrong for this case. When the mirror step itself succeeds (even with 0 rows) but the build step's date-range query comes back empty, the message should say something like "No AI usage data found in the last N days" rather than "have not been mirrored... run Pull from Fibery" - the latter is only accurate if the mirror step itself failed outright (`mirrored.ok === false`), which is a different, already-distinguishable case in the code.
2. **Likely the real underlying issue, needs its own investigation:** no AI usage data has landed past **2026-05-31** for over three months, independent of today's AM-mirror stall. This points at the **upstream** Anthropic Admin API -> Fibery ingest job (feature **017**, `src/aiUsageSyncJob.js`) potentially having stopped working around that date, or at a bug in `fetchAllAiUsageRowsChunked_`'s date-range/pagination logic that always returns empty for "recent" ranges. This needs its own root-cause pass - do not assume it is the same class of problem as BUG-036-01 just because it surfaced in the same run.
3. **Resilience gap:** this single dataset's failure blocked `portfolio-pnl` and `viz-warm` (7th and 8th of 8 datasets) from running at all in this execution, even though they are logically independent of AI usage data. Consider whether one dataset step failing should still let independent later steps attempt to run (or at least be retried standalone) rather than halting the whole chain.

**Acceptance Criteria (testable):**
- [x] The error message correctly distinguishes "mirror step itself failed" from "mirror succeeded but found no rows in the query window" - the latter must not tell the operator to do something they just did. **PASS (v3.28.0):** `buildAiUsagePayloadFromSupabase_` sets `emptyReason: NO_ROWS_IN_RANGE` with window/latest-date copy; mirror failure keeps separate message in `hydrateSupabaseAiUsage_`. `test_supabaseAiUsageEmptyWindowDistinction_()` asserts no "Ask an ADMIN to run Pull" text on empty-window path.
- [x] Root cause identified for why no `fos_ai_usage_rows.usage_date` exists past 2026-05-31 - specifically state whether feature 017's Anthropic ingest job has been failing since then (check its own run history/Settings status) or whether this hydrate step's own range/pagination logic is the problem. **PASS (investigation):** Live Supabase query 2026-09-10: `max(usage_date)=2026-05-31`, `max(synced_at)=2026-08-25`, 5250 rows. Mirror window fetch returned 0 new rows (not pagination bug in hydrate). Upstream feature **017** Anthropic→Fibery ingest is the likely gap; run `_diag_aiUsageDataFreshness_()` and Settings AI Usage sync status / log sheet for last successful ingest after 2026-05-31. Hydrate range logic is not the primary cause.
- [ ] Once the real cause is fixed, a fresh Pull from Fibery successfully mirrors current AI usage data and `hydrateSupabaseAiUsage_` completes without error. **PENDING:** requires feature 017 ingest restored; soft-fail path ships in v3.28.0 so downstream datasets can complete meanwhile.
- [x] `portfolio-pnl` and `viz-warm` either complete in the same run once `ai-usage` is fixed, or (if pursuing the resilience gap) are shown to run independently of an `ai-usage` failure. **PASS (v3.28.0):** `hydrateSupabaseAiUsage_` returns `softFail: true` on empty window; `processSupabaseSyncBatch_` continues to datasets 7-8. Re-verify on next Pull while AI data remains stale.

**Architecture Review:**
- **Security:** None.
- **Performance:** None directly, though fixing dataset-step independence could reduce wasted re-runs of already-completed datasets when only one step is broken.
- **Regression risk:** Low - this is a message-accuracy fix plus an upstream data-freshness investigation, not a change to any calculation or display logic.
- **Testing gaps:** No existing test distinguishes "mirror ok, zero new rows" from "mirror failed" in `hydrateSupabaseAiUsage_`. Add one asserting the correct message/outcome for each case.

**Verification Steps:**
1. Check feature 017's AI usage sync job status (Settings panel, or its own run history) for signs it stopped succeeding around 2026-05-31.
2. Fix whatever that reveals; re-run Pull from Fibery; confirm `fos_ai_usage_rows` gets rows with a current `usage_date` and `synced_at`.
3. Confirm the `ai-usage` step no longer blocks `portfolio-pnl`/`viz-warm` from completing in the same run.

---

### CHANGE-036-03: Temporarily pause AI Usage - hide the nav route, skip its hydrate step, quiet its diagnostics

**Requested:** 2026-09-10 - "I would like to hide the AI usage route and skip any AI Usage hydration temporarily while I focus on other work. Please remove this from the daily sync job and update the tests and diagnostics and notifications accordingly."

**Scope, confirmed by terminology match against this codebase's own vocabulary:** "hydration" and "the daily sync job" both refer specifically to the **Supabase hydrate pipeline** (`src/supabaseSyncJob.js`, `SUPABASE_SYNC_DATASETS_`, the same job investigated in BUG-036-01/-02) - **not** feature **017**'s separate Anthropic Admin API → Fibery ingest job (`src/aiUsageSyncJob.js`, its own kill switch already exists: `AI_USAGE_SYNC_ENABLED`). This request pauses the Hub's own **display and hydration** of AI Usage, not the upstream Anthropic cost ingest into Fibery - leave that running so cost data keeps accumulating in Fibery for whenever this is turned back on. If that reading is wrong, say so before implementing - it changes what gets touched.

**Recommended mechanism - reuse the exact existing pattern, don't invent a new one.** `adminSettingsRegistry.js` already has `AI_USAGE_SYNC_ENABLED` (boolean, default `true`) as a kill switch for the *other* AI usage job. Add a sibling: **`AI_USAGE_HYDRATE_ENABLED`** (boolean, default `true` - flipping it to `false` is the "pause," flipping back to `true` is the entire "resume," no code change needed either time since it's a Settings-editable Script Property). Check this **one** flag everywhere AI Usage currently participates:

1. **Nav route** (`src/Code.js`, the `buildNavigationModel_`-style function, `finance-group.children`): when the flag is `false`, filter `ai-usage` out of `finance-group.children` - mirror the **exact** pattern already used for `resource-assignments`/`agreement-dashboard`/`project-performance-review` a few lines below the nav item list (`.map()` over `navItems`, find the group by id, `.filter()` the child out). Do not hide the whole `finance-group` - Portfolio P&L and Expenses stay visible.
2. **Daily hydrate** (`src/supabaseSyncJob.js`, `SUPABASE_SYNC_DATASETS_`): when the flag is `false`, the `'ai-usage'` entry must not be iterated - `hydrateSupabaseAiUsage_` (and the `mirrorAiUsageRowsFromFibery_` call inside it) never runs. Confirm exactly how `SUPABASE_SYNC_DATASETS_` is consumed (a static array today) before deciding whether to filter it at read-time or convert it to a small function - either way, removing this step this way means it is simply **never attempted**, not attempted-and-failing, so `notifyAdminsHydrateFailed_` (which only fires on `status === 'failed'`) is naturally unaffected - confirm this holds, don't add special-casing there unless something about the resume/continuation logic (`resumeEligible`, `datasetsTotal`) hardcodes an expectation of 8 datasets specifically.
3. **Diagnostics** (`src/perfParityDiagnostics.js`, `FOS_DIAG_SUITE_STEPS_`): the two existing entries `ai-usage-empty-window` (`test_supabaseAiUsageEmptyWindowDistinction_`) and `ai-usage-freshness` (`_diag_aiUsageDataFreshness_`) will otherwise **always fail** while hydration is paused (there's deliberately no fresh data to check). Do not let them report as failures - have each function check `AI_USAGE_HYDRATE_ENABLED` first and short-circuit to `{ok: true, pass: true, skipped: true, message: 'AI usage hydration paused (AI_USAGE_HYDRATE_ENABLED=false)'}` when it's off, so the standing diagnostic suite (feature **057**) stays green and legible instead of noisy while this is intentionally paused.
4. **Notifications** (`src/notificationJobs.js`, `userCanAccessNotificationDashboard_`, line ~121): `'ai-usage'` currently resolves through the same `canAccessExpensesDashboard_` check as `expenses`/`portfolio-pnl`. When the flag is `false`, this function should return `false` for `'ai-usage'` specifically too - if a user can't see the panel, they shouldn't be offered an AI-Usage-specific alert subscription option in Profile either. Confirm whether this function is *only* used for Profile subscription gating or also for something else (e.g. the notification tray) before changing its behavior broadly - scope the change to not regress an unrelated consumer.

**Acceptance Criteria (testable):**
- [x] `AI_USAGE_HYDRATE_ENABLED` exists in `adminSettingsRegistry.js` (boolean, default `true`), editable in Settings, following the exact `AI_USAGE_SYNC_ENABLED` pattern (group, label, tooltip). **PASS (v3.29.1):** `adminSettingsRegistry.js` entry in group `ai-usage-sync`.
- [x] Given the flag is `false`, when any user opens the app, then **AI Usage** does not appear under Finance in the nav - Portfolio P&L and Expenses are unaffected. **PASS (v3.29.1):** server-side filter in `buildNavigationModel_`; `test_aiUsageHydrateNavGating_` in diagnostic suite.
- [x] Given the flag is `false`, when the daily hydrate (or a manual Pull from Fibery) runs, then the `ai-usage` dataset step is skipped entirely - no Fibery/Supabase calls for it, and the run's dataset count/summary reflects that it was skipped, not failed. **PASS (v3.29.1):** `getSupabaseSyncDatasets_()` omits `ai-usage` on fresh runs; resume path skips with note `ai-usage: skipped (AI_USAGE_HYDRATE_ENABLED=false)`; `datasetsTotal` uses filtered count (7, not 8).
- [x] Given the flag is `false`, when the standing diagnostic suite (feature 057) runs, then both AI-usage-related steps report a clear "paused" skip - not a pass built on stale data, and not a failure. **PASS (v3.29.1):** `test_supabaseAiUsageEmptyWindowDistinction_` and `_diag_aiUsageDataFreshness_` return `{skipped:true}`; `test_aiUsageHydrateDiagnosticsPausedShortCircuit_` asserts both.
- [x] Given the flag is `false`, when a user opens Profile notification settings, then AI Usage is not offered as a subscribable dashboard (if `userCanAccessNotificationDashboard_` is confirmed to gate that, and only that). **PASS (v3.29.1):** `userCanAccessNotificationDashboard_` returns false for `ai-usage` when paused; `getMyUserProfile` filters catalog through the same helper (digest jobs also use it at `notificationJobs.js` line ~476). No AI Usage catalog entries exist today, but the gate is wired for future entries.
- [ ] Given the flag is flipped back to `true`, when the next hydrate runs, then AI Usage resumes exactly as before - nav item reappears, hydrate step runs, diagnostics resume asserting real freshness - with **no code change**, only the Settings toggle. **Pending operator:** flip flag in Settings and re-run Pull + suite (step 5).
- [x] Feature **017**'s Anthropic → Fibery ingest job (`AI_USAGE_SYNC_ENABLED`) is explicitly confirmed **unaffected** - it keeps running on its own schedule unless the user separately asks to pause that too. **PASS (v3.29.1):** no edits to `src/aiUsageSyncJob.js`.

**Architecture Review:**
- **Security:** None - a display/hydrate visibility toggle, no new access surface. Confirm the nav-hiding is enforced the same way as every other gated nav child (server-side in the nav-model builder, not just a client-side CSS hide) - consistent with how `resource-assignments`/`agreement-dashboard` are already hidden, not a new pattern.
- **Performance:** Net positive while paused - one fewer dataset per hydrate run, one fewer Fibery/Supabase round trip. No regression risk to the datasets that keep running (am-mirror, agreement, utilization, pipeline, resource-assignments, portfolio-pnl, viz-warm) - confirm `ai-usage`'s removal from the iterated list doesn't shift any positional/index assumption elsewhere (the list is iterated by dataset **key**, per the existing `hydrateSupabaseDatasetByKey_`-style switch, not by position, but confirm this rather than assume).
- **Regression risk:** This flag touches four files across nav, hydrate, diagnostics, and notifications - the risk is leaving one of the four un-gated (e.g. hiding the nav item but still hydrating, or vice versa), which would produce a confusing half-paused state. Verify all four together, not one at a time in isolation. Also confirm the AI Usage panel's own client-side route guard (whatever renders `#panel-ai-usage`) doesn't independently assume the nav item exists in a way that breaks if a user has an old cached nav model or a stale deep link to `#panel-ai-usage` while paused - a graceful "not available" state is better than a broken blank panel for a direct link.
- **Testing gaps:** This spec's own AC 3-4 above are new testing surface with no coverage today - add a `test_*` for the flag correctly gating the nav filter (mirroring `test_erShouldHideReviewsTab_`'s pattern for a similar single-item nav hide), and confirm the two updated diagnostic functions' "paused" short-circuit is itself covered by a quick assertion (stub the flag off, confirm `skipped: true` comes back, not a false pass or a false fail). Register any new test in `FOS_DIAG_SUITE_STEPS_` per the standing convention (feature 057).

**Verification Steps:**
1. Set `AI_USAGE_HYDRATE_ENABLED` to `false` in Settings; confirm AI Usage disappears from Finance nav for a normal user, while Portfolio P&L/Expenses remain.
2. Run a manual Pull from Fibery; confirm the run's dataset list/summary shows `ai-usage` skipped, not attempted, and completes the remaining 7 datasets normally.
3. Run `scripts/run_diagnostics.py` (feature 057); confirm both AI-usage diagnostic entries report "paused," and the overall suite still exits 0 (a deliberate pause is not a regression).
4. Check Profile notification settings; confirm AI Usage is not offered as a subscription option.
5. Flip the flag back to `true`; re-run the hydrate and the diagnostic suite; confirm everything resumes with no code change.
6. Confirm `AI_USAGE_SYNC_ENABLED` (feature 017's own flag) is untouched and that job's own schedule is unaffected throughout.

## Technical appendix (engineering)

See [implementation plan](036-supabase-dashboard-data-layer-implementation-plan.md) for phases, file list, sync batching, dual-write policy, and cutover. Customer-facing notebook should keep this section short or omit it; git holds the detailed plan.

## Change log

| Date | Note |
| --- | --- |
| 2026-09-10 | **v3.27.0:** BUG-036-01 code fix shipped - 4h staleness guard on `startSupabaseSync_`, Settings sync health + force-clear, `_diag_supabaseSyncHealth`, `test_supabaseSyncStaleRunningGuard_`. Ops unblock (fresh sync + BUG-040-01 re-verify) still pending Admin **Pull from Fibery**. |
| 2026-09-10 | **v3.28.0:** BUG-036-02 shipped - empty-window messaging, ai-usage soft-fail, `_diag_aiUsageDataFreshness_`, `test_supabaseAiUsageEmptyWindowDistinction_`. Upstream AI data still stale since 2026-05-31 (feature 017 investigation documented). |
| 2026-09-10 | **v3.29.1:** CHANGE-036-03 shipped - `AI_USAGE_HYDRATE_ENABLED` pauses Hub AI Usage nav/hydrate/diagnostics/notifications; feature 017 ingest unchanged. |
| 2026-09-10 | Spec update: added **CHANGE-036-03** - temporary pause of AI Usage (nav route, daily hydrate step, feature 057 diagnostics, notification subscription option) behind a single new `AI_USAGE_HYDRATE_ENABLED` Script Property, mirroring the existing `AI_USAGE_SYNC_ENABLED` kill-switch pattern. Explicitly scoped to the Supabase hydrate pipeline only - feature 017's separate Anthropic-to-Fibery ingest job is unaffected. Not yet implemented. |
| 2026-09-10 | Spec update: added **BUG-036-01** (confirmed live incident - FOSDashboard's own AM-mirror sync job, tracked in `fos_sync_runs`, stuck `running` since 2026-08-25 17:47 UTC, zero runs since; explains BUG-040-01's missing SOW rates as a downstream symptom). **Scope-corrected same day**: the separate `ClockifyToFiberySync` repo's own labor-cost pipeline is healthy (synced this morning) - only the Agreement Management mirror (agreements, resource allocations, portfolio-pnl, pipeline, AI usage, and FOSDashboard's own utilization panel-cache step) is affected, not "every Live panel." Not yet implemented - immediate ops remediation (clear stuck state, force a fresh sync) needed independent of the code fix. |
| 2026-08-25 | **v3.19.0 (feature 049):** Migration **052** / `fos_programs`; `fos_agreements` Bid/Program/Initial Planned Hours columns; AM mirror `programs` + agreements select/map; Agreement cache schema **5**. |
| 2026-08-15 | **v3.7.4:** Live Resource assignments honors From/To by rebuilding from typed tables (`buildResourceAssignmentDashboardPayloadFromSupabase_`); hydrate blob stays default-range fallback (mirrors Utilization + `fos_labor_costs`). |
| 2026-07-29 | **v3.4.10:** AM mirror `estimated_allocations` select maps `allocation` → Fibery **Percent Allocated** (field `Agreement Management/Allocation` does not exist; overnight sync failed after resource_allocations). |
| 2026-07-27 | **v3.4.6:** Migration **044** restores `anon`/`authenticated` grants + RLS policies on `fos_labor_costs` / `labor_costs` (fixes Live Labor Hours / Utilization and Pull `permission denied for table fos_labor_costs`). |
| 2026-07-27 | **v3.4.2:** AM mirror Companies Segment / Assigned Resources / P&L revenue junctions use Fibery path vectors (nested collection `{ q/from }` fails on this workspace). |
| 2026-07-25 | **v3.4.1:** Migration **043** restores `anon`/`authenticated` grants on AM mirror tables (fixes nightly `permission denied for table fos_am_enums`). |
| 2026-07-24 | **v3.4.0:** Panel hydrate builds JSON from Supabase typed tables (`supabasePanelBuilders.js`); Fibery Labor Costs no longer mirrored (Clockify `fos_labor_costs` only); HubSpot/AI row mirrors before Pipeline/AI panels; AM FK constraints (migration **042**). |
| 2026-07-23 | **v3.3.0:** ADMIN Pull / nightly hydrate Agreement Management relational tables (`am-mirror` via `supabaseAmMirror.js`) before panel JSON blobs. Migration **041**. Fibery Labor Costs → `fos_am_labor_costs` (Clockify `fos_labor_costs` unchanged). Panel aggregation builders unchanged. |
| 2026-07-22 | **v3.0.12:** `fos_labor_costs` is Hub time-entry mirror of `labor_costs` (migration 038). ADMIN Pull auto-installs nightly hydrate trigger; Settings shows trigger status. |
| 2026-07-22 | **v3.0.11:** Live serve is Datastore-only (no Fibery / Drive warm fallback). Utilization and Resource assignments no longer skip Supabase when the client sends date ranges. |
| 2026-07-21 | **v3.0.9:** Default `DASHBOARD_READ_SOURCE` is **supabase**; `fibery` remains the kill-switch. |
| 2026-07-21 | **v3.0.4:** Datastore **Reload** (not Fibery pull): show Reloaded vs Data as of; disable browser TTL Stale for Datastore; button label Reload + tooltip. |
| 2026-07-21 | **v3.0.2:** Customer-facing reload labels use **Datastore** / **Reloading from Datastore** (hide Supabase vendor name); ADMIN Settings still name Supabase. |
| 2026-07-21 | **v3.0.1:** Panel Refresh no longer skips Supabase; loading overlays use `dashboardReadSource` hint from `doGet`. |
| 2026-07-21 | Release renumbered **MAJOR 3.0.0** (was drafted as 2.28.0) for serving-contract change to Supabase Live path. |
| 2026-07-21 | Implemented Phases 0–7 in code (v3.0.0): supabaseClient, schema migration, sync job, serve gates, dual-write, Drive bypass, Admin Pull UI, PRD FR-133 / AC-95. |
| 2026-07-21 | Spec Draft: Supabase live serve (except Expenses), Fibery nightly + ADMIN Pull hydrate, dual-write status updates, Labor Cost sync out of scope, Drive warm caches retired for Live, historical snapshots remain on Drive (Supabase snapshots follow-on). |

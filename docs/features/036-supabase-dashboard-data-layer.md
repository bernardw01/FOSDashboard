# Feature: Supabase dashboard data layer

> **Status:** Shipped (**v3.0.0**; follow-on patches through **v3.0.4**).  
> **PRD version:** 3.0.5  
> **Feature id:** 036 | **Task list:** Data platform  
> **Release type:** Enhancement  
> **Extends:** [003 - Agreement client cache](003-agreement-dashboard-fibery-client-cache.md), [005 - Utilization](005-utilization-management-dashboard.md), [006 - Delivery P&L](006-delivery-project-pnl.md), [009 - Historical snapshots](009-dashboard-historical-snapshots.md), [010 - Historical data source](010-dashboard-historical-data-source.md), [016 / 030 - Pipeline](030-sales-os-pipeline.md), [017 / 023 - AI usage](023-ai-usage-dashboard.md), [022 / 025 - Portfolio](025-portfolio-pnl-performance-and-load-source-ux.md), [027 / 028 - Resource assignments](027-resource-assignment-dashboard.md), [034 - Live Drive warm cache](034-live-dashboard-warm-cache-and-portfolio-batching.md) (live Drive path superseded by this feature).  
> **Implementation plan:** [036-supabase-dashboard-data-layer-implementation-plan.md](036-supabase-dashboard-data-layer-implementation-plan.md)
> **Teamwork notebook:** [Feature 036 - Supabase dashboard data layer](https://win.godeap.io/app/projects/1615262/notebooks/312758)  
> **Implementation plan notebook:** [Feature 036 - Implementation plan (Supabase data layer)](https://win.godeap.io/app/projects/1615262/notebooks/312759)  
> **Release task:** [v3.0.0 - Supabase dashboard data layer](https://win.godeap.io/app/tasks/40552222)

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

Logical domains (exact DDL in implementation plan / `supabase/migrations` or `docs/sql/036/`):

| Domain | Example tables | Used by | Writer in 036 |
| --- | --- | --- | --- |
| Sync meta | `sync_runs`, `sync_watermarks`, `dataset_as_of` | Admin + load-source | Fibery hydrate job |
| Companies / agreements / rates | `companies`, `agreements`, related dims | Agreements, Revenue, Delivery list, Portfolio index | Fibery hydrate |
| Delivery economics | revenue, ODC, allocation facts | Delivery P&L, Portfolio | Fibery hydrate |
| Status updates | status update rows (+ doc metadata as needed) | Delivery P&L, dual-write | Fibery hydrate + dual-write path |
| People / time | Clockify users, time aggregates | Utilization, Labor hours, Resource assignments | Fibery hydrate (where Fibery-sourced) |
| Labor costs | `labor_costs` (or equivalent) | P&L / util cost | **External Clockify sync only** |
| Pipeline | HubSpot deal mirror | Pipeline (merged with Sales sheet in GAS) | Fibery hydrate |
| AI usage | usage / cost rows | AI Usage | Fibery hydrate |

**Optimization principles:**

- Serve-oriented columns (typed fields for filters/joins), not only opaque Fibery JSON blobs.
- Upsert by stable `fibery_id` (or documented natural key).
- Btree indexes on join/filter keys (`fibery_id`, dates, status, project/agreement id, email).
- Prefer fewer GAS round-trips via PostgREST filters and/or Postgres **RPC / views** shaped for panel builders.
- Soft-delete or tombstone rows removed in Fibery so Live does not keep ghosts.

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

## Technical appendix (engineering)

See [implementation plan](036-supabase-dashboard-data-layer-implementation-plan.md) for phases, file list, sync batching, dual-write policy, and cutover. Customer-facing notebook should keep this section short or omit it; git holds the detailed plan.

## Change log

| Date | Note |
| --- | --- |
| 2026-07-21 | **v3.0.4:** Datastore **Reload** (not Fibery pull): show Reloaded vs Data as of; disable browser TTL Stale for Datastore; button label Reload + tooltip. |
| 2026-07-21 | **v3.0.2:** Customer-facing reload labels use **Datastore** / **Reloading from Datastore** (hide Supabase vendor name); ADMIN Settings still name Supabase. |
| 2026-07-21 | **v3.0.1:** Panel Refresh no longer skips Supabase; loading overlays use `dashboardReadSource` hint from `doGet`. |
| 2026-07-21 | Release renumbered **MAJOR 3.0.0** (was drafted as 2.28.0) for serving-contract change to Supabase Live path. |
| 2026-07-21 | Implemented Phases 0–7 in code (v3.0.0): supabaseClient, schema migration, sync job, serve gates, dual-write, Drive bypass, Admin Pull UI, PRD FR-133 / AC-95. |
| 2026-07-21 | Spec Draft: Supabase live serve (except Expenses), Fibery nightly + ADMIN Pull hydrate, dual-write status updates, Labor Cost sync out of scope, Drive warm caches retired for Live, historical snapshots remain on Drive (Supabase snapshots follow-on). |

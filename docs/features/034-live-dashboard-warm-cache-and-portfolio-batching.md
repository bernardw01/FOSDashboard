# Feature: Live dashboard warm cache and Portfolio batch builds

> **Status:** Implemented in code (v2.26.1); deployment verification and Teamwork ship remain.  
> **PRD version:** 2.26.1  
> **Feature id:** 034 | **Task list:** Data platform  
> **Release type:** Enhancement  
> **Teamwork notebook:** [Feature 034 - Live dashboard warm cache and Portfolio batch builds](https://win.godeap.io/app/projects/1615262/notebooks/312664)  
> **Implementation plan notebook:** [Feature 034 - Implementation plan (warm cache + Portfolio batches)](https://win.godeap.io/app/projects/1615262/notebooks/312665)  
> **Release task:** [Feature 034 - Live dashboard warm cache and Portfolio batch builds](https://win.godeap.io/app/tasks/40507567)  
> **Extends:** [003 - Agreement client cache](003-agreement-dashboard-fibery-client-cache.md), [006 - Delivery projects](006-delivery-project-pnl.md), [022 - Portfolio Project P&L](022-portfolio-project-pnl.md), [025 - Portfolio performance / load-source UX](025-portfolio-pnl-performance-and-load-source-ux.md), [009 - Historical snapshots](009-dashboard-historical-snapshots.md), [010 - Historical data source](010-dashboard-historical-data-source.md).  
> **Implementation plan:** [034-live-dashboard-warm-cache-and-portfolio-batching-implementation-plan.md](034-live-dashboard-warm-cache-and-portfolio-batching-implementation-plan.md)

## Goal

Cut **live-mode wait time** for the most common cold paths without changing dashboard math or inventing a new hosting platform:

1. **Same-day Drive warm cache for Agreements** (and derived Delivery list), so the second user (and later opens) of the day do not pay a full Fibery rebuild.
2. **Reuse a warm Agreement payload for Delivery list**, so opening Delivery after Agreements does not trigger a duplicate Agreement Fibery fetch.
3. **Portfolio P&L cold Drive builds via continuation batches**, so the first visitor of the day does not rebuild every project in one Apps Script execution (6-minute timeout risk).

**Primary audience:** All authorized users who open Agreements, Delivery, or Portfolio P&L in **Live** data mode during the workday.

**Out of scope (v1):** Utilization Drive daily cache / row trimming; parallel `google.script.run`; CacheService as primary full-payload store; moving off Apps Script; changing historical snapshot artifact contracts except where Portfolio live batching reuses the existing snapshot batch pattern.

## Problem statement

Today, perceived speed comes mostly from **browser `sessionStorage` TTLs** and two **Drive daily caches** (Portfolio P&L, AI Usage). Live **Agreements** and **Delivery** still rebuild from Fibery on every cold miss. **Delivery list** always calls `getAgreementDashboardData()` even when the client already holds a fresh Agreement cache. **Portfolio** same-day Drive cache helps after the first build, but that first build still loops all projects in **one** execution (`buildPortfolioPnlBundleFromFibery_`), which is slow and can hit the Apps Script time limit.

Historical snapshots help **as-of** browsing; they do **not** warm Live.

## Locked product decisions

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Agreement live cache | Same-day Drive folder under the snapshot root (mirror AI Usage / Portfolio pattern). Default **on** when `FOS_SNAPSHOT_DRIVE_FOLDER_ID` is configured. |
| 2 | Refresh semantics | Panel **Refresh** / `forceRefresh` bypasses Drive and rebuilds from Fibery, then rewrites today's Drive cache. |
| 3 | Delivery list | Prefer warm Agreement (browser and/or Drive) + `buildDeliveryDashboardPayloadFromAgreement_`; do not Fibery-fetch Agreement again when a fresh Agreement payload is available. |
| 4 | Portfolio cold build | Live Drive daily cache builds use **continuation triggers** (same idea as `processSnapshotPnlBatch_`), not one unbounded for-loop. |
| 5 | Load-source UX | Keep **FR-120** labels: show **`Drive cache · YYYY-MM-DD`** when serving Agreement / Delivery / Portfolio from Drive daily cache; **`Live Fibery`** while building or on force refresh. |
| 6 | Snapshot mode | Unchanged: historical dates still use snapshot artifacts; this feature does not replace snapshot job contracts. |
| 7 | Parallel client runs | **Rejected** (feature 025 / v2.13.1). Keep sequential `google.script.run`. |

## User stories

- As a **dashboard user**, I want Agreements to load quickly after the first successful live build of the day so my team is not waiting on Fibery for every cold open.
- As a **delivery reviewer**, I want Delivery projects to open quickly when I already loaded Agreements (or when today's Agreement Drive cache exists) so I do not wait for the same Fibery work twice.
- As a **finance reviewer**, I want the first Portfolio P&L open of the day to complete reliably (with progress) instead of risking a long hang or timeout while every project builds inline.
- As any **user**, I want the loading overlay to still say whether data is coming from **Live Fibery**, **Browser cache**, or **Drive cache**.
- As a **mobile user**, I want the same faster loads and source labels on a narrow viewport (no new desktop-only chrome).

## Acceptance criteria (testable)

### A. Agreement same-day Drive warm cache

- [x] **Given** Live mode and a configured snapshot Drive root, **when** the first authorized user loads Agreements with a cold browser cache, **then** the server may build from Fibery and **writes** today's Agreement payload to Drive (`agreement-cache/YYYY-MM-DD/` or equivalent documented path).
- [x] **Given** today's Agreement Drive cache exists and schema matches, **when** a later Live Agreement load runs without force refresh, **then** the server returns the Drive payload and the overlay / last-refreshed source shows **`Drive cache · YYYY-MM-DD`**.
- [x] **Given** the user clicks **Refresh**, **when** Agreement reloads, **then** Fibery is queried, Drive cache for today is rewritten, and source shows **Live Fibery** for that fetch.
- [x] **Given** Drive cache is disabled or unconfigured, **when** Agreement loads, **then** behavior matches today (Fibery on miss; browser TTL unchanged).
- [x] **Given** Drive cache schema version mismatches, **when** Agreement loads, **then** the stale file is ignored and Fibery rebuilds (then writes the new schema).

### B. Delivery list reuses Agreement

- [x] **Given** a fresh Agreement payload in browser sessionStorage (within TTL, matching schema), **when** the user opens Delivery list in Live mode, **then** the client derives or requests Delivery **without** a second Agreement Fibery round-trip (server may accept cached agreement JSON or a slim "project-from-agreement" path).
- [x] **Given** no warm Agreement in the browser but today's Agreement Drive cache exists, **when** Delivery list loads, **then** the server builds Delivery from that Drive Agreement payload (or shared warm-cache helper) rather than a duplicate Fibery Agreement build when possible.
- [x] **Given** neither browser nor Drive Agreement is available, **when** Delivery loads, **then** one Agreement Fibery build occurs, Delivery is derived, and Agreement Drive cache is written for later reuse.
- [x] **Given** snapshot mode, **when** Delivery opens, **then** existing snapshot core-bundle behavior is unchanged.

### C. Portfolio cold build via continuation batches

- [x] **Given** no Portfolio Drive daily bundle for today, **when** Live Portfolio loads (or Refresh forces rebuild), **then** the server starts a **batched** build (`PORTFOLIO_PNL_LIVE_BUILD_BATCH_SIZE`, default 8, max 25) and returns a **progress / pending** response the client polls sequentially until the bundle is complete.
- [x] **Given** a batched Portfolio build is in progress, **when** another user opens Portfolio, **then** they either wait on the in-progress build (lock + read partial/complete) or see progress UI; they do not start a second full unbounded rebuild that races the first.
- [x] **Given** the Drive daily bundle is complete for today, **when** Portfolio loads without force refresh, **then** behavior matches feature **025** (near-instant Drive cache hit).
- [x] **Given** a large portfolio, **when** the cold build runs, **then** no single Apps Script execution rebuilds all projects inline in one unbounded loop (the current `buildPortfolioPnlBundleFromFibery_` for-loop is replaced or gated behind batching).

### Load-source and mobile

- [x] **Given** any of the above cache hits, **when** overlays show, **then** **`formatLoadSourceLabel_`** continues to use the FR-120 vocabulary (including **Drive cache · date**).
- [x] **Given mobile width (&lt; 768px)**, **when** the user opens Agreements, Delivery, or Portfolio, **then** faster loads apply the same; no new controls that only work in the desktop sidebar.

## UI notes

- **Routes:** `#panel-agreement` (and Revenue review if it shares Agreement payload), `#panel-delivery`, `#panel-portfolio-pnl`.
- **Desktop:** Prefer progress copy on Portfolio cold build (for example "Building Drive cache… 12 / 40 projects") using existing overlay patterns from feature **025**.
- **Mobile:** Same overlays / source labels; no new bottom-nav routes. Touch targets for Refresh unchanged (≥ 44px).
- **Settings:** ADMIN registry entries expose `AGREEMENT_DRIVE_CACHE_ENABLED` and `PORTFOLIO_PNL_LIVE_BUILD_BATCH_SIZE`.

## Data model

| Artifact | Path (proposed) | Contents |
| --- | --- | --- |
| Agreement daily cache | `{SNAPSHOT_ROOT}/agreement-cache/YYYY-MM-DD/bundle.json` (+ small manifest) | Same shape as `buildAgreementDashboardPayload_` / live Agreement API (`cacheSchemaVersion` aligned with `AGREEMENT_DASHBOARD_CACHE_SCHEMA_VERSION_`) |
| Portfolio daily cache | Existing `portfolio-pnl-cache/YYYY-MM-DD/` | Unchanged final `bundle.json`; **build process** becomes batched |
| Portfolio build queue | `portfolio-pnl-cache/YYYY-MM-DD/build-state.json` + Script Properties / LockService | Cursor, partial `pnlById`, date key, status |

No Fibery schema changes. No auth Users-tab changes.

## Operations

- **Queries:** Existing Fibery builders; Drive read/write under snapshot root.
- **Actions:** Live panel loads; Refresh; optional ADMIN "rebuild today's cache" later (not required for v1).
- **Jobs:** May add or extend a **continuation** trigger for Portfolio live cache build (pattern from `processSnapshotPnlBatch_`). Optional: warm Agreement Drive cache from the nightly snapshot job for "today" after midnight (nice-to-have; not required if first Live open writes the cache).

## Edge cases

- Private mode / no `sessionStorage`: Delivery reuse falls back to Drive / Fibery; Agreement browser cache skipped.
- Concurrent first opens: LockService around Drive write; second waiter re-reads cache.
- Partial Portfolio failures: preserve feature **025** `partial` / `failedIds` semantics in the final bundle.
- Schema bumps: bump Agreement Drive cache schema with live `AGREEMENT_DASHBOARD_CACHE_SCHEMA_VERSION_`; ignore mismatched Drive files.
- Snapshot Drive folder missing: caches disabled; live Fibery only (safe degrade).

## Verification steps

1. **Desktop Live cold:** Clear browser cache. Open Agreements. Confirm Fibery once, Drive file created, source label correct. Reload / second browser: **Drive cache** hit.
2. **Delivery reuse:** With warm Agreement sessionStorage, open Delivery; confirm no second Agreement Fibery (Network / server logs / elapsed time). Clear sessionStorage only; confirm Delivery uses Drive Agreement when present.
3. **Portfolio cold:** Delete or force-refresh today's `portfolio-pnl-cache`. Open Portfolio. Confirm batched progress and completion without a single unbounded loop; second open hits Drive.
4. **Refresh:** Force refresh on each panel; confirm Fibery + cache rewrite.
5. **Snapshot mode:** Select a past date; Agreements / Delivery / Portfolio still load from snapshot artifacts.
6. **Mobile (~390px):** Repeat Agreements → Delivery and Portfolio open; overlays readable; Refresh usable.

## Implementation checklist

- [x] Update feature spec checkboxes as implemented
- [x] **Mobile UI** per `.cursor/rules/mobile-ui-shell.mdc` (same progress overlays and source labels; no new controls)
- [x] Admin settings registry entries for new Script Properties
- [x] Align snapshot / Drive docs (feature **009** / **025** notes)
- [x] PRD FR/AC + version bump to **2.26.1** (patch reliability fixes)
- [ ] Run smoke steps above on deployed Web App
- [ ] Sync Teamwork notebooks at ship; rename task to `vX.Y.Z - …`

## Technical appendix (engineering)

See [implementation plan](034-live-dashboard-warm-cache-and-portfolio-batching-implementation-plan.md) for phases, file list, and API sketches. Customer-facing notebook should keep this section short or omit it; git holds the detailed plan.

## Change log

| Date | Note |
| --- | --- |
| 2026-07-16 | v2.26.1 patch: nested ScriptLock helper (`scriptLockNest.js`), Portfolio index fetch before lock, per-project build checkpoints, lock-busy continuation reschedule, poll-time batch advance, lock-timeout graceful fallback. |
| 2026-07-16 | Implemented v2.26.0: Agreement same-day Drive cache, Delivery browser/Drive Agreement reuse, and Portfolio continuation batch build with sequential client polling. |
| 2026-07-16 | Spec Draft: Agreement Drive warm cache, Delivery Agreement reuse, Portfolio continuation batch builds (responsiveness review options 1, 2, 4). |

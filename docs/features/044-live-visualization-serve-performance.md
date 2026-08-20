# Feature: Live visualization serve performance

> **Teamwork:** Create this spec first as a notebook in [FOS Dashboard Development](https://win.godeap.io/app/projects/1615262) using these sections. Sync to `docs/features/0NN-<slug>.md` at approval and again at ship. See `docs/teamwork-workflow.md`.
> **Teamwork notebook:** [Feature 044 - Live visualization serve performance](https://win.godeap.io/app/projects/1615262/notebooks/313366)  
> **Implementation plan notebook:** [Feature 044 - Implementation plan (Live viz serve)](https://win.godeap.io/app/projects/1615262/notebooks/313367)  
> **Release task:** [Feature 044 - Live visualization serve performance](https://win.godeap.io/app/tasks/40839335)
>
> **Status:** Spec Draft  
> **PRD version:** 3.8.0 (FR/AC numbers assigned at ship; proposed **FR-141**, **AC-102**)  
> **Feature id:** 044 | **Task list:** Data platform  
> **Release type:** Enhancement  
> **Extends:** [036 - Supabase dashboard data layer](036-supabase-dashboard-data-layer.md), [005 - Utilization](005-utilization-management-dashboard.md), [027 - Resource assignments](027-resource-assignment-dashboard.md), [003 - Agreement client cache](003-agreement-dashboard-fibery-client-cache.md), [025 - Portfolio load-source UX](025-portfolio-pnl-performance-and-load-source-ux.md), [009 - Historical snapshots](009-dashboard-historical-snapshots.md), [010 - Historical data source](010-dashboard-historical-data-source.md), [029 - Mobile shell](029-mobile-shell-phase-ab.md)  
> **Implementation plan:** [044-live-visualization-serve-performance-implementation-plan.md](044-live-visualization-serve-performance-implementation-plan.md)

## Goal

Cut Live **panel refresh and chart paint wait** by serving visualization data from **Postgres-shaped aggregates** and **small JSON payloads**, instead of paging fact tables in Apps Script and shipping full panel blobs through `google.script.run` on every Reload or date-range change.

Fibery remains the operational system of record. Nightly / ADMIN **Pull from Fibery** remains the hydrate. This feature changes **how Live reads** that Datastore, not who writes it.

**Primary audience:** All authorized dashboard users (faster Live charts and grids); ADMIN operators (Pull still rebuilds; Refresh does not impersonate Pull).

**Primary outcomes:**

1. Utilization and Resource assignments Live loads call **Supabase RPCs** (or equivalent SQL) for the requested date range instead of paging `fos_labor_costs` / `fos_resource_allocations` in GAS.
2. Chart-heavy panels can fetch a **slim chart payload** (tens of KB) so Chart.js can paint before full tables arrive.
3. Panel **Refresh** re-reads stored panel JSON; it does **not** rebuild typed-table payloads unless schema is stale or ADMIN Pull is running.
4. Custom From/To windows hit a **range-keyed cache** after the first build for that window.
5. **Browser-direct Datastore reads** for charts are a documented follow-on (Phase E), not required for the first ship.

## Problem statement

Live panels already store hydrated JSON in `fos_panel_payloads` / `fos_delivery_pnl`. Several visualization paths still **rebuild from typed facts on every UI request**:

- Utilization / Labor hours: `buildUtilizationPayloadFromFosLaborCosts_` pages `fos_labor_costs` (1000-row PostgREST pages) and aggregates in GAS.
- Resource assignments: Live always rebuilds from all `fos_resource_allocations` plus labor, then filters the date range in GAS (hydrate blob is default-range fallback only).
- Agreement / Delivery **Refresh** (`forceRefresh`): rebuilds **both** panel blobs from AM typed tables.
- Full payloads (rows, assignment grids, status history) travel Browser → Apps Script → PostgREST → GAS JSON parse → HtmlService serialize. Chart.js waits on that round trip.

Browser `sessionStorage` already skips TTL for Datastore payloads, so the wait users feel is **Reload, first paint, and date-range change**, not TTL expiry.

## Locked product decisions

| # | Topic | Decision |
| --- | --- | --- |
| 1 | First ship | Phases **A-D** in one Enhancement when A-C are proven; **D** may ship in the same release if range cache is ready, otherwise the next PATCH on 044. |
| 2 | Phase E | **Follow-on:** browser → PostgREST/RPC with a restricted key and RLS. Same feature notebook; separate release task when security review is approved. Not in the first 044 ship. |
| 3 | Math | KPI, chart, and grid totals MUST match the current GAS builders within documented rounding. No silent formula change. |
| 4 | Secrets | Service role key stays in Script Properties. Phase E must not expose it to `DashboardShell.html`. |
| 5 | Historical | Snapshot / Data source date mode stays on Drive (009 / 010). Slim Live APIs are Live-only unless a snapshot artifact already has the chart slice. |
| 6 | Refresh vs Pull | **Refresh** = re-read Datastore JSON (or range-cache / RPC for date-bound panels). **Pull from Fibery** = hydrate typed tables and rewrite panel blobs. |
| 7 | Default range | Utilization and Resource assignments with **default** From/To MAY serve the hydrate blob or a default-range cache row; custom ranges use RPC + range cache. |
| 8 | Load-source UX | Keep FR-120 Datastore vocabulary (`Reloading from Datastore`, `Source: Datastore · synced {asOf}`). Slim chart fetch may show the same overlay or a lighter in-panel spinner; do not name Supabase outside ADMIN Settings. |
| 9 | Parallel `google.script.run` | Still sequential for full panel APIs (feature 034). Slim chart call MAY run **before** the full table call on the same panel (chart-first, not two competing full payloads). |
| 10 | Cache schema | Slim and range-cache envelopes get their own `cacheSchemaVersion` (or a dedicated field). Bump when chart JSON shape changes. Full panel schema bumps only if table payloads change. |

## User Stories

- As a **dashboard user**, I want Utilization and Resource assignment charts and grids to appear quickly after I open the panel or change dates so I am not waiting on a full fact-table rebuild in the server.
- As a **finance / delivery reviewer**, I want Agreement, Pipeline, and Utilization charts to paint from a small payload so the visuals are usable while large tables are still loading.
- As a **dashboard user**, I want **Refresh** to re-read the latest hydrated Datastore snapshot so Reload is fast and does not rebuild the warehouse in my session.
- As an **ADMIN**, I want **Pull from Fibery** to remain the action that rebuilds typed tables and panel JSON so Refresh cannot be confused with a Fibery extract.
- As a **dashboard user**, I want a second open of the same custom date range to be fast so I am not paying the first-build cost every time I toggle From/To back.
- As a **mobile user**, I want the same faster Live loads at viewport width **&lt; 768px**, including filter sheets and **Show charts** (no desktop-only performance path).
- As a **security reviewer** (Phase E), I want chart reads that skip Apps Script to use a non-admin key and RLS so the service role never ships to the browser.

## Acceptance Criteria (testable)

### A. RPC-backed Utilization and Resource assignments (item 1)

- [ ] **Given** Live Datastore is configured, **when** an authorized user opens Utilization (or Labor hours) with a date range, **then** the server does **not** page raw `fos_labor_costs` via `supabaseSelectAll_` as the primary path; it calls a Postgres RPC (or reads a range-cache row built from that RPC).
- [ ] **Given** Live Datastore is configured, **when** an authorized user opens Resource assignments with From/To, **then** allocations are filtered **in SQL** (overlap with the requested window); GAS does not download the full allocation table and filter in memory as the primary path.
- [ ] **Given** a known fixture range, **when** RPC totals are compared to the current GAS builder, **then** hours, cost, billable mix, and assignment week hours match within documented rounding (implementation plan).
- [ ] **Given** the RPC or SQL is unavailable, **when** the panel loads, **then** the user sees a safe error (existing miss copy); no Fibery Live fallback.

### B. Slim chart endpoints (item 2)

- [ ] **Given** Agreements Live, **when** the panel opens, **then** Chart.js donuts / stack / customer bar can render from `getAgreementChartData` (or equivalent) **without** requiring `financialTable`, `revenueItemsByAgreement`, or Sankey nodes in that first response.
- [ ] **Given** Utilization Live, **when** the panel opens, **then** the six Chart.js canvases can render from a slim aggregates payload (by week / customer / project / person / role / billable mix) without `rows[]` in that response.
- [ ] **Given** Pipeline Live, **when** the panel opens, **then** forecast / vertical charts can render from a slim chart payload; deal tables may load in a second call.
- [ ] **Given** the slim call succeeds and the full payload is still in flight, **when** the user views the panel, **then** charts are visible (or mobile **Show charts** works on the slim data); tables show the existing loading state until the full payload arrives.
- [ ] **Mobile:** **Given** viewport **&lt; 768px**, **when** charts are behind **Show charts**, **then** the slim payload is enough to render those charts; no extra desktop-only API.

### C. Refresh re-reads blobs (item 3)

- [ ] **Given** Live Agreements (or Delivery list, Portfolio, Pipeline, AI Usage) with a valid `fos_panel_payloads` row matching schema, **when** the user clicks **Refresh**, **then** the server re-reads that row (or Delivery P&L row) and does **not** call `rebuildAgreementDeliveryPanelsFromTyped_` / typed P&L rebuild.
- [ ] **Given** schema mismatch or missing blob, **when** the user clicks Refresh, **then** a typed rebuild MAY run (same as today on miss), then upsert.
- [ ] **Given** ADMIN **Pull from Fibery** completes, **when** a user subsequently Refresh-es, **then** they receive the newly written blobs (`synced_at` / Data as of advances).
- [ ] **Given** Utilization or Resource assignments with a **custom** date range, **when** the user clicks Refresh, **then** the server re-reads the range-cache row if present and fresh relative to labor/allocation watermarks; otherwise it re-runs the RPC and upserts the cache (it still does not Pull from Fibery).

### D. Range-keyed cache (item 4)

- [ ] **Given** Utilization or Resource assignments, **when** the user selects a From/To window the first time in a hydrate epoch, **then** the server stores the built payload keyed by panel + start + end (+ schema version).
- [ ] **Given** the same user or another user requests the **same** window before the next Pull / labor watermark change, **when** the panel loads, **then** the response comes from that cache row (one PostgREST read), not a full RPC rebuild.
- [ ] **Given** ADMIN Pull or Clockify labor mirror watermark moves, **when** a cached range is requested, **then** the cache is treated stale and rebuilt.
- [ ] **Given** snapshot mode, **when** date pickers apply, **then** existing snapshot slice behavior is unchanged (no `fos_viz_range_payloads` requirement).

### E. Browser-direct chart reads (item 5, follow-on)

- [ ] **Given** Phase E is not shipped, **when** Live charts load, **then** they still go through Apps Script (Phases A-D).
- [ ] **Given** Phase E is approved later, **when** a slim chart RPC is called from the browser, **then** auth uses a **non-service-role** key, RLS (or a signed RPC) scoped to dashboard-read, and the service role is never in HtmlService output.
- [ ] **Given** Phase E, **when** RLS or token mint fails, **then** the client falls back to the GAS slim endpoint.

### Load-source and mobile

- [ ] **Given** slim-first load, **when** overlays show, **then** FR-120 Datastore labels still apply (no "RPC" or vendor names in the user overlay).
- [ ] **Given mobile width (&lt; 768px)**, **when** the user opens Utilization, Resource assignments, Agreements, or Pipeline, **then** faster Live paths apply; filter sheets and 44px targets unchanged; no sidebar-only Refresh.

## UI Notes

- **Routes / panels:** Utilization, Labor hours, Resource assignments (primary). Agreements, Pipeline (slim charts). Delivery list, Portfolio P&L, AI Usage, Delivery project P&L (Refresh semantics). Expenses unchanged (Sheets).
- **Desktop:** No new nav routes. Optional: charts appear before tables (existing layout). Refresh button copy stays **Refresh** / **Reload**; tooltip MAY say it re-reads Datastore (not Fibery).
- **Mobile (`DashboardShell.html`, &lt; 768px):** Same APIs. **Show charts** uses slim payload. Date range / filters stay in `openMobileFilterSheet_` where those panels already use it. Not a new bottom-nav item.
- **Settings:** No new required ADMIN chrome for A-D. Optional read-only "viz cache" watermark is ADMIN-only if implemented. Phase E settings (anon/JWT) are follow-on.
- **Activity events:** Reuse existing panel refresh events. If a distinct slim-load event is added, whitelist it in `userActivityLog.js`.

## Data Model

Logical additions (exact DDL in implementation plan / migration **046+**):

| Object | Purpose |
| --- | --- |
| RPCs e.g. `fos_rpc_util_aggregates`, `fos_rpc_ra_week_grid` | Date-bounded aggregates for Live viz |
| `fos_viz_range_payloads` | Range-keyed JSON cache: `panel_key`, `range_start`, `range_end`, `cache_schema_version`, `payload`, `built_at`, `source_watermark` |
| Optional materialized views | Default windows only (YTD, last 90 days, RA default lookback/lookahead), refreshed at end of Pull |

Indexes: existing labor/allocation date indexes (037 / AM mirror) MUST be used by RPCs (`start_date_time`, allocation duration overlap).

**Out of schema for first ship:** Historical snapshot partitions in Postgres; browser-readable RLS policies (Phase E).

## Operations

- **Queries (Live):** Slim chart APIs; full panel APIs still exist for tables/CSV/Ask. Utilization / RA prefer RPC + range cache.
- **Queries (Historical):** Drive snapshots unchanged.
- **Actions:** Refresh = Datastore re-read. Pull = hydrate + blob rewrite + invalidate viz range cache (or bump watermark).
- **Jobs:** Nightly / Pull SHOULD invalidate or rebuild default-range viz cache after panel hydrate.
- **Secrets:** Unchanged for A-D. Phase E adds a restricted key in Script Properties, never logged.

## Edge Cases

- RPC timeout / statement timeout: safe error; do not hang the 6-minute script on unbounded SQL.
- Truncation: if an RPC must cap rows, surface `partial` / warning like today's labor cap.
- Range longer than RA max weeks (52): keep existing clamp.
- Concurrent Refresh + Pull: Pull lock wins; Refresh may serve pre-Pull blob then next Refresh gets new blob.
- sessionStorage quota: slim payload SHOULD still fit; full payload may use in-memory fallback (existing Utilization pattern). IndexedDB is optional in the plan, not required for AC.
- Schema bump: ignore range-cache rows with old `cache_schema_version`.
- Snapshot mode: ignore `fos_viz_range_payloads`.

## Verification Steps

1. **Desktop Live Utilization:** Change From/To; confirm charts/KPIs match a pre-change fixture (or side-by-side with kill-switch rebuild diag). Confirm server logs / `_diag_` show RPC or range-cache hit, not `supabaseSelectAll_` paging of all labor rows.
2. **Desktop Live Resource assignments:** Change From/To; week grid matches prior builder; second load of the same range is fast (range cache).
3. **Agreements / Pipeline:** Charts visible before or without waiting on the full table payload; CSV / table still complete after full fetch.
4. **Refresh:** Agreements Refresh does not log typed rebuild; ADMIN Pull then Refresh shows new `synced_at`.
5. **Snapshot:** Pick a historical date; Utilization / RA / Agreements still load from Drive.
6. **Mobile (~390px):** Utilization and Resource assignments usable; Show charts / filter sheet; Refresh still Datastore re-read.
7. **Phase E (when built):** Confirm no service role in page source; RLS denies table dump; fallback to GAS works.

## Implementation Checklist

- [ ] Update feature spec checkboxes as implemented
- [ ] **Mobile UI** per `.cursor/rules/mobile-ui-shell.mdc` (same PR as desktop if UI timing changes)
- [ ] SQL migration + `docs/supabase-data-model.md`
- [ ] Snapshot cache-sync rule: full panel `cacheSchemaVersion` unchanged unless table JSON changes
- [ ] Add/update `_diag_` for RPC vs blob vs range-cache
- [ ] Run local smoke test
- [ ] Commit with message: feat: ...
- [ ] At ship: PRD FR-141 / AC-102, `FOS_PRD_VERSION`, src headers, Teamwork rename

## Change requests

Post-approval customer edits land here until ship (Teamwork notebook). Merge into the body at ship.

## Changelog

| Date | PRD | Notes |
| --- | --- | --- |
| 2026-08-19 | 3.8.0 | Spec Draft: Live viz RPCs, slim charts, Refresh = blob re-read, range cache, Phase E follow-on. |

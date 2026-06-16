# Implementation plan: Feature 025 - Portfolio P&L performance and load-source UX

> **Feature spec:** [025-portfolio-pnl-performance-and-load-source-ux.md](025-portfolio-pnl-performance-and-load-source-ux.md)  
> **PRD:** **FR-120**, **AC-79** (Backlog)

## Summary

Two tracks: **(A)** transparency - show cache vs Fibery vs snapshot on every loading surface; **(B)** speed - slim portfolio P&L builder + tunable batch size. Ship **A** first for immediate user value; **B** addresses root latency.

## Phase A - Load-source UX

### A1. Shared client helpers (`DashboardShell.html`)

1. Add **`LoadSourceKind`** constants: `LIVE_FIBERY`, `BROWSER_CACHE`, `SNAPSHOT`, `DRIVE_DAILY_CACHE`, `SPREADSHEET`, `MIXED`.
2. **`formatLoadSourceLabel_(ctx)`** returns primary string per spec.
3. **`setOverlayLoading_(overlayEl, { on, title, sourceCtx, subtext })`** updates label + optional **`data-load-source`** for tests.
4. Refactor **`setGlobalLoading_(key, on, message, sourceCtx)`** to set title + source line on **`#fosLoadingModal`**.

### A2. Panel wiring

| Panel | When `BROWSER_CACHE` | When `LIVE_FIBERY` | When snapshot |
| --- | --- | --- | --- |
| Agreement | Cache hit, same `fetchedAt` skip | `getAgreementDashboardData` | `dataSourceState.agreement` |
| Utilization | Cache + in-range | `getUtilizationDashboardData` | bundle utilization |
| Delivery list | `readDeliveryCache` | fetch | bundle delivery |
| Delivery P&L | `readDeliveryPnlCache` | `getDeliveryProjectMonthlyPnL` | `getDashboardSnapshotPnl` |
| Portfolio | `portfolioPnlReadCache_` full hit | batch fetch | sequential snapshot P&L |
| Expenses | session cache | spreadsheet read | bundle expenses |
| AI Usage | session cache | Fibery or Drive daily | live-only banner |
| Pipeline | session cache | Fibery | bundle pipeline |

### A3. Portfolio-specific

In **`loadPortfolioPnlAll_`**:

- Counters: **`fromCacheCount`**, **`fromFiberyCount`**, **`fromSnapshotCount`**.
- When reusing **`readDeliveryPnlCache(pid)`**, increment cache counter before batch fetch.
- Pass counts into **`portfolioPnlSetLoading_`**.

### A4. Post-load badge

Extend **`formatLastRefresh`** or adjacent span with **` · Source: …`**.

### A5. Docs / PRD

Release **FR-120** / **AC-79**; update feature **010** loading table.

**Files touched:** `src/DashboardShell.html` only (Phase A).

**Test plan:** Manual matrix above; no schema bump.

---

## Phase B - Portfolio performance

### B1. Admin setting

**`src/adminSettingsRegistry.js`:**

| Key | Default | Max | Group |
| --- | --- | --- | --- |
| `PORTFOLIO_PNL_BATCH_SIZE` | 3 | 4 | Delivery / Portfolio |

**`src/portfolioPnlDashboard.js`:** read property in **`getPortfolioProjectPnLBatch`**.

### B2. Slim builder

**`src/deliveryDashboard.js`:**

```javascript
function buildPortfolioMonthlyPnLInternal_(agreementId) {
  // Same as buildDeliveryProjectMonthlyPnLInternal_ but:
  // - skip fetchStatusUpdatesForAgreement_
  // - skip fetchResourceAllocationsForAgreement_
  // - omit discrepancyCheck (or keep lightweight lifetime only)
  // - still compute laborEmployee / laborContractor for portfolio grid
}
```

**Important:** **`portfolioPnlApplyPayload_`** MUST NOT call **`writeDeliveryPnlCache`** with slim payloads (would poison Delivery panel). Only write full payloads from Delivery fetch path.

### B3. Wire batch endpoint

**`getPortfolioProjectPnLBatch`** calls **`buildPortfolioMonthlyPnLInternal_`** instead of full builder.

### B4. Diagnostics

**`_diag_portfolioPnLBatchProbe`:** log elapsed ms per agreement in batch.

**Files touched:** `portfolioPnlDashboard.js`, `deliveryDashboard.js`, `adminSettingsRegistry.js`.

**Test plan:** `_diag_portfolioPnLBatchProbe(['id1','id2'])`; compare Apps Script execution ms before/after; open Delivery P&L on same project - confirm status chip + allocations still load.

---

## Phase C - Drive daily cache (deferred)

New module **`src/portfolioPnlDashboardCache.js`** (pattern from **`aiUsageDashboardCache.js`**):

- Folder: **`portfolio-pnl-cache/YYYY-MM-DD/`**
- Files: **`manifest.json`**, **`bundle.json`** (all slim P&L payloads keyed by agreement id)
- Property: **`PORTFOLIO_PNL_DRIVE_CACHE_ENABLED`**
- **`getPortfolioProjectPnLBatch`** short-circuit when bundle present unless Refresh

Snapshot sync: optional; not required for Phase C.

---

## Phase D - Snapshot `portfolio-pnl.json` (deferred)

**`dashboardSnapshotJob.js`:** after all `delivery-pnl/<id>.json` written, build rollup JSON for portfolio grid inputs.

**`dashboardSnapshotStore.js`:** expected schema version for `portfolio-pnl`.

Client snapshot path: one bundle read instead of N **`getDashboardSnapshotPnl`** calls.

---

## Release sequencing

| Release | Scope | PRD bump |
| --- | --- | --- |
| **v2.16.0** (proposed) | Phase A + B | MINOR - new FR-120, feature **025** |
| **v2.16.1** (optional) | Phase C Drive cache | PATCH |
| **v2.17.0** (optional) | Phase D snapshot artifact | MINOR if new snapshot dataset |

## Teamwork

- Notebook: **Feature 025 - Portfolio P&L performance and load source**
- Task list: **Finance**
- Intake: link from Inbox or child of Feature **022** notebook

## Open questions for customer

1. Is **35–45 s** acceptable after Phase B, or is **Drive daily cache (Phase C)** required for same-day repeat visits?
2. Should **`Last refreshed`** show **mixed** source when some projects came from cache and some from Fibery?
3. Phase D pre-aggregated snapshot: include in nightly job scope now or defer?

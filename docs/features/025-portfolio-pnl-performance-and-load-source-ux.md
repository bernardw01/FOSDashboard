# Feature: Portfolio P&L performance and load-source UX

> **PRD version 2.26.0** - **FR-120** / **AC-79** (Released v2.16.0; load-overlay progress copy patched v2.22.1; continuation build added v2.26.0)
> **Feature id:** 025 | **Task list:** Finance  
> **Teamwork notebook:** [Feature 025](https://win.godeap.io/app/projects/1615262/notebooks/311911)  
> **Release task:** [Feature 025 - Portfolio P&L performance and load source](https://win.godeap.io/app/tasks/40203349)  
> **Extends:** [Feature 022 - Portfolio Project P&L](022-portfolio-project-pnl.md), [Feature 010 - Historical data source](010-dashboard-historical-data-source.md)  
> **Implementation plan:** [025-portfolio-pnl-performance-implementation-plan.md](025-portfolio-pnl-performance-implementation-plan.md)  
> **Status:** Shipped **v2.16.0** (progress UX refinement **v2.22.1**)

## Goal

Make **Portfolio P&L** load faster where possible, and make **every dashboard loading state** tell the user **where data is coming from** (Fibery live, browser cache, Drive snapshot, or Drive daily cache).

## Problem statement

Portfolio P&L is slow in **Live data** mode because the client must fetch **one full Delivery monthly P&L payload per in-scope project**. Each payload triggers **~6 Fibery query groups** server-side (agreement context, labor, ODC, revenue, status updates, resource allocations). With the default batch size of **2 projects per `google.script.run` call**, a portfolio of **40 projects** requires **20 sequential server round trips**, often **2–4+ minutes** total.

Users cannot tell whether the spinner means **Fibery**, **sessionStorage**, **per-project P&L cache**, or a **historical snapshot**.

## User stories

- As a **finance reviewer**, I want Portfolio P&L to load in a reasonable time so I can use it in meetings without waiting several minutes.
- As any **dashboard user**, I want loading copy to say **Live Fibery**, **Browser cache**, **Snapshot (YYYY-MM-DD)**, or **Drive cache** so I know if numbers are fresh or cached.
- As a **finance reviewer**, when Portfolio P&L reads cached project P&L from a prior Delivery visit, I want the UI to say so explicitly.
- As an **operator**, I want tunable batch size and optional slim P&L fetch for portfolio aggregation without breaking Delivery drill-down fidelity.

## Acceptance criteria

### Load-source UX (all dashboards)

- [x] Every panel loading overlay and the global **`#fosLoadingModal`** MUST show a secondary line **`Source: …`** using a shared client helper **`formatLoadSourceLabel_(context)`**.
- [x] Recognized source labels (exact copy):
  - **`Live Fibery`** - live mode, server fetch in progress or just completed from Fibery.
  - **`Browser cache`** - `sessionStorage` / in-memory payload reused (Agreement, Utilization, Delivery list, Portfolio aggregate, per-project Delivery P&L, etc.).
  - **`Snapshot · YYYY-MM-DD`** - historical data source; artifact from Drive snapshot bundle.
  - **`Drive cache · YYYY-MM-DD`** - AI Usage daily Drive cache (`ai-usage-cache/`) or Portfolio daily cache (`portfolio-pnl-cache/`).
  - **`Spreadsheet`** - Expenses panel (auth spreadsheet tab).
- [x] Portfolio P&L uses single-bundle load (supersedes per-project progress counts); **`Last refreshed`** shows bundle source (Fibery, Drive cache, Snapshot, Browser cache).

### Portfolio P&L performance (minimum viable)

- [x] **Phase B1:** Script Property **`PORTFOLIO_PNL_BATCH_SIZE`** (admin registry, default **3**, max **4**) controls **`getPortfolioProjectPnLBatch`** batch size.
- [x] **Phase B2:** **`buildPortfolioMonthlyPnLInternal_(agreementId)`** skips **non-essential** blocks for portfolio grid only: **`statusUpdates`**, **`resourceAllocations`**, etc.
- [x] Portfolio batch endpoint uses the slim builder; Delivery **`getDeliveryProjectMonthlyPnL`** remains full fidelity.
- [x] Live Portfolio loads via **`getPortfolioPnLDashboardData`** (single bundle call).

### Portfolio P&L performance (shipped follow-ons)

- [x] **Phase C:** Daily Drive bundle **`portfolio-pnl-cache/YYYY-MM-DD/bundle.json`**.
- [x] **Phase D:** Snapshot job writes **`portfolio-pnl.json`**; client reads via **`getDashboardSnapshotPortfolioPnl`**.

## Performance options (evaluation)

| Option | Effort | Impact | Risk | Recommendation |
| --- | --- | --- | --- | --- |
| **A. Load-source UX only** | Small | High trust, no speed change | Low | **Ship first** (Phase A) |
| **B1. Configurable batch size (3–4)** | Small | ~33–50% fewer round trips | Low concurrent Fibery pressure if max 4 | **Include in Phase B** |
| **B2. Slim P&L builder for portfolio** | Medium | ~30% less server time per project | Must not drift Delivery cache shape | **Include in Phase B** |
| **C. Reuse Delivery per-project browser cache** | Small (UX only today) | Faster when user visited Delivery first | Already partially implemented | **Improve messaging + warm-cache hint** |
| **D. Drive daily portfolio bundle** | Medium | Near-instant repeat loads same day | Drive folder + invalidation rules | Phase C if still slow |
| **E. Snapshot `portfolio-pnl.json`** | Medium | Fast historical; helps snapshot mode | Snapshot job + schema sync | Phase D; aligns with feature **022** note |
| **F. Server CacheService per agreement** | Medium | Helps repeat loads across users | 6 MB / 100k limit; eviction | Defer unless multi-user same-day |
| **G. Parallel client `google.script.run`** | Small code | Theoretical speedup | **Rejected** - caused partial failures (v2.13.1) | Do not pursue |
| **H. Single mega-endpoint (all projects)** | Large | One round trip | Apps Script **6 min** timeout risk | Only with slim builder + chunking |

**Rough live load math (40 projects, ~4 s per project server time, batch 2):**  
20 round trips × (4 s compute + ~1 s client latency) ≈ **100 s minimum**; batch 4 + slim builder (~2.5 s/project, 10 trips) ≈ **35–45 s**.

## UI notes

### Shared loading helper

Add **`#fos-loading-source`** (or reuse **`#fosLoadingBody`** second line) on:

| Panel | Overlay id | Today |
| --- | --- | --- |
| Agreement | `#agreement-loading` | Generic "Loading data…" |
| Utilization | `#util-loading` | Generic |
| Labor hours | `#lh-loading` | "Loading week…" |
| Delivery list | `#delivery-loading` | Generic |
| Delivery P&L | `#delivery-pnl-loading` | "Fetching monthly P&L…" |
| Revenue review | `#rr-loading` | Generic |
| Portfolio P&L | `#ppnl-loading` | Progress only; no source |
| Expenses | `#exp-loading` | Generic |
| AI Usage | `#aiu-loading` | Generic |
| Global modal | `#fosLoadingModal` | "Please wait…" |

Pattern:

```text
Loading portfolio P&L…
Source: Live Fibery
Fetching P&L for all projects… (6 / 40 projects · 4 from cache, 2 from Fibery)
```

### Portfolio refresh row

Add optional badge next to **`Last refreshed`**: **`Fibery`** | **`Cache`** | **`Snapshot · date`**.

## Data model

### Server payload extensions (Phase B)

**`getPortfolioProjectPnLBatch`** results unchanged shape; builder may omit empty optional blocks when `portfolioMode: true`.

**`getPortfolioProjectIndex()`** MAY add:

```javascript
loadHints: {
  batchSizeDefault: 3,
  slimPortfolioBuilder: true
}
```

### Load-source context (client only)

```javascript
{
  mode: 'live' | 'snapshot',
  snapshotDate: 'YYYY-MM-DD' | null,
  transport: 'fibery' | 'sessionStorage' | 'driveSnapshot' | 'driveDailyCache' | 'spreadsheet',
  detail: 'optional human suffix'
}
```

No secrets in labels.

## Operations

### Queries

- Existing: **`getPortfolioProjectIndex`**, **`getPortfolioProjectPnLBatch`**, **`getDashboardSnapshotPnl`**.
- Phase C: **`getPortfolioPnLFromDriveCache_(dateKey)`**, **`buildPortfolioPnLDriveCache_()`**.

### Actions

- Activity: **`portfolio_pnl_load_source`** (optional, label `source=<token> · cached=<n> · fibery=<n>`).

## Edge cases

| Case | Behavior |
| --- | --- |
| Mixed cache + Fibery in one portfolio load | Progress line shows both counts; **`Last refreshed`** uses **`Mixed (cache + Fibery)`** or dominant source |
| TTL stale Agreement cache used for project index | Label **`Browser cache (stale)`** when stale badge visible |
| AI Usage snapshot mode | Keep existing live-only banner; loading source N/A |
| Expenses | Always **`Spreadsheet`** in live mode |
| Private mode / no sessionStorage | Omit cache label; show Fibery or Snapshot only |

## Verification steps

1. Open Portfolio P&L (live, cold cache): loading shows **`Source: Live Fibery`** and per-project Fibery fetches; note elapsed time.
2. Select one Delivery project (loads P&L), then open Portfolio P&L: first projects show **`from cache`** in progress text.
3. Switch **Data source** to snapshot with P&L artifacts: loading shows **`Snapshot · YYYY-MM-DD`**; no Fibery executions.
4. Open Agreement with warm cache: overlay shows **`Browser cache`** (and **`stale`** sublabel if past TTL).
5. Open AI Usage twice same day: second load shows **`Drive cache · YYYY-MM-DD`**.
6. After Phase B: compare cold Portfolio load time with **`PORTFOLIO_PNL_BATCH_SIZE=4`** vs 2; confirm Delivery P&L modal still has status + allocations.

## Implementation plan

### Phase A - Load-source UX (recommended first ship)

| Step | Work |
| --- | --- |
| A1 | Client: **`formatLoadSourceLabel_(ctx)`**, **`setPanelLoading_(panel, on, { title, source, subtext })`** in `DashboardShell.html` |
| A2 | Wire all panel overlays + **`setGlobalLoading_`** to pass source context |
| A3 | Portfolio: extend **`portfolioPnlSetLoading_`** with cache vs Fibery counts; track per-id source in load loop |
| A4 | Payload handlers set **`lastLoadSource`** on render state; show on **`Last refreshed`** rows |
| A5 | PRD **FR-120**, **AC-79**; docs **010**, **022** cross-links |

**Estimate:** 1–2 dev days. No cache schema bump unless portfolio aggregate adds `loadSource` field (optional).

### Phase B - Portfolio speed (same or follow-on release)

| Step | Work |
| --- | --- |
| B1 | **`PORTFOLIO_PNL_BATCH_SIZE`** in `adminSettingsRegistry.js`; use in `portfolioPnlDashboard.js` |
| B2 | **`buildPortfolioMonthlyPnLInternal_`**: shared labor/ODC/revenue path; skip status + allocations |
| B3 | Point **`getPortfolioProjectPnLBatch`** at slim builder |
| B4 | Diagnostics: **`_diag_portfolioPnLBatchProbe`** documents timing |

**Estimate:** 2–3 dev days. No Delivery P&L schema bump if slim output is server-only for portfolio batch (do not write slim payloads to **`writeDeliveryPnlCache`**).

### Phase C - Drive daily cache (optional)

Mirror **`aiUsageDashboardCache.js`**: **`portfolio-pnl-cache/YYYY-MM-DD/bundle.json`**, Settings flag, Refresh bypass.

### Phase D - Snapshot pre-aggregate (optional)

Extend **`dashboardSnapshotJob.js`**; feature **009** dataset table row; client snapshot path reads one file.

## Implementation checklist

- [x] Teamwork notebook approved
- [x] Phase A: load-source UX across dashboards
- [x] Phase B: batch size + slim portfolio builder
- [x] Phase C: Drive daily portfolio cache
- [x] Phase D: snapshot `portfolio-pnl.json`
- [x] Feature **034** follow-on: cold Live daily cache builds persist progress and continue in bounded server batches (`PORTFOLIO_PNL_LIVE_BUILD_BATCH_SIZE`)
- [x] PRD **FR-120**, **AC-79** released; version **2.16.0**
- [ ] Teamwork release task at ship

## Changelog

| Version | Date | Notes |
| --- | --- | --- |
| 2.26.0 | 2026-07-16 | Feature **034** replaces the Drive-enabled cold all-project loop with persistent `build-state.json`, continuation triggers, and sequential client progress polling. |
| 2.22.1 | 2026-07-08 | Portfolio load overlay always shows animated progress + current-activity statement during single-bundle Fibery/Drive/snapshot waits (paired with feature **031** export UX). |
| 2.16.0 | 2026-06-09 | Shipped Phases A–D: load-source UX, slim builder, **`getPortfolioPnLDashboardData`**, Drive **`portfolio-pnl-cache/`**, snapshot **`portfolio-pnl.json`**. **FR-120**, **AC-79**. |
| (draft) | 2026-06-09 | Initial spec: performance evaluation + load-source UX plan |

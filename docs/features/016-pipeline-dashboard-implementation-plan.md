# Implementation plan — Pipeline dashboard (Sales — Fibery HubSpot deals)

> Companion to [016-pipeline-dashboard.md](016-pipeline-dashboard.md). **Status: shipped v2.6.0** (2026-05-28). Released as **MINOR → PRD 2.6.0**, **FR-110**, **AC-66**. R0 data facts confirmed live (see feature spec § R0).

## Summary

| Item | Choice |
| --- | --- |
| **Release** | **MINOR** (`2.6.0`) — new top-level **Sales** nav group + new dashboard surface + new server endpoint + FR/AC lift. |
| **PRD gate** | Add **FR-110 / AC-66 / AC-67** to `docs/FOS-Dashboard-PRD.md`; bump **`FOS_PRD_VERSION`** to `2.6.0` + **every** `src/*` header + touched `docs/features/*` per `.cursor/rules/google-apps-script-core.mdc`. |
| **Auth** | Same default gate as the Fibery dashboards: **`requireAuthForApi_()`** + **`fiberyAccess`**. Reuse the `canAccess…_()` helper pattern; **no** Sales-team narrowing in v1 (approved). |
| **Data** | **Read-only** Fibery `HubSpot/Deal` via `fiberyClient.js`. Stage/pipeline are **free text**; won/lost/closed derived from **stage bucket** (Is Won/Is Closed are null). Numerics coerced from string/null. |
| **Server** | New module **`src/pipelineDashboard.js`** — `getPipelineDashboardData()` returns normalized `{ deals, aggregates, pipelines, asOf, partial?, warnings?, cacheSchemaVersion }`. |
| **Client** | **`src/DashboardShell.html`** — `#panel-pipeline.fos-agreement-root`: KPI strip, deals-by-stage accordion, revenue-by-quarter Chart.js (bars + lines), funnel, pipeline-view tabs, Export CSV, **global loading modal**, optional `sessionStorage` cache. |
| **Nav** | **`src/Code.js`** — `buildNavigationModel_()` adds **`sales-group`** (child `pipeline`) **between Home and Operations**; icon in `NAV_ICONS`. |
| **Out of scope v1** | Editable cells / local overrides, Weekly To-Dos, one-liner banner, write-back, FX, Drive snapshot artifact. |

## Phased delivery

### Phase 1 — Server read + normalize (1 d)

| Step | Task | Notes |
| --- | --- | --- |
| 1.1 | Create **`src/pipelineDashboard.js`** with JSDoc header (PRD version line) + public **`getPipelineDashboardData()`**; gate via **`requireAuthForApi_()`** + **`canAccessPipelineDashboard_()`** (mirror `canAccessExpensesDashboard_`, but default = any `fiberyAccess` user). | Match header/comment style of `fiberyAgreementDashboard.js`. |
| 1.2 | Fetch `HubSpot/Deal` via **`fiberyClient.js`** — select the field set in spec § Data source; expand **`Deal Owner` → Owner name** and **`company` → Company name**; paginate to **`PIPELINE_MAX_ROWS`** (default 2000). | Use existing Fibery query/paginate helpers; `q_limit` ≤ 1000 per page. |
| 1.3 | **Normalize** each deal → `{ id, name, company, pipeline, stage, bucket, amount, weightedAmount, probability, forecastCategory, forecastCategoryIsDerived, owner, closeDate, lastStageChangeDate, daysInStage, isWon, isClosed, isStale, description, nextStep, hubspotLink }`. | `bucket` via stage-pattern map (§1.4). `isWon = bucket==='won'`, `isClosed = bucket∈{won,lost}`. `isStale = /^stale\b/i` on name. Coerce numerics with `toNumber_(v)` (null/''→0). Convert document fields (description, nextStep) to safe plain text (strip). |
| 1.4 | **Stage bucketing**: default case-insensitive map from spec § R0 table; merge/override from Script Property **`PIPELINE_STAGE_BUCKET_MAP_JSON`**. Unmatched → `other` + push a `warnings[]` note (`Unmapped stage "<x>" (N deals)`). | Keep map in module constant `DEFAULT_STAGE_BUCKET_MAP_`. |
| 1.5 | **Exclude** deals whose name matches **`/^test/i`**. Do **not** exclude `STALE -` (flag only). | Mirror mockup's TEST exclusion. |
| 1.6 | **Forecast category** derivation (`deriveForecastCategory_`): commit (`proposing`/`negotiating`)→`COMMIT`; `discovery`/`demo`/`validation`→`BEST_CASE`; `prospecting`→`PIPELINE`; `won`→`CLOSED`; `lost`/`onhold`→`OMIT`; `implementation`→`CLOSED`. | Same logic as mockup. |
| 1.7 | **Server aggregates**: per-bucket `{ count, total }`; KPI totals — **Total Deal Amount** (active, non-lost), **Commit** (proposing+negotiating), **Best Case** (active Σ weighted, fallback amount×prob); quarter map `{ 'YYYY-Q#' → { won, commit, best, pipeline } }` keyed off `closeDate`. | Compute per **pipeline view** lazily on client, OR ship raw deals + let client aggregate per active view (preferred — matches mockup's `renderAll`). Server still ships an `all` aggregate for fast first paint. |
| 1.8 | Payload envelope: `{ deals, aggregates, pipelines: [distinct pipeline names], asOf: ISO, partial, warnings, cacheSchemaVersion: 1 }`. | Client cache key **`fos_pipeline_dashboard_v1`**. |
| 1.9 | Verify module is picked up by clasp (project auto-includes `src/**/*.js`; confirm vs `appsscript.json`). | Same as Expenses. |

### Phase 2 — Navigation: Sales group + panel skeleton (0.5 d)

| Step | Task | Notes |
| --- | --- | --- |
| 2.1 | **`buildNavigationModel_()`** — insert a new group **before** `operations-group`, **after** `home`: `{ id:'sales-group', type:'group', label:'Sales', active:false, children:[{ id:'pipeline', label:'Pipeline', active:false }] }`. Filter out for users failing `canAccessPipelineDashboard_` (parallels the `finance-group` filter). | Group order becomes Home → Sales → Operations → Delivery → Finance. |
| 2.2 | Update the `getDashboardNavigation` / `buildNavigationModel_` **JSDoc union** if it enumerates ids. Add **`NAV_ICONS['pipeline']`** (e.g. `bi-funnel` or `bi-graph-up-arrow`). | |
| 2.3 | **`DashboardShell.html`** — add **`#panel-pipeline.fos-agreement-root`** with `.fos-agreement-inner`, title **Pipeline Dashboard**, header **Refresh** + **Export CSV** buttons (reuse `var(--ag-accent)` button style). Register `els.panelPipeline`, top-bar title, nav wiring (`onNavClick`/`setActiveNav`), and **Data source ≠ Live** guard (v1 live-only → inline notice + disabled Refresh, mirror Expenses). | Copy `showExpenses`/`showRevenueReview` visibility pattern. |
| 2.4 | **Lazy fetch** on first open via `google.script.run.getPipelineDashboardData()`, wrapped in the **global loading modal** (`setGlobalLoading_('pipeline', true/false)` per v2.5.8). Cache to `sessionStorage`; honor `cacheSchemaVersion`. | Reuse `setGlobalLoading_`. |

### Phase 3 — Client view-model: KPIs + view tabs (1 d)

| Step | Task | Notes |
| --- | --- | --- |
| 3.1 | `pipelineState` holding `payload`, `activeView` (`'all'` + one per pipeline), `openStages` set, `sort`. Helper `pipelineViewDeals_(deals, view)`: `all` = sales pipelines (New Logo + X-Man + Partner; Existing Client = CS motion, excluded from `all` per mockup), else exact pipeline match. | Confirm "all" pipeline membership with product if Existing Client should be included. |
| 3.2 | **View tabs** from `payload.pipelines` (+ `All sales`). Hidden if only one pipeline. Changing view recomputes all sections (`renderPipelineAll_`). Log `pipeline_view_change`. | |
| 3.3 | **KPI strip** (3 tiles): Total Deal Amount, Commit, Best Case — each deals count + dollars; compute client-side from view deals (so tabs update them). Money via `formatMoneyCompact`. | No editable KPIs in v1 (drop mockup's click-to-edit). |

### Phase 4 — Deals-by-stage accordion + funnel (1 d)

| Step | Task | Notes |
| --- | --- | --- |
| 4.1 | **Stage accordion** in canonical bucket order; per-stage count + total; expand to list deals sorted by amount desc. Row: company, owner chip, days-in-stage (fresh/warn/stale color: <30 / 30–59 / ≥60), close date, forecast pill, stage, amount. Empty stages disabled. Persist open stages across re-render. | Dark-theme re-skin of mockup `.acc-*`; scope under `#panel-pipeline`. Show `STALE` chip when `isStale`. |
| 4.2 | **Funnel** grid of the six active stages: count + dollar total + proportional bar (max-count scaled). | Re-skin mockup `.funnel-*`. |
| 4.3 | Stage header toggle logs **`pipeline_stage_toggle`** (debounced/optional). | |

### Phase 5 — Revenue-by-quarter chart + Export CSV (1 d)

| Step | Task | Notes |
| --- | --- | --- |
| 5.1 | **`loadChartJs()`** once; build quarter buckets from view deals (won by `closeDate`; active pipeline/best/commit by `closeDate`). Pre-seed current 4 quarters. | Reuse existing Chart.js loader. |
| 5.2 | One mixed chart: **Closed Won = bars**, **Pipeline / Best Case / Commit = lines** (brand-token colors against dark bg). Tooltip formats money. Destroy/recreate on re-render. | Match mockup datasets. |
| 5.3 | **Export CSV** — serialize visible (view) deals: company, name, pipeline, stage, forecast category, amount, close date, days-in-stage, owner. Clipboard + file fallback; reuse the **copied-alert** pattern. Log **`pipeline_export`**. | |
| 5.4 | **Refresh** button re-fetches + rebuilds cache; logs **`pipeline_refresh`**. | |

### Phase 6 — Config, activity, docs, release (0.5–1 d)

| Step | Task | Notes |
| --- | --- | --- |
| 6.1 | **`adminSettingsRegistry.js`** — register **`PIPELINE_STAGE_BUCKET_MAP_JSON`**, **`PIPELINE_MAX_ROWS`**, **`PIPELINE_DASHBOARD_TTL_MS`** (optional), **`PIPELINE_VIEW_FILTERS_JSON`** (optional) with tooltips + group. | New "Pipeline" group or under an existing Sales/Fibery group. |
| 6.2 | **`userActivityLog.js`** — whitelist **`pipeline_refresh`**, **`pipeline_view_change`**, **`pipeline_export`**, **`pipeline_stage_toggle`** (Route `pipeline`); `nav_view` already generic. | |
| 6.3 | **PRD**: add **FR-110** + **AC-66 / AC-67**, §13 changelog row; bump header/body to **2.6.0**. | |
| 6.4 | **Version sweep**: `FOS_PRD_VERSION='2.6.0'` + `FOS_RELEASE_DESCRIPTION`; update PRD version line in **every** `src/*` `.js`/`.html` header; update `docs/features/000-overview.md` shipped line; flip this plan + feature doc headers to shipped. | Full sweep, not just changed files. |
| 6.5 | **Snapshot decision**: document **"Pipeline not in Drive snapshot bundle v1 — live-only under FR-105"** (no `pipeline.json`); no `dashboard-snapshot-cache-sync.mdc` change needed. | Follow-up PR if snapshots wanted later. |

## File touch list (expected)

| File | Action |
| --- | --- |
| `src/pipelineDashboard.js` | **Add** — Fibery read, normalize, bucket map, aggregates, caps, warnings, access gate. |
| `src/Code.js` | `buildNavigationModel_()` Sales group + filter; `FOS_PRD_VERSION` + `FOS_RELEASE_DESCRIPTION`; nav JSDoc. |
| `src/DashboardShell.html` | `#panel-pipeline` HTML, scoped dark CSS, JS view-model + accordion + chart + funnel + tabs + CSV + cache + global loading. |
| `src/userActivityLog.js` | Whitelist `pipeline_*` events. |
| `src/adminSettingsRegistry.js` | New Script Property keys/tooltips. |
| `src/*` (all clasp-pushed `.js`/`.html`) | PRD version header sweep → `2.6.0`. |
| `docs/FOS-Dashboard-PRD.md` | FR-110 + AC-66/AC-67 + §13 row + version `2.6.0`. |
| `docs/features/000-overview.md` | Shipped blurb + PRD version line. |
| `docs/features/016-pipeline-dashboard.md` | Flip header DRAFT → Released; FR/AC + version. |
| `docs/features/016-pipeline-dashboard-implementation-plan.md` | Flip status → shipped on release. |

## Risk / dependency notes

| Risk | Mitigation |
| --- | --- |
| **Free-text stages drift** (new stage names appear) | Pattern map + `other` bucket + `warnings[]`; map overridable via Script Property — no code change to add a mapping. |
| **`Is Won`/`Is Closed` null** | Derive closed/won from stage bucket (confirmed at R0); never branch on those raw fields. |
| **String/null numerics** | Central `toNumber_()` coercion; treat null as 0; never `NaN` into charts. |
| **"All sales" membership** (Existing Client included?) | Default excludes Existing Client (CS motion, per mockup); confirm with product — one-line constant if changed. |
| **Owner/company relation expansion cost** | Select related name fields in one query; cap rows via `PIPELINE_MAX_ROWS`; `partial` flag if capped. |
| **Document fields** (description/nextStep) | Convert to plain text + truncate; never inject raw HTML; escape on render. |
| **Snapshot mode** | Disable fetch + clear notice; do not call `getPipelineDashboardData` from snapshot bundle (no artifact v1). |
| **Activity PII** | Log route + view + counts only; no deal names in `label`. |

## Test plan

| # | Steps | Expected |
| --- | --- | --- |
| T1 | Fibery-authorized user → **Sales → Pipeline** | Group appears below Home; panel loads via global modal; KPIs/accordion/chart/funnel populate. |
| T2 | Non-Fibery user | No Sales group; `getPipelineDashboardData` rejects with safe error. |
| T3 | View tab switch (New Logo / X-Man / Partner / Existing Client / All) | All four sections recompute; KPIs change; no full reload. |
| T4 | Stage accordion expand | Deals sorted by amount; owner/days/close/forecast/amount correct; empty stages disabled. |
| T5 | Deal with stage `Discovery / Demo` / `Solutioning / Validation` / `Kickoff…` | Lands in `demo` / `validation` / `implementation` buckets respectively. |
| T6 | Deal named `Test Deal - For Report` | Excluded everywhere. `STALE -` deals included + flagged. |
| T7 | Deal with null `Amount` / null `Weighted` | Counts as `$0`; Best Case uses amount×prob fallback; no `NaN` in chart. |
| T8 | Revenue chart | Closed Won bars by close-date quarter; Pipeline/Best/Commit lines; ≥ current 4 quarters. |
| T9 | Funnel | Six active stages with count + dollars + proportional bar. |
| T10 | **Export CSV** | Clipboard/file matches visible view's deals + columns; copied alert shows. |
| T11 | **Refresh** | Re-fetches, rebuilds cache, `asOf` updates. |
| T12 | Snapshot / non-Live data source | No live fetch; spec'd notice; no errors. |
| T13 | **Activity** sheet | `pipeline_*` + `nav_view` rows accepted server-side. |
| T14 | Unmapped stage injected via test prop | Lands in `other`; `warnings[]` entry present. |

## Definition of done

- Feature spec **[016](016-pipeline-dashboard.md)** acceptance checklist satisfied.
- Main PRD + **semver** synced (`2.6.0`); **FR-110 / AC-66 / AC-67** added; App Versions registry row on next deploy (`FOS_RELEASE_DESCRIPTION`).
- Full `src/*` header sweep complete; `000-overview.md` updated.
- No new secrets; Fibery creds unchanged; read-only (no write-back).

## Changelog (this plan)

| Date | Change |
| --- | --- |
| 2026-05-28 | Initial implementation plan from approved feature spec; R0 stage/pipeline facts confirmed live (Fibery `HubSpot/Deal`). |

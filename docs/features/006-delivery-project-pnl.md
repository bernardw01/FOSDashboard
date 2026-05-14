# Feature: Delivery Dashboard — Active Projects + Per-Project P&L

> **PRD version 1.27.2** — Phase A shipped in v1.19.0; **Phase B** in v1.20.0; **Phase C (pacing strip, delivery signals, portfolio Sankey)** in v1.21.0.
> `src/Code.js` `FOS_PRD_VERSION` and every `src/*` file header MUST match the
> version line in `docs/FOS-Dashboard-PRD.md`.

## Status

| Phase | Scope | Target PRD | Status |
| --- | --- | --- | --- |
| **Phase A — activation + project list + monthly P&L** | Delivery panel activation (replaces the v1.0 "coming soon" stub) · Active projects table · row-click → **monthly P&L time-series** (one row per calendar month from project start through current month) with Revenue Recognized · Labor Cost · Expenses · Total Cost · Margin $ · Margin %; per-project lazy fetch of `Labor Costs` + `Other Direct Costs`; rollup KPI strip + lifetime totals row in the same card · refresh + TTL row · `sessionStorage` cache · activity events | v1.19.0 | **Shipped** |
| **Phase B — chart view + drill-down + projected months + CSV + search** | Table / Chart view toggle on the monthly P&L (stacked Labor + Expenses bars with an overlaid Revenue line via Chart.js) · per-month Revenue drill-down modal sourced from the cached `month.revenueItems[]` (zero extra Fibery fetches) · projected months tagged `projected: true` server-side (drops recognized-only filter on Revenue Items; defaults `DELIVERY_PNL_INCLUDE_PROJECTED_ODC` to `true`) and surfaced as a `Projected` pill in the table + muted bar fills in the chart · Copy CSV action on the P&L card · client-side substring search input in the Active Projects header (Project + Customer; persisted + debounced) · four new activity events (`delivery_pnl_view_toggle`, `delivery_pnl_month_drilldown`, `delivery_pnl_copy_csv`, `delivery_table_search`) · cache schema bump (`_v1` → `_v2`) | v1.20.0 | **Shipped** |
| **Phase C — predictive** | Client-only **pacing strip** on the P&L card (linear plan vs recognized + trailing 3-mo avg) · **Delivery signals** strip above Active Projects (rules on cached `projects[]` only) · **Portfolio margin-flow Sankey** (D3 + d3-sankey, visible-row aggregate) · Agreement Attention extensions in `agreementAlerts.js` (pacing / cost vs recognized / low recognition near duration end) | v1.21.0 | **Shipped** |

## Goal

Activate the **Delivery** left-nav entry (route id `delivery`, DOM panel
`#panel-delivery`) — currently a "coming soon" modal — as a **Delivery
Dashboard**: a top-level **Active Projects table** with each agreement's
contract value and completion %, and a per-row **profit-and-loss statement
that spans the life of the project at monthly granularity**. The P&L
shows, for every calendar month from the project's start through the
current month, the labor cost, expenses (Materials & ODC), revenue
recognized, gross profit ($), and margin (%).

The Active Projects table is a thin presentation layer over the existing
Agreement Dashboard server payload (`getAgreementDashboardData()`) — no
new Fibery query is required for it. The **monthly P&L is lazy-fetched
per project on selection** so the initial Delivery panel open stays
lightweight: each click triggers three small Fibery queries all scoped to
the clicked agreement (no date filter, full project lifetime) — Labor
Costs, Other Direct Costs, and recognized Revenue Items — and the server
returns a month-bucketed time-series the client renders directly. Per-
project responses are cached client-side in `sessionStorage` so
re-clicking a previously-opened project is instant.

## User stories

- As a **delivery lead**, I want to open the **Delivery** dashboard and see
  every active project I'm responsible for as a single sortable list, with
  the contract value and a clear completion % so I can prioritize which
  engagement to look at first.
- As a **finance reviewer**, I want to click any project row and see a
  **month-by-month P&L** for that project — revenue recognized minus
  labor and expenses, with the margin for each month — so I can spot
  the specific month a project tipped from profitable to unprofitable
  (and pinpoint why) without exporting to a spreadsheet.
- As a **delivery lead**, I want a **rollup KPI strip** at the top of the
  P&L card (Revenue · Total Cost · Margin %) so I get the lifetime
  picture at a glance, and the **monthly grid** below it for the detail.
- As an **executive**, I want margins colored in the monthly grid
  (green ≥ target, amber within 5 pts of target, red below) so the
  trouble months pop visually.
- As an **engineering manager**, I want completion % colored at a glance
  in the projects table (< 25% blue, 25–75% teal, 75–100% green, > 100%
  orange) so I can spot projects that are over- or under-burning.
- As an **admin**, I want **no new Fibery tokens or secrets** in any
  cached JSON, and the Delivery panel MUST share the auth + access
  controls used by the rest of the app (`requireAuthForApi_()`).

## Page anatomy

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Delivery Dashboard                            [ Refresh ] [Auto-refresh ▾] │
│ <subtitle: "<N> active projects · last refreshed <ts>">                    │
├────────────────────────────────────────────────────────────────────────────┤
│ Active projects                                                            │
│ ┌────────────────────────────────────────────────────────────────────────┐ │
│ │ Project │ Customer │ Type │ Status │ Contract Value │ Rev Rec │ % Cplt │ │
│ │ ──────────────────────────────────────────────────────────────────────│ │
│ │ <row …>                                                                │ │
│ └────────────────────────────────────────────────────────────────────────┘ │
│ Columns: Project · Customer · Type · Status · Contract Value               │
│          · Revenue Recognized · % Complete (progress bar) · Margin         │
├────────────────────────────────────────────────────────────────────────────┤
│ ── P&L card (renders when a row is selected) ─────────────────────────────│
│ ▸ <project name>                   <customer · type · workflow state · dur>│
│ ┌── KPI strip ──────────────────────────────────────────────────────────┐ │
│ │ Revenue Recognized $XX,XXX │ Total Cost ($XX,XXX) │ Margin XX% (tgt XX%) │
│ └───────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│ Monthly P&L                                                                │
│ ┌────────────────────────────────────────────────────────────────────────┐ │
│ │ Month   │ Revenue   │ Labor    │ Expenses │ Total Cost│ Margin $ │ Mgn%│ │
│ │ ──────────────────────────────────────────────────────────────────────│ │
│ │ Jan '24 │ $12,000   │ ($8,000) │ ($1,200) │ ($9,200)  │   $2,800 │ 23% │ │
│ │ Feb '24 │      $0   │ ($5,500) │      $0  │ ($5,500)  │ ($5,500) │  —  │ │
│ │ Mar '24 │ $24,000   │ ($9,400) │   ($600) │($10,000)  │  $14,000 │ 58% │ │
│ │ …       │ …         │ …        │ …        │ …         │ …        │ …   │ │
│ │ ──────────────────────────────────────────────────────────────────────│ │
│ │ Total   │ $XXX,XXX  │ ($XX,XXX)│ ($X,XXX) │ ($XX,XXX) │  $XX,XXX │ XX% │ │
│ └────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

Empty state: when no row is selected, the P&L card renders a light
placeholder (`"Select a project above to see its P&L."`) instead of being
hidden — keeps the layout stable. Selection is exclusive (one project at a
time, click-to-toggle deselects). When a project is selected, the **KPI strip
renders immediately** from data already in memory; the **monthly grid renders
with a spinner overlay** until the per-project Fibery fetch completes
(typically < 1 s).

## Data sources

Phase A pulls from **two server endpoints**:

### 1. Active Projects table — reuses `getAgreementDashboardData()`

Every column the Active Projects table needs is already on the existing
normalized `agreement` rows projected by
`src/fiberyAgreementDashboard.js` (`buildAgreementsQuery_()` +
`normalizeAgreements_()`). No new Fibery query for the table.

| Property | Fibery field | Used for |
| --- | --- | --- |
| `id` | `fibery/id` | Row identity. |
| `name` | `Agreement Management/Name` | Project column; P&L card title. |
| `state` | `workflow/state → enum/name` | Status column; active filter. |
| `type` | `Agreement Type → enum/name` | Type column; Internal exclusion. |
| `customer` | `Customer → Name` | Customer column; P&L subtitle. |
| `plannedRev` | `Total Planned Revenue` | Contract Value column + KPI strip rollup. |
| `revRec` | `Rev Recognized` | Revenue Recognized column + completion % numerator + KPI strip. |
| `laborCosts` | `Total Labor Costs` | KPI strip Total Cost rollup. |
| `materialsOdc` | `Total Materials & ODC` | KPI strip Total Cost rollup. |
| `margin` | `Current Margin` (× 100) | KPI strip Margin chip + Margin column. |
| `targetMargin` | `Target Margin` (× 100) | KPI strip Margin caption ("tgt XX%"). |
| `durStart`, `durEnd` | `Duration.{start,end}` | P&L subtitle. |
| `executionDate` | `Execution Date` | P&L subtitle fallback. |

### 2. Monthly P&L grid — NEW per-project lazy fetch

When a row is selected, the client calls a NEW endpoint
`getDeliveryProjectMonthlyPnL(agreementId)` which issues three small
Fibery queries scoped to the single agreement (no date filter — full
project lifetime) and aggregates the result server-side into a monthly
time-series. Each per-project fetch is independent and cached client-side
under its own `sessionStorage` key, so re-clicking a previously-opened
project is instant.

| Bucket | Fibery entity | Filter | Fields selected | Aggregation |
| --- | --- | --- | --- | --- |
| **Revenue per month** | `Agreement Management/Revenue Item` | `Agreement = X` AND `Revenue Recognized = true` | `Actual Amount`, `Target Amount`, `Actual Date`, `Target Date` | Group by month of `Actual Date` (fallback `Target Date`); sum `Actual Amount` (fallback `Target Amount`). |
| **Labor cost per month** | `Agreement Management/Labor Costs` | `Agreement = X` | `Cost`, `Start Date Time` | Group by month of `Start Date Time`; sum `Cost`. Paginated 1000 rows / page. |
| **Expenses per month** | `Agreement Management/Other Direct Costs` | `Engagement = X` AND `Status = "Actual"` | `Amount`, `Date`, `Status` | Group by month of `Date`; sum `Amount`. Excludes `Status = "Projected"` rows (opt-in via Script Property). |

The server-side aggregator produces the canonical month list (every
month from the earliest activity month through the current month, or
`durEnd` month if earlier) and emits zero rows for months within the
project window that had no activity in any of the three buckets. This
keeps the grid honest about project pacing without polluting the
display with months that pre-date the project or post-date its current
state.

### Cross-check: Fibery's native `Agreement P and L Items` (not fetched in Phase A)

Fibery already maintains a pre-aggregated monthly P&L roll-up for every
agreement under `Agreement Management/Agreement P and L Items` — one row
per `(agreement, Month-Year)` with `Duration Revenue`, `Duration Costs`,
`Margin $`, and `Margin %` precomputed. Phase A does **not** query this
entity (it would duplicate the work and doesn't split cost into labor
vs expenses, which the user explicitly requested). It is documented
here as a Phase B cross-check option: when discrepancies surface between
our client-summed totals and Fibery's precomputed roll-up, this entity
is the reconciliation source of truth.

## Computed values

### Active Projects table + KPI strip (lifetime rollups, no extra fetch)

| Id | Definition | Notes |
| --- | --- | --- |
| **§D.1 Contract Value** | `agreement.plannedRev` | Active Projects column; KPI strip caption. `formatMoneyCompact`. |
| **§D.2 Revenue Recognized (lifetime)** | `agreement.revRec` | Active Projects column; KPI strip "Revenue Recognized" chip. |
| **§D.3 Revenue Outstanding** | `max(0, plannedRev − revRec)` | KPI strip optional caption; floored at zero. |
| **§D.4 Completion %** | `revRec ÷ plannedRev × 100` | `null` when `plannedRev = 0` → renders `—`. Progress bar visually capped at 100%. |
| **§D.5 Lifetime Labor cost** | `agreement.laborCosts` | KPI strip Total Cost rollup. |
| **§D.6 Lifetime Materials & ODC** | `agreement.materialsOdc` | KPI strip Total Cost rollup. |
| **§D.7 Lifetime Total Cost** | `laborCosts + materialsOdc` | KPI strip Total Cost chip. |
| **§D.8 Lifetime Margin %** | `agreement.margin` (already 0–100) | KPI strip Margin chip; Active Projects Margin column. |
| **§D.9 Target Margin %** | `agreement.targetMargin` (already 0–100) | KPI strip Margin chip caption. |
| **§D.10 Margin variance bucket** | `margin − targetMargin` | ≥ 0 green · ≥ −5 amber · < −5 red. |
| **§D.11 Completion bucket** | < 25% blue · 25–75% teal · 75–100% green · > 100% orange | Drives the progress-bar fill color in the Active Projects table. |
| **§D.12 Active filter** | `state != "Closed-Lost"` AND `type != "Internal"` | Default — overridable via `DELIVERY_ACTIVE_STATES` / `DELIVERY_EXCLUDE_INTERNAL` Script Properties. |

### Monthly P&L grid (per-project lazy fetch)

| Id | Definition | Notes |
| --- | --- | --- |
| **§M.1 Project month list** | every yyyy-mm key from `max(durStart-month, earliest-activity-month)` through `min(today-month, durEnd-month)` | Inclusive on both ends. Months with zero activity within this window ARE shown (zero rows, no special styling) so pacing gaps are visible. Months outside this window with stray activity (e.g. labor logged after `durEnd`) ARE included and tagged with an "OOR" tooltip on the month label. |
| **§M.2 Month revenue** | sum of `Revenue Item.Actual Amount` (fallback `Target Amount` when `Actual Amount` is null) where `Revenue Recognized = true` AND month-of-`Actual Date` (fallback `Target Date`) = key | Recognized-only — projected revenue is out of scope for Phase A. |
| **§M.3 Month labor cost** | sum of `Labor Costs.Cost` where month-of-`Start Date Time` = key | Rows with null/zero `Cost` are skipped and counted in the server-side warning log. |
| **§M.4 Month expenses (Materials & ODC)** | sum of `Other Direct Costs.Amount` where month-of-`Date` = key AND `Status = "Actual"` | Set `DELIVERY_PNL_INCLUDE_PROJECTED_ODC = true` to also include `Status = "Projected"` (Phase B forecast view). |
| **§M.5 Month total cost** | `monthLabor + monthExpenses` | Rendered with parentheses + red tone in the grid. |
| **§M.6 Month gross profit** | `monthRevenue − monthTotalCost` | Negative renders red. |
| **§M.7 Month margin %** | `monthGrossProfit ÷ monthRevenue × 100` when `monthRevenue > 0`; `null` when `monthRevenue = 0` | Null renders as `—`. Margin-bucket color (green/amber/red) follows §D.10 thresholds compared against `agreement.targetMargin`. |
| **§M.8 Lifetime totals row** | per-column sums of every month in the grid | Margin % = `Σ grossProfit ÷ Σ revenue × 100`. Pinned to the bottom of the grid with a top border. |
| **§M.9 Lifetime totals reconciliation** | compare `Σ §M.3 (summed labor)` to `agreement.laborCosts`; compare `Σ §M.4 (summed expenses)` to `agreement.materialsOdc`; compare KPI-strip Margin % (`agreement.margin`) to derived `Σ grossProfit ÷ Σ revenue × 100` | Discrepancy > 5% of the lifetime value (or > 5 percentage points for the Margin %) surfaces a small `ⓘ` caption with a tooltip listing both values; below 5% stays silent. Never blocks render. |
| **§M.10 Out-of-range marker** | a month with activity but outside `[durStart-month, durEnd-month]` | Month label rendered italic with an "OOR" tooltip; row still contributes to totals. |

## UI / interactions

### Active Projects table

- **Header** above the table: `"Active projects"` + the row count (e.g. `"24
  active projects"`). A **search input** that filters the table client-side
  by Project / Customer substring is **deferred to Phase B** (decision #7) —
  Phase A relies on column-header sort.
- **Columns** (left → right): Project (ellipsis, `title` tooltip on overflow)
  · Customer · Type (badge pill) · Status (badge pill, color from `agreementThresholds.workflowStateColor`) · Contract Value (right-aligned `$` compact) · Revenue Recognized (right-aligned) · **% Complete** (progress bar + numeric label) · Margin (right-aligned `%` w/ variance dot).
- **Sort:** click any column header to sort ascending/descending. Default
  sort = Contract Value desc (consistent with the Agreement Dashboard's
  Financial performance table).
- **Selection:** click a row → row gets `.is-selected`, P&L card below
  re-renders. Click the same row again → deselects (P&L collapses to
  placeholder). Keyboard: `tabindex="0"` + Enter/Space activation, same
  pattern as FR-86's milestones modal.
- **Empty state:** "No active projects in the current cache. Refresh to check
  Fibery." Refresh button stays operable.

### P&L card

- Renders in `#panel-delivery .fos-delivery-pnl` directly below the table.
- **Header block** (top of the card): project name + customer + type + state
  pill + duration string on the left; **KPI strip** (3 chips: Revenue
  Recognized · Total Cost · Margin % with target margin caption) on the
  right. The KPI strip renders **immediately** on row selection from the
  already-cached agreement payload (no fetch wait).
- **Monthly P&L grid** (below the header): a regular table with sticky
  header. Columns: Month · Revenue · Labor · Expenses · Total Cost ·
  Margin $ · Margin %. Rows in chronological order, one per project
  month per §M.1. Bottom row is the **Total** row from §M.8.
- **Margin coloring (§M.7 + §D.10)**: green / amber / red background
  tint on the Margin % cell.
- **Negative values**: parentheses + red tone on Total Cost and any
  negative Margin $.
- **Discrepancy caption (§M.9)**: small `ⓘ Lifetime totals reconciliation`
  caption below the totals row when summed monthly labor or expenses
  deviates > 1% from the agreement's lifetime fields. Tooltip lists both
  numbers.
- **Loading state**: while
  `getDeliveryProjectMonthlyPnL(<agreementId>)` is in flight, render a
  centered spinner overlay scoped to the grid only (the KPI strip and
  header stay visible).
- **Placeholder state** (no row selected): "Select a project above to
  see its monthly P&L." — uses the same card shell so height is stable.

### Refresh + TTL

- Reuse the **Auto-refresh selector** + **Stale badge** pattern from the
  Agreement Dashboard. Cache key for the projects list:
  `fos_delivery_dashboard_v1`. Cache key per monthly P&L:
  `fos_delivery_pnl_<agreementId>_v1`. TTL preference persists in
  `localStorage` under `fos_delivery_dashboard_ttl_minutes_v1` and
  applies to BOTH cache families (so a single TTL knob controls the
  whole panel).
- Pressing **Refresh** invalidates the projects-list cache AND every
  `fos_delivery_pnl_*` key in `sessionStorage` (one round-trip per cached
  project the user re-opens after refresh).

### Activity events (FR-60 / activity log)

| Event | Route | Label format |
| --- | --- | --- |
| `delivery_panel_open` | `delivery` | `from=<previousNavId>` |
| `delivery_refresh` | `delivery` | `manual=true` or `manual=false` |
| `delivery_project_select` | `delivery` | `agreementId=<id> · name=<truncated>` |
| `delivery_project_deselect` | `delivery` | `agreementId=<id>` |
| `delivery_table_sort` | `delivery` | `column=<col> · direction=asc` (or `desc`) |
| `delivery_pnl_fetch_start` | `delivery` | `agreementId=<id>` |
| `delivery_pnl_fetch_done` | `delivery` | `agreementId=<id> · monthCount=<n> · ms=<elapsed>` |
| `delivery_pnl_fetch_error` | `delivery` | `agreementId=<id> · code=<err>` |

## Server contract

**Two new endpoints** in a new module `src/deliveryDashboard.js`:

### 1. `getDeliveryDashboardData()` — projects list

```js
function getDeliveryDashboardData() {
  requireAuthForApi_();
  // Reuse the Agreement Dashboard payload — same Fibery round-trip the
  // user already pays for when they visit Agreement Dashboard. The
  // existing function is idempotent and stateless server-side.
  var raw = getAgreementDashboardData();
  if (!raw.ok) return raw;            // pass-through error envelope

  var thresholds = getAgreementThresholds_();  // reuse §8 color maps
  var projects = buildActiveProjects_(raw.agreements, thresholds);

  return {
    ok: true,
    source: 'fibery',
    fetchedAt: raw.fetchedAt,
    cacheSchemaVersion: 1,
    ttlMinutes: raw.ttlMinutes,
    projects: projects,   // see shape below
  };
}
```

**Project row shape:**

```js
{
  id, name, customer, type, state,
  contractValue, revenueRecognized, revenueOutstanding,
  completionPct,             // 0..100 or null
  completionBucket,          // 'under' | 'building' | 'on-track' | 'over'
  laborCosts, materialsOdc, totalCost, // lifetime, from agreement payload
  marginPct,                 // 0..100 or null
  targetMarginPct,           // 0..100 or null
  marginVariance,            // marginPct - targetMarginPct
  marginVarianceBucket,      // 'green' | 'amber' | 'red'
  durStart, durEnd, executionDate,
  stateColor, typeColor,     // copy from existing thresholds
}
```

### 2. `getDeliveryProjectMonthlyPnL(agreementId)` — monthly time-series

```js
function getDeliveryProjectMonthlyPnL(agreementId) {
  requireAuthForApi_();
  if (!agreementId) return { ok: false, error: 'missing_agreement_id' };

  // Three small Fibery queries scoped to this single agreement.
  // No date filter — full project lifetime.
  var laborRows   = fetchLaborCostsForAgreement_(agreementId);
  var odcRows     = fetchOtherDirectCostsForAgreement_(agreementId);
  var revRows     = fetchRecognizedRevenueItemsForAgreement_(agreementId);

  var months = buildMonthlyPnL_({
    laborRows: laborRows,           // [{cost, startDateTime}]
    odcRows: odcRows,               // [{amount, date, status}]
    revenueRows: revRows,           // [{actualAmount, actualDate, targetAmount, targetDate}]
    durStart: getAgreementDuration_(agreementId).start,
    durEnd:   getAgreementDuration_(agreementId).end,
    includeProjectedOdc: getDeliveryIncludeProjectedOdc_(),
    targetMarginPct: getAgreementTargetMargin_(agreementId), // for coloring
  });

  return {
    ok: true,
    source: 'fibery',
    fetchedAt: new Date().toISOString(),
    cacheSchemaVersion: 1,
    agreementId: agreementId,
    months: months,                 // see shape below
    discrepancyCheck: {              // §M.9
      summedLabor:    sumLabor(months),
      lifetimeLabor:  raw.laborCosts,
      summedExpenses: sumExpenses(months),
      lifetimeExpenses: raw.materialsOdc,
    },
  };
}
```

**Month row shape (one per `months[i]`):**

```js
{
  key,              // 'yyyy-mm'
  label,            // 'Jan 2024'
  revenue,          // number (dollars)
  labor,            // number (positive; rendered as ($X))
  expenses,         // number (positive; rendered as ($X))
  totalCost,        // labor + expenses
  grossProfit,      // revenue - totalCost
  marginPct,        // number | null
  marginBucket,     // 'green' | 'amber' | 'red' | null
  outOfRange,       // bool — activity outside agreement.Duration (§M.10)
  hasActivity,      // bool — true if any of revenue/labor/expenses > 0
}
```

`getDeliveryCacheTtlMinutes()` mirrors the Agreement Dashboard helper
(`DELIVERY_CACHE_TTL_MINUTES`, default 10).

## Client cache contract

- **Projects list cache key:** `fos_delivery_dashboard_v1`. Value =
  `{ projects, fetchedAt, ttlMinutes, cacheSchemaVersion: 1 }`.
- **Per-project monthly P&L cache key:** `fos_delivery_pnl_<agreementId>_v1`.
  Value = `{ months, fetchedAt, ttlMinutes, cacheSchemaVersion: 1, discrepancyCheck }`.
- **TTL preference:** `fos_delivery_dashboard_ttl_minutes_v1` (single
  knob — applies to both cache families).
- **Filter state preference:** `fos_delivery_filters_v1`
  (`schemaVersion: 1`) — `{ sort: { column, dir }, selectedId: string|null }`.
- **Secrets:** none. Standard rule — never persist Fibery tokens.
- **Sticky panel render:** mirror the v1.13.1 pattern — track
  `lastRenderedFetchedAt` for the projects list AND a
  `lastRenderedPnLFetchedAt` per agreementId; skip re-render when the
  cached payload's `fetchedAt` matches what's already in the DOM.
- **Refresh button** invalidates the projects-list cache AND iterates
  `sessionStorage.keys()` to drop every `fos_delivery_pnl_*` entry, so
  the next selection refetches.

## Required Script Properties (additive only)

| Key | Purpose | Default |
| --- | --- | --- |
| `DELIVERY_CACHE_TTL_MINUTES` | Server-side seed for the **Auto-refresh** selector | `10` |
| `DELIVERY_ACTIVE_STATES` | (Optional, comma-separated) explicit whitelist of `workflow/state` values that count as "active". Empty = use the default rule (state ≠ Closed-Lost). | `` |
| `DELIVERY_EXCLUDE_INTERNAL` | When `true`, drop `Agreement Type = Internal` projects from the table | `true` |
| `DELIVERY_PNL_INCLUDE_PROJECTED_ODC` | When `true`, include `Other Direct Costs` rows with `Status = "Projected"` in §M.4. Phase A default = `false` (Actual only). | `false` |
| `DELIVERY_PNL_MAX_LABOR_ROWS` | Hard cap on how many Labor Cost rows the server will paginate per project (defensive). Set to `0` for unlimited. | `10000` |

No new Fibery-side properties are required. `FIBERY_HOST` /
`FIBERY_API_TOKEN` are already required by the Agreement Dashboard.

## Branding (normative summary)

- Reuse the **existing** root CSS variables from `src/DashboardShell.html`
  (Agreement PRD §9.5–§9.7 brand tokens).
- New CSS scope: `#panel-delivery .fos-delivery-*`. Mirror the structure
  of `.fos-financial-table` for the Active Projects table; mirror the
  structure of `.fos-section-card` + KPI strip for the P&L card.
- No in-panel logo (consistent with the v1.13.0 cosmetic rule across all
  dashboards).
- Progress-bar fill colors come from a new `deliveryThresholds.completionColor`
  bucket map (see §D.11).

## Acceptance criteria (testable; promoted into the main PRD as AC-43..AC-48)

- [ ] **AC-43 — Delivery panel activation.** Clicking the **Delivery** nav
      entry MUST open `#panel-delivery` instead of the generic "coming
      soon" modal. The header MUST surface the Delivery title, subtitle
      (`<N> active projects · last refreshed <ts>`), a **Refresh** button,
      an **Auto-refresh** selector with the same preset set as the
      Agreement Dashboard (5 / 10 / 30 min / Off), and a **Stale** badge
      that lights up when the cache exceeds the TTL.
- [ ] **AC-44 — Active Projects table.** The table MUST render one row per
      agreement matching the §D.12 active filter, with columns Project ·
      Customer · Type · Status · Contract Value · Revenue Recognized ·
      % Complete · Margin. Header click MUST sort by that column (toggle
      asc / desc; the active column MUST carry a visible indicator). The
      default sort MUST be Contract Value desc. The progress-bar fill in
      the % Complete column MUST follow the §D.11 bucket coloring; the
      Margin cell MUST surface a §D.10 variance dot.
- [ ] **AC-45 — P&L card header + KPI strip.** Clicking a row MUST render
      the P&L card directly below the table with the project header
      (name, customer, type, state pill, duration) on the left and the
      KPI strip (Revenue Recognized · Total Cost · Margin %) on the
      right — both rendered **synchronously** from the already-cached
      agreement payload, with no fetch wait. The selected row MUST carry
      `.is-selected`; clicking it again MUST deselect and revert the
      P&L card to the placeholder state. Keyboard activation
      (Enter / Space on focused row) MUST behave identically to mouse
      click.
- [ ] **AC-46 — Monthly P&L grid.** Within < 100 ms of row selection,
      a spinner overlay MUST appear in the monthly grid area while
      `getDeliveryProjectMonthlyPnL(<agreementId>)` is fetched. On
      success, the grid MUST render one row per month per §M.1, populate
      every §M.2–§M.7 cell, color the Margin % cell per §M.7 + §D.10,
      render negative Total Cost / Margin $ in `--ag-danger` with
      parentheses, and pin a Lifetime Total row at the bottom per
      §M.8. The grid MUST surface the §M.9 reconciliation caption when
      summed labor / expenses / margin diverge > 5% from the lifetime
      fields. Out-of-range months (§M.10) MUST render with italic month
      labels and an "OOR" tooltip. When the server returns
      `partial: true` (Labor Cost row cap hit per decision #13), a
      `"Partial data — capped at <N> rows"` badge MUST appear in the
      P&L card header.
- [ ] **AC-47 — Cache + selection persistence.** The projects-list
      payload MUST cache in `sessionStorage` under
      `fos_delivery_dashboard_v1` (`cacheSchemaVersion: 1`). The monthly
      P&L for each selected project MUST cache under
      `fos_delivery_pnl_<agreementId>_v1` and reuse the same TTL
      preference. Panel switches MUST NOT re-render the table or the
      monthly grid when their respective `fetchedAt` timestamps match
      the last-rendered values. Pressing **Refresh** MUST invalidate
      BOTH cache families. Selecting a project that has a fresh cached
      monthly P&L MUST render the grid synchronously (no spinner, no
      fetch).
- [ ] **AC-48 — Activity logging.** The eight activity events listed
      above MUST fire on the documented interactions. Logging failures
      MUST be swallowed silently and MUST NEVER block UI.

## Components / files

| File | Role | Status |
| --- | --- | --- |
| `src/deliveryDashboard.js` | **NEW.** `getDeliveryDashboardData()`, `getDeliveryProjectMonthlyPnL(agreementId)`, `getDeliveryCacheTtlMinutes()`, `buildActiveProjects_()`, `buildMonthlyPnL_()`, `fetchLaborCostsForAgreement_()`, `fetchOtherDirectCostsForAgreement_()`, `fetchRecognizedRevenueItemsForAgreement_()`, `deriveCompletionBucket_()`, `deriveMarginVarianceBucket_()`, `deriveMonthlyMarginBucket_()`, `_diag_sampleDeliveryPayload()`, `_diag_sampleMonthlyPnL(agreementId)` editor helpers. | new |
| `src/fiberyClient.js` | Add reusable helpers for the three per-agreement queries (`fetchLaborCostsForAgreement_`, `fetchOtherDirectCostsForAgreement_`, `fetchRecognizedRevenueItemsForAgreement_`) since they may be reused by future features. **Alternative**: keep them private inside `src/deliveryDashboard.js`. Decide before coding (item #2 below). | modify (TBD) |
| `src/DashboardShell.html` | Add `#panel-delivery` markup; new CSS scope; client render functions (`renderDeliveryTable`, `renderDeliveryPnLHeader`, `renderDeliveryPnLKpis`, `renderDeliveryMonthlyGrid`, `selectDeliveryProject_`, `loadDeliveryPnLForProject_`); wire `els.panelDelivery`; route handler `showDelivery()` replacing the prior `showComingSoon` for nav id `delivery`; per-project cache plumbing + spinner overlay scoped to the grid only. | modify |
| `src/Code.js` | Bump `FOS_PRD_VERSION` to `1.19.0`. No nav-model change required. | modify |
| `src/agreementThresholds.js` | Add `completionColor` (4-bucket) + `marginVarianceColor` (3-bucket) maps and corresponding Script Property overrides keyed `DELIVERY_COMPLETION_*` and `DELIVERY_MARGIN_VARIANCE_*`. | modify |
| `docs/FOS-Dashboard-PRD.md` | New **FR-89** (Delivery panel activation), **FR-90** (Active Projects table contract), **FR-91** (P&L header + KPI strip contract), **FR-92** (Monthly P&L grid contract — Revenue / Labor / Expenses / Total / Margin per month + Lifetime Total row + OOR + reconciliation), **FR-93** (Delivery cache + per-project P&L cache contract); **AC-43..AC-48**; bump PRD to **1.19.0**; new changelog row; update §3 summary line; new **§11 Delivery Dashboard** section between §8 and §9. | modify |
| `docs/features/006-delivery-project-pnl.md` | This file. | new |
| `README.md` | Update the Delivery row from "still opens the shared coming-soon modal" to a Phase A summary identical in shape to the Operations + Agreement Dashboard rows. | modify |
| Every other `src/*` + `docs/features/*` header | Sync version to `1.19.0`. | modify |

## Implementation plan

### Phase A — activation + project list + monthly P&L (target v1.19.0)

1. **Pre-flight** — confirm Fibery `Labor Costs` rows populate `Cost` +
   `Start Date Time` and `Other Direct Costs` rows populate `Amount` +
   `Date` + `Status` on a live workspace. Spot-check via the existing
   Fibery MCP or a one-off Apps Script editor run.
2. **Decide query-helper home** — either add the three per-agreement
   helpers to `src/fiberyClient.js` (reusable, more refactor) or keep
   them private inside `src/deliveryDashboard.js` (cleaner blast radius
   for v1.19.0). Default: keep private; promote if Phase B needs them.
3. **Server**:
   a. Create `src/deliveryDashboard.js` with the two new endpoints +
      private helpers + diagnostic helpers.
   b. `getDeliveryDashboardData()` calls `getAgreementDashboardData()`,
      filters via §D.12, projects per-agreement → the documented row
      shape, returns the projects-list payload.
   c. `getDeliveryProjectMonthlyPnL(agreementId)` issues three Fibery
      queries scoped to the agreement (paginated via the existing
      `fiberyClient.queryEntities` plumbing) and calls
      `buildMonthlyPnL_()` to bucket by month, compute §M.2–§M.7,
      flag §M.10 OOR rows, and emit the §M.9 reconciliation block.
4. **Thresholds**: extend `src/agreementThresholds.js` with
   `completionColor` (4-bucket) and `marginVarianceColor` (3-bucket) maps,
   plus Script Property overrides keyed `DELIVERY_COMPLETION_*` and
   `DELIVERY_MARGIN_VARIANCE_*`. The monthly-margin bucket reuses
   `marginVarianceColor` thresholds.
5. **Client**:
   a. `#panel-delivery` markup, scoped CSS, render functions, and
      `showDelivery()`.
   b. Wire row selection into a module-level `deliveryState =
      { sort, selectedId, lastRenderedFetchedAt, pnlByAgreement: {} }`.
      Persist `sort + selectedId` in `localStorage`.
   c. **On row click**: synchronously render the P&L header + KPI strip
      from the agreement payload; check
      `fos_delivery_pnl_<id>_v1` — if fresh, render the grid from
      cache; otherwise show the grid spinner overlay and call
      `getDeliveryProjectMonthlyPnL(id)`.
   d. Mirror the v1.13.1 loading overlay + sticky-render pattern (the
      v1.14.2 viewport-fixed spinner is scoped to full-panel loads only;
      the per-grid spinner is a smaller, in-card overlay).
   e. On **Refresh**, drop `fos_delivery_dashboard_v1` AND every
      `fos_delivery_pnl_*` key, then reload.
6. **Activity logging**: emit `delivery_panel_open`, `delivery_refresh`,
   `delivery_project_select`, `delivery_project_deselect`,
   `delivery_table_sort`, `delivery_pnl_fetch_start`,
   `delivery_pnl_fetch_done`, `delivery_pnl_fetch_error` via
   `logActivity_`.
7. **Docs**: PRD bump 1.18.0 → 1.19.0; add FR-89..93, AC-43..48, new §11
   section; sync every file header; update README.
8. **Verification**: `ReadLints` clean; manual trace of all eight
   activity events; verify cache keys + cacheSchemaVersion match the
   doc; verify §M.9 reconciliation caption appears when expected
   (manually edit a Labor Cost row in Fibery, refresh, confirm the
   caption surfaces and lists both values).

### Decisions (locked in 2026-05-13 before Phase A coding)

The decisions below carry forward from the original lifetime-summary
plan unless noted as **REVISED 2026-05-13**.

1. **"Active project" definition.** `state != "Closed-Lost"` AND
   `type != "Internal"` — overridable via Script Properties.
2. **Completion %.** `revRec ÷ plannedRev × 100`; `null` when
   `plannedRev = 0` renders as `—`.
3. **P&L basis — REVISED.** The P&L is now a **monthly time-series** with
   one row per calendar month. Each row uses **recognized basis** —
   that month's `revenue − (labor + expenses)`. The contract-basis
   number is no longer shown as a separate line; it surfaces only in the
   KPI strip as "Contract Value" caption. (User request 2026-05-13.)
4. **"Value" column semantics.** Total Contract Value =
   `agreement.plannedRev`.
5. **Row click affordance.** Below-the-table split view. Selection is
   exclusive; click-again deselects.
6. **Materials & ODC line.** Always render the Expenses column in every
   month, even when zero, so the grid structure is identical across
   projects.
7. **Search input.** Deferred to Phase B.

### Decisions locked (2026-05-13, after the monthly-P&L scope change)

The scope change to monthly P&L raised seven additional decisions
beyond the seven in the previous block. All locked before Phase A
coding. Numbered M.1–M.7 to distinguish them from the original 1–7.

- **M.1 Revenue date basis for monthly bucketing.** Use `Revenue
  Item.Actual Date` when populated, fall back to `Target Date`
  otherwise.
- **M.2 Projected ODC inclusion.** Phase A includes **Actual only**.
  Operators can opt in to Projected too by setting
  `DELIVERY_PNL_INCLUDE_PROJECTED_ODC = true`.
- **M.3 Out-of-range activity (§M.10).** Months with activity outside
  `agreement.Duration` are **included** in the grid with an italic
  "OOR" tooltip on the month label. Activity totals still contribute
  to the Lifetime Total row.
- **M.4 Zero-activity months within `Duration`.** Render as zero rows
  (visible but muted) so pacing gaps stay honest.
- **M.5 Reconciliation tolerance (§M.9).** Surface the caption only
  when the discrepancy exceeds **5%** of the lifetime field. Below
  5%, treat as rounding / formula drift and stay silent.
- **M.6 Labor-cost row cap.** `DELIVERY_PNL_MAX_LABOR_ROWS = 10000`
  per project. If exceeded, server returns `partial: true` and the
  client surfaces a `"Partial data — capped at <N> rows"` badge in
  the P&L card header.
- **M.7 Lifetime KPI Margin source.** Use the precomputed
  `agreement.margin` from Fibery's formula (consistent with the
  Active Projects table). The monthly Lifetime Total row's Margin %
  derives from `Σ grossProfit ÷ Σ revenue` so the two values may
  differ — surface the §M.9 caption when they diverge by more than
  the M.5 threshold.

### Phase B — chart view + drill-down (target v1.20.0; NOT in v1.19.0)

- **Chart toggle** on the monthly P&L card: switch the grid view to a
  stacked-area chart (Revenue line over Labor + Expenses stack) using
  Chart.js (already loaded for the Agreement Dashboard).
- **Drill-down**: clicking a Revenue cell in the monthly grid opens the
  FR-86 milestones modal filtered to that month.
- **Projected months**: include future-dated Revenue Items + Projected
  ODC rows (Script Property opt-in for Phase A; default-on in Phase B)
  rendered with a "Projected" pill in the month label.
- **CSV copy / clipboard** for the P&L grid (one button → tab-separated
  blob).
- **Client-side project search input** in the Active Projects table
  header.

### Phase C — predictive (speculative; needs a separate spec)

- Burn-rate forecast — fit a simple linear regression on monthly cost +
  recognition trajectories; project end-of-recognized-revenue date;
  flag projects where the burn line crosses the planned-revenue line
  before the agreement duration ends.
- Pacing alerts in the Agreement Dashboard's Attention panel.

## Execution notes

- **Per-project lazy fetch.** The Active Projects table loads from
  the existing Agreement Dashboard payload (no extra Fibery cost).
  Each project's monthly P&L is fetched only when the user clicks the
  row — three small per-agreement queries (Labor Costs, Other Direct
  Costs, Revenue Items), all scoped by `Agreement = X` so the round-trip
  is short (typically a few hundred Labor Cost rows for a multi-year
  project).
- **Reuse `requireAuthForApi_()`.** No new auth surface; the Delivery
  panel inherits the same per-user authorization the rest of the app
  uses, including the v1.18.0 Fibery-access gate.
- **Reuse the existing branding tokens.** No new color variables are
  introduced; the Delivery panel binds to the existing
  `--ag-bg / --ag-surface / --ag-text / --ag-success / --ag-danger`
  palette. The monthly-margin bucket coloring reuses the
  Operations-dashboard cell-tint variables.
- **Cache independence.** The projects-list cache and each
  per-project monthly P&L cache are independent so the user can
  navigate freely without re-fetching. **Refresh** clears both
  cache families.
- **Discrepancy never blocks render.** If the server's summed monthly
  totals (§M.3 / §M.4) diverge from the agreement's lifetime fields,
  the §M.9 caption surfaces but the grid still renders. Users see the
  inconsistency without losing the data.
- **Diagnostic helpers.** `_diag_sampleDeliveryPayload()` MUST log
  `{projectCount, sample: projects[0], filtersApplied}`.
  `_diag_sampleMonthlyPnL(agreementId)` MUST log
  `{monthCount, firstMonth, lastMonth, sumRevenue, sumLabor,
   sumExpenses, discrepancyCheck}` so a future schema change in any
  of the three source entities surfaces quickly without redeploying.

## Possible follow-ups (not in scope for v1.19.0)

- **CSV export** of the monthly P&L grid (one button → `data:text/csv`
  blob).
- **Internal projects toggle** in the Active Projects table header,
  parallel to the Operations panel's Internal-labor toggle.
- **Margin trend sparkline** in the P&L card header — leverages the
  monthly data already in memory.
- **Cross-project P&L comparison** — multi-select projects, render a
  combined monthly grid (Phase C territory).
- **Active project alerts** — extend `agreementAlerts.js` with a
  delivery-scoped severity (e.g. "three consecutive negative-margin
  months") and surface in a small attention strip above the Active
  Projects table.

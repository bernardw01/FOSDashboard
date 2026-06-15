# Feature: Portfolio Project P&L (Finance)

> **PRD version 2.13.5** - sync with `docs/FOS-Dashboard-PRD.md`  
> **Feature id:** 022 | **Task list:** Finance  
> **Teamwork notebook:** [Feature 022 - Portfolio Project P&L](https://win.godeap.io/app/projects/1615262/notebooks/311833)  
> **Release task:** [Feature 022 - Portfolio Project P&L](https://win.godeap.io/app/tasks/40161428)  
> **Intake:** [Inbox task 40160887](https://win.godeap.io/app/tasks/40160887)  
> **Extends:** [Feature 006 - Delivery project P&L](006-delivery-project-pnl.md)  
> **Status:** Implemented (**v2.13.5**; deploy with `clasp push`)

## Goal

Give finance and executive users a **portfolio-wide profit-and-loss view** that rolls up **all in-scope Subscription and Services agreements** into one hierarchical grid: **Portfolio → Customer → Project**, with **monthly columns**, **quarter subtotals**, and a **full-year total**. The surface lives under the **Finance** nav group and reuses the same Fibery P&L data already fetched for Delivery per-project P&L (labor, ODC, revenue milestones), with labor split into **Employee** vs **Contractor** using the same internal-company rule as Utilization.

## User stories

- As a **finance reviewer**, I want to open **Portfolio P&L** and see revenue, costs, margin $, and margin % for the **entire portfolio** in one place so I can compare customers and projects without clicking each Delivery row.
- As an **executive**, I want **customer subtotals** and a **portfolio total row** with quarterly and annual rollups so I can answer "how did Q2 look across delivery?" without exporting to Excel.
- As a **finance reviewer**, I want labor costs split into **Employee** (harpin company) and **Contractor** (all other companies) so contractor spend is visible separately from employee labor.
- As a **finance reviewer**, I want revenue split into **Subscription** and **Services** (per the sample workbook) so product-line mix is visible at project and rolled-up levels.
- As an **admin**, I want the view to respect existing **auth gates** (Finance team / Exec / Admin, same as Expenses) and **not expose secrets** in cached JSON.

## Reference layout (from `Sample Structure.xlsx`)

The attached workbook defines the **row hierarchy** and **column structure** (not literal placeholder values):

```text
Row tree (column B labels)          Columns (C..S)
─────────────────────────────────────────────────────────────
Portfolio Revenue                   Jan … Dec | Q1 Q2 Q3 Q4 | FY
  Customer 1                        (customer subtotal = sum of its projects)
    Project 1                       (project subtotal = Revenue + Costs + Margin rows)
      Revenue                       Subscription + Services
        Subscription
        Services
      Costs                         Employee + Contractor + ODC
        Employee
        Contractor
        ODC
      Margin $
      Margin %
    Project 2                       (same block)
  Customer 2
    Project 3 …
```

**Formulas (from workbook):**

| Row | Formula |
| --- | --- |
| Revenue (project) | Subscription + Services |
| Costs (project) | Employee + Contractor + ODC |
| Margin $ | Revenue − Costs |
| Margin % | Margin $ ÷ Revenue (blank or ` - ` when Revenue = 0) |
| Project subtotal | Sum of that project's metric rows for the period |
| Customer subtotal | Sum of child projects |
| Portfolio total | Sum of customers (FY = Q1+Q2+Q3+Q4 = sum of months) |

**Column periods:** calendar months grouped with quarter subtotals immediately after each three-month block: **Jan, Feb, Mar, Q1, Apr, May, Jun, Q2, …, Dec, Q4, FY** (FY = sum of all months).

## Acceptance criteria (testable)

### Navigation and access

- [ ] Given a user with **Finance team**, **EXEC**, or **ADMIN** role, the sidebar **Finance** group includes a **Portfolio P&L** item (route id TBD, e.g. `portfolio-pnl`) that opens `#panel-portfolio-pnl`.
- [ ] Given a user **without** Expenses/Finance access, the Finance group (and Portfolio P&L link) is **hidden** and direct navigation shows the same friendly gate message used for Expenses.
- [ ] Given **Fibery access** is required for live data (same as Delivery), users without `fibery_access` see a clear not-authorized message; snapshot mode may still load when historical P&L artifacts exist (see Historical data).

### Grid structure and rollups

- [ ] Given live Fibery data, the grid renders a **Portfolio Revenue** top row equal to the sum of all in-scope projects' recognized-basis revenue for each period column.
- [ ] Given multiple customers, **Customer** header rows appear grouped alphabetically (or by configurable sort) with subtotals matching the sum of their projects.
- [ ] Given each project, child rows appear under expand toggles: **Revenue** → Subscription, Services; **Costs** → Employee, Contractor, ODC; then **Margin $** and **Margin %** (not all detail rows visible until Revenue/Costs are expanded).
- [ ] Given monthly columns, columns appear as **Jan, Feb, Mar, Q1, Apr … Dec, Q4, FY**; each quarter equals the sum of its three preceding months; **FY** equals the sum of all twelve months.
- [ ] Given Margin %, when Revenue = 0 for a period, the cell shows ` - ` (no divide-by-zero).

### Data mapping (reuse Delivery P&L)

- [ ] Given a project, **monthly revenue, labor, and ODC** match the same bucketing rules as [Feature 006](006-delivery-project-pnl.md) (`buildMonthlyPnL_`, revenue date = Actual Date then Target Date, ODC respects `DELIVERY_PNL_INCLUDE_PROJECTED_ODC`).
- [ ] Given labor cost rows, **Employee** = labor where `Clockify User Company` matches configured internal company names (default `harpin.ai`, `Harpin`; same list as `UTILIZATION_INTERNAL_COMPANY_NAMES` / `agreementThresholds.internalCompanyNames`); **Contractor** = all other labor in that month.
- [ ] Given ODC rows, **ODC** = sum of Other Direct Costs for the month (same as Delivery Expenses column).
- [ ] Given **Subscription** vs **Services** revenue split, **Agreement Type** assigns **all** of that project's monthly revenue to the matching row (Subscription-type → Subscription only; Services-type → Services only). No project appears in both rows.
- [ ] Given agreement **type** is not **Subscription** or **Services** (e.g. Internal, Partner), that agreement is **excluded** from the portfolio grid and from fetch progress totals.

### Performance and loading

- [ ] On panel open (live mode), a **progress indicator** is visible until all in-scope project P&L payloads are loaded. Copy MUST state that the dashboard is **fetching P&L for all projects** (not a single project), e.g. `"Loading portfolio P&L - fetching all project data (12 / 48 projects)…"`.
- [ ] Progress updates as each project completes (numerator/denominator of in-scope Subscription + Services agreements).
- [ ] Given a prior successful load within TTL, revisiting the panel reuses **sessionStorage** cache without refetching until Refresh or TTL expiry.
- [ ] Given one project fails to load, the grid still renders other projects and surfaces a **partial data** warning with **project names and error messages** (not ids only).
- [ ] Live mode loads P&L via sequential **`getPortfolioProjectPnLBatch`** server calls (default 2 agreements per execution), not parallel per-project **`google.script.run`** calls.

- [ ] **Group by quarter** toggle hides month columns and shows **Q1 - Q4 + FY** only; turning it off restores the interleaved month + quarter layout.
- [ ] Empty grid cells (zero amount) show **` - `** instead of **`$0`** or **`($0)`**.
- [ ] Sticky label column uses a **solid opaque** background when scrolling horizontally (no bleed-through from data columns).

- [ ] **Subscription** and **Services** checkboxes filter the grid and KPI totals (default both checked); at least one must stay selected; filter applies without refetching P&L.

### Layout and readability (v2.13.1)

- [ ] FY summary KPIs render in a **Portfolio summary** card as a **single inline row** (wraps to two lines on narrow widths); each **value** has a hover tooltip explaining what it includes.
- [ ] The portfolio grid sits **directly in the panel** (no nested "Portfolio grid" section card).
- [ ] Grid cells show **column borders**; numeric cells **wrap** when needed.
- [ ] **Customer** rows use a **larger font and distinct color** vs project rows.
- [ ] **Collapsed** project names **truncate** with ellipsis; **expanded** project names **wrap**.
- [ ] When **Include projected months** is on, projected month cells use **muted orange styling**; planned labor on projected months comes from **`resourceAllocations.months[].allocatedCost`** (Employee row; Contractor shows ` - `).

### Refresh, filters, and export (Phase B - optional if deferred)

- [ ] **Refresh** clears portfolio cache and refetches all in-scope projects.
- [ ] **Copy CSV** exports the visible grid (respecting expand/collapse) in the same column order as on screen.
- [ ] **Include projected months** toggle, default **off**: when off, rollups exclude months where Delivery marks `projected: true`; when on, include them with muted styling consistent with Delivery.
- [ ] Client-side filters (customer, agreement type, status) narrow which projects contribute to rollups, consistent with Delivery filters (reuse filter semantics from v2.11.2 where practical).

### Historical data (snapshot mode)

- [ ] Given **Data source = snapshot** and `delivery-pnl/<id>.json` artifacts exist for the snapshot date, Portfolio P&L aggregates from those files **without new Fibery calls**.
- [ ] Given a snapshot date missing some P&L files, the UI notes **partial P&L coverage** (reuse manifest `pnlProgress` / failed ids when available).

## UI notes

### Route and panel

| Item | Proposal |
| --- | --- |
| Nav group | **Finance** (below or above Expenses) |
| Nav label | **Portfolio P&L** |
| Route id | `portfolio-pnl` |
| DOM panel | `#panel-portfolio-pnl` |
| Chrome | Same dark Agreement/Delivery shell (`fos-agreement-root`), refresh + auto-refresh row, data-source badge when snapshot selected |

### Grid interaction

- **Expand/collapse:** Default **collapsed** to portfolio total + **customer subtotals** only. User expands a customer to see projects; expands a project for Revenue/Costs/Margin detail rows (Subscription, Services, Employee, Contractor, ODC).
- **Sticky** row labels (column B equivalent) while horizontally scrolling months.
- **Negative margins** use the same threshold coloring as Delivery monthly grid where applicable.
- **Empty state:** "No Subscription or Services projects in scope" when the filtered set is empty.

### Loading UX (Phase A - required)

- Full-panel or inline overlay while portfolio data loads (reuse global loading modal pattern where appropriate).
- Primary label: **Loading portfolio P&L** with subtext **Fetching P&L for all projects…**
- Progress: **`{loaded} / {total} projects`**; optional thin progress bar bound to the same ratio.
- On completion, overlay dismisses and the collapsed portfolio + customer rows render.

### KPI strip (recommended Phase A)

Optional top strip: **FY Revenue**, **FY Total Cost**, **FY Margin %**, **Projects in scope**, **Last refreshed**.

## Data model

### Server payload (proposed)

New endpoint `getPortfolioProjectPnL(options)` returning:

```javascript
{
  ok: true,
  source: 'fibery' | 'snapshot',
  fetchedAt: 'ISO-8601',
  cacheSchemaVersion: 1,
  ttlMinutes: 15,
  fiscalYear: 2026,           // calendar year in scope
  periods: ['2026-01', …],    // month keys present
  filtersApplied: { … },
  projects: [
    {
      agreementId: 'uuid',
      name: 'Project name',
      customer: 'Customer name',
      type: 'Services',
      state: 'In Progress',
      months: [ /* same month objects as Delivery P&L, plus splits */ ],
      lifetime: { … }
    }
  ],
  partial: false,
  failedAgreementIds: [],
  capCounts: { projectsRequested, projectsLoaded, projectsFailed }
}
```

Each month object extends Delivery's month shape with:

```javascript
{
  monthKey: '2026-01',
  revenue: number,
  revenueSubscription: number,
  revenueServices: number,
  laborEmployee: number,
  laborContractor: number,
  odc: number,
  totalCost: number,
  grossProfit: number,
  marginPct: number | null,
  projected: boolean
}
```

### Fibery query changes

| Need | Change |
| --- | --- |
| Employee vs Contractor | Extend `fetchLaborCostsForAgreement_` to select `Clockify User Company` on Labor Costs (same field as Utilization). |
| Subscription vs Services | **Agreement Type** on the agreement (only Subscription and Services agreements are in scope). |

**Inclusion (locked):** only agreements with **Agreement Type = Subscription** or **Agreement Type = Services**, plus Delivery-style active rules (`state != Closed-Lost` unless overridden). All other types are out of scope.

**Revenue split (locked):** Subscription-type → **Subscription** row only; Services-type → **Services** row only.

### Cache

| Key | Purpose |
| --- | --- |
| `fos_portfolio_pnl_v2` | sessionStorage; invalidate on `cacheSchemaVersion` bump (was `v1` in 2.13.0) |
| Server-side | Optional Script Cache shard per agreement (reuse Delivery P&L cache keys if added later) |

### Snapshot alignment

No new Drive artifact required for v1: aggregate existing `delivery-pnl/<agreementId>.json` files from the snapshot bundle. If server-side pre-aggregation is needed for performance, add optional `portfolio-pnl.json` in a follow-on patch and document in [009](009-dashboard-historical-snapshots.md).

## Operations

### Queries

- `getPortfolioProjectPnLBatch(agreementIds, startIndex, batchSize)` - live: process 1–4 agreements per server execution (default **2**); returns `{ results, failures, nextIndex, done }`.
- Snapshot: `getDashboardSnapshotCoreBundle` + batch read `delivery-pnl/*` via existing P&L snapshot API.

### Actions

- `portfolio_pnl_panel_open`, `portfolio_pnl_refresh`, `portfolio_pnl_export_csv`, `portfolio_pnl_expand_toggle` activity events (mirror Delivery naming).

## Edge cases

| Case | Behavior |
| --- | --- |
| No projects in scope | Empty state; KPI strip shows zeros |
| Single customer | Still show Customer subtotal row |
| Project with no activity in a month | Show zero rows (consistent with Delivery M.4) |
| Projected months | Controlled by toggle (default **off**); when on, muted styling |
| Labor row missing company | Treat as **Contractor** |
| Non Subscription/Services agreement | **Excluded** from portfolio (not shown, not counted in progress total) |
| Apps Script execution time | Batch projects via **`getPortfolioProjectPnLBatch`**; sequential client batches; progress indicator; partial warning with names + messages |

## Verification steps

1. Confirm inbox attachment `Sample Structure.xlsx` row/column layout matches rendered grid structure (hierarchy and Q/FY columns).
2. Sign in as Finance user; open **Portfolio P&L**; confirm loading progress then portfolio total matches manual sum of Delivery P&L exports for 3 sample projects.
3. Pick one project: compare Employee + Contractor + ODC for one month against Delivery chart/modal totals (Employee+Contractor = Labor).
4. Toggle **Data source** to a snapshot date with P&L artifacts; confirm no Fibery executions and totals match sum of snapshot JSON files.
5. Sign in as non-Finance user; confirm Finance group hidden.
6. Simulate one failed project fetch; confirm partial warning and remaining projects render.

## Implementation checklist

- [x] Customer review: scope, access, loading UX, projected toggle default
- [x] R0: validate Labor Cost `Clockify User Company` field on live Fibery data
- [x] Server: extend labor fetch + `portfolioPnlDashboard.js` index endpoint
- [x] Client: `#panel-portfolio-pnl` tree grid + progress loading
- [x] Nav: Finance **`portfolio-pnl`** route + Expenses access gate
- [x] Activity logging + sessionStorage cache
- [x] Snapshot mode aggregation from `delivery-pnl/*`
- [x] PRD FR-116 / AC-74 + version bump (**2.13.0**; patch **2.13.1** UX + batch load)
- [x] Teamwork notebook + release task intake (Spec Draft)
- [ ] Teamwork release task rename at ship (`teamwork_ship_task.py`)
- [ ] Smoke test after `clasp push`

## Decisions (locked)

| Topic | Decision |
| --- | --- |
| Year scope | **Calendar year** for the current date (Jan–Dec + Q1–Q4 + FY). Year selector deferred to Phase B. |
| Project scope | **Subscription** and **Services** agreements only; active = `state != Closed-Lost` (same as Delivery). All other agreement types **excluded**. |
| Projected months | **Toggle**, default **off** |
| Access | **Finance / EXEC / ADMIN** (same as Expenses) |
| Revenue split | **Agreement Type**: Subscription → Subscription row; Services → Services row |
| Missing company on labor | **Contractor** |
| Default expand | **Collapsed:** portfolio + customer subtotals; expand to drill down |
| Loading UX | Progress indicator + explicit **fetching all project P&L data** messaging (`loaded / total` projects) |

## Change log

| Date | Change |
| --- | --- |
| 2026-06-12 | Draft requirements from Inbox 40160887 + `Sample Structure.xlsx`. |
| 2026-06-12 | Customer review: Agreement Type revenue split; Finance/EXEC/ADMIN access; calendar year; projected-month toggle (default off); collapsed customer-level default. |
| 2026-06-12 | Implemented v2.13.0: Finance Portfolio P&L panel, progress loader, schema 8 labor splits. |
| 2026-06-13 | Patch v2.13.5: **Expenses** nav hides Portfolio P&L panel (`showExpenses` adds `d-none` on `#panel-portfolio-pnl`). |
| 2026-06-12 | Patch v2.13.4: **Subscription** / **Services** agreement-type filter checkboxes. |
| 2026-06-12 | Patch v2.13.1: sequential batch P&L load (`getPortfolioProjectPnLBatch`), partial-failure detail, KPI card + tooltips, column order (months + quarter blocks), revenue/cost expand groups, projected-month styling + allocation labor, grid readability (borders, wrap, customer emphasis, project name truncate/wrap). |

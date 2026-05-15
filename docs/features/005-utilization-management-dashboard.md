# Feature: Utilization Management Dashboard (Fibery Labor Costs)

> **PRD version 1.27.3** — see `docs/FOS-Dashboard-PRD.md`. Phase A was delivered in v1.12.0 (new FRs FR-70–FR-76 + AC-22 / AC-23 + new **§8 Utilization Management Dashboard** added to the main PRD). Phase B was delivered in v1.13.0 (FR-77–FR-79 + AC-24 / AC-25 + AC-26). v1.13.1 is a UX-polish patch shared with the Agreement Dashboard (loading overlay + sticky panel render — see AC-27 in the main PRD). **Phase C was delivered in v1.14.0** (FR-80 / FR-81 / FR-82 + AC-28 / AC-29 / AC-30 / AC-31 / AC-32 / AC-33 / AC-34 / AC-35 in the main PRD — adds the Utilization Alerts panel, Person × Week heatmap with a heatmap-local Role filter (top 30 contributors), Pending Approvals widget, and row-detail drawer; bumps the client cache schema 1 → 2 to carry `aggregates.byPersonWeek` + `alerts[]`). **v1.15.0** rebuilds the row-detail drawer's **Open in Fibery →** anchor: the old hard-coded URL (wrong host, wrong path, wrong slug) is replaced by a server-supplied deep-link template, and the anchor is gated by a new **`fibery_access`** column on the Users sheet (FR-83 / FR-84 + AC-36 / AC-37). **v1.16.0** reorganizes the Utilization Alerts panel from a flat list to **per-person collapsible groups** (server payload unchanged; presentation transform only — see FR-80 v1.16.0 clause + AC-38). **v1.17.0** revises the grouping axis from `target.person` to alert **`kind`** (Under-utilized / Over-allocated / Stale approvals) per operator feedback that managers triage one class of issue at a time, and adds a **Collapse all** button in the panel header that closes every group in one click (FR-80 v1.17.0 clause + AC-38 revision + new AC-39). **v1.18.0** ships four targeted improvements: (a) **Heatmap cell click → modal** listing the contributing labor entries (replaces the v1.14.0 pin-Person + switch-range drill that forced a fresh Fibery fetch on every click — FR-85 + AC-40); (b) **Persons multi-select alpha-sort** in the menu while preserving the server's hours-desc order for heatmap rows (FR-87 + AC-42); (c) **Fibery link tolerance** — loose-match column header fallback in `findHeaderIndex_`, scheme/trailing-slash scrub in `getFiberyDeepLinkConfig_`, devtools console diagnostic in `getFiberyLaborCostUrl_`, and a new `_diag_fiberyAccess()` editor helper (FR-88 + AC-42); plus the Agreement Dashboard milestones modal (FR-86 + AC-41 — see feature 003).

## Status

| Phase | Scope | Target PRD | Status |
| --- | --- | --- | --- |
| **Phase A — Live wiring + core charts** | Operations panel activation · KPI strip · Hours-by-Customer · Hours-by-Project · Weekly trend · Billable vs Non-billable · Customer + Project filters · Billable + Internal-labor toggles · Date-range preset · `sessionStorage` cache + Auto-refresh selector | v1.12.0 | **Delivered v1.12.0** |
| **Phase B — Cross-filter + drill-down + detail table** | Click-to-toggle on every chart (Role + Person added) · Role + Person + Billable filters · Filter chip bar · Detail table with sortable row-level entries · Persist filter state in `localStorage` · **Cosmetic: removed duplicate in-panel harpin logo from Agreement + Utilization dashboards (sidebar already brands the app)** | v1.13.0 | **Delivered v1.13.0** |
| **UX polish (v1.13.1)** | (1) Semi-transparent **`.fos-loading-overlay`** added inside `#panel-operations .fos-agreement-inner` — toggled on at the start of every `fetchUtilizationFromServer()` call and off in both handlers, covering initial load / Refresh / range change / background stale-refresh. (2) **Sticky panel render** — navigating away and back no longer re-runs `applyUtilPayload(cached)` when the cached payload's `fetchedAt` matches what the DOM already shows, preserving Chart.js + Detail-Table state across panel toggles. `applyStoredFilters_()` moves inside the no-skip branch so a cross-tab filter change cannot desync state from DOM. Stale-detection + background fetch logic (FR-73) still fires. See main PRD **FR-73**, **AC-27**. | v1.13.1 | **Delivered v1.13.1** |
| **Phase C — Heatmap + alerts + approval queue** | Person × Week utilization heatmap (custom SVG, top-30 contributors, **heatmap-local Role filter**, partial-week hatch overlay, click → pin Person + switch range) · Pending Approvals widget (cap 50, Show all toggle, age badges) · Utilization Alerts panel (`src/utilizationAlerts.js`: under-utilized / over-allocated / stale approvals) · Row-detail **drawer** (off-canvas right, Open in Fibery deep link, closable via button / backdrop / Escape) · Client cache schema bumped 1 → 2 to carry `aggregates.byPersonWeek` + `alerts[]` | v1.14.0 | **Delivered v1.14.0** |
| **Phase C correctness patch (v1.14.1)** | `isPendingApproval_` no longer flags `Approval = Approved` rows whose `Time Entry Status` is blank as pending (was producing 7,000+ false-positive stale-approval alerts in the field). Stale-approval alerts are now capped at the 20 oldest individual cards in the Alerts panel — any remainder is consolidated into a single `stale_approval_rollup` Warning card whose click flips the Pending Approvals widget into Show-all mode and scrolls to it. New editor helper `_diag_sampleUtilizationPending()` dumps the Approval × Time-Entry-Status distribution + the count the predicate flags as pending, for verifying the fix against live data. See main PRD **FR-80**, **AC-28**. | v1.14.1 | **Delivered v1.14.1** |

## Goal

Activate the **Operations** left-nav entry (route id `operations`; was a "coming soon" stub through v1.11.0, **activated in v1.12.0**) as a **Utilization Management Dashboard** powered by the Fibery `Agreement Management/Labor Costs` table. Surface how the harpin AI team spends time across customers and projects — billable vs non-billable, by role and by person — with **interactive cross-filtering** (click any chart element to constrain the whole view) and **row-level drill-down** to individual labor entries. Global filters by **Customer** and **Project** apply to every visualization on the page.

Reuse the existing Fibery wiring (`src/fiberyClient.js`, batched `/api/commands`), branding tokens (root CSS vars from `agreement-dashboard-prd-v2.md` §9.5–§9.7), and the cache + TTL pattern proven on the Agreement Dashboard. **No persistent server-side datastore** for labor payloads — Fibery remains authoritative; the client caches in `sessionStorage` for speed.

## User stories

- As a **delivery lead**, I want to see how many billable hours each **customer** consumed last quarter so I can spot under- or over-served accounts.
- As an **engineering manager**, I want to filter to a single **project** and see exactly which people logged time, broken out by role.
- As a **resource planner**, I want a **utilization %** KPI (billable ÷ total hours) per person so I can identify under-utilized capacity and over-allocated risk.
- As a **finance reviewer**, I want a **Pending Approvals** count so unapproved time entries surface before the invoice cycle.
- As an **executive**, I want to click a **Customer** bar and have every chart on the page re-render to that customer — and then click a **Project** bar to drill further in, with a clear chip bar showing what I've filtered to.
- As an **analyst**, I want to scroll to a **Detail Table** below the charts and see the exact labor-cost rows behind whatever I've filtered to (with sortable columns and an export-ready row format).
- As an **admin**, I want no Fibery tokens or secrets in any cached JSON; the client only ever sees normalized labor data.

## Data source — `Agreement Management/Labor Costs`

Fields read (paths verified via Fibery `describe_database` + a sample query on `2026-05-17`):

| Field | Path | Purpose |
| --- | --- | --- |
| `id`, `publicId` | `fibery/id`, `fibery/public-id` | Stable row identity. |
| `name` | `Agreement Management/Name` | Human-readable label (e.g. `"2026-05-17 - tatsiana kantarovich - 11.0 hrs"`). |
| `hours` | `Agreement Management/Hours` | **Primary measure**. Decimal stored as **text**; coerce with `Number()` server-side. |
| `seconds` | `Agreement Management/Seconds` | Backup duration (int). Used for tie-break / sanity. |
| `cost` | `Agreement Management/Cost` | Precomputed `$` cost — `Hours × User Role Cost Rate` (int). |
| `billable` | `Agreement Management/Billable` | Text `"Yes"` / `"No"`. Drives §N.9 / utilization. |
| `startDateTime`, `endDateTime` | `Agreement Management/Start Date Time`, `End Date Time` | ISO datetimes. Date bucketing uses `startDateTime`. |
| `dateOfCreation`, `dateOfApproval` | `Agreement Management/Date of creation`, `Date of approval` | Approval workflow timestamps. |
| `approval` | `Agreement Management/Approval` → `enum/name` | `"Unapproved"` / `"Approved"` (harpin-side workflow). |
| `timeEntryStatus` | `Agreement Management/Time Entry Status` → `enum/name` | `"NOT_SUBMITTED"` / `"PENDING"` / `"APPROVED"` (Clockify-side). |
| `agreementId`, `agreementName` | `Agreement Management/Agreement → fibery/id` / `Agreement Name` | Joins to the Agreement entity. |
| `agreementType` | `Agreement → Agreement Type → enum/name` | `"Services"`, `"Internal"`, etc. |
| `agreementState` | `Agreement → workflow/state → enum/name` | `"Delivery In Progress"`, `"Awarded"`, etc. |
| `customer` | `Agreement → Customer → Name` | **Global filter dimension #1** + chart axis. |
| `projectName` | `Agreement Management/Time Entry Project Name` | **Global filter dimension #2**. Clockify-side project string (distinct from Agreement Name — one agreement can host multiple Clockify projects). |
| `projectId` | `Agreement Management/Project ID` | Clockify project id (stable key for grouping). |
| `task` | `Agreement Management/Task` | Optional sub-grouping. |
| `userName`, `userId` | `Time Entry User Name`, `User ID` | Person dimension (`userId` is the email — stable key). |
| `clockifyUserCompany` | `Clockify User Company → enum/name` | `"Harpin"`, `"Coherent"`, `"RET"`, `"Axis One Global"`, `"Edison Black"`, `"LeadWhisper"`, `"KForce"`. Used to bucket internal vs partner labor. |
| `clockifyUserRole` | `Clockify User Role → enum/name` | Coarse role: `"Remote Engineer"`, `"Data Science"`, `"Architect"`, `"Solutions Engineer"`, etc. |
| `userRole` | `User Role → Name` | Granular role from the `Team Member Roles` table (e.g. `"QA (Near Shore)"`, `"Solutions Architect"`). |
| `userRoleBillRate`, `userRoleCostRate` | `User Role Bill Rate`, `User Role Cost Rate` | Decimal $/hr from the linked Team Member Role. **May be `null`** — see schema notes. |

### Schema notes / risks (verified against a live sample)

1. **`Hours` is text.** A sampled row had `"hours": "11"`. Always `Number(r.hours || 0)` server-side; never trust the raw string in arithmetic.
2. **Per-row `Bill Rate` / `Cost Rate` are typically null.** The denormalized `User Role Bill Rate` was `null` on sampled rows even when `User Role Cost Rate` was populated. **Revenue-from-labor (= Hours × Bill Rate) is therefore Unknown for many rows in Phase A.** The KPI strip will explicitly label "Effective Bill Rate" as `—` rather than fabricate a number. (Phase B fallback: allocate `Agreement.Total Planned Revenue` proportionally to labor rows by hours.)
3. **`Cost` is `int`** — never decimal. Acceptable for utilization reporting.
4. **Two approval workflows in parallel.** `Approval` (harpin) and `Time Entry Status` (Clockify) are independent. Pending = `Approval = "Unapproved"` OR `Time Entry Status ∈ {"NOT_SUBMITTED", "PENDING"}`.
5. **`Time Entry Project Name`** is the Clockify project string. It can diverge from the Agreement name (e.g. agreement `"SOW 15 - GUEST SERVICES"` hosts the Clockify project `"Shipwright (PCL - Utility Services)"`). The **Project filter** uses this Clockify name; the Agreement name is shown alongside for context.
6. **Volume estimate** — assuming ~5 active engineers × 5 days × 8 hours = ~200 entries/week → ~10k entries/year. A 90-day window fetches ~2.5k rows ≈ 1–2 MB JSON. Well within `sessionStorage` (5–10 MB per origin) and `HtmlService` payload caps.
7. **Customer name fallback** — labor rows without an Agreement (rare) or with an Agreement that has no Customer get bucketed as `(Unassigned)` (consistent with Sankey §7.11.8 fallback).

## Computed values

| Id | Definition | Notes |
| --- | --- | --- |
| **§U.1 Total Hours** | `Σ Hours` over the active filter set. | Coerce to number. |
| **§U.2 Billable Hours** | `Σ Hours WHERE Billable = "Yes"` | Case-insensitive compare. |
| **§U.3 Utilization %** | `Billable Hours ÷ Total Hours × 100` | Per-person variant divides by per-person totals. |
| **§U.4 Total Cost** | `Σ Cost` | `$` int. |
| **§U.5 Effective Cost Rate** | `Σ Cost ÷ Σ Hours` | `$/hr`. |
| **§U.6 Effective Bill Rate** | `Σ (Hours × User Role Bill Rate) ÷ Σ (Hours WHERE Bill Rate known)` | `—` displayed when **all** rows in the filter have null rate. Coverage % shown alongside (e.g. `$182/hr · 72% coverage`). |
| **§U.7 Pending Approvals** | `count(rows WHERE Approval = "Unapproved" OR Time Entry Status ∈ {"NOT_SUBMITTED","PENDING"})` | Surfaced as a KPI + Phase C drill-into widget. |
| **§U.8 Margin per Hour** (row level) | `Bill Rate − Cost Rate` | Only when both are known. |
| **§U.9 Capacity (per person, per week)** | Configurable target hours (default **40**, Script Property override). | Used for utilization % over time. |
| **§U.10 Utilization color buckets** | `< 60%` red (under-utilized) · `60–85%` amber (building) · `85–110%` green (target) · `> 110%` orange (over-allocated). | Configurable thresholds. |
| **§U.11 Week bucket** | ISO week starting Monday from `startDateTime`. | Stable across timezones; server emits `YYYY-Www`. |

## Required Script Properties

| Key | Purpose | Default |
| --- | --- | --- |
| `FIBERY_HOST` | Existing — Fibery workspace host **and** default deep-link host (e.g. `harpin-ai.fibery.io`). | — (required) |
| `FIBERY_API_TOKEN` | Existing — Fibery API token. | — (required) |
| `FIBERY_PUBLIC_SCHEME` *(v1.15.0)* | URL scheme used when composing public deep links for the row-detail drawer's **Open in Fibery →** anchor. | `https` |
| `FIBERY_DEEP_LINK_HOST` *(v1.15.0)* | Optional override for the **deep-link host only** (`FIBERY_HOST` continues to be the API host). Set this when the API host differs from the public web host. | falls back to `FIBERY_HOST` |
| `FIBERY_LABOR_COST_PATH_TEMPLATE` *(v1.15.0)* | URL-path template with two placeholders — `{slug}` is `row.name.trim().replace(/\s/g, '-')` and `{publicId}` is the entity's `fibery/public-id`. | `/Agreement_Management/Labor_Costs/{slug}-{publicId}` |
| `AUTH_COL_FIBERY_ACCESS` *(v1.15.0)* | Header name on the Users sheet for the per-user Fibery-access gate. When absent, server denies by default and emits a one-time `console.warn`. | `fibery_access` |
| `UTILIZATION_CACHE_TTL_MINUTES` | Default seed TTL for the client selector. | `10` |
| `UTILIZATION_DEFAULT_RANGE_DAYS` | Default lookback window when no explicit range chosen. | `90` |
| `UTILIZATION_MAX_RANGE_DAYS` | Hard cap on the date-range fetch to keep payloads bounded. | `365` |
| `UTILIZATION_WEEKLY_CAPACITY_HOURS` | Per-person capacity baseline for §U.9. | `40` |
| `UTILIZATION_TARGET_PERCENT` | Target utilization % (top of green bucket). | `85` |
| `UTILIZATION_UNDER_PERCENT` | Threshold below which a person is flagged as under-utilized. | `60` |
| `UTILIZATION_OVER_PERCENT` | Threshold above which a person is flagged as over-allocated. | `110` |
| `UTILIZATION_INTERNAL_COMPANY_NAMES` | Comma-separated internal Clockify-User-Company values (rows from these are treated as internal). | `harpin.ai,Harpin` |
| `UTILIZATION_TOP_N_PERSONS` | Cap on §N.7 Hours-by-Person rows (top-N + collapse rest). | `20` |
| `UTILIZATION_TOP_N_PROJECTS` | Cap on §N.5 Hours-by-Project rows. | `20` |
| `UTILIZATION_TOP_N_CUSTOMERS` | Cap on §N.4 Hours-by-Customer rows. | `20` |

## Server contract

**`getUtilizationDashboardData(rangeStart?, rangeEnd?)`** — `requireAuthForApi_()`; if both args are absent, derives the default range (`now - UTILIZATION_DEFAULT_RANGE_DAYS` → `now`). Validates the range against `UTILIZATION_MAX_RANGE_DAYS`. Runs one paginated Fibery query against `Agreement Management/Labor Costs` (filtered by `Start Date Time ∈ [rangeStart, rangeEnd]`), normalizes shapes, and returns:

```
{
  ok: true,
  source: 'fibery',
  fetchedAt: ISO,
  cacheSchemaVersion: 1,
  ttlMinutes: number,
  range: { start: ISO, end: ISO, defaulted: boolean },

  rows: [
    {
      id, publicId, hours, cost,
      billable: boolean,                   // normalized to boolean server-side
      startDateTime, endDateTime,
      week: 'YYYY-Www',                    // §U.11 ISO week (Monday-anchored)
      day: 'YYYY-MM-DD',
      agreementId, agreementName, agreementType, agreementState,
      customer,                            // (Unassigned) when null
      projectName, projectId, task,
      userId, userName, clockifyUserCompany,
      clockifyUserRole, userRole,
      userRoleBillRate, userRoleCostRate,  // null when unknown
      approval, timeEntryStatus,           // sanitized enum names
      isPending: boolean,                  // §U.7 derived
      isInternal: boolean,                 // §U.11 (Clockify User Company in UTILIZATION_INTERNAL_COMPANY_NAMES OR agreementType === 'Internal')
      revenueFromLabor: number | null      // hours × userRoleBillRate when known
    }, ...
  ],

  kpis: {
    totalHours, billableHours, utilizationPct,
    totalCost, effectiveCostRate,
    effectiveBillRate, effectiveBillRateCoverage,   // null + 0..1 fraction
    pendingApprovalsCount, distinctPersons, distinctProjects, distinctCustomers
  },

  dimensions: {
    customers: [{ name, hours, billableHours, color }],
    projects:  [{ name, id, customer, hours, billableHours, color }],
    persons:   [{ name, id, hours, billableHours, utilizationPct, color }],
    roles:     [{ name, hours, billableHours, color }]
  },

  aggregates: {
    byCustomer:           [{ name, hours, billableHours, cost }],
    byProject:            [{ name, id, customer, hours, billableHours, cost }],
    byPerson:             [{ name, id, hours, billableHours, cost, utilizationPct }],
    byRole:               [{ name, hours, billableHours }],
    byWeek:               [{ week, hours, billableHours, nonBillableHours }],
    billableVsNonBillable: [{ week, billable, nonBillable }]
  },

  pendingApprovals: [ /* same row shape, filtered to isPending=true */ ]
}
```

**Aggregations are server-precomputed** for the **unfiltered** view so the first paint is fast. When the client applies filters, it **re-aggregates from `rows` in-memory** — no server roundtrip required unless the date range changes.

**`getUtilizationCacheTtlMinutes()`** — `requireAuthForApi_()`; returns `UTILIZATION_CACHE_TTL_MINUTES` (default 10).

**`_diag_pingUtilization()`** and **`_diag_sampleUtilizationPayload()`** — Apps-Script-editor-only helpers for credential and schema verification (mirroring the agreement-dashboard pattern).

**No** writing labor payloads to Script Properties / Sheet / Drive.

## Client cache contract

- **`sessionStorage` key:** `fos_utilization_dashboard_v1`. Value carries `range`, `fetchedAt`, full payload.
- **Range change** = cache invalidate + server re-fetch (the cached range is part of the value, not the key — simpler, and prevents stale-range bugs).
- **Filter / drill change** = in-memory re-aggregate from `rows`; no cache touch.
- **`localStorage` TTL preference:** `fos_utilization_dashboard_ttl_minutes_v1`, options `5 / 10 / 30 / Off`, default `10`. Stale-on-open → render immediately + background refresh + `Stale` badge (same UX as Agreement Dashboard).
- **Secrets:** No Script Properties or Fibery tokens cached.

## Components / visualizations

| # | Component | Phase | Library | Drill behavior |
| --- | --- | --- | --- | --- |
| §N.1 | **Page header** — title "Utilization Management Dashboard" · subtitle "{N} hours · {M} entries · range {start}–{end}". **No in-panel logo** as of v1.13.0 — the app sidebar (`.fos-brand-logo`) is the single source of brand. (Phase A through v1.12.0 carried a duplicate logo + `.agreement-logo-sep` divider; Phase B removes them.) | A · B (cleanup) | HTML | — |
| §N.2 | **KPI strip** — six cards: Total Hours · Billable Hours · Utilization % · Total Cost · Effective Bill Rate · Pending Approvals | A | HTML | Click a KPI scrolls/focuses the most-relevant chart or table |
| §N.3 | **Filter bar** — Date range preset (Last 30 / 90 / 6mo / YTD / Custom, default 90d) · Customer multi-select · Project multi-select · Billable toggle (All / Billable / Non-billable) · **Internal labor toggle** (Include / Exclude internal labor, default Include) · Active-filter chip row · "Clear filters" button | A | HTML | Chips have `×` to remove individual dimensions |
| §N.4 | **Hours by Customer** — horizontal bar, top-N (default 20), customer palette | A | Chart.js v4 | Click bar → toggle Customer in filter set |
| §N.5 | **Hours by Project** — horizontal bar, top-N. Each bar color-coded by its customer | A | Chart.js v4 | Click bar → toggle Project in filter set |
| §N.6 | **Hours by Role** — donut, colored from a role palette | B | Chart.js v4 | Click slice → toggle Role in filter set |
| §N.7 | **Hours by Person** — horizontal bar, top-N | B | Chart.js v4 | Click bar → toggle Person in filter set |
| §N.8 | **Weekly trend** — line chart, X axis = ISO week, two series: Total Hours · Billable Hours | A | Chart.js v4 | Click point → set date range to that week (drill-into-week) |
| §N.9 | **Billable vs Non-billable** — stacked bar per week | A | Chart.js v4 | Click bar segment → toggle Billable filter |
| §N.10 | **Utilization heatmap** — Person × Week grid, color buckets per §U.10 | C | Custom SVG | Click cell → set Person + Date filter to that cell |
| §N.11 | **Pending Approvals** — list (top 50) of `isPending` rows sorted by `startDateTime` desc | C | HTML | Click row → opens detail drawer |
| §N.12 | **Detail Table** — every row matching the active filter: Date · Person · Customer · Project · Role · Hours · Cost · Bill Rate · Approval | B | HTML (sortable, paginated 100/page) | Click row → detail drawer (Phase C) |

## Drill-down model

Two complementary patterns:

1. **Cross-filter (every chart is a control surface).** Clicking any chart element toggles the corresponding dimension in the **global filter set**. Every other chart, KPI, and the Detail Table re-aggregates in-place. The clicked element is visually marked (border / opacity) so the user can see what's selected.

   - Example: click `Princess Cruise Lines` in §N.4 → Customer filter `+= "Princess Cruise Lines"` → §N.5 now shows only projects under that customer; §N.7 shows only people who logged time on PCL; §N.8 reflects PCL hours only.
   - Click again to remove the value; or use the chip `×`; or use the multi-select dropdown.
   - Filters compose with AND across dimensions, OR within a dimension (multi-select).

2. **Row-level drill (Detail Table).** Always rendered below the charts. Shows the raw labor entries matching the active filter set. **Sortable** by any column, paginated 100 rows/page. In Phase C, clicking a row opens a side drawer with the full entry: agreement context, raw `cost` / `hours` / rates, approval timestamps, Clockify task id.

### Filter state semantics

```
filters = {
  customers:     Set<string>,         // empty = all customers
  projects:      Set<{name,id}>,      // empty = all projects (keyed by projectId)
  persons:       Set<string>,         // empty = all (Phase B)
  roles:         Set<string>,         // empty = all (Phase B)
  billable:      'all' | 'billable' | 'non-billable',   // default 'all'
  internalLabor: 'include' | 'exclude',                 // default 'include'
  range:         { start, end }       // bound to the server fetch
}
```

- Filter chip bar renders one chip per non-empty Set entry plus one chip each for non-default `billable` and non-default `internalLabor`.
- The **Internal labor** toggle and the **Billable** toggle are independent — they describe different facets (`isInternal` is derived from Clockify-User-Company / Agreement Type per §U.11 + `UTILIZATION_INTERNAL_COMPANY_NAMES`; `billable` is the row-level `Billable` text field). A user can, for example, set Billable = `billable` AND Internal = `exclude` to see only customer-facing billable work.
- When `internalLabor = 'exclude'`, the active-filter chip reads `Excluding internal labor [×]`.
- "Clear filters" button resets everything except `range`.
- Phase B persists filters in `localStorage` key `fos_utilization_filters_v1` (excluding `range`).

## Interactivity behavior (acceptance-grade detail)

- Chart updates use `chart.update('none')` on filter change — no animation, perceived as instant.
- The customer/project multi-select dropdowns are populated from `dimensions.customers` / `dimensions.projects` (sorted by hours desc).
- Date range presets snap to **calendar boundaries** where natural (Last 30 days = today − 29 → today; YTD = Jan 1 → today). Custom range uses two date inputs.
- Range change triggers a server fetch with a small inline spinner; existing charts dim to 50% opacity until the new payload arrives.
- Network/server errors render a non-fatal banner; the prior cache stays visible.
- The Detail Table cap (e.g. 100 rows/page) ensures DOM stays cheap; full export is **Phase B+**.

## Thresholds & color maps

- **Billable / Non-billable** — `#43D6BA` / `#A0AEC0` (text-muted on dim background).
- **Utilization buckets** (§U.10) — under `< 60%` `#fc5c65` · building `60–85%` `#f9c74f` · target `85–110%` `#43D6BA` · over `> 110%` `#f78c1f`.
- **Customer palette** — reuse `CUSTOMER_PALETTE_` from `src/agreementThresholds.js` (10 distinct hues; cycle by sorted-hours order).
- **Role palette** — derived deterministic palette indexed by sorted-hours order (Phase B). 12+ hues to cover the 13 known role enum values.
- **Internal company tint** — `#2a5a7a` (matches `--ag-text-dim`).
- **Approval state** — Approved `#43D6BA` · Pending `#f9c74f` · Unapproved `#fc5c65`.

## Acceptance criteria (testable)

### Phase A

- [ ] **Given** an authorized user, **when** they click **Operations**, **then** the panel renders the Utilization Management Dashboard (not the "coming soon" modal), with the header, KPI strip, Hours-by-Customer bar, Hours-by-Project bar, Weekly trend, Billable-vs-Non-billable stacked bar, and the filter bar.
- [ ] **Given** Fibery credentials are configured, **when** the panel opens with no prior cache, **then** `getUtilizationDashboardData()` returns labor rows for the default range (last 90 days), KPIs match the row-level totals, and all four Phase A charts populate.
- [ ] **Given** a user opens the panel with a cached payload older than the TTL, **then** the cache renders immediately, the **Stale** badge appears, a background refresh is dispatched, and on success the badge clears and `last refreshed` updates.
- [ ] **Given** the user clicks **Refresh**, **then** cache and UI update and `last refreshed` matches server `fetchedAt`.
- [ ] **Given** the user changes the Date range preset, **then** the cache is invalidated, a new server fetch runs with the new range, and the dashboard re-renders.
- [ ] **Given** the user selects a Customer in the filter dropdown, **then** every Phase A chart and the KPI strip re-aggregate to only that customer's rows.
- [ ] **Given** the user selects a Project in the filter dropdown, **then** every Phase A chart and the KPI strip re-aggregate to only that project's rows (composes AND with any Customer filter).
- [ ] **Given** the user toggles **Internal labor → Exclude**, **then** every chart, KPI, and the row count drop the rows where `isInternal = true` (Clockify-User-Company in `UTILIZATION_INTERNAL_COMPANY_NAMES` OR `agreementType = "Internal"`), and an `Excluding internal labor` chip appears in the active-filter row.
- [ ] **Given** the user toggles the **Billable** filter, **then** every chart, KPI, and the row count reflect only the chosen `billable` slice (`All` / `Billable` / `Non-billable`), composing independently of the Internal toggle.
- [ ] **Given** the user clicks a bar in **Hours by Customer**, **then** that customer is added to the Customer filter set and the bar's visual selection state updates.
- [ ] **Given** the user clicks a bar in **Hours by Project**, **then** that project is added to the Project filter set.
- [ ] **Given** all rows in the filtered view lack `User Role Bill Rate`, **then** the **Effective Bill Rate** KPI displays `—` (not `$0/hr` or `NaN`); coverage label reads `0% coverage`.
- [ ] **Given** the server returns an error, **then** a friendly message renders and the prior cache stays visible if present.
- [ ] **Given** an unauthorized session, **then** `getUtilizationDashboardData()` returns `NOT_AUTHORIZED` and no labor rows are returned.

### Phase B

- [ ] Click-to-toggle works on every chart (Customer, Project, Role, Person, Billable bars/slices).
- [ ] Active filters render as removable chips; `×` removes individual dimensions; **Clear filters** resets all (range stays).
- [ ] Detail Table renders below the charts with sortable columns and 100 rows/page; row count matches the filtered-row total.
- [ ] Filter state persists across reloads via `localStorage` (`fos_utilization_filters_v1`); range does NOT persist.
- [ ] **Cosmetic — duplicate brand logo removed.** The in-panel `<img src="…/logo.svg">` and adjacent `.agreement-logo-sep` divider are removed from BOTH `#panel-agreement-dashboard` AND `#panel-operations` panel headers. The sidebar `.fos-brand-logo` remains the single rendered harpin logo on the page. The dashboard headings (`Agreement Management Dashboard` / `Utilization Management Dashboard`) and subtitles remain unchanged, left-aligned, with the same `.fos-agreement-inner` container. The orphan `.fos-agreement-root .agreement-logo-sep` CSS rule is removed.

### Phase C

- [ ] Heatmap renders one cell per `(person, week)` with color from §U.10 thresholds; clicking a cell pins both Person and the week's Date range.
- [ ] Pending Approvals widget lists `isPending` rows sorted by `startDateTime` desc and surfaces a count badge in the KPI strip.
- [ ] Utilization alert panel surfaces under-utilized / over-allocated / stale-approval alerts sorted Critical → Warning → Informational, matching the agreement-dashboard severity pattern.

## Components / files

| File | Phase added | Role |
| --- | --- | --- |
| `src/DashboardShell.html` | A | New panel `#panel-operations` markup, CSS for utilization surfaces, render functions (`renderKpis`, `renderCustomerBar`, `renderProjectBar`, `renderWeeklyTrend`, `renderBillableStack`, …), filter bar + chip rendering, client-side aggregation helpers, cache + refresh + TTL client script. Operations nav-click branch now calls `showOperations()` instead of the coming-soon modal. |
| `src/fiberyUtilizationDashboard.js` | A | **New.** `getUtilizationDashboardData(rangeStart?, rangeEnd?)` orchestrator: paginated `/api/commands` query against `Agreement Management/Labor Costs`, row normalization (hours coercion, week bucket, `isPending` derivation, internal-company detection), KPI computation, server-side aggregates, `getUtilizationCacheTtlMinutes()`, `_diag_*` helpers. |
| `src/utilizationThresholds.js` | A | **New.** `UTILIZATION_*` defaults + Script Property override loader; color buckets; role palette; `isInternalLabor_()` predicate; cache schema version constant. |
| `src/utilizationAlerts.js` | C | **New (Phase C).** Under-utilization / over-allocation / stale-approval rule evaluators + severity sorter (mirrors `src/agreementAlerts.js`). |
| `src/fiberyClient.js` | — | **Reused** — no changes. Already supports batched `/api/commands` with auth and error mapping. |
| `src/authUsersSheet.js` | — | **Reused** — `requireAuthForApi_()` unchanged. |
| `src/Code.js` | A | Add `getUtilizationDashboardData` and `getUtilizationCacheTtlMinutes` to the client-callable surface only if exposure routing isn't automatic. (Apps Script picks up top-level `function` declarations from any `.js` file in the project automatically, so usually no `Code.js` edit is needed.) |
| `docs/FOS-Dashboard-PRD.md` | A | Add FRs (utilization data contract, drill-down, filters), ACs, §8 (or new §9) Operations / Utilization section; changelog row → v1.12.0. |
| `docs/features/005-utilization-management-dashboard.md` | — | **This document.** |

## Implementation plan

### Phase A — Live wiring + core charts (target PRD v1.12.0)

**Server (Apps Script, in order):**

1. **`src/utilizationThresholds.js`** — define constants (`UTILIZATION_DEFAULTS_`, color buckets, role palette), `getUtilizationThresholds_()` reading Script Property overrides (mirrors `getAgreementThresholds_()`).
2. **`src/fiberyUtilizationDashboard.js`** — write `buildLaborCostsQuery_(rangeStart, rangeEnd, limit, offset)`. Use the verified Fibery field paths from the **Data source** section above. **Page** with `q/limit: 1000, q/offset: …` until `result.length < limit`. **`q/order-by: [[['Agreement Management/Start Date Time'], 'q/desc']]`** (the wrapped-vector form, matching agreement-dashboard v1.9.2).
3. **`normalizeRow_(r)`** — coerce `hours` with `Number()`, derive `week` (ISO Monday-anchored), `day` (`YYYY-MM-DD`), `isPending`, `isInternal`, `billable` boolean, `revenueFromLabor` (`hours * userRoleBillRate` when both known, else `null`).
4. **`computeKpis_(rows)`** — §U.1–§U.7 per-payload aggregates; track effective-bill-rate coverage explicitly.
5. **`buildAggregates_(rows, thresholds)`** — `byCustomer`, `byProject`, `byPerson`, `byRole`, `byWeek`, `billableVsNonBillable`. Server pre-aggregates so the first paint doesn't depend on the client.
6. **`getUtilizationDashboardData(rangeStart, rangeEnd)`** — `requireAuthForApi_()`; default range from Script Property; clamp to `UTILIZATION_MAX_RANGE_DAYS`; one pass through the paginated query; return the payload shape documented above. On error: return `{ ok:false, message, warnings }`.
7. **`getUtilizationCacheTtlMinutes()`** — mirrors `getAgreementCacheTtlMinutes()`.
8. **`_diag_pingUtilization()` / `_diag_sampleUtilizationPayload()`** — editor-only verification helpers.

**Client (`src/DashboardShell.html`, in order):**

9. **Operations nav-click branch** — replace `showComingSoon(...)` for `item.id === 'operations'` with `showOperations()` (analogous to `showAgreementDashboard()`).
10. **`#panel-operations` markup** — header, KPI strip, filter bar (date preset + Customer multi + Project multi + Billable toggle + chip row + Clear), four chart canvases (`#util-customer-bar`, `#util-project-bar`, `#util-weekly-line`, `#util-billable-stack`), TTL selector + Stale badge + Refresh button + last-refreshed text.
11. **CSS** — utilization-specific styles using the existing `--ag-*` aliases (so branding is automatic).
12. **Cache + TTL** — `readUtilizationCache()`, `writeUtilizationCache()`, `isUtilizationStale()`, TTL selector wired to `fos_utilization_dashboard_ttl_minutes_v1`.
13. **Filter state model** — `state.filters = { customers:[], projects:[], billable:'all', range:{...} }`; helpers `applyFilters(rows)`, `aggregateRows(rows)`, `renderAll(payload)`.
14. **Renderers** — `renderKpis`, `renderCustomerBar`, `renderProjectBar`, `renderWeeklyTrend`, `renderBillableStack`. Each takes the post-filter aggregates so they're filter-agnostic.
15. **Chart Chart.js click handlers** — for customer + project bars, wire `onClick: (evt, els) => toggleFilter(...)`. Activity-log each click as `'util_drill'` with the dimension and value.
16. **Date range selector** — preset values + custom; on change → invalidate cache, fetch fresh.
17. **Activity logging** — `logActivity_('refresh','operations','')`, `logActivity_('ttl_change','operations',…)`, `logActivity_('util_filter','operations',JSON-summary)`, `logActivity_('util_drill','operations',dimension+'='+value)`.

**Docs (in order):**

18. Bump `docs/FOS-Dashboard-PRD.md` → **1.12.0**, add FRs (FR-70..FR-76 e.g.), ACs (Phase A list above), §8 Operations section, changelog row.
19. Sync all `src/*` + `docs/features/*` headers to 1.12.0.

**Verification:**

20. Run `_diag_pingUtilization()` from the Apps Script editor.
21. Run `_diag_sampleUtilizationPayload()`; inspect KPI math against a spreadsheet pivot.
22. Open the panel, change date range, toggle filters, confirm chart counts add up to the KPI totals.

### Phase B — Cross-filter + drill-down + detail table (target v1.13.0)

23. Add Role + Person filter dropdowns to the filter bar; add the Role donut (§N.6) and Hours-by-Person bar (§N.7).
24. Wire click-to-toggle on every Phase A + Phase B chart (Customer, Project, Role, Person, Billable).
25. Render the active-filter **chip bar** beneath the filter row; each chip has an `×` button; "Clear filters" resets.
26. Implement the **Detail Table** with sortable columns + pagination (100/page). Render below the charts. Always reflects the active filter.
27. Persist filter state in `localStorage` (`fos_utilization_filters_v1`); excluding `range`.
28. **Cosmetic header cleanup (cross-dashboard).** In `src/DashboardShell.html`, remove the duplicate harpin `<img>` + `.agreement-logo-sep` divider from BOTH panel headers — `#panel-agreement-dashboard` (≈ lines 937–946 as of v1.12.0) and `#panel-operations` (≈ lines 1128–1137 as of v1.12.0). After removal, the header row contains only the heading + subtitle wrapper (`<div class="flex-grow-1 min-w-0">`). Drop the now-unreferenced `.fos-agreement-root .agreement-logo-sep` rule. The sidebar `.fos-brand-logo` is unchanged and remains the single rendered harpin logo. Mirror the change in `docs/features/003-agreement-dashboard-fibery-client-cache.md` (cross-reference note that v1.13.0 dropped the Agreement Dashboard's in-panel logo) and bump its header to 1.13.0 alongside the rest.
29. Acceptance tests for Phase B; bump PRD → 1.13.0.

### Phase C — Heatmap + alerts + approval queue (delivered v1.14.0)

30. **`src/utilizationAlerts.js`** — **[Delivered v1.14.0]** Under-utilized (Warning; mean util% across the last 3 complete weeks `< UNDER_PERCENT`, PTO-only persons excluded), over-allocated (Critical; any 2 consecutive complete weeks `> OVER_PERCENT`, first triggering pair per person only), stale-approval (Warning ≥ 7 days, Critical ≥ 14 days). Severity ordering matches `src/agreementAlerts.js`.
31. **Heatmap (§N.10)** — **[Delivered v1.14.0]** SVG `(person × ISO week)` grid; row cap `UTILIZATION_HEATMAP_TOP_N_PERSONS` (default 30) — separate from `UTILIZATION_TOP_N_PERSONS`; **heatmap-local Role multi-select** scopes the heatmap independently from the global Role filter; partial weeks pro-rate capacity by `(daysInRangeInWeek / 7)` and render the bucket color overlaid with a diagonal-hatch `<pattern>`; cell click pins the global Person filter to that person + switches the active range to the clicked week (`weekStartIso` / `weekEndIso`) which triggers a server fetch; tooltips show person/week/hours/utilization + partial-week fraction.
32. **Pending Approvals widget (§N.11)** — **[Delivered v1.14.0]** List view beside the heatmap; sorted by `startDateTime` desc; cap 50 visible rows with a Show all (N) toggle; amber / red age badges at the 7-day / 14-day cuts; click → row-detail drawer.
33. **Row-detail drawer** — **[Delivered v1.14.0]** Off-canvas right (z-index 1100 + backdrop 1090), slide-in `0.22s ease` (suppressed under `prefers-reduced-motion: reduce`); definition-list of the full normalized row + **Open in Fibery** deep link by `publicId`; closable via button / backdrop / Escape; opened from the alerts panel, Pending Approvals widget, OR Detail Table (each `<tr>` carries `data-row-id`).
34. **Cache schema bump 1 → 2** — **[Delivered v1.14.0]** `UTILIZATION_DASHBOARD_CACHE_SCHEMA_VERSION_` and the client constant both move to `2`; clients carrying a v1 payload silently drop their cache on next open.
35. **Phase C ACs** — **[Delivered v1.14.0]** AC-28 (alerts panel) · AC-29 (heatmap with heatmap-local Role filter) · AC-30 (Pending Approvals) · AC-31 (drawer) · AC-32 (cache schema bump) · AC-33 (activity logging) · AC-34 (configurable thresholds) · AC-35 (editor diagnostics). PRD bumped to **1.14.0**.

## Confirmed decisions (2026-05-12)

1. **Nav label stays `Operations`** — route id `operations`, label `"Operations"`, page header `"Utilization Management Dashboard"`. The Operations panel was a "coming soon" stub through v1.11.0; v1.12.0 activates it without changing the nav id or label.
2. **Default date range = last 90 days** — `UTILIZATION_DEFAULT_RANGE_DAYS = 90`.
3. **Weekly capacity baseline = 40 hours / person / week** — `UTILIZATION_WEEKLY_CAPACITY_HOURS = 40`, applied uniformly to every person; partner-staff differentiation is **not** in scope.
4. **Internal labor toggle ships in Phase A** — distinct from the Billable toggle. Default state: **Include internal labor**. Toggling to **Exclude** removes every row where `isInternal = true` from every chart and KPI. The chip bar surfaces the non-default state as `Excluding internal labor`.
5. **The Utilization Management Dashboard is the entire Operations panel** for now — no other widgets share the panel; the panel root maps 1:1 to this feature.

## Execution notes / remaining items

- **Per-row Revenue calc** — Phase A uses `Hours × User Role Bill Rate` when both are known, `null` otherwise. The Effective Bill Rate KPI honestly labels coverage (`$182/hr · 72% coverage`) rather than fabricate a number. Phase B can backfill via proportional `Agreement.Total Planned Revenue` allocation if Bill Rate gaps are large in practice.
- **Capacity drill-down** — joining `Resource Allocations` / `Estimated Allocations` for planned-vs-actual is **out of scope** for Phase A–C; potential Phase D follow-up.
- **Export** — CSV export of the Detail Table is **out of scope** for Phase A; Phase B may add a `Download CSV` button on the Detail Table.

## Possible follow-ups (post-Phase C)

- **Forecast view** — join `Estimated Allocations` (planned hours per person per agreement) and overlay against actual labor; surface gaps.
- **Burn-down view** — per agreement: cumulative actual labor cost vs `Agreement.Target Costs` over the agreement duration.
- **Outliers** — rows with `> 12h` per day, rows where `startDateTime > endDateTime`, rows missing approval older than 14 days.
- **Slack notification** — daily digest when the pending approvals queue exceeds a threshold.
- **CSV / Excel export** of any filtered view.
- **Persisted thresholds** — admin UI to tune `UTILIZATION_*` constants without Script Property edits.

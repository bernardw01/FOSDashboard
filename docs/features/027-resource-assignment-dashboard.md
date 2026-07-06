# Feature: Resource assignment dashboard (Operations)

> **PRD version 2.18.3** - sync with `docs/FOS-Dashboard-PRD.md` (**FR-122**, **AC-81**).  
> **Intake:** Inbox task [40228925 - Resource Assignment Dashboard](https://win.godeap.io/app/tasks/40228925).  
> **Feature id:** 027 | **Task list:** Operations  
> **Extends / reuses:** [Feature 019](019-resource-allocation-pnl-chart.md) (Fibery Resource Allocations, calendar-day proration), [Feature 024](024-delivery-pnl-resource-assignments-modal.md) (assignment row fields), [Feature 007](007-labor-hours-dashboard.md) (expand/collapse project breakdown UX), [Feature 005](005-utilization-management-dashboard.md) (Operations date range + filter patterns).  
> **Status:** **Released v2.18.0** (Phases A, B, and C).

## Goal

Give delivery and operations leads a **portfolio-wide view** of **planned resource assignments** from Fibery **`Agreement Management/Resource Allocations`**: which people are assigned to which projects, **by ISO week**, with quick visibility into **assignments ending soon** and **over-allocated** staff.

The view answers:

- Who is staffed on what projects over the next quarter (and recent past)?
- Where does planned allocation exceed a full work week?
- Which assignments roll off in the next 30 days?

## Reference UI (intake mockup)

Inbox task **40228925** includes a wireframe image:

`https://s3.amazonaws.com/tw-inlineimages/1120769/0/0/1eb22f72d1cd46b1bd8d0e24f2ad2343.png`

Key layout elements from intake:

| Element | Behavior |
| --- | --- |
| **Rows** | One row per **person** (Clockify User); **collapsible** to show child rows per **project** (Agreement). |
| **Columns** | One column per **ISO week** (Mon-Sun) in the selected date range. |
| **Collapsed person row** | **Allocation % heatmap** per week (**v2.18.3**): blue (under) → green (**100-110%**) → yellow/red (over); numeric **%** label on each cell. |
| **Expanded person row** | Child project rows; each week cell shows **planned hours** (numeric), not %. |
| **Date range** | User-selectable; **default** = **past 30 days** through **next 90 days** (121-day window anchored on today in script timezone). |

Branding MUST match existing **Operations** panels (FOS dark theme, `.fos-section-card`, Inter, existing chart/bar tokens). Do not introduce a light-theme variant.

## User stories

- As a **delivery lead**, I want to see **who is assigned to which projects by week** so I can balance staffing across the portfolio without opening each Delivery P&L.
- As an **operations manager**, I want **over-allocation** highlighted when a person's combined planned % exceeds **100%** in a week so I can resolve conflicts before they hit delivery.
- As a **resource planner**, I want **assignments ending within 30 days** surfaced so I can extend or backfill roles before roll-off.
- As a **finance reviewer**, I want the same Fibery **Resource Allocations** source used on Delivery P&L (features **019** / **024**) so planned staffing stays consistent across views.

## Phasing

| Phase | Scope | Target |
| --- | --- | --- |
| **Phase A - Core grid + alerts** | New Operations route **`resource-assignments`** (`#panel-resource-assignments`); server fetch + weekly grid; expand/collapse; default date range; two alert rules; loading overlay + refresh | **v1 release (this spec)** |
| **Phase B - Filters + export** | Company / Person / Role / Project multi-select; **Copy CSV**; client TTL + stale badge | **Shipped v2.18.0** |
| **Phase C - Historical snapshots** | Daily snapshot artifact + Data source selector wiring (feature **009** / **010**) | **Shipped v2.18.0** |

Phase B and C are **out of scope** for initial implementation unless explicitly pulled into Phase A during review.

## Acceptance criteria (testable)

### Navigation and shell

- [x] Given an authorized user with Fibery access, the **Operations** nav group includes **Resource assignments** (route id **`resource-assignments`**, icon consistent with Operations siblings) opening **`#panel-resource-assignments`**.
- [x] The panel reuses Operations chrome: `.fos-agreement-root`, loading overlay with **`Source:`** line per feature **025**, refresh control, and user-friendly error states (no stack traces).

### Date range

- [ ] On first load, the date range defaults to **today − 30 days** through **today + 90 days** (inclusive, script timezone **`FOS_SNAPSHOT_TIMEZONE`** or Apps Script default when unset).
- [ ] The user can change **start** and **end** dates (date inputs or preset chips); changing the range triggers a **fresh server fetch** (no silent stale data).
- [ ] Weeks shown are **ISO weeks** (`YYYY-Www`, Monday anchor) intersecting the selected range; partial weeks at range edges are included and flagged **`partial: true`** on affected week buckets.

### Weekly grid

- [ ] **Person rows** are sorted by **display name** (Clockify User name, else Allocation Name, else `(Unnamed)`), with a stable secondary sort by person key.
- [x] **Collapsed** person row: for each week column, render an **allocation % heatmap cell** (**v2.18.3**): blue (under) → green (**100-110%**) → yellow/red (over).
- [ ] **Expanded** person row: one child row per **project** (Agreement) with planned hours in each week cell; hours formatted to **one decimal** (match Utilization hour formatting).
- [ ] Expand/collapse is per person (click chevron or row header); state MAY persist in **`sessionStorage`** for the session only.
- [ ] Empty range (no allocations overlapping): show an inline empty state ("No resource assignments in this range") without a broken grid.

### Planned hours and % (calculation contract)

- [ ] **Work week capacity** defaults to **`UTILIZATION_WEEKLY_CAPACITY_HOURS`** (Script Property, default **40**); same baseline as Utilization % unless review specifies a separate property.
- [ ] When **`Percent Allocated`** is present on a row, weekly **%** = `percentAllocated` (treat values `0 < n ≤ 1` as fractions × 100, consistent with feature **024**).
- [ ] When **`Percent Allocated`** is missing, derive weekly hours by **calendar-day proration** of **`Allocated Hours`** across the row **`Duration`**, then convert to **%** using work-week capacity (reuse calendar-day intersection helpers from feature **019** / `prorateAllocationRowToMonths_` family, adapted to ISO weeks).
- [ ] For **partial weeks** at range or allocation boundaries, prorate **%** and **hours** by `(overlapDaysInWeek / 7)` so totals stay consistent between collapsed % bars and expanded hour cells.
- [ ] **Collapsed total %** for a person-week = **sum of segment %** across all overlapping assignments (MAY exceed 100%; bar MAY extend visually with over-allocation styling).

### Alerts

- [x] **Ending soon (Warning):** emit one alert per allocation whose **`Duration` end** falls within the **next 30 calendar days** from today (inclusive of today; open-ended allocations without an end date are excluded). Message includes person, project, and end date.
- [x] **Over-allocated (Critical):** emit one alert per person-week where **sum of planned % > 100%** (after proration rules above). Message includes person, week key, and total % (one alert per person-week hit; cap list at **50** with "+N more" footnote if needed).
- [x] Alerts render in an Operations-style list grouped by **type**, then **person**; both levels collapsible (**v2.18.2**). Clicking an alert scrolls to / expands the target person row.

### Data and auth

- [x] Server entry point **`getResourceAssignmentDashboardData(rangeStart?, rangeEnd?)`** requires **`requireAuthForApi_()`** and **`canAccessResourceAssignmentsDashboard_()`** (**v2.18.1**): visible when **any** of **Team = CLIENT-ENGAGEMENT**, **Role = EXEC**, or **Role = ADMIN** (same rule as Pipeline).
- [ ] Fibery query reads **`Agreement Management/Resource Allocations`** portfolio-wide (not scoped to one Agreement), with at minimum: person name, role, agreement id/name, customer name, duration, percent allocated, allocated hours, allocation name.
- [ ] Payload includes **`cacheSchemaVersion: 1`**, **`weeks[]`**, **`persons[]`** (nested **`projects[]`** with per-week **`percent`** and **`hours`**), **`dimensions`**, **`alerts[]`**, **`kpis`** (distinct persons, projects, assignments, over-allocated person-weeks count, ending-soon count), and **`warnings[]`** for data quality (e.g. missing duration).

### Activity logging

- [ ] **`resource_assignments_refresh`**, **`resource_assignments_range_change`**, **`resource_assignments_expand_person`**, **`resource_assignments_alert_click`** logged to User Activity with Route = **`resource-assignments`**.

### Out of scope (future)

- [ ] Comparison to **actual** Utilization / Labor hours (future enhancement; note in UI as non-goal for v1).

## Release notes (shipped)

| Version | Date | Summary |
| --- | --- | --- |
| **2.18.0** | 2026-06-09 | **Resource assignments dashboard.** New Operations route with ISO week grid, expand/collapse person/project rows, ending-soon and over-allocation alerts, filters, Copy CSV, client TTL/cache, and snapshot **`resource-assignments.json`**. |
| **2.18.1** | 2026-06-09 | **Access gate.** Route visible when **Team = CLIENT-ENGAGEMENT**, **Role = EXEC**, or **Role = ADMIN** (same rule as Pipeline). |
| **2.18.2** | 2026-06-09 | **Alerts UX.** Alerts grouped by **type** then **person**; both levels collapsible. |
| **2.18.3** | 2026-06-09 | **Current week + heatmap.** Prominent **current ISO week** banner near panel top; collapsed grid cells use allocation **% heatmap** (blue → green **100-110%** → yellow/red) instead of per-project stacked bars. |

**Current product version:** **2.18.3** (`FOS_PRD_VERSION` in `src/Code.js`).

## UI notes

### Routes / panels

| Item | Value |
| --- | --- |
| Route id | `resource-assignments` |
| Panel | `#panel-resource-assignments` |
| Nav group | **Operations** (third child after Utilization, Labor hours) |
| Hash | `#resource-assignments` |

### Components (new / edited)

- **`src/resourceAssignmentDashboard.js`** (new): Fibery fetch, weekly proration builder, alerts, `getResourceAssignmentDashboardData`.
- **`src/Code.js`**: register route in **`buildNavigationModel_`**, expose server handler.
- **`src/DashboardShell.html`**: panel markup, weekly grid renderer (stacked bars + expandable project rows), date range controls, alerts strip, client cache key **`fos_resource_assignments_v1`** (Phase A: invalidate on range change only).
- **`src/userActivityLog.js`**: new event types above.

### Visual details

- **Stacked bars:** replaced **v2.18.3** with **allocation % heatmap** on collapsed person rows (see below).
- **Allocation heatmap (**v2.18.3**):** blue at 0% graduating to green at 100%; **100-110%** solid green (on target); above 110% yellow graduating to bright red by ~150%+.
- **Current ISO week banner (**v2.18.3**):** prominent callout near panel top (`Wnn · YYYY` plus Mon-Sun date span); current week column highlighted in grid header and cells.
- **Week headers:** show `Www` + optional month boundary label when week starts a new month.
- **Project child rows:** indent + project name + customer subtitle (truncate with tooltip).

## Data model

### Fibery source

Entity: **`Agreement Management/Resource Allocations`** (same as features **019** / **024**).

| Fibery field | Payload use |
| --- | --- |
| `fibery/id` | `assignments[].id` |
| `Agreement Management/Clockify User` → Name | Person key + display name |
| `Agreement Management/Clockify User Company` | `dimensions.companies` (Phase B filters) |
| `Agreement Management/Clockify User Team Member Role` → Name | Role label |
| `Agreement Management/Agreement` → `fibery/id`, Name | Project id + name |
| `Agreement Management/Agreement` → Customer → Name | Customer label |
| `Agreement Management/Duration` | `durStart`, `durEnd` (ISO date-only) |
| `Agreement Management/Percent Allocated` | Weekly % (primary) |
| `Agreement Management/Allocated Hours` | Proration fallback |
| `Agreement Management/Allocation Name` | Name fallback |

Unlike Delivery P&L, **Allocated Cost** is **not required** for rows to appear in this dashboard (staffing view, not cost chart).

### Server payload sketch (Phase A)

```json
{
  "cacheSchemaVersion": 1,
  "rangeStart": "YYYY-MM-DD",
  "rangeEnd": "YYYY-MM-DD",
  "weeklyCapacityHours": 40,
  "weeks": [{ "key": "2026-W23", "label": "Jun 2", "partial": false }],
  "persons": [{
    "key": "person:…",
    "name": "Jane Doe",
    "roleName": "Senior Engineer",
    "byWeekTotalPercent": { "2026-W23": 110 },
    "projects": [{
      "agreementId": "…",
      "projectName": "Acme Platform",
      "customerName": "Acme Corp",
      "byWeek": { "2026-W23": { "percent": 60, "hours": 24, "partial": false } }
    }]
  }],
  "dimensions": { "persons": [], "projects": [], "customers": [], "companies": [], "roles": [] },
  "kpis": { "personCount": 0, "projectCount": 0, "assignmentCount": 0, "overAllocatedWeeks": 0, "endingSoonCount": 0 },
  "alerts": [{ "id": "…", "severity": "critical|warning", "title": "…", "detail": "…", "target": { "personKey": "…", "week": "2026-W23" } }],
  "warnings": []
}
```

### Snapshot note (Phase C — shipped v2.18.0)

Daily snapshot job writes **`resource-assignments.json`** via **`buildResourceAssignmentDashboardPayload_()`**; registered in feature **009** manifest; client gate in feature **010**. Flag **`SNAPSHOT_INCLUDE_RESOURCE_ASSIGNMENTS`** (default true). Omitted from snapshot bundle when user fails access gate (**v2.18.1**).

## Operations

### Queries

- **`getResourceAssignmentDashboardData(rangeStart?, rangeEnd?)`**: primary read; paginated Fibery query with date overlap filter on **`Duration`** (allocations overlapping `[rangeStart, rangeEnd]`).
- Reuse **`fiberyQuery_`**, **`requireAuthForApi_`**, date parsing helpers from `deliveryDashboard.js` / `fiberyUtil.js`.

### Actions

- Client **Refresh** re-invokes server handler (respect TTL in Phase B).
- No Fibery writes from this panel in Phase A.

## Edge cases

| Case | Behavior |
| --- | --- |
| Missing **Duration** | Row included with warning `RESOURCE_ALLOCATION_MISSING_DURATION`; assign to overlap week containing start, or first week in range if both ends missing (match P&L fallback spirit). |
| Open-ended allocation (no end) | Included while start ≤ rangeEnd; never triggers **Ending soon**. |
| Zero **Allocated Hours** and null **Percent** | Omit from weekly totals; row MAY still list in a "Data gaps" warning count. |
| Duplicate person on same project | Separate segments if multiple allocation rows exist (do not merge unless product requests merge during review). |
| User lacks Client Engagement / Exec / Admin access | Same gate as Pipeline: nav hidden, API **FORBIDDEN**, snapshot field omitted |
| Very wide date range (> 52 weeks) | Server MAY cap at **52 weeks** with warning `RANGE_CAPPED` (confirm cap during review). |
| Snapshot mode selected (before Phase C) | Inline message when `resource-assignments.json` is missing for the selected snapshot date (legacy snapshots). |

## Verification steps

1. **Fibery spot check:** Run `_diag_resourceAssignmentsSample(rangeStart, rangeEnd)` (to be added) and confirm person/project/week totals match a manual spreadsheet for 2-3 known allocations.
2. **Default range:** Load panel fresh; confirm 30+90 day window and week column count.
3. **Expand/collapse:** Expand one person; project hour cells match collapsed % × capacity / 100 for a full week.
4. **Over-allocation:** Find a person with two overlapping 60% assignments; Critical alert fires and collapsed bar shows 120% styling.
5. **Ending soon:** Allocation ending in 14 days appears in Warning alerts; one ending in 45 days does not.
6. **Auth:** Non-Fibery user sees blocked state; authorized user loads without console errors.
7. **Activity:** Refresh and expand emit expected User Activity rows.

## Implementation checklist

- [x] Customer approves spec in Teamwork (**Spec Approved**)
- [x] `resourceAssignmentDashboard.js` + `_diag_resourceAssignmentsSample`
- [x] Nav + panel in `DashboardShell.html` (Phases A/B/C)
- [x] Activity events
- [x] PRD **FR-122** / **AC-81** + version **2.18.0** + `src/*` header sweep
- [x] Snapshot **`resource-assignments.json`** (feature **009** / **010**)
- [ ] Teamwork ship task rename + manifest update

## Change requests

_(Customer edits during Spec Draft / review go here; merge into main sections at Spec Approved.)_

## Changelog

| Date | Version | Notes |
| --- | --- | --- |
| 2026-06-09 | 2.18.3 | Current ISO week banner; allocation % heatmap (replaces project stacked bars) |
| 2026-06-09 | 2.18.2 | Project color legend; alerts grouped by type then person (collapsible) |
| 2026-06-09 | 2.18.1 | Access gate: CLIENT-ENGAGEMENT team, EXEC, or ADMIN |
| 2026-06-09 | 2.18.0 | Shipped Phases A/B/C: grid, alerts, filters, CSV, TTL, snapshots |
| 2026-06-09 | Draft | Initial spec from Inbox task 40228925 |

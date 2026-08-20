# Feature: Project Performance layer (Delivery)

> **Status:** Shipped (**v3.6.0**; patched through **v3.8.2**)  
> **PRD version:** **3.8.2** (`FR-137`, `AC-99`)  
> **Feature ID:** **040**  
> **Release type:** Enhancement  
> **Task list:** Delivery  
> **Depends on:** Delivery project P&L (**006**); Resource allocation chart / assignments (**019**, **024**); Month modal hours by person (**v3.4.11** / **v3.4.12**); Mobile shell (**029**); Supabase Live data layer (**036**); Engagement Update metrics (**037**) for shared plan / EAC formulas  
> **Implementation plan:** [040-project-performance-layer-implementation-plan.md](040-project-performance-layer-implementation-plan.md)  
> **Source:** [Performance Hub Requested Changes 2026-08-04](file:///c:/code/DEAP-Vault/01-PROJECTS/Clients/Harpin/Initiatives/Performance-Hub-Requested-Changes-2026-08-04.md) (demo feedback: Bernard, Jordan, Guy, Jess, Niurvi)  
> **Teamwork notebook:** [Feature 040 - Project Performance layer](https://win.godeap.io/app/projects/1615262/notebooks/313386)  
> **Implementation plan notebook:** [Feature 040 - Implementation plan (Project Performance)](https://win.godeap.io/app/projects/1615262/notebooks/313387)  
> **Release task:** [v3.6.0 - Project Performance layer](https://win.godeap.io/app/tasks/40848294)  
> **Template reference:** `docs/FEATURE_TEMPLATE.md`

---

## Origin / source request

CSM project financial health demo (**v3.4.11** / follow-ons). Feedback: the Delivery project view is strong as an **accounting P&L**, but managers need a **project performance** layer they can trust at a glance (plan context beside actuals, forward-looking EAC, hours next to dollars) without a verbal walkthrough of timing anomalies.

**Already delivered (out of scope for 040):**

| Change | Status |
| --- | --- |
| Resource name drill-down in month detail (names, hours logged/allocated, % allocated, cost) | Done (**v3.4.11** / **v3.4.12**) |
| Color coding for resource assignments (white = allocated & billable; orange = planned not billable / not on SOW) | Live |
| Unallocated time visibility (Clockify without Fibery allocation) | Live |

**Related but different surface:** Feature **037** Engagement Update status packs already snapshot **EAC**, **margin planned vs projected**, and resource hours for **monthly review packs**. This feature brings the same performance concepts into the day-to-day **Delivery project** workspace so CSMs can self-serve without opening an Engagement Review.

---

## Goal

Extend the **Delivery** selected-project experience with a **Project Performance** view that sits beside (not replaces) the accounting monthly P&L, so Client Engagement and delivery leads can:

1. See **planned margin** and **projected margin** next to period actuals (timing gaps no longer look like failed engagements by default).
2. See **Estimate at Completion (EAC)** in **hours** and **dollars** from remaining resource allocations.
3. Toggle or scan **hours alongside dollars** in the cost table, including **lifetime hours per resource** across the full project (not only the selected month/period).
4. Use an explicit **Project Performance** tab (or equivalent labeled mode) distinct from the accounting P&L table/chart.

**Primary audience:** CSMs / Client Engagement, delivery leads, Execs reviewing a single engagement.

**Non-goals:**

- Full **percentage-of-completion** revenue accounting.
- Ops follow-ups from the same call (Clockify buckets for SOW 21/22, LeadWhisper logging process, admin chat membership).
- Replacing Engagement Review status packs (**037**); share formulas instead of duplicating divergent math.

---

## Problem today

| Pain | Today |
| --- | --- |
| Negative period GP looks like a unhealthy account | July labor vs August invoice milestones produce large negative GP that is still on-plan; managers need verbal cover |
| No fixed plan margin on the project card | KPI strip shows actual margin vs target coloring on the list, but the selected-project view does not surface **planned** vs **projected** margin as first-class metrics |
| Forward look is incomplete | Allocation cost line and assignments modal show plan cost; EAC hours/dollars are not on Delivery P&L (they exist only inside Engagement Update snapshots) |
| Hours are buried | Month modal has person hours; the main cost table is dollars-first; lifetime hours per person are not obvious |
| Accounting and performance are mixed | One P&L card tries to serve both ledger review and project health |

---

## Locked product decisions

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Feature scope | **New Feature 040** under Delivery. Extends **006** UI/payload; does **not** change **037** notebooks unless a shared-metrics refactor needs a short technical note. **One Feature ID, one Teamwork release** (all slices in a single ship). |
| 2 | UX shape | On the selected-project card, add tabs: **Accounting P&L** (current table/chart) and **Project Performance** (new). |
| 3 | Default tab | **Client Engagement** → **Project Performance**. **Finance** team → **Accounting P&L**. Others → last-used in `sessionStorage` (fallback Accounting). |
| 4 | Nav | No new sidebar route. Remains under Delivery → Active Projects → project selection (`#panel-delivery`). |
| 5 | Planned margin source | Agreement **`Target Margin`** (`targetMargin` / `target_margin`), same as list KPIs and **037**. Display as fixed **Planned margin %** for the engagement. |
| 6 | Projected margin (smoothing) | Use **project-level projected margin** (lifetime / full-engagement view: actuals to date + remaining plan) to **smooth lumpy milestone timing**. Do **not** fall back to period-only margin or N/A when a single month looks bad; the project margin is the cover story next to period actuals. Formula: **(Revenue to date + remaining planned revenue − Cost to date − remaining planned cost) ÷ (Revenue to date + remaining planned revenue)**. Remaining plan from projected P&L months + allocation plan; align with Guy: *actuals to date + remaining plan*. |
| 7 | Timing anomaly flag | Show **Engagement review recommended** / **Timing review** when **period (as-of month) gross profit is negative** **and** **revenue is planned later** (remaining / future planned or projected revenue &gt; 0 after as-of). No $ floor. Do **not** require percentage-of-completion accounting. Optional deep-link to Engagement Review when user has access (**037**). |
| 8 | EAC hours | `actual hours to date + remaining planned allocation hours` (same construction as **037** `eacHours`). Budgeted = sum of allocation hours when present. |
| 9 | EAC dollars | **Labor cost + expenses (ODC) actuals to date** + **remaining planned allocation cost** (+ remaining planned ODC/expenses when available on the P&L). Budgeted = planned labor (allocations) + planned expenses/ODC when present. EAC $ is **not** labor-only. |
| 10 | Hours in cost table | On **Project Performance**: one table with **allocated hours, logged hours, allocated cost, logged cost, hours variance, and cost variance $** (no $ / Hours toggle as of **v3.7.5**; cost/hours variance columns added in **R5**). Default range is **all time**. Custom start/end dates filter actual margin and resource rows by calendar month. Lifetime hours per resource = sum of logged hours across all project months + lifetime allocated hours from assignments. |
| 11 | Formula ownership | Extract shared builders used by **037** `buildEngagementUpdateQuantitativeSnapshot_` into a shared module (e.g. `projectPerformanceMetrics.js`) consumed by Delivery P&L payload and Engagement Update snapshots so the two surfaces cannot drift. Update **037** EAC $ path to the same labor + expenses/ODC definition when extracting. |
| 12 | Cache / snapshots | Extend Delivery P&L payload; bump **`DELIVERY_PNL_CACHE_SCHEMA_VERSION_`** and client constant; snapshot job continues to use shared builder (**009**). |
| 13 | Historical | Snapshot / Datastore modes must render Project Performance from payload fields (no live Fibery). |
| 14 | Mobile | Same release: tabs in filter sheet or stacked controls; KPI cards 2-col; tables → cards; ≥ 44px targets (**029**). |
| 15 | Access | Same as Delivery panel today (no new role gate). Timing badge / Engagement Review CTA only when user can open **037**. |
| 16 | Resource variances (R5) | **Hours variance** = logged hours − allocated hours. **Cost variance $** = logged cost − allocated cost. Positive = over plan (logged more than allocated). **Allocated cost** = Fibery assignment allocated cost (lifetime from assignments; date-filtered months use the same month-prorate as allocated hours). |
| 17 | KPI formula tooltips (R5) | Every calculated KPI chip on **PM Overview** (project summary strip **and** Project Performance strip) MUST expose hover/`title` (and `aria-describedby` or equivalent) copy that states the formula in one or two sentences. Status update chip is not a calculated KPI; no formula tooltip required. |
| 18 | Performance Copy CSV (R5) | **Copy CSV** on the Project Performance tab copies **visible** resource table rows (respecting the date range) including the new variance columns. Reuse the Accounting P&L clipboard helper and ~3s status flash. |

---

## User stories

- As a **CSM**, I want **planned margin and projected margin** on the project view so I can tell if an account is tracking to plan without asking finance to interpret a negative month.
- As a **delivery lead**, I want **EAC hours and EAC dollars** so I can see completion risk before the engagement ends.
- As a **CSM**, I want **hours next to dollars** (and **lifetime hours per resource**) so staffing burn is visible without exporting Clockify.
- As a **CSM**, I want a **custom date range** (default all time) on Project Performance so I can inspect actual margin and resource burn for a period without leaving the tab.
- As a **CSM**, I want **orange highlighting explained** so I know which people logged time without an allocation or are not Allocated & Billable.
- As a **Client Engagement lead**, I want a **Project Performance** tab separate from the accounting P&L so I am not forced to read ledger rows to judge health.
- As a **facilitator**, I want **timing anomaly** cases flagged for engagement review instead of looking like failed projects.
- As a **CSM**, I want **allocated cost, cost variance $, and hours variance** on the Project Performance resource table so I can see plan vs actual burn without opening the month modal.
- As a **PM**, I want a **hover explanation on each PM Overview KPI** so I can recall how the number is calculated without leaving the page.
- As a **delivery lead**, I want **Copy CSV** of the Project Performance table so I can paste resource hours, costs, and variances into a review note or spreadsheet.
- As a **mobile user**, I want the same performance KPIs and tab switch usable under **768px**.

---

## Acceptance Criteria (testable)

### Tabs and placement

- [ ] **Given** a Delivery Active Project is selected, **when** the P&L card renders, **then** the user sees tabs (or equivalent labeled modes) **Accounting P&L** and **Project Performance**.
- [ ] **Given** **Accounting P&L** is selected, **when** the user views the card, **then** existing monthly table/chart, status updates, allocation line, and month modal behavior remain available (no regression of **006** / **019** / **v3.4.12**).
- [ ] **Given** **Project Performance** is selected, **when** the card renders, **then** the primary content is performance KPIs and performance tables (not the full accounting grid as the only view).

### Plan vs projected margin

- [ ] **Given** an agreement with **Target Margin**, **when** Project Performance loads, **then** **Planned margin %** shows that target (or **N/A** if missing).
- [ ] **Given** actuals and remaining plan inputs, **when** Project Performance loads, **then** **Projected margin %** is the **project-level** (smoothed) projected margin beside planned margin, not the single-month accounting margin alone.
- [ ] **Given** a month with large negative GP while later revenue is still on the plan (fixture: timing anomaly), **when** the user opens Project Performance, **then** project planned/projected margin remains visible so the account is not judged solely by that month.

### Default tab

- [ ] **Given** a user with team **CLIENT-ENGAGEMENT**, **when** they open a project P&L card with no prior tab preference, **then** **Project Performance** is selected.
- [ ] **Given** a user with team **FINANCE**, **when** they open a project P&L card with no prior tab preference, **then** **Accounting P&L** is selected.
- [ ] **Given** the user previously chose a tab this session, **when** they re-open a project, **then** last-used tab wins over the role default.

### Engagement review flagging

- [ ] **Given** as-of month gross profit **&lt; 0** **and** remaining/future planned or projected revenue **&gt; 0**, **when** Project Performance (or KPI strip) renders, **then** an **Engagement review recommended** / **Timing review** badge appears with short copy that revenue is planned later.
- [ ] **Given** period GP negative **and** no later planned revenue, **when** rendered, **then** the timing badge does **not** appear (treat as true period underperformance context).
- [ ] **Given** the user lacks Engagement Review access, **when** the badge shows, **then** copy still explains timing risk; CTA to open **037** is hidden or disabled.

### EAC

- [ ] **Given** resource allocations exist, **when** Project Performance loads, **then** **EAC hours** and **EAC dollars** show value (and budgeted when available).
- [ ] **Given** EAC dollars, **when** computed, **then** actuals include **labor + expenses/ODC** to date (not labor-only), plus remaining planned cost.
- [ ] **Given** no allocations, **when** Project Performance loads, **then** EAC hours fall back to actuals-to-date (or **N/A** for budgeted) with a clear empty/partial state; no crash.

### Hours alongside dollars

- [ ] **Given** Project Performance cost / resource section **and** the project has at least one resource allocation record, **when** the card renders, **then** allocated hours, logged hours, allocated cost, logged cost, hours variance, and cost variance $ appear in one table (no $ / Hours toggle).
- [ ] **Given** resource rows, **when** rendered with the default date range, **then** each resource can show **lifetime logged hours**, **lifetime allocated hours**, **lifetime allocated cost**, and **lifetime logged cost** for the project (full life), not only the selected month.
- [ ] **Given** orange / non-billable / unallocated rules already live, **when** the table renders, **then** those rules continue to apply and a legend/tooltip explains orange highlighting.
- [ ] **Given** a resource with allocated hours/cost and logged hours/cost, **when** the table renders, **then** **Hours variance** = logged − allocated and **Cost variance $** = logged cost − allocated cost (positive over plan). Zero allocated with logged time still shows variance equal to logged amounts.
- [ ] **Given** the custom date range is not all time, **when** resource rows render, **then** allocated cost and both variances use the same calendar-month filter as hours and logged cost (month-prorated allocation cost, not the unfiltered lifetime assignment total).

### No resource plan (v3.8.2)

- [ ] **Given** a selected project whose Delivery P&L payload has **`resourceAllocations.hasAllocations !== true`** (no Fibery/Datastore allocation records), **when** the user opens **Project Performance**, **then** the resource table (desktop) and mobile resource cards are hidden, and an inline dialog / empty-state panel shows the title **No Resource Plan Found**.
- [ ] **Given** the same project has allocation records (`hasAllocations === true`), **when** Project Performance renders, **then** the resource table and orange legend behave as before (including labor-only orange rows when present).
- [ ] **Given** no resource plan, **when** Project Performance renders, **then** Performance KPIs and the date-range control remain visible (only the resource table is replaced).
- [ ] **Given** viewport width **&lt; 768px**, **when** there is no resource plan, **then** the **No Resource Plan Found** panel is readable and not desktop-only (no reliance on a wide table).

### Date range

- [ ] **Given** Project Performance, **when** the KPI strip renders, **then** a custom start and end date control appears to the right of **Actual margin to date**, defaulting to **all time** (empty dates).
- [ ] **Given** the user enters a start and/or end date, **when** the range applies, **then** actual margin and resource rows include only calendar months in that range; planned/projected/EAC stay project-level.
- [ ] **Given** mobile width (&lt; 768px), **when** the user uses the date control, **then** start/end inputs are usable (≥ 44px) and wrap below the KPI cards.

### KPI formula tooltips (R5)

- [ ] **Given** a project is selected on **PM Overview**, **when** the user hovers (or long-presses / focuses) a project-summary KPI chip, **then** a tooltip explains that chip’s formula (Contract value, Revenue recognized, Total cost, Gross profit, Margin).
- [ ] **Given** **Project Performance** is selected, **when** the user hovers or focuses a Performance KPI chip, **then** a tooltip explains that chip’s formula (Planned margin, Projected margin, EAC hours, EAC $, Actual margin to date). Date range is a filter control, not a calculated KPI.
- [ ] **Given** viewport width **&lt; 768px**, **when** the user focuses a KPI chip, **then** the explanation is still available (`title` plus visible `aria-describedby` text or an equivalent accessible name; do not rely on hover-only).

### Performance Copy CSV (R5)

- [ ] **Given** Project Performance is selected and resource rows exist, **when** the user clicks **Copy CSV**, **then** the clipboard receives a CSV of **currently visible** rows with columns Name, Role, Allocated hrs, Logged hrs, Hours variance, Allocated cost, Logged cost, Cost variance $.
- [ ] **Given** the date range is not all time, **when** Copy CSV runs, **then** only the filtered resource rows are included (same set as the table).
- [ ] **Given** no resource rows, **when** Copy CSV is clicked, **then** the UI flashes a “Nothing to copy” (or headers-only) status and does not fail.
- [ ] **Given** Copy CSV succeeds, **when** the clipboard write completes, **then** a ~3s status flash appears and activity `delivery_pnl_perf_copy_csv` is logged on route `pm-overview`.
- [ ] **Given** viewport width **&lt; 768px**, **when** Project Performance is selected, **then** Copy CSV remains reachable in the card toolbar (≥ 44px), not desktop-table-only.

### Mobile

- [ ] **Given** viewport width **&lt; 768px**, **when** the user switches tabs and scans KPIs, **then** controls are reachable without desktop-only toolbar chrome; KPIs are card/2-col; touch targets ≥ 44px.

### Cache / observability

- [ ] Delivery P&L `cacheSchemaVersion` bumped on server and client; stale session cache invalidates.
- [ ] Activity events for tab switch and date-range changes are whitelisted in `userActivityLog.js`.
- [ ] Snapshot / Datastore historical load renders Project Performance from stored payload fields.

---

## UI Notes

### Desktop

- **Route / panel:** `delivery` / `#panel-delivery` (unchanged).
- **Surface:** Selected-project card below Active Projects.
- **Tabs:** `Accounting P&L` | `Project Performance` in the card toolbar (near existing Table/Chart controls; Chart stays under Accounting).
- **Project Performance layout (proposed):**
  1. KPI strip: Planned margin % · Projected margin % · EAC hours · EAC $ · Actual margin to date · **Date range** (start/end, default all time) immediately to the right of Actual margin
  2. Timing / engagement-review badge row when rules fire
  3. Orange-highlight legend (logged without allocation, or not Allocated & Billable)
  4. Resource performance table: Name · Role · Allocated hrs · Logged hrs · Hours variance · Allocated cost · Logged cost (label **Cost** or **Logged cost**) · Cost variance $ (orange row styling)
  5. Toolbar **Copy CSV** visible on the Performance tab (same control family as Accounting P&amp;L Copy CSV)
  6. Optional compact monthly spark/series for hours and margin planned vs projected (reuse **037** series concepts; keep light for v1)

**KPI tooltip copy (locked R5; keep short):**

| Chip | Tooltip |
| --- | --- |
| Contract value | Lifetime planned contract value from the agreement (same as Active Projects). |
| Revenue recognized | Sum of recognized revenue items for this agreement to date. |
| Total cost | Labor cost plus Materials and ODC for the agreement to date. |
| Gross profit | Revenue recognized minus total cost (recognized basis). |
| Margin | Gross profit divided by revenue recognized, as a percent. Subtext shows agreement Target Margin when present. |
| Planned margin | Agreement Target Margin. Fixed plan for the engagement; not the current month’s accounting margin. |
| Projected margin | Project-level: (revenue to date + remaining planned revenue − cost to date − remaining planned cost) divided by (revenue to date + remaining planned revenue). Smooths lumpy invoice timing. |
| EAC hours | Actual hours through the as-of month plus remaining planned allocation hours. Budget is total allocated hours when allocations exist. |
| EAC $ | Labor plus expenses/ODC actuals to date plus remaining planned allocation cost (and remaining planned ODC when on the P&amp;L). Not labor-only. |
| Actual margin to date | (Revenue − labor − expenses) divided by revenue for months in the selected date range (all time = through as-of). Planned, projected, and EAC stay project-level. |

### Mobile (`DashboardShell.html`, &lt; 768px)

- Tab switch via toolbar buttons (≥ 44px) or **`openMobileFilterSheet_`** if toolbar overflows.
- KPI strip → 2-col cards; date range wraps full width with ≥ 44px date inputs; resource table → person cards that also show allocated cost, hours variance, and cost variance $.
- Copy CSV stays in the shared P&amp;L toolbar (already ≥ 44px); do not hide it as `fos-delivery-accounting-only`.
- Progressive disclosure: charts/series behind **Show details** if included.
- Bottom nav / Delivery access gates unchanged.

### Filters (existing)

Customer, agreement type, agreement status, assigned owner remain on Active Projects (design principle from the meeting). No new portfolio-wide Project Performance route in this feature.

---

## Data Model

No new Fibery entities. Extend Delivery monthly P&L payload (and shared metrics helper):

```text
performance: {
  plannedMarginPct: number|null,
  projectedMarginPct: number|null,
  projectedMarginDollars: number|null,   // optional
  actualMarginPctToDate: number|null,
  eacHours: { value, budgeted },
  eacDollars: { value, budgeted, variancePct },
  timingReview: {
    recommended: boolean,
    reasonCode: 'negative_period_gp_on_plan' | ...,
    message: string
  },
  resourcesLifetime: [{
    personKey, name, role,
    allocatedHoursLife, loggedHoursLife,
    allocatedCostLife, loggedCostLife,
    hoursVarianceLife,   // loggedHoursLife - allocatedHoursLife (R5; may be client-derived)
    costVarianceLife,    // loggedCostLife - allocatedCostLife (R5; may be client-derived)
    allocatedAndBillable, highlightOrange
  }],
  series?: { hoursByMonth, marginByMonth }  // optional v1
}
```

**Sources (Supabase Live):**

| Field | Source |
| --- | --- |
| Planned margin | `fos_agreements.target_margin` (via agreement context) |
| Actuals | Existing Delivery P&L months (labor, ODC, revenue) |
| Remaining plan | `resourceAllocations` month buckets + projected revenue months |
| EAC | Same construction as `engagementUpdateMetrics.js` |
| Lifetime hours | Sum `laborByPerson` across months + assignment allocated hours |

**Migration notes:** None for Postgres schema beyond what **036** / **037** already mirror. Payload `cacheSchemaVersion` bump only.

---

## Operations

### Queries / builders

- Extend `buildDeliveryProjectMonthlyPnLInternal_` / Supabase twin to attach `performance`.
- Shared: `buildProjectPerformanceBlock_(pnlCtx)` used by Delivery and (refactored) Engagement Update snapshot.

### Actions (client)

- Tab switch; date range start/end (default all time); optional "Open Engagement Review" CTA; **Copy CSV** on Performance (R5).

### Activity events (proposed)

- `delivery_pnl_performance_tab`
- `delivery_pnl_perf_date_range`
- `delivery_pnl_timing_badge_click` (if CTA)
- `delivery_pnl_perf_copy_csv` (R5)

---

## Edge Cases

- Missing Target Margin: Planned = **N/A**; project projected margin still computed when possible.
- No allocations: EAC budgeted null; remaining plan hours/cost 0; show partial state.
- Negative period GP with later planned revenue: timing badge **on**.
- Negative period GP with **no** later planned revenue: timing badge **off**.
- All-future project: actuals 0; projected ≈ plan.
- Closed / past projects: remaining plan 0; EAC ≈ actuals; timing badge off.
- Snapshot schema older than bump: hide Performance tab or show upgrade message (prefer degrade with banner, keep Accounting).
- Clockify without allocation: keep orange / unallocated surfacing (already delivered).
- Allocated cost missing for a person: show **$0** allocated and cost variance = logged cost (same as hours when allocated hours are 0).
- Copy CSV in non-secure context: use existing `writeTextToClipboard_` textarea fallback.

---

## Verification Steps

1. **Desktop:** Open Delivery → select engagement with known Target Margin and allocations → **Project Performance** shows planned/projected/EAC; switch to **Accounting P&L** and confirm prior behavior.
2. **Timing fixture:** Month with negative GP and later planned/projected revenue → badge on; month with negative GP and no later revenue → badge off.
3. **Resources:** Confirm allocated hours, logged hours, allocated cost, logged cost, hours variance, and cost variance $ appear together; lifetime hours per resource match sum of month modal person hours across months (± rounding) on the default all-time range. Spot-check variance = logged − allocated.
4. **Date range:** Enter start/end; actual margin and resource rows follow calendar months in range; **All time** clears back to lifetime. Planned/projected/EAC unchanged. Date-filtered allocated cost and variances follow the same months.
5. **Orange:** Legend and orange-row tooltip explain logged without allocation / not Allocated & Billable.
6. **EAC $:** Confirm labor + expenses/ODC actuals are included (not labor-only).
7. **Default tabs:** CE user lands on Performance; Finance on Accounting (clear session tab key first).
8. **Mobile (~390px):** Tab switch, KPI cards, date inputs (≥ 44px), resource cards (including new variance fields) usable; Copy CSV reachable; no horizontal-only table as sole UX.
9. **Snapshot:** Load historical date; Performance fields render without Fibery.
10. **Regression:** Month modal logged vs allocated (**v3.4.12**), orange non-billable, assignments modal still work on Accounting tab.
11. **KPI tooltips:** Hover/focus each project-summary and Performance KPI; copy matches the locked table (formulas, not just labels).
12. **Copy CSV (Performance):** Copy filtered and all-time sets; paste into a sheet; columns and row counts match the table. Accounting Copy CSV still works.

---

## Implementation Checklist

- [ ] Spec Draft reviewed; Teamwork notebook + `Feature 040 - ...` release task created; notebook synced to git at Spec Approved
- [x] Shared metrics module + Delivery payload `performance` block (**v3.6.0**)
- [x] UI tabs + Project Performance KPIs / tables / badge (**v3.6.0** / **v3.7.5**)
- [x] Hours alongside cost + lifetime resource hours (**v3.7.5**; toggle removed)
- [x] **R5:** Allocated cost + hours/cost variance columns
- [x] **R5:** KPI formula tooltips (project summary + Performance)
- [x] **R5:** Performance Copy CSV + `delivery_pnl_perf_copy_csv`
- [x] **R5:** Month-prorated `allocatedCost` on `laborByPerson` if schema bump required
- [x] Mobile accommodations same PR as R5
- [x] PRD FR/AC + version bump at R5 ship
- [ ] Re-sync notebook at ship; rename task to `vX.Y.Z - ...`

---

## Release slices (build order; one ship)

Internal build order for one Feature **040** / one Teamwork release task (do not split into separate Feature IDs or separate ship tasks):

| Slice | Scope |
| --- | --- |
| **R1** | Shared metrics extract + Planned / project Projected margin KPIs + timing badge |
| **R2** | Hours toggle + lifetime hours per resource |
| **R3** | EAC hours + EAC dollars (labor + expenses/ODC) |
| **R4** | Accounting vs Project Performance tabs; CE/Finance defaults; Engagement Review CTA |
| **R5** | Allocated cost + hours/cost variance columns; KPI formula tooltips; Performance Copy CSV (follow-on PATCH after **v3.7.5**) |
| **R6** | No resource plan empty dialog when `hasAllocations` is false (**v3.8.2**) |

Ship **R1-R4 together** as a single MINOR (**v3.6.0**). **R5** / **R6** are follow-on PATCHes. Implementation: [040-project-performance-layer-implementation-plan.md](040-project-performance-layer-implementation-plan.md); empty-state plan: [040-no-resource-plan-empty-implementation-plan.md](040-no-resource-plan-empty-implementation-plan.md).

---

## Open questions

*(None. Product decisions locked 2026-08-10.)*

---

## Change requests

| Date | Request | Disposition |
| --- | --- | --- |
| 2026-08-20 | Project Performance: when no resource allocation records exist for the selected project, hide the resource table and show **No Resource Plan Found**. | Accepted as **R6** (**v3.8.2**). Gate on `resourceAllocations.hasAllocations`; KPIs stay visible. |

---

## Changelog (feature doc)

| Date | Note |
| --- | --- |
| 2026-08-10 | Spec Draft from Aug 4 demo feedback; Feature **040** proposed. |
| 2026-08-10 | Locked: CE/Finance default tabs; project-level projected margin smoothing; EAC $ = labor + expenses/ODC; timing badge = negative period GP with later planned revenue; one Feature / one ship. |
| 2026-08-18 | **v3.7.5:** Remove $ / Hours toggle; orange legend/tooltip; custom date range (default all time) to the right of Actual margin to date. |
| 2026-08-19 | **v3.7.6 / R5:** Allocated cost + hours/cost variance columns; KPI formula tooltips on PM Overview; Performance Copy CSV. Delivery P&L schema **16**. |
| 2026-08-20 | **v3.8.2 / R6:** When `resourceAllocations.hasAllocations` is false, hide the Performance resource table and show **No Resource Plan Found**. |

# Feature: Project Performance layer (Delivery)

> **Status:** Shipped (**v3.6.0**; patched through **v3.8.2**)  
> **PRD version:** **3.28.0** (`FR-137`, `AC-99`; allocated cost = hours × user cost rate)  
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
| 16 | Resource variances (R5) | **Hours variance** = logged hours − allocated hours. **Cost variance $** = logged cost − allocated cost. Positive = over plan (logged more than allocated). **Allocated cost** = allocated hours × user **Team Member Role** cost rate (SOW cost rate if current rate is missing; Fibery Allocated Cost only if no rate). Date-filtered rows use the same hours × rate on month-prorated allocated hours, not the unfiltered lifetime assignment total. |
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
- [ ] **Given** the custom date range is not all time, **when** resource rows render, **then** allocated cost and both variances use the same calendar-month filter as hours and logged cost (allocated hours × user cost rate, not the unfiltered lifetime assignment total).

### No resource plan (v3.8.2)

- [ ] **Given** a selected project whose Delivery P&L payload has **`resourceAllocations.hasAllocations !== true`** (no Fibery/Datastore allocation records), **when** the user opens **Project Performance**, **then** the resource table (desktop) and mobile resource cards are hidden, and an inline dialog / empty-state panel shows the title **No Resource Plan Found**.
- [ ] **Given** the same project has allocation records (`hasAllocations === true`), **when** Project Performance renders, **then** the resource table and orange legend behave as before (including labor-only orange rows when present).
- [ ] **Given** no resource plan, **when** Project Performance renders, **then** the date-range control and **Actual margin to date** remain visible (resource table is replaced). As of **v3.9.0** / feature **046**, Planned margin, Projected margin, EAC hours, and EAC $ show **N/A** with **No plan available** instead of Target Margin / forecast figures.
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

## Bug fixes (engineering-tracked)

*(Technical appendix; not synced to any Teamwork notebook per `docs/teamwork-workflow.md` "Bug-fix releases." Authored by Claude Code from code review + user report 2026-09-09; implementation belongs to Cursor.)*

### BUG-040-01: Planned margin and Projected margin show N/A site-wide on the live Project Performance tab

**CONFIRMED 2026-09-10 - root cause found, this is a downstream symptom of BUG-036-01, not an independent defect.** A direct read-only Supabase query (via the newly-connected Supabase MCP tool - not previously available) confirmed the actual data: **zero** of the checked `fos_resource_allocations` rows have a `sowBillRate` **key** in their `raw` JSONB column (not null - the key is entirely absent), and every row's `synced_at` is frozen at **2026-08-25 09:28:31 UTC**. Cross-referencing `public.fos_sync_runs` shows the entire Supabase sync/hydrate pipeline has been stuck since **2026-08-25 17:47 UTC** (one manual run left permanently in `status: 'running'`, blocking every subsequent scheduled or manual attempt - see **BUG-036-01** in `docs/features/036-supabase-dashboard-data-layer.md` for the full root cause and fix). `sowBillRate`/`sowCostRate`/`roleOnSow` were added to the AM mirror's select map for feature **053**, which shipped after the last successful sync - so no allocation row has ever actually been synced with these fields present. **Do not implement a calculation-logic fix here** until BUG-036-01 is resolved and a fresh sync has run - re-verify this entry against live data at that point; it may close with no code change needed in this file at all. The original hypothesis-stage analysis below is kept for reference since it correctly identified the shared `allocatedAndBillable` gate mechanism, even though the live data pointed to a sync-freshness cause rather than a rate-mapping bug.

**Original report:** 2026-09-09 - "None of the Projected or Planned margins are showing up in the live data even though it should be there." This was raised while investigating a Lookback report (`docs/features/056-monthly-lookback-financial-review.md` BUG-056-12, closed as not-a-bug for one specific project once the user confirmed PM Overview's live tab showed the same state for it) - the user is now saying the underlying live calculation itself is wrong **across projects generally**, not just the one already checked.

**Mechanism (confirmed, code-level) - both margins share exactly one gate that can explain a site-wide failure.** `ppComputeAllocationLaborMargin_` (`src/projectPerformanceMetrics.js` lines 291-343) is called twice per project - once with `rateMode: 'sow'` (Planned margin) and once with `rateMode: 'current'` (Projected margin). Both calls first filter `assignments` down to `a.allocatedAndBillable === true` (line 295); if that filter empties the list, **both** calls return `{ pct: null, ok: false, reason: 'No billable allocations with hours on this SOW.' }` **before ever looking at any rate** - a single shared cause, not two independent rate problems. Only past that first gate do the two calculations diverge onto separate rate sources:
- **Planned (SOW):** `row.sowBillRate` / `row.sowCostRate`, sourced from the allocation's mirrored `raw` JSONB column - `sowRateFromSupabaseAllocationRaw_(raw, 'sowBillRate')` (`src/supabasePanelBuilders.js` lines 1357-1362) reads `raw.sowBillRate` / `raw.sowCostRate` directly.
- **Projected (current):** `role.bill_rate` / `role.cost_rate`, looked up from `loadFosTeamMemberRolesMap_()` by `clockify_user_role_id` (`src/supabasePanelBuilders.js` lines 1383-1405) - a **separate** table/join, unrelated to the SOW rate columns.

Traced end to end and found **structurally correct, but unverified against live data** (I have no way to query Supabase/Fibery directly - this needs Cursor to check the actual values):
- Fibery field paths are consistent everywhere they're referenced (`Agreement Management/Allocated & Billable`, `.../SOW Bill Rate`, `.../SOW Cost Rate`, `.../Role on SOW`) - `src/supabaseAmMirror.js` lines 306-332.
- `amMirrorMapResourceAllocation_` (`src/supabaseAmMirror.js` lines 1377-1401) stores `raw: row` - `row` is the select-mapped object using the same camelCase keys (`sowBillRate`, `sowCostRate`, etc.) that `sowRateFromSupabaseAllocationRaw_` later reads, so the key names line up on paper.
- `amMirrorBool_` (`src/supabaseAmMirror.js` lines 1661-1671) correctly coerces boolean/string/other Fibery values for `allocated_billable` - no obvious bug in the coercion itself.

**Because both a site-wide "no billable allocations" failure (one shared cause) and independent SOW-rate / current-rate data gaps (two separate causes) would produce the same visible symptom, this needs a live data check before writing any code - do not guess which one it is.**

**Ranked diagnostic steps (do these first, in order):**
1. For a project **known** to have real, billable resource allocations with rates set in Fibery today, query `fos_resource_allocations` directly: check `allocated_billable` (is it actually `true`, or `null`/`false`?), `raw->>'sowBillRate'` and `raw->>'sowCostRate'` (populated or null?), and `clockify_user_role_id` (set, or null?).
2. If `allocated_billable` is coming back `null`/`false` when Fibery clearly shows it checked, the AM mirror sync for this field is broken (or hasn't run since the field was last edited) - check the mirror's last successful sync timestamp/logs for the `resource_allocations` entity specifically, not just that the job ran generally.
3. If `allocated_billable` is correctly `true` but `raw->>'sowBillRate'`/`sowCostRate'` are null, check whether `Agreement Management/SOW Bill Rate` / `SOW Cost Rate` are relatively **new** Fibery fields (per **053**'s SOW-based planned margin work) that the AM mirror's field-select list only recently picked up - if so, check whether a **full resync** (not just an incremental one) is needed to backfill `raw` for allocation rows synced before that field was added to the select map.
4. Separately, if `clockify_user_role_id` is null or `loadFosTeamMemberRolesMap_()`'s underlying table has null `bill_rate`/`cost_rate` for the resolved role, that's a distinct gap specific to Projected margin only - confirm whether Planned margin (SOW path) is affected too before assuming they share one cause.
5. Cross-check against a project's own **live** Resource Assignments panel (feature 027/028) or the raw Fibery record - if the SOW/current rates are visibly populated there but still come back null through this path, the bug is in the Supabase mirror or this fetch chain, not in Fibery itself.

**Acceptance Criteria (testable):**
- [x] Root cause identified from live data (per the diagnostic steps above) and stated explicitly before any code change - specifically: is this the shared `allocatedAndBillable` gate, a SOW-rate-specific mirror gap, a current-rate role-lookup gap, or more than one of these at once? **PASS:** BUG-036-01 AM mirror stall; fresh sync 2026-09-10 repopulated `sowBillRate`/`roleOnSow` on all 150 rows. No calculation change in `projectPerformanceMetrics.js`.
- [x] For a project confirmed to have complete SOW and current rate coverage in Fibery, PM Overview's live Project Performance tab shows real Planned margin and Projected margin percentages, not N/A / "See tooltip". **PASS (data path):** Post-sync Supabase allocations carry SOW rates; August 2026 Lookback metrics updated for covered projects (see per-project table below). Live Web App spot-check recommended for PM Overview tab.
- [x] If the cause is a stale/incomplete AM mirror sync for newer fields (`SOW Bill Rate`, `SOW Cost Rate`, `Role on SOW`), a resync path is identified and run (full resync vs. incremental) - state which, and confirm it doesn't need a recurring one-off script per the standing rule against those (`.cursor/rules/teamwork-product-workflow.mdc`). **PASS:** ADMIN Pull from Fibery after BUG-036-01 unblock (2026-09-10); incremental AM mirror with reconcile.
- [x] No regression to the legitimate "See tooltip" / "No plan available" states for projects that genuinely lack complete rate coverage or a resource plan - this fix must not paper over real gaps with fabricated values (same guardrail as BUG-056-12). **PASS:** Projects below still show N/A with explicit Fibery rate-gap reasons.
- [x] Once fixed, re-verify Lookback's frozen KPI cards (**FEATURE-056-11** / **BUG-056-12**) for the same projects, since Lookback's freeze reuses this exact calculation chain - a live-side fix here should flow through to future locks automatically, but confirm rather than assume. **PASS:** August 2026 Lookback month `03914879-93dd-40a3-96f2-b6e7c0d4b09f` metrics refreshed (LeadWhisper Combined updated 2026-09-10 19:48 UTC).

**Per-project August 2026 Lookback (selected projects, `metrics.performance` after re-run):**

| Project | Planned | Projected | Status |
| --- | --- | --- | --- |
| LeadWhisper - Combined SOWs | 55% | 50% | Fixed |
| Order Form #6 | 54.8% | 50% | Fixed |
| SOW 1 Change Order 15 & 16 | 54.8% | 50% | Fixed |
| SOW 15 PCL Utility | 55% | 50% | Fixed |
| SOW 16 Identity Services | 55.1% | 50% | Fixed |
| SOW 1 Canon | N/A | 50% | Planned N/A: SOW bill+cost missing on billable allocs (Fibery source) |
| SOW 21 Omnichannel | N/A | 50% | Planned N/A: SOW rates missing (Niurvi Santos alloc) |
| SOW 22 Dedicated LW | N/A | 50% | Planned N/A: missing SOW cost rate (Kim-an Quinn) |
| SOW 23 Fluent | N/A | 50% | Planned N/A: SOW bill present, SOW cost null on all billable allocs |
| RCI Phase 2 | N/A | N/A | SOW gaps + missing role bill rates (Edison Black, Account Executive - US Contractor) |

**Architecture Review:**
- **Security:** None - read-only diagnostic and data-sync fix.
- **Performance:** None expected, unless the fix requires a full AM mirror resync, which is a heavier one-time operation than the normal incremental sync - size that separately if needed.
- **Regression risk:** This calculation chain is shared by PM Overview's Project Performance tab (**040**/**053**), Delivery P&L (**006**), Engagement Updates (**037**), and Lookback's frozen KPI cards (**056** **FEATURE-056-11**) - a fix here affects all of them. Re-verify each surface still shows correct **and** correctly-N/A states after the fix, not just the one originally reported.
- **Testing gaps:** No existing test asserts `allocated_billable` / SOW rate / current rate actually reach `ppComputeAllocationLaborMargin_` correctly from a real Supabase row shape - only the calculation function itself has been tested in isolation with stubbed inputs. Add a test that goes through the real fetch chain (`fetchResourceAllocationsForAgreementFromSupabase_` or equivalent) for a known-good fixture row and asserts the resulting `assignments` entry has the expected `allocatedAndBillable`/`sowBillRate`/`sowCostRate`/`currentBillRate`/`currentCostRate` values - this is the layer that was never actually exercised end to end.

**Verification Steps:**
1. Query `fos_resource_allocations` directly for a project with known-good Fibery rate data; confirm `allocated_billable`, `raw->>'sowBillRate'`, `raw->>'sowCostRate'`, and the resolved role's `bill_rate`/`cost_rate` all match what Fibery shows.
2. Fix whatever the query reveals (mirror resync, a mapping bug, or a genuinely different issue); confirm PM Overview's live tab now shows real Planned and Projected margin for that project.
3. Spot-check a project that genuinely lacks complete rate coverage; confirm it still correctly shows N/A / "See tooltip" (not silently "fixed" into a fake value).
4. Re-lock or re-run a Lookback month containing an affected project; confirm the frozen KPI cards now also show the corrected values.

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
| 2026-08-21 | **v3.9.0 / feature 046:** Empty-plan Planned/Projected/EAC chips are N/A with **No plan available**; Actual margin stays. |
| 2026-09-01 | **v3.20.18:** Date-range (and all-time) allocated cost = allocated hours × Team Member Role cost rate when Fibery Allocated Cost is empty. Delivery P&L schema **19**. |
| 2026-09-10 | **v3.28.0:** BUG-040-01 closed as downstream of BUG-036-01 sync fix. Re-verified August 2026 Lookback metrics and per-project Planned/Projected margin (see AC table). No code change in `projectPerformanceMetrics.js`. |
| 2026-09-10 | **Confirmed via live Supabase query:** root cause is **BUG-036-01** (sync pipeline stuck since 2026-08-25) - `sowBillRate`/`sowCostRate`/`roleOnSow` have never been synced into `fos_resource_allocations.raw` at all. No calculation-logic fix needed here pending BUG-036-01's remediation; re-verify after that ships. |

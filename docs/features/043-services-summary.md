# Feature: Services Summary

> **Status:** Shipped (**v3.8.0**)  
> **PRD version 3.8.0** - sync with `docs/FOS-Dashboard-PRD.md` (`FR-140`, `AC-101`).  
> **Feature id:** 043 | **Task list:** Delivery  
> **Release type:** Enhancement  
> **Teamwork notebook:** [Feature 043 - Services Summary](https://win.godeap.io/app/projects/1615262/notebooks/313388)  
> **Implementation plan notebook:** [Feature 043 - Implementation plan (Services Summary)](https://win.godeap.io/app/projects/1615262/notebooks/313389)  
> **Release task:** [v3.8.0 - Services Summary](https://win.godeap.io/app/tasks/40848296)  
> **Implementation plan:** [043-services-summary-implementation-plan.md](043-services-summary-implementation-plan.md)  
> **Teamwork workflow:** See `docs/teamwork-workflow.md`.

## Goal

Give delivery and finance users a single **Services Summary** view of the **active Services agreement** portfolio: customer filter, headline KPIs, and a plan-versus-actual table (revenue and hours) with assigned owner.

## User Stories

- As a delivery leader, I want to scan all active Services engagements in one place so that I can see who owns each agreement and how billed progress compares to plan.
- As a finance reviewer, I want to see this month's scheduled revenue versus invoiced revenue so that I can spot billing lag without opening every project P&L.
- As a mobile user, I want KPI cards and agreement cards (not a wide table only) so that I can review the portfolio on a phone.

## Acceptance Criteria (testable)

- [x] Given the user can open Delivery routes, when they choose **Services Summary**, then the panel `#panel-services-summary` opens under the Delivery nav group (route id `services-summary`).
- [x] Given the agreement list is loaded, when the panel renders, then only **Agreement Type = Services** rows that match Delivery active-state rules (`Closed-Lost` excluded) appear.
- [x] Given more than one customer exists, when the user uses the **Customer** multi-select, then the KPI cards and table update to the selected customers without a Fibery refetch.
- [x] Given the visible set of agreements, then KPI **Active Engagements** equals that count; **Low Margin Projects** counts rows below Target Margin when set, otherwise below 35%; **Scheduled vs invoiced** sums this calendar month's milestone target amounts versus recognized amounts.
- [x] Given the table, when it renders, then columns are agreement title, total agreement value, planned revenue to date, actual revenue to date, planned hours to date, actual hours to date, and assigned owner; headers are sortable; a search box filters title/customer/owner.
- [x] Given Datastore labor and allocations are available on Live, when hours attach, then planned hours to date prorate `fos_resource_allocations` through today and actual hours sum `fos_labor_costs` through today; otherwise hours show **N/A**.
- [x] Given snapshot mode, when the user opens Services Summary, then money KPIs and the table come from the snapshot Agreement payload and hours are **N/A**.
- [x] **Mobile:** Given viewport width **&lt; 768px**, when the user opens Services Summary, then KPIs stack/scan in a compact grid, the customer control is at least 44px tall, and agreements render as cards instead of a wide table. The route is available from sidebar **More**, not the primary bottom nav.

## UI Notes

- Routes/pages impacted: Delivery group child **Services Summary** (`services-summary`), `#panel-services-summary` in `DashboardShell.html`.
- Components: customer multi-select (`.fos-util-multi`), three KPI cards (`.fos-agreement-kpi`), sortable table + mobile cards, Refresh.
- **Desktop:** filters, KPI row, table.
- **Mobile (`DashboardShell.html`, &lt; 768px):** 1-column KPIs, card list, 44px filter trigger. Not added to `MOBILE_BOTTOM_NAV_ITEMS_` / Home quick access (secondary Delivery route).

## Data Model

- Reuses Agreement dashboard payload (`getAgreementDashboardDataInternal_`) plus optional Supabase `fos_agreements.clockify_project_id`, `fos_resource_allocations`, `fos_labor_costs`.
- Client cache: `sessionStorage` key `fos_services_summary_v1`, `cacheSchemaVersion` **1**.
- No new Drive snapshot artifact in this release (hours omitted in snapshot mode).

## Operations

- Queries: `getServicesSummaryDashboardData(forceRefresh)`
- Actions: customer filter, search, sort, Refresh (Live)

## Edge Cases

- Missing Clockify project id: actual hours N/A for that row.
- Labor query truncated: warning + `partial`.
- Unknown customer: `(Unknown)`; blank owner: `Unassigned`.

## Verification Steps

1) Desktop: open **Delivery → Services Summary**; confirm Services-only active rows; change Customer filter; sort columns; Refresh.
2) **Mobile (~390px):** confirm cards, KPIs, 44px customer trigger; open from More.
3) Snapshot date: money columns populate; hours show N/A.

## Implementation Checklist

- [x] Update feature spec checkboxes as implemented
- [x] **Mobile UI** per `.cursor/rules/mobile-ui-shell.mdc` (same PR as desktop)
- [x] Add/update tests (if applicable) - none; Apps Script panel
- [ ] Run local smoke test
- [ ] Commit with message: feat: ...

## Changelog

| Date | PRD | Notes |
| --- | --- | --- |
| 2026-08-19 | 3.8.0 | Initial Services Summary route (feature 043). |
| 2026-08-20 | 3.8.0 | Teamwork ship catch-up: notebook + release task marked Shipped. |

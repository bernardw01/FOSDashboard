# Feature: Delivery P&L resource assignments modal

> **PRD version 2.15.12** - sync with `docs/FOS-Dashboard-PRD.md`  
> **Feature id:** 024 | **Task list:** Delivery  
> **Teamwork notebook:** [Feature 024](https://win.godeap.io/app/projects/1615262/notebooks/311906)  
> **Release task:** [v2.15.12](https://win.godeap.io/app/tasks/40203320) (Role column); [v2.15.10](https://win.godeap.io/app/tasks/40194885) (initial modal)  
> **Extends:** [Feature 019 - Resource allocation cost line](019-resource-allocation-pnl-chart.md)  
> **Status:** Shipped in **v2.15.10**; Role column in **v2.15.12**

## Goal

When the Delivery P&L **Chart** view shows planned allocation cost (orange **Allocated cost (plan)** line), let users open a modal listing each Fibery **Resource Allocations** row with person name, date duration, percent allocated, and total hours.

## User stories

- As a **delivery lead**, I want to see **who is assigned** to a project and for how long so I can validate the staffing plan against the chart overlay.
- As a **finance reviewer**, I want **% allocation and hours** beside planned cost so I can reconcile Fibery allocations without leaving the dashboard.

## Acceptance criteria

- [x] Given Chart view with **`resourceAllocations.hasAllocations`** and chart months (orange line visible), a **View resource assignments** link appears beneath the chart.
- [x] Clicking the link opens **`#deliveryPnlAssignmentsModal`** with columns **Name**, **Role**, **Duration**, **% allocation**, **Total hours**.
- [x] **Name** prefers **`Clockify User`** name, else **Allocation Name**, else `(Unnamed)`.
- [x] **Duration** shows `YYYY-MM-DD` or `start to end` from **`Duration`**.
- [x] Modal closes on **X**, **Close**, or backdrop click (Bootstrap).
- [x] Link hidden when no allocations, empty overlap message, or Table view.
- [x] **`resourceAllocations.assignments[]`** on P&L payload; **`DELIVERY_PNL_CACHE_SCHEMA_VERSION_` 10** (client `_v10`).
- [x] Snapshot **`delivery-pnl/<id>.json`** includes **`assignments[]`** via shared builder.
- [x] Activity event **`delivery_pnl_assignments_modal_open`**.

## UI notes

- **Route:** `delivery` / `#panel-delivery` (unchanged).
- **Link:** `#delivery-pnl-assignments-link` below `#delivery-pnl-allocation-note`.
- **Modal:** `#deliveryPnlAssignmentsModal` (table in `.fos-financial-table`).

## Data model

### Fibery fields (additional to feature 019)

| Field | Payload |
| --- | --- |
| `Agreement Management/Clockify User` → Name | `assignments[].name` (primary) |
| `Agreement Management/Clockify User Team Member Role` | `assignments[].roleName` (`(No role)` fallback) |
| `Agreement Management/Allocation Name` | name fallback |
| `Agreement Management/Duration` | `assignments[].durationLabel` |
| `Agreement Management/Percent Allocated` | `assignments[].percentAllocated` |
| `Agreement Management/Allocated Hours` | `assignments[].allocatedHours` |

### Server

`buildResourceAllocationAssignmentsList_()` in `src/deliveryDashboard.js`.

## Operations

- **Queries:** Same allocation fetch as feature 019 (extended select).
- **Client:** `showDeliveryPnLAssignmentsModal_()`, `updateDeliveryPnLAssignmentsLink_()`.

## Edge cases

- Rows with zero **Allocated Cost** still appear in **`assignments[]`** when other rows drive the chart line.
- Missing **Percent Allocated** or **Duration**: show ` - ` in the table.
- Percent values `0 < n <= 1` treated as fractions and multiplied by 100 for display.

## Verification steps

1. Open a project with resource allocations and Chart view: link visible; modal lists rows.
2. Project with no allocations: link hidden; empty note unchanged.
3. Toggle Table view: link hidden.
4. `_diag_sampleMonthlyPnL(agreementId)` includes `resourceAllocations.assignments`.
5. Historical snapshot with schema 10: modal works from bundled P&L and shows **Role**.

## Implementation checklist

- [x] Extend `fetchResourceAllocationsForAgreement_` select
- [x] `buildResourceAllocationAssignmentsList_` + payload `assignments[]`
- [x] Bump **`DELIVERY_PNL_CACHE_SCHEMA_VERSION_`** to **10** (Role column)
- [x] Client link + modal + activity event
- [x] PRD **FR-119**, **AC-78**, version **2.15.12**

## Changelog

| Version | Date | Notes |
| --- | --- | --- |
| 2.15.12 | 2026-06-09 | Role column on assignments modal; schema 10 |
| 2.15.10 | 2026-06-09 | Shipped: assignments modal on Delivery P&L chart |

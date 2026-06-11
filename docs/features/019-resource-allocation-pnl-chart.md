# Feature: Resource allocation cost line on Delivery P&L chart

> **PRD version 2.12.7** - sync with `docs/FOS-Dashboard-PRD.md`  
> **Feature id:** 019 | **Task list:** Delivery  
> **Teamwork notebook:** [Feature 019](https://win.godeap.io/app/projects/1615262/notebooks/311795)  
> **Release task:** [v2.12.7](https://win.godeap.io/app/tasks/40146936)  
> **Intake:** [Inbox task 40146804](https://win.godeap.io/app/tasks/40146804)  
> **Extends:** [Feature 006 - Delivery project P&L](006-delivery-project-pnl.md) (Phase D)  
> **Status:** Shipped in **v2.12.7**

## Goal

On the **Delivery** dashboard, when a user views a project's **monthly P&L chart**, show **planned labor cost from Fibery Resource Allocations** alongside **actual labor + expenses** and **revenue**, so delivery and finance can see whether the project is tracking to the staffing plan.

When the agreement has **no** `Agreement Management/Resource Allocations` rows, show a clear note under the chart: **"No resource allocations currently associated with this agreement."**

## User stories

- As a **delivery lead**, I want a **projected allocated cost trend** on the P&L chart so I can compare planned staffing spend to actual labor month by month.
- As a **finance reviewer**, I want to see **total allocated cost vs actual total cost** over the project timeline so I can spot overruns before margin erodes.
- As a **delivery lead**, I want an explicit **empty state** when no resource allocations exist so I do not mistake missing plan data for zero cost.

## Acceptance criteria

- [x] Given an agreement with one or more **Resource Allocations** linked in Fibery, when I open **Chart** view on that project's P&L, then a **line series** shows **monthly allocated labor cost** derived from allocation rows for that agreement.
- [x] Given the same chart, **actual cost** continues to show as today (stacked labor by role + expenses bars) and **revenue** continues as the existing line overlay.
- [x] Given an agreement with **zero** resource allocations, when Chart view is visible, then a message appears **beneath the chart**: `No resource allocations currently associated with this agreement.`
- [x] Given resource allocations with **Duration** date ranges, allocated cost is **spread across months** in the P&L month axis (prorated by calendar days per allocation).
- [x] Given **historical snapshot** data source, behavior matches live rules when allocation data is present in the snapshot payload.
- [x] No new secrets in client cache; allocation fetch uses existing Fibery auth path (`requireAuthForApi_()`).
- [x] Activity event `delivery_pnl_view_toggle` includes `allocationOverlay=true|false` when chart view is toggled.

## UI notes

- **Route:** `delivery` / `#panel-delivery` (unchanged).
- **Surface:** P&L card **Chart** view only (`#delivery-pnl-chart`); table view unchanged in v1.
- **New series:** `Allocated cost (plan)` as a **dashed violet line** (`#9B8CFF`) distinct from Revenue (solid teal).
- **Legend:** Revenue | Allocated cost (plan) | Labor roles (stack) | Expenses.
- **Tooltip:** Includes allocated cost for the hovered month when present.
- **Empty state:** `#delivery-pnl-allocation-note` below chart hint; hidden when allocations exist.

## Data model

### Fibery source

**Entity:** `Agreement Management/Resource Allocations`

| Field | Use |
| --- | --- |
| `Agreement Management/Agreement` | Filter to selected project |
| `Agreement Management/Allocated Cost` | Plan cost for the allocation row |
| `Agreement Management/Allocated Hours` | Optional QA vs cost |
| `Agreement Management/Duration` | Date range for month proration |

### Server payload extension (`getDeliveryProjectMonthlyPnL`)

`resourceAllocations` block on P&L JSON; **`DELIVERY_PNL_CACHE_SCHEMA_VERSION_` 6** (client suffix `_v6`).

### Month bucketing rule (v1)

For each allocation row with `Duration.start` / `Duration.end`:

1. Intersect allocation range with each P&L chart month.
2. Prorate `Allocated Cost` by **calendar days in intersection / calendar days in full allocation range**.
3. Sum prorated amounts per month across all rows for the agreement.

## Operations

- **Queries:** One additional Fibery query per project on P&L load.
- **Actions:** `buildDeliveryProjectMonthlyPnLInternal_` in `src/deliveryDashboard.js`; `renderDeliveryPnLChart_` in `DashboardShell.html`.
- **Snapshots:** Same builder path; `delivery-pnl/<id>.json` includes `resourceAllocations`.

## Edge cases

- Allocations with null **Duration**: entire `Allocated Cost` to first chart month; server `warnings[]` includes `RESOURCE_ALLOCATION_MISSING_DURATION`.
- `Allocated Cost` = 0 or null: skip row; if all rows skipped, treat as no allocations.
- Allocations outside project chart months: `emptyMessage`: `Allocations exist but none overlap project dates.`
- Partial Fibery failure: chart renders actuals; allocation line omitted; inline warning on P&L card.

## Verification steps

1. Select agreement **with** resource allocations: Chart view shows allocated cost line + actual stacks.
2. Select agreement **without** allocations: message under chart per acceptance criteria.
3. Toggle Table / Chart: table unchanged; note only in Chart view.
4. Historical snapshot date: same chart behavior when payload includes allocations.
5. Run `_diag_sampleMonthlyPnL(agreementId)`; confirm `resourceAllocations` block.
6. Confirm `sessionStorage` cache invalidates on schema version bump (`_v6`).

## Implementation checklist

- [x] Fibery query helper `fetchResourceAllocationsForAgreement_`
- [x] Month proration helper `buildResourceAllocationsBlock_`
- [x] Extend P&L payload + cache schema version **6**
- [x] Chart.js allocated cost line + legend + tooltip
- [x] Empty-state note DOM + copy
- [x] Snapshot job alignment (shared builder)
- [x] Feature doc sync to git at approval
- [x] PRD FR/AC + version bump (**2.12.6**)
- [x] Teamwork release task rename at ship (`teamwork_ship_task.py`)
- [x] Teamwork notebook synced from git at ship

## Change log

| Date | Change |
| --- | --- |
| 2026-06-11 | Spec approved; implementation started (server + client + cache v6). |
| 2026-06-11 | Chart fix: separate Chart.js stack ids for revenue vs allocation lines (v2.12.7). |
| 2026-06-11 | Shipped v2.12.7; notebook synced to Teamwork. |

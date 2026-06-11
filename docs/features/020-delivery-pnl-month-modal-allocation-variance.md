# Feature: Delivery P&L month modal - allocation by role and variance

> **PRD version 2.12.8** - sync with `docs/FOS-Dashboard-PRD.md`  
> **Feature id:** 020 | **Task list:** Delivery  
> **Teamwork notebook:** [Feature 020](https://win.godeap.io/app/projects/1615262/notebooks/311801)  
> **Release task:** [v2.12.8](https://win.godeap.io/app/tasks/40150201)  
> **Intake:** [Inbox task 40149979](https://win.godeap.io/app/tasks/40149979)  
> **Extends:** [Feature 006 - Delivery project P&L](006-delivery-project-pnl.md), [Feature 019 - Resource allocation P&L chart](019-resource-allocation-pnl-chart.md)  
> **Status:** Shipped in **v2.12.8**

## Goal

When a user clicks a month on the **Delivery P&L chart**, the **monthly P&L modal** (`#deliveryPnlMonthModal`) must show **planned allocated cost by team member role** alongside **actual labor by role**, plus a **variance** column (actual vs plan) so delivery and finance can see role-level billing drift for that month.

## User stories

- As a **delivery lead**, I want to see **allocated cost by role** in the month drill-down modal so I can compare staffing plan to actual labor for each role in that month.
- As a **finance reviewer**, I want a **variance column** (actual minus planned) per role and in total so I can spot over- or under-billing against resource allocations quickly.
- As a **delivery lead**, I want the modal to degrade gracefully when the agreement has **no** resource allocations (allocated and variance columns show em dash or a short note).

## Acceptance criteria

- [x] Given an agreement with **Resource Allocations** that include **Clockify User Team Member Role**, when I click a month bar/point on the P&L **Chart** view, the modal **cost section** shows columns: **Line item**, **Actual**, **Allocated (plan)**, **Variance** (`Actual - Allocated`).
- [x] Given the same modal, **labor rows** are grouped by the same role names used in the chart (`laborByRole` keys); **allocated (plan)** rows use prorated allocation cost for that month grouped by role (aligned with Fibery **Team Member Role** name, with `(No role)` fallback when role is missing).
- [x] Given **Expenses** for the month, the modal shows actual expenses in the **Actual** column; **Allocated** and **Variance** are em dash or blank (expenses are out of scope for resource allocations v1).
- [x] Given **Revenue** for the month, the modal continues to show revenue as today (single amount row or unchanged revenue block); variance applies to the **cost** section only.
- [x] Given **zero** resource allocations on the agreement, the modal opens as today for actuals; **Allocated** and **Variance** columns show em dash for labor rows and a footnote: `No resource allocations for this agreement.`
- [x] Given **historical snapshot** data source, behavior matches live when `resourceAllocations` in the P&L payload includes per-month `allocatedByRole` (or snapshot-safe empty state).
- [x] Activity event `delivery_pnl_chart_month_click` metadata includes `hasAllocationDetail=true|false`.

## UI notes

- **Route:** `delivery` / `#panel-delivery` (unchanged).
- **Surface:** `#deliveryPnlMonthModal` only (chart month click). Table view and revenue-item modal unchanged.
- **Table header (cost rows):**

| Line item | Actual | Allocated (plan) | Variance |
| --- | --- | --- | --- |
| Role name / Labor / Expenses | `$` actual | `$` plan or ` - ` | `$` with sign; positive variance styled as cost overrun |

- **Variance sign:** `Actual - Allocated` (positive = spent more than planned for that role in the month).
- **Footer:** Total cost row shows actual total, allocated labor total for the month, and total variance when allocations exist.
- **Layout:** `modal-xl` for four columns; `.fos-financial-table` patterns.

## Data model

### Fibery source (extend Feature 019 fetch)

**Entity:** `Agreement Management/Resource Allocations`

| Field | Use |
| --- | --- |
| `Agreement Management/Agreement` | Filter to project |
| `Agreement Management/Allocated Cost` | Plan cost (prorate by month) |
| `Agreement Management/Duration` | Month proration (same rule as Feature 019) |
| `Agreement Management/Clockify User Team Member Role` → `Agreement Management/Name` | Role bucket for `allocatedByRole` |

### Server payload extension

`resourceAllocations.months[]` includes `allocatedByRole` per month. **`DELIVERY_PNL_CACHE_SCHEMA_VERSION_` 7** (client `_v7`).

## Operations

- **Queries:** Role name added to existing Resource Allocations fetch (no extra round-trip).
- **Actions:** `buildResourceAllocationsBlock_` in `src/deliveryDashboard.js`; `openDeliveryPnlMonthModal_` in `DashboardShell.html`.
- **Snapshots:** Shared builder path; expected schema **7**.

## Edge cases

- Multiple allocation rows same role in one month: **sum** prorated costs.
- Role on allocation but no actual labor in month: show actual `$0`, allocated plan amount, negative variance.
- Actual labor role with no matching allocation row: allocated ` - `, variance equals actual.
- Role name mismatch: no fuzzy match in v1; union of role keys from actual and plan sides.

## Verification steps

1. Open Delivery, select project with resource allocations and chart month with both actual and planned labor.
2. Click chart month: modal shows four columns; role rows reconcile to chart tooltip totals.
3. Agreement without allocations: modal shows em dash in plan/variance with footnote.
4. Snapshot data source: same modal behavior without live Fibery.
5. `_diag_sampleMonthlyPnL(agreementId)` includes `resourceAllocations.months[].allocatedByRole`.

## Implementation checklist

- [x] Extend Fibery fetch with role name on allocation rows
- [x] Per-month `allocatedByRole` in `buildResourceAllocationsBlock_`
- [x] Cache schema **7** server + client + snapshot store
- [x] Modal table columns + variance formatting
- [x] Empty / snapshot states
- [x] PRD FR/AC + version bump (**2.12.8**)
- [x] Teamwork release task rename at ship (`teamwork_ship_task.py`)
- [x] Teamwork notebook synced from git at ship

## Change log

| Date | Change |
| --- | --- |
| 2026-06-11 | Implemented v2.12.8: `allocatedByRole`, modal columns, cache v7. |
| 2026-06-11 | Shipped v2.12.8; notebook synced to Teamwork. |

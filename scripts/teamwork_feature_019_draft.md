# Feature 019 - Resource allocation cost line on Delivery P&L chart

> **Feature id:** 019 | **Task list:** Delivery  
> **Teamwork notebook:** [Feature 019](https://win.godeap.io/app/projects/1615262/notebooks/311795)  
> **Intake:** [Inbox task 40146804](https://win.godeap.io/app/tasks/40146804)  
> **Extends:** [Feature 006 - Delivery project P&L](../features/006-delivery-project-pnl.md) (Phase D)  
> **Status:** Draft spec - customer review in Teamwork

## Goal

On the **Delivery** dashboard, when a user views a project's **monthly P&L chart**, show **planned labor cost from Fibery Resource Allocations** alongside **actual labor + expenses** and **revenue**, so delivery and finance can see whether the project is tracking to the staffing plan.

When the agreement has **no** `Agreement Management/Resource Allocations` rows, show a clear note under the chart: **"No resource allocations currently associated with this agreement."**

## User stories

- As a **delivery lead**, I want a **projected allocated cost trend** on the P&L chart so I can compare planned staffing spend to actual labor month by month.
- As a **finance reviewer**, I want to see **total allocated cost vs actual total cost** over the project timeline so I can spot overruns before margin erodes.
- As a **delivery lead**, I want an explicit **empty state** when no resource allocations exist so I do not mistake missing plan data for zero cost.

## Acceptance criteria

- [ ] Given an agreement with one or more **Resource Allocations** linked in Fibery, when I open **Chart** view on that project's P&L, then a **line series** (or equivalent trend) shows **cumulative or monthly allocated labor cost** derived from allocation rows for that agreement.
- [ ] Given the same chart, **actual cost** continues to show as today (stacked labor by role + expenses bars) and **revenue** continues as the existing line overlay.
- [ ] Given an agreement with **zero** resource allocations, when Chart view is visible, then a message appears **beneath the chart**: `No resource allocations currently associated with this agreement.`
- [ ] Given resource allocations with **Duration** date ranges, allocated cost is **spread across months** in the P&L month axis (prorated by calendar days or work days per allocation; document rule in Technical appendix).
- [ ] Given **historical snapshot** data source, behavior matches live rules when allocation data is present in the snapshot payload (or shows a snapshot-safe message if allocations are omitted from snapshot artifacts).
- [ ] No new secrets in client cache; allocation fetch uses existing Fibery auth path (`requireAuthForApi_()`).
- [ ] Activity event logged when user toggles chart with allocation overlay visible (extend existing `delivery_pnl_*` events).

## UI notes

- **Route:** `delivery` / `#panel-delivery` (unchanged).
- **Surface:** P&L card **Chart** view only (`#delivery-pnl-chart`); table view unchanged in v1.
- **New series:** `Allocated cost` (or `Planned labor (allocations)`) as a **dashed line** distinct from Revenue (solid teal). Suggested color: `#9B8CFF` (violet) or `#63B3ED` (blue) per dashboard palette.
- **Legend:** Revenue | Allocated cost (plan) | Labor roles (stack) | Expenses.
- **Tooltip:** Include allocated cost for the hovered month when present.
- **Empty state:** `#delivery-pnl-allocation-note` below chart hint; hidden when allocations exist.

### Chart mockup (target layout)

See **Visualization mockup** section below (HTML diagram in Teamwork notebook).

## Data model

### Fibery source (verified)

**Entity:** `Agreement Management/Resource Allocations`

| Field | Use |
| --- | --- |
| `Agreement Management/Agreement` | Filter to selected project |
| `Agreement Management/Allocated Cost` | Plan cost for the allocation row (USD integer in samples) |
| `Agreement Management/Allocated Hours` | Optional QA vs cost |
| `Agreement Management/Duration` | Date range for month proration |
| `Agreement Management/Clockify User` | Display only in drill-down (optional v1) |
| `Agreement Management/Clockify User Team Member Role` | Optional future stack by role |

**Not in v1:** `Agreement Management/Estimated Allocations` (pre-sales estimate); link only **Resource Allocations** on the agreement.

### Server payload extension (`getDeliveryProjectMonthlyPnL`)

Add to per-project P&L JSON:

```json
{
  "resourceAllocations": {
    "hasAllocations": true,
    "rowCount": 4,
    "months": [
      { "key": "2026-05", "allocatedCost": 12000, "cumulativeAllocatedCost": 12000 }
    ],
    "lifetimeAllocatedCost": 68340
  }
}
```

- Bump `DELIVERY_PNL_CACHE_SCHEMA_VERSION_` and snapshot alignment per dashboard-snapshot-cache-sync rule.
- `hasAllocations: false` omits `months` array; client shows empty-state note.

### Month bucketing rule (v1 proposal)

For each allocation row with `Duration.start` / `Duration.end`:

1. Intersect allocation range with P&L month range (project start through last chart month).
2. Prorate `Allocated Cost` by **calendar days in intersection / calendar days in full allocation range**.
3. Sum prorated amounts per month across all rows for the agreement.

Open question for review: use **Work Days** field when populated instead of calendar days?

## Operations

- **Queries:** One additional Fibery query per project on P&L load: Resource Allocations where Agreement = selected `agreementId`.
- **Actions:** Extend `buildDeliveryProjectMonthlyPnLInternal_` in `src/deliveryDashboard.js`; extend `renderDeliveryPnLChart_` in `DashboardShell.html`.
- **Snapshots:** Extend `buildDeliveryProjectMonthlyPnLInternal_` path in `dashboardSnapshotJob.js` / per-project `delivery-pnl/<id>.json` artifacts.

## Edge cases

- Allocations with null **Duration**: allocate entire `Allocated Cost` to month of `Duration.start` or spread evenly across project months (pick one; default **single month at start** with warning in server `warnings[]`).
- `Allocated Cost` = 0 or null: skip row; if all rows skipped, treat as no allocations.
- Agreement has allocations but all fall outside project duration: show note or zero line (prefer note: `Allocations exist but none overlap project dates.`).
- Partial Fibery failure: chart renders actuals; allocation line omitted; inline warning on P&L card.
- Chart.js mixed bar+line: third line dataset must not break stack scale (use separate y-axis only if needed; prefer single axis with formatted tooltips).

## Verification steps

1. Select agreement **with** resource allocations (e.g. RCI Phase 2 sample in Fibery): Chart view shows allocated cost line + actual stacks.
2. Select agreement **without** allocations: message under chart per acceptance criteria.
3. Toggle Table / Chart: table unchanged; note only in Chart view.
4. Historical snapshot date (if payload includes allocations): same chart behavior without live Fibery call.
5. Run `_diag_*` or editor sample for one agreement id; confirm month buckets sum to ~total allocated cost.
6. Confirm `sessionStorage` cache invalidates on schema version bump.

## Implementation checklist

- [ ] Fibery query helper `fetchResourceAllocationsForAgreement_`
- [ ] Month proration helper `buildAllocatedCostByMonth_`
- [ ] Extend P&L payload + cache schema version
- [ ] Chart.js allocated cost line + legend + tooltip
- [ ] Empty-state note DOM + copy
- [ ] Snapshot job alignment
- [ ] Feature doc sync to git at approval; PRD FR/AC + version bump at ship
- [ ] Teamwork release task `Feature 019 - Resource allocation cost on P&L chart`

## Change requests

(Add customer edits here after spec approval.)

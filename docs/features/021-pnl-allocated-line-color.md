# Feature: P&L chart allocated cost line color

> **PRD version 2.12.9** - sync with `docs/FOS-Dashboard-PRD.md`  
> **Feature id:** 021 | **Task list:** Delivery  
> **Teamwork notebook:** [Feature 021](https://win.godeap.io/app/projects/1615262/notebooks/311808)  
> **Release task:** [Feature 021](https://win.godeap.io/app/tasks/40151944)  
> **Intake:** [Inbox task 40151912](https://win.godeap.io/app/tasks/40151912)  
> **Extends:** [Feature 019 - Resource allocation P&L chart](019-resource-allocation-pnl-chart.md)  
> **Status:** Ready for test (**v2.12.9**; deploy with `clasp push`)

## Goal

Change the **Allocated cost (plan)** dashed line on the Delivery **P&L chart** from violet to **bright orange** so planned resource allocation cost is easier to distinguish at a glance.

## User stories

- As a **delivery lead**, I want the allocated cost line in **bright orange** on the P&L chart so it stands out clearly from revenue (teal) and expense bars (gold).

## Acceptance criteria

- [x] Given Chart view on a project P&L with resource allocations, the **`Allocated cost (plan)`** line, point markers, and legend swatch use **bright orange** (`#FF8800`).
- [x] Revenue line (teal), stacked labor bars, and expense bars are unchanged.
- [x] No server or cache schema change (client-only styling).

## UI notes

- **Route:** `delivery` / `#panel-delivery` (unchanged).
- **Surface:** P&L card Chart view only (`renderDeliveryPnLChart_` in `DashboardShell.html`).
- **Color:** `#FF8800` line; fill/hover tint `rgba(255, 136, 0, 0.12)`.
- **Replaces:** violet `#9B8CFF` from Feature **019**.

## Data model

No payload changes.

## Operations

- **Client:** `allocColor` constant in `renderDeliveryPnLChart_`.

## Edge cases

- When allocation line is hidden (no allocations), color change has no visible effect.

## Verification steps

1. Open **Delivery**, select a project with Fibery resource allocations.
2. Switch P&L to **Chart** view.
3. Confirm **Allocated cost (plan)** legend and dashed line are bright orange, distinct from teal revenue and gold expense bars.
4. Hover a month: tooltip still shows allocated cost amount.

## Implementation checklist

- [x] Update `allocColor` and line `backgroundColor` in `DashboardShell.html`
- [x] PRD FR/AC + version bump (**2.12.9**)
- [x] Feature doc + Teamwork notebook sync
- [x] Teamwork release task created (In-progress)
- [x] Teamwork notebook synced from git
- [ ] Teamwork release task rename at ship (`teamwork_ship_task.py`)
- [ ] Smoke test after `clasp push`

## Change log

| Date | Change |
| --- | --- |
| 2026-06-11 | Inbox intake 40151912; implemented orange allocated line (v2.12.9). |

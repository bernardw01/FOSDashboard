# Implementation plan: Feature 040 patch - No Resource Plan Found

> **PRD version:** 3.8.2  
> **Feature spec:** [040-project-performance-layer.md](040-project-performance-layer.md)  
> **Parent release:** [v3.6.0 - Project Performance layer](https://win.godeap.io/app/tasks/40848294)  
> **Release type:** Bug Fix / small Enhancement (PATCH)

## Goal

On **PM Overview → Project Performance**, when the selected project has **no resource allocation records**, hide the resource table (and mobile cards) and show an inline dialog: **No Resource Plan Found**. Projects that have allocations keep today's table.

## Detection

Use the existing Delivery P&L payload flag:

```text
payload.resourceAllocations.hasAllocations === true  → show table
otherwise                                            → show empty dialog
```

Do **not** use "zero `resourcesLifetime` rows" alone: labor-only rows can still appear when allocations are missing; product intent is "no resource **plan**" = no allocation records.

## UI

| Element | No plan | Has plan |
| --- | --- | --- |
| `#delivery-pnl-perf-no-plan` (new) | Visible | Hidden |
| `.fos-delivery-perf-desktop-table` | Hidden | Visible when rows exist |
| `#delivery-pnl-perf-cards` | Hidden | Visible when rows exist |
| Orange legend | Hidden | Visible |
| `#delivery-pnl-perf-empty` (no rows in range) | Hidden | Unchanged |
| Performance KPIs + date range | Visible | Visible |

Dialog copy (exact title): **No Resource Plan Found**. Optional muted subtitle clarifying no allocation records in Datastore.

Mobile: same panel; scannable under 768px; no modal that blocks the page.

## Files

| File | Change |
| --- | --- |
| `src/DashboardShell.html` | Markup + CSS + `renderDeliveryPerformance_` branch |
| `docs/features/040-project-performance-layer.md` | AC + changelog |
| `docs/FOS-Dashboard-PRD.md` | FR-137 / AC-99 patch note + §13 row **3.8.2** |
| `src/Code.js` + all `src/*` headers | `FOS_PRD_VERSION` **3.8.2** |

No server/`cacheSchemaVersion` bump (client-only presentation of existing `hasAllocations`).

## Verification

1. Desktop: select a project with allocations → table as today.
2. Desktop: select a project with `hasAllocations: false` → table hidden; **No Resource Plan Found** visible; KPIs still show.
3. Mobile ~390px: same empty state usable.
4. Accounting P&L tab unchanged.

## Checklist

- [x] Feature RD AC
- [x] Client empty state
- [x] Mobile
- [x] PRD PATCH bump
- [ ] Smoke on deployed Web App after `clasp push`

# Implementation plan: Feature 035 - Collapsible sidebar navigation sections

> **Status:** Shipped (**v2.26.2**).  
> **Feature spec:** [035-collapsible-sidebar-nav-sections.md](035-collapsible-sidebar-nav-sections.md)  
> **Related patterns:** Settings collapse UI ([012](012-admin-settings-usage-analytics-collapsible.md)); mobile More offcanvas ([029](029-mobile-shell-phase-ab.md)); shell nav ([001](001-dashboard-shell-navigation.md)).  
> **Primary file:** `src/DashboardShell.html` (`renderNav`, sidebar CSS).  
> **Server:** No change (`buildNavigationModel_` already emits group ids).  
> **Ship type:** Enhancement (**PATCH 2.26.2**).  
> **PRD:** **FR-131** / **AC-93**.  
> **Teamwork notebook:** [Feature 035 - Implementation plan (collapsible nav sections)](https://win.godeap.io/app/projects/1615262/notebooks/312687)  
> **Feature notebook:** [Feature 035 - Collapsible sidebar navigation sections](https://win.godeap.io/app/projects/1615262/notebooks/312686)  
> **Release task (shipped):** [v2.26.2 - Collapsible sidebar navigation sections](https://win.godeap.io/app/tasks/40521287)

## Locked review decisions

| Topic | Decision |
| --- | --- |
| Default | **Collapsed** |
| Auto-expand on navigate | **Yes** |
| Animation | Bootstrap **collapse** |
| Toggle activity logging | **No** |

## Summary

| Item | Choice |
| --- | --- |
| **What** | Make Sales / Operations / Delivery / Finance headings toggle child visibility |
| **Where** | Client-only in `renderNav` + CSS + `setActiveNav` hook |
| **Persist** | `sessionStorage` key `fos_nav_group_collapse_v1` with `{ schemaVersion, expanded }` |
| **Default** | All **collapsed** when no valid stored state |
| **Navigate** | Auto-expand group that owns the active route; write through to storage |

## Storage envelope

```javascript
{ schemaVersion: 1, expanded: { 'operations-group': true } }
```

Missing group ids ⇒ collapsed.

## Implementation checklist

- [x] Storage helpers (`read` / `write` / `isExpanded` / `setExpanded`)
- [x] `renderNav` group header button + Bootstrap collapse body + chevron
- [x] Wire `shown.bs.collapse` / `hidden.bs.collapse` to sessionStorage
- [x] `ensureNavGroupExpandedForRoute_` from `setActiveNav`
- [x] CSS (44px touch target, chevron rotate)
- [x] PRD / headers / overview

## Test plan

| # | Steps | Expected |
| --- | --- | --- |
| T1 | Fresh session, desktop | All visible groups collapsed |
| T2 | Expand Finance → refresh | Finance still expanded |
| T3 | Collapse Finance → refresh | Finance collapsed |
| T4 | Operations collapsed → open Utilization | Operations expands with animation; Utilization active |
| T5 | Mobile ~390px → More expand Delivery → refresh → More | Delivery expanded |
| T6 | Corrupt `sessionStorage` value | No throw; all collapsed |
| T7 | User without Finance access | No Finance header; other groups OK |
| T8 | Keyboard: focus heading, Space/Enter | Toggles collapse |
| T9 | Home / Profile / Settings / data source | Unchanged |

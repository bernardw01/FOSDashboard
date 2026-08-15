# Implementation plan: Feature 042 - By person variances tab

> **Feature spec:** [042-resource-assignments-by-person-variances.md](042-resource-assignments-by-person-variances.md)  
> **Status:** Shipped (**v3.7.0**)  
> **Feature ID:** **042**  
> **Depends on:** Feature **028** (By project tab, variance math, orange rules)

## Summary

Add **By person variances** tab (person → Assigned / Actual / Variance → project), rename **By person** → **By person allocations**, add daily drill-down modal, extend server payload + cache schema.

## Phase 1 - Server (`resourceAssignmentsDashboard.js`)

1. Reuse `buildResourceAssignmentsByProject_` daily merge logic; add **`byDay`** maps on project week cells (assigned, actual).
2. New builder **`buildResourceAssignmentsPersonVariances_`**:
   - Input: same allocation + labor maps as By project.
   - Output: `personVariances[]` with nested groups and projects.
   - Sort persons by name; projects by name within group.
3. Bump **`RESOURCE_ASSIGNMENTS_CACHE_SCHEMA_VERSION_`** to **3**; mirror client constant.
4. Wire into `buildResourceAssignmentsDashboardPayload_` and snapshot job.

## Phase 2 - Client (`DashboardShell.html`)

1. Tab labels: `ra-tab-person` → **By person allocations**; add `ra-tab-person-variances` **By person variances**.
2. `raState.activeTab`: `'person' | 'project' | 'personVariances'`.
3. Render function **`renderResourceAssignmentsPersonVariances_`**:
   - Mirror By project expand/collapse patterns (`raState.expandedPersonVarianceGroups` keyed by `personKey|group`).
   - Collapsed group row: sum week columns from child projects.
4. Modal **`openResourceAssignmentsDayDetailModal_`**: person, project, week, group type; table from `byDay`.
5. Mobile: horizontal tab scroll or filter sheet for tabs; modal full viewport width.

## Phase 3 - Docs / ship

- PRD FR/AC for ops variance review + tab rename.
- Feature **028** doc note (tab rename superseded by **042**).
- Snapshot **009** dataset table row if schema described.

## Test matrix

| Case | Expected |
| --- | --- |
| Allocated + actual match | Variance 0; may omit from Variance group or show 0 |
| Unallocated actual | Actual group, orange, positive variance |
| Non-billable allocation | Orange on actual row |
| Collapsed Assigned | Week total = sum projects |
| Cell click | Daily rows sum to weekly cell |
| Snapshot v2 | Variances tab shows upgrade message or hidden until regen |

## Changelog (plan doc)

| Date | Note |
| --- | --- |
| 2026-08-14 | Shipped v3.7.0. |

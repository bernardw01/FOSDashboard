# Feature: Resource assignments - By person variances tab

> **Status:** Shipped (**v3.7.2**)  
> **PRD version:** **3.7.2** (`FR-139`, `AC-100`)  
> **Feature ID:** **042**  
> **Release type:** Enhancement  
> **Task list:** Operations  
> **Shipped with:** Feature **041** (same **v3.7.0** release)  
> **Inbox source:** [Feature request - Resource assignments by person variances](https://win.godeap.io/app/tasks/40793086)  
> **Extends:** [Feature 028](028-resource-assignments-plan-vs-actual.md), [Feature 027](027-resource-assignment-dashboard.md)  
> **Implementation plan:** [042-resource-assignments-by-person-variances-implementation-plan.md](042-resource-assignments-by-person-variances-implementation-plan.md)  
> **Teamwork:** [Release task](https://win.godeap.io/app/tasks/40793089) · [Notebook](https://win.godeap.io/app/projects/1615262/notebooks/313284)  
> **Template reference:** `docs/FEATURE_TEMPLATE.md`

---

## Goal

Give operations managers a **By person variances** tab on the Resource assignments weekly grid so they can search by team member and date range, see which projects a person was **assigned** to vs where they **actually** logged time, spot **variances** and **unexpected / non-billable / unallocated** entries, and drill into **daily** detail for any week cell.

Also rename the existing **By person** tab to **By person allocations** (allocation % heatmap view unchanged).

---

## Origin / user story

> As an ops manager, I want to search by team member and time frame to see which projects they logged time against, know if they were allocated by PMs or not, see if they were fulfilling a role listed on the SOW (billable), and see any variances between allocated and actuals, so that I can identify unexpected time entries to follow up on.

This feature satisfies that story via the existing Resource assignments filters (Person, date range) plus the new tab hierarchy and cell drill-down modal.

---

## Locked product decisions

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Tab rename | **By person** → **By person allocations** (behavior unchanged from feature **027**). |
| 2 | New tab | **By person variances** (third tab alongside allocations and By project). |
| 3 | Top-level grouping | **Person** (sorted by display name), not project. |
| 4 | Second level | Three collapsible groups under each person: **Assigned**, **Actual**, **Variance**. |
| 5 | Third level | **Project** rows under each group showing hours per ISO week. |
| 6 | Assigned group | Projects with **planned / assigned hours &gt; 0** in the week (from Resource Allocations). |
| 7 | Actual group | Projects with **logged hours &gt; 0** in the week (from labor costs). Includes unallocated-only projects (assigned 0). |
| 8 | Variance group | Projects where **varianceHours ≠ 0** (positive = over actual; negative = under / assigned without work). |
| 9 | Collapsed group cells | Show **group total** hours for that ISO week when collapsed. |
| 10 | Orange styling | Reuse feature **028** rules: orange when not **Allocated & Billable** or no assignment on actual rows. |
| 11 | Cell click | Any numeric week cell opens a **modal** with a **daily breakdown** table (Mon–Sun or calendar days in that ISO week) for the clicked person × project × metric (assigned / actual / variance context). |
| 12 | Filters | Existing Company / Person / Role / Project filters apply; Person filter is primary for this user story. |
| 13 | Default tab | **By person variances** is first in the tab strip and the default on first visit; last tab persisted in `sessionStorage` (`fos_resource_assignments_active_tab_v2`). |
| 14 | Payload | Extend server payload with **`personVariances[]`** (or equivalent) including **`byDay`** buckets for modal drill-down; bump **`cacheSchemaVersion`**. |
| 15 | Snapshots | **`resource-assignments.json`** includes new shape when built after release. |
| 16 | Mobile | Tab strip scrollable; modal full-width; ≥ 44px targets. |
| 17 | Default expand | Person and groups **collapsed** by default on load. |
| 18 | Release packaging | Shipped in **v3.7.0** with Feature **041**. |

---

## User stories

- As an **ops manager**, I want to filter by **person and date range** and open **By person variances** so I can see assigned vs actual vs variance by project without pivoting by project first.
- As an **ops manager**, I want to know if time was **allocated by PMs** or logged **without allocation** so I can follow up on unexpected entries.
- As an **ops manager**, I want **billable / non-billable** (SOW role) signaled with existing **orange** styling on actuals.
- As an **ops manager**, I want to **click a week cell** and see **hours by day** so I can pinpoint when variance occurred.
- As a **delivery lead**, I want **By person allocations** renamed but unchanged so my allocation heatmap workflow is stable.

---

## Acceptance criteria (testable)

### Tabs

- [x] Tab control shows **By person allocations**, **By project**, and **By person variances**.
- [x] **By person allocations** matches prior **By person** behavior.
- [x] **By project** tab unchanged from feature **028**.

### By person variances hierarchy

- [x] Top-level rows are **people** (filtered, sorted by name).
- [x] Child groups **Assigned**, **Actual**, **Variance** (each collapsible; default collapsed).
- [x] Expanded groups show **project** rows with hours per ISO week.
- [x] Collapsed groups show **sum** for that group/week.

### Plan vs actual / variance

- [x] Assigned / actual / variance math matches feature **028**.
- [x] Labor-only rows under **Actual** with orange styling.
- [x] **Variance** group includes projects with **non-zero** variance (positive and negative).

### Daily drill-down modal

- [x] Week cell opens daily breakdown modal (Mon–Sun) with assigned / actual / variance columns.
- [x] Modal title includes person, project, ISO week, group context.
- [x] Snapshot payloads with schema **3** include daily buckets.

### Filters, export, activity

- [x] Filters apply to variances tab.
- [x] **Copy CSV** exports variances tab rows.
- [x] Activity: `resource_assignments_cell_drilldown` whitelisted.

### Mobile

- [x] Mobile tabs scroll; modal usable at ≥ 44px touch targets.

---

## UI notes

### Hierarchy (desktop)

```text
Person (Jane Doe)                         [W01] [W02] ...
  Assigned (collapsed → week totals)
    Project A                               ...
    Project B                               ...
  Actual
    Project A                               ...
    Project C (unallocated)                 ...  (orange)
  Variance
    Project A                               ...
```

### Modal (conceptual)

| Day | Assigned h | Actual h | Variance h |
| --- | --- | --- | --- |
| Mon 2026-08-11 | 4.0 | 3.5 | -0.5 |
| ... | | | |

---

## Data model

Extend Resource assignments payload:

```text
personVariances: [{
  personKey, name, roleName?,
  groups: {
    assigned: { projects: [{ agreementId, name, byWeek, byDay }] },
    actual:   { projects: [...] },
    variance: { projects: [...] }
  },
  highlightOrange?
}]
cacheSchemaVersion: 3  // was 2 in feature 028
```

**`byDay`:** keyed by `YYYY-MM-DD` within each ISO week for modal drill-down.

---

## Edge cases

- Person with allocations but no labor: Assigned group populated; Actual empty or zero.
- Person with labor but no allocations: Actual shows projects; Variance group shows positive actual vs zero assigned.
- Partial ISO weeks at range edge: same `partial` flag as existing grid.
- Zero hours cell: not clickable or opens empty state in modal.

---

## Verification steps

1. Pick a person with mixed allocated, unallocated, and non-billable rows; confirm hierarchy and orange rules.
2. Collapse Assigned group; week cell equals sum of child projects.
3. Click week cell; daily modal reconciles to weekly total.
4. Rename: **By person allocations** still shows heatmap.
5. Snapshot historical date loads variances tab when schema ≥ bump.
6. Mobile 390px: tabs + modal.

---

## Implementation checklist

- [x] Server: `personVariances[]`, `byDay`, schema **3**
- [x] Client: third tab, hierarchy, modal, tab rename
- [x] Snapshot alignment (**009**)
- [x] Mobile same release
- [x] Activity whitelist
- [x] PRD **FR-139**, **AC-100**, version **3.7.2**
- [x] Teamwork notebook synced at ship

---

## Changelog (feature doc)

| Date | Note |
| --- | --- |
| 2026-08-14 | Spec Draft from ops manager inbox request. |
| 2026-08-14 | Locked decisions; shipped **v3.7.0** with Feature **041**. |
| 2026-08-14 | **v3.7.1:** default tab By person variances; expand on load; client hydrate from `projects[]` when `personVariances` missing. |
| 2026-08-14 | Variance group includes **non-zero** variance (not only &gt; 0); people/groups collapsed by default again (**v3.7.2**). |

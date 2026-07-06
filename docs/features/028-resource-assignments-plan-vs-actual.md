# Feature: Resource assignments plan vs actual (Operations)

> **PRD version 2.19.1** - sync with `docs/FOS-Dashboard-PRD.md` (**FR-122**, **AC-81**).  
> **Feature id:** 028 | **Task list:** Operations  
> **Extends:** [Feature 027](027-resource-assignment-dashboard.md) (weekly grid, ISO weeks, filters, snapshots), [Feature 005](005-utilization-management-dashboard.md) (`Agreement Management/Labor Costs`), [Feature 007](007-labor-hours-dashboard.md) (person + project hour rollups).  
> **Status:** **Released v2.19.0**

## Goal

Extend the **Resource assignments** Operations dashboard so delivery leads can compare **planned assignment hours** to **actual labor hours** **by project and by person**, in the same ISO-week grid used today.

Add a **tabbed** weekly grid:

1. **By person** - the current view (person → project breakdown; allocation **% heatmap** on collapsed cells).
2. **By project** - project → person; expanding a person reveals **Assigned**, **Actual**, and **Variance** sub-rows per ISO week.

**Orange styling:** person name and **actual hours** when the allocation is not **`Allocated & Billable`** in Fibery, or when the person has **no assignment** (labor only, assigned = 0).

## User stories

- As a **delivery lead**, I want **assigned vs actual hours by project and person by week** so I can spot staffing plans that are not matching time logged.
- As an **operations manager**, I want the **By project** tab with expand/collapse so I can drill project → person → hour breakdown without leaving Operations.
- As a **finance reviewer**, I want **non-billable or unassigned** labor highlighted in **orange** at a glance.

## Acceptance criteria (testable)

### Tabbed grid

- [x] Tab control: **By person** (default) and **By project**.
- [x] **By person** tab unchanged from feature **027** / **v2.18.3**.
- [x] **By project** tab: project parent rows sorted by project name; person child rows sorted by display name.
- [x] Expanding a **person** under a project shows three sub-rows: **Assigned**, **Actual**, **Variance** (`Actual − Assigned`, one decimal).
- [x] Expand state independent per tab; persisted in **`sessionStorage`** for the session.

### Plan vs actual

- [x] Assigned hours from Resource Allocations (same proration as feature **027**).
- [x] Actual hours from **`Agreement Management/Labor Costs`** for the same date range, matched by agreement + person + ISO week.
- [x] Persons with **actual hours but no assignment** appear under the project with assigned = 0; **orange** styling on name and actual hours.
- [x] Collapsed project row week cells show project **actual** total (tooltip includes assigned and variance).

### Allocated & Billable

- [x] Server reads **`Agreement Management/Allocated & Billable`**.
- [x] **`highlightOrange`** when **any** allocation row for that person × project is unchecked, or when **`hasAssignment`** is false.
- [x] Legend on **By project** tab explains orange styling.

### Filters, KPIs, export, snapshots

- [x] Filters apply to both tabs; **KPI strip unchanged**.
- [x] **Copy CSV** exports active tab (project tab includes assigned, actual, variance columns).
- [x] **`cacheSchemaVersion: 2`**; snapshot **`resource-assignments.json`** includes **`projects[]`** and labor merge.

## UI notes

### By project hierarchy

| Level | Collapsed week cells | Expanded |
| --- | --- | --- |
| **Project** | Actual total (tooltip: assigned / actual / variance) | Person rows |
| **Person** | Actual hours (orange when flagged) | **Assigned**, **Actual**, **Variance** sub-rows |

## Data model

- Payload adds **`projects[]`**, **`laborMeta`**, **`cacheSchemaVersion: 2`**.
- Person under project: **`highlightOrange`**, **`hasAssignment`**, **`byWeek.{assignedHours, actualHours, varianceHours}`**.

## Verification steps

1. Compare assigned / actual / variance for a known project-week against a spreadsheet.
2. Expand project → person → verify three detail rows.
3. Labor-only person: assigned 0, actual > 0, orange name and actual.
4. Uncheck **Allocated & Billable** in Fibery: orange after refresh.
5. **By person** tab unchanged; snapshot mode loads without live Fibery.

## Implementation checklist

- [x] Server: labor merge + **`projects[]`** + schema bump
- [x] Client: tabs + project grid + orange styling + CSV
- [x] Snapshot alignment (feature **009**)
- [x] PRD **FR-122** / **AC-81** + **2.19.0** + `src/*` headers
- [ ] Teamwork ship task rename + manifest update

## Changelog

| Date | Version | Notes |
| --- | --- | --- |
| 2026-06-18 | 2.19.1 | Patch: alias-match labor time-entry login to assignment Clockify User; single row per person per project |
| 2026-06-18 | 2.19.0 | Shipped: By project tab, plan vs actual sub-rows, labor merge, orange styling, cache schema 2 |
| 2026-06-18 | Draft | Initial spec |

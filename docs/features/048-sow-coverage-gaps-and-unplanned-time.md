# Feature: SOW coverage gaps and unplanned time

> **Status:** In development (**v3.18.0**)  
> **PRD version:** **3.19.1** (**FR-154**, **AC-116**; daily Assigned workday spread extends **FR-139**)  
> **Feature ID:** **048**  
> **Release type:** Enhancement  
> **Task list:** Operations  
> **Inbox source:** [Surface SOW Coverage Gaps and Unplanned Time Logging](https://win.godeap.io/app/tasks/40554541) (form 2026-07-21; requestor **jess.williams@harpin.ai**; priority **Medium**)  
> **Extends:** [027](027-resource-assignment-dashboard.md), [028](028-resource-assignments-plan-vs-actual.md), [042](042-resource-assignments-by-person-variances.md)  
> **Related (not this release):** [040](040-project-performance-layer.md) orange rows on one project; [045](045-pm-overview-resource-time-entries.md) daily drill-down; Inbox [Add SOW margin data and SOW role mappings](https://win.godeap.io/app/tasks/40876280)  
> **Teamwork notebook:** [Feature 048 - SOW coverage gaps and unplanned time](https://win.godeap.io/app/projects/1615262/notebooks/313508)  
> **Release task:** [Feature 048 - SOW coverage gaps and unplanned time](https://win.godeap.io/app/tasks/40898277)  
> **Template reference:** `docs/FEATURE_TEMPLATE.md`

---

## Origin / source request

Inbox title: **Surface SOW Coverage Gaps and Unplanned Time Logging.**

> Add a dedicated report/view that surfaces only "problem resources" - people who need PM attention - filtering out anyone who's fully fine. Two issue types, shown together in one list:
>
> **No active SOW** ("orange"): Person is logging time against a project but is not listed on the active SOW.
>
> **Unplanned time logged:** Person is logging time against a project they are not currently planned/allocated to.
>
> Each row should show the person, the project, and enough detail (e.g., date range, hours logged, assigned hours or SOW status) to act on it without digging elsewhere. The report should exclude anyone who has neither issue - the point is a clean punch list, not a full roster.

---

## Goal

Give ops managers and PMs a **punch list** of person × project rows that need attention: time logged with **no active SOW listing**, time logged **without a current allocation**, or both.

People and projects that are fully fine (logged time is allocated **and** listed on the SOW) **must not appear**. This is not a roster and does not replace Resource assignments **By person variances** (feature **042**).

**Primary audience:** Ops managers (portfolio punch list) and PMs who want exceptions without scanning every grid row.

---

## Problem today

| Pain | Today |
| --- | --- |
| Orange mixes two causes | Feature **028** / **040** orange means unallocated **or** not Allocated & Billable. Jess asked for those as **two named issue types**. |
| Full grids hide the exceptions | **By project** and **By person variances** show everyone. Finding problems means scanning orange cells across weeks. |
| Per-project only | PM Overview Project Performance shows orange on **one** agreement. There is no portfolio list of "who is logging where they should not." |

---

## Locked product decisions

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Surface | New tab **Coverage gaps** on **Resource assignments** (Operations). Same From/To, Company / Person / Role / Project filters. Not a new nav route; not a PM Overview section. |
| 2 | Grain | One row per **person × project** in the selected range. Not one row per person (would hide which project). Not one row per week (too noisy for a punch list). |
| 3 | Issue A: No active SOW | Logged hours **> 0** on the project in range **and** the person is **not** listed as **Allocated & Billable** on any overlapping allocation for that agreement. No overlapping allocation also counts as not listed on the SOW. |
| 4 | Issue B: Unplanned time | Logged hours **> 0** on the project in range **and** assigned hours for that person × project overlapping the range **= 0** (no resource allocation, or none that overlaps the window). |
| 5 | Both issues | One row with **two badges**. Do not split into two rows. |
| 6 | Hide the fine | A person × project with logged hours **and** overlapping assigned hours **and** Allocated & Billable **true** is **omitted**. Assigned-only rows (plan, no labor) are **omitted**. Zero-hour rows are **omitted**. |
| 7 | Internal / harpin | **Exclude** projects whose customer name contains **harpin** (same skip as **v3.15.1** orange). No Include-internal toggle in v1. |
| 8 | Date window | Reuse Resource assignments From/To. This tab only evaluates **logged and assigned hours inside that range** (future weeks with plan and no labor do not create rows). |
| 9 | Columns | Person, Customer, Project, issue badges, Hours logged, Assigned hours, SOW status (`Allocated & Billable` / `Not on SOW` / `-`), First logged date, Last logged date. |
| 10 | Sort | Hours logged **desc** (largest exceptions first), then person name. |
| 11 | Issue filter | Chips: **All problems** (default) / **No SOW** / **Unplanned**. All problems shows rows with either badge. |
| 12 | KPIs (this tab only) | **Problem rows**, **People**, **Hours no SOW**, **Hours unplanned**. Hours in both issues count in **both** KPI totals (badges are independent). |
| 13 | Drill | Click/tap a row opens the existing Resource assignments **daily breakdown** modal for that person × project (feature **042**), scoped to the active range. |
| 14 | Export | **Copy CSV** of the visible punch-list rows (badges as columns). |
| 15 | Access | Same gate as Resource assignments. No new route in bottom nav. |
| 16 | Snapshot | Include `coverageGaps[]` on `resource-assignments.json` when the RA cache schema bumps (**3 → 4**). Historical dates without the slice show an inline empty/unavailable message on this tab only. |
| 17 | Out of scope | Editing allocations or Clockify membership; alert emails; auto-creating Clockify projects (Inbox [40698747](https://win.godeap.io/app/tasks/40698747)); SOW role / planned-margin columns on PM Overview (Inbox [40876280](https://win.godeap.io/app/tasks/40876280)). |

**Approved 2026-08-25** (Jess via Bernard): (1) tab on Resource assignments, (3) SOW listing = Allocated & Billable, (7) exclude internal/harpin.

---

## User stories

- As an **ops manager**, I want a list that shows **only** people logging time with no SOW listing or no current allocation so I can follow up without scanning the full roster.
- As a **PM**, I want each row to name the **person**, **project**, **hours logged**, **assigned hours**, and **SOW status** so I can act without opening another dashboard first.
- As an **ops manager**, I want **No SOW** and **Unplanned** as separate badges so I know whether to add someone to the SOW, add an allocation, or both.
- As a **mobile user**, I want the punch list as **cards** (not a wide table only) with a filter sheet for issue type and existing RA filters.

---

## Acceptance criteria (testable)

### Surface

- [ ] Given Resource assignments is open, when the user selects tab **Coverage gaps**, then only problem person × project rows render (criteria in decisions 3-6).
- [ ] Given a person × project that is allocated, Allocated & Billable, and has logged time in range, when Coverage gaps renders, then that pair is **absent**.
- [ ] Given a person with allocations but **no** logged time in range, when Coverage gaps renders, then that person is **absent**.

### Issue types

- [ ] Given logged hours and **no** overlapping allocation, then the row shows **Unplanned** and **No SOW**.
- [ ] Given an overlapping allocation with **Allocated & Billable** unchecked (or false) and logged hours, then the row shows **No SOW** and does **not** show **Unplanned**.
- [ ] Given overlapping assigned hours and Allocated & Billable true, then the row is omitted even if weekly variance is non-zero (over/under plan is still **042**, not this list).

### Detail and filters

- [ ] Each row shows person, customer, project, badges, hours logged, assigned hours, SOW status, first and last logged dates in range.
- [ ] Company / Person / Role / Project filters and From/To apply to this tab.
- [ ] Issue chips filter to All / No SOW / Unplanned without a server refetch.
- [ ] **Copy CSV** exports the visible rows.

### Empty, snapshot, activity

- [ ] Empty state copy: **No coverage gaps in this date range.**
- [ ] Snapshot dates without `coverageGaps` show an inline message on this tab; other RA tabs still work.
- [ ] Activity: `resource_assignments_tab_change` already covers tab switches; add `resource_assignments_coverage_filter` for issue-chip changes and `resource_assignments_coverage_drill` when a row opens the daily modal.

### Mobile

- [ ] **Given** viewport width **&lt; 768px**, when the user opens **Coverage gaps**, then rows render as cards (person, project, badges, hours), issue type uses the **filter bottom sheet**, and tap targets are at least **44px**. Desktop tab strip at **≥ 768px** is unchanged except for the new tab.

---

## UI notes

- **Route:** existing `resource-assignments` / `#panel-resource-assignments`.
- **Desktop:** fourth tab after **By person variances**, **By person allocations**, **By project**. Table + KPI strip for this tab. Orange is **not** the only signal; badges are the labels Jess asked for. Keep orange on other tabs as today.
- **Mobile:** cards; issue-type sheet via `openMobileFilterSheet_`; no new bottom-nav item.
- **Legend:** short line under KPIs: **No SOW** = not listed as Allocated & Billable (or no allocation). **Unplanned** = logged time with no overlapping allocation.

Conceptual row:

| Person | Customer | Project | Issues | Logged h | Assigned h | SOW | First log | Last log |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Alex | Acme | SOW 12 | Unplanned, No SOW | 16.0 | 0.0 | Not on SOW | 2026-07-08 | 2026-07-18 |
| Sam | Acme | SOW 12 | No SOW | 8.0 | 8.0 | Not on SOW | 2026-07-14 | 2026-07-14 |

---

## Data model

Reuse Live Datastore sources already on Resource assignments:

- `fos_labor_costs` (logged hours, person, Clockify project)
- `fos_resource_allocations` (assigned hours, Allocated & Billable, duration overlap)
- `fos_agreements` / `fos_companies` (project, customer)
- Person-key aliases already used by **028** / **042** / **040**

Payload sketch (schema bump on RA cache **3 → 4**):

```text
coverageGaps: [{
  personKey, personName, roleName, company,
  customer, projectName, agreementId,
  issues: ['no_sow' and/or 'unplanned'],
  hoursLogged, hoursAssigned,
  sowStatus: 'allocated_billable' | 'not_on_sow' | 'none',
  firstLoggedDate, lastLoggedDate
}]
coverageGapKpis: { rowCount, personCount, hoursNoSow, hoursUnplanned }
```

First/last logged dates come from labor `byDay` when available; otherwise null.

---

## Operations

- **Queries:** same RA Live rebuild from typed tables for the selected From/To; derive `coverageGaps` from labor × allocation overlap (no extra Fibery round trip).
- **Actions:** none (read-only). Drill reuses the **042** daily modal fetch.

---

## Edge cases

- Internal / harpin customers: always omitted (decision 7).
- Person alias split (two Clockify names): same merge rules as **028** / **042**; do not list the same human twice when aliases already collapse.
- Labor on a Clockify project with no Fibery agreement: still a row; project name from time entry; SOW status **Not on SOW**; both badges.
- Snapshot older than the schema bump: tab message only.
- Over-plan (assigned 40, logged 50, Allocated & Billable true): **not** a coverage gap (variance belongs on **042**).

---

## Verification steps

1. **Desktop:** Resource assignments → Coverage gaps. Confirm a known unallocated logger appears with both badges; a fully allocated & billable logger does not.
2. Confirm Allocated & Billable unchecked (with assigned hours) shows **No SOW** only.
3. Toggle **No SOW** / **Unplanned** chips; row set matches badges.
4. Change From/To; list rebuilds; future-only allocations do not create rows.
5. **Copy CSV** matches visible rows.
6. Click a row; daily modal hours reconcile to Logged h.
7. **Mobile (~390px):** cards, filter sheet, 44px taps; desktop tab strip unchanged at ≥ 768px.

---

## Implementation checklist

- [x] Update feature spec checkboxes as implemented
- [x] **Mobile UI** per `.cursor/rules/mobile-ui-shell.mdc` (same PR as desktop)
- [x] Server: `coverageGaps[]` + RA `cacheSchemaVersion` bump; snapshot **009**
- [x] Client: tab, KPIs, table/cards, chips, CSV, daily drill
- [x] Activity whitelist in `userActivityLog.js`
- [x] PRD FR/AC + version bump at ship
- [ ] Add/update tests (if applicable)
- [ ] Run local smoke test
- [ ] Commit with message: feat: Coverage gaps punch list on Resource assignments

---

## Changelog

| Version | Date | Notes |
| --- | --- | --- |
| 3.19.1 | 2026-08-25 | Daily Assigned hours in Coverage gaps drill use Mon–Fri workday spread; RA schema **5**. |
| 3.18.0 | 2026-08-25 | Implemented Coverage gaps tab; schema **4**; **FR-154**, **AC-116**. |
| Spec Approved | 2026-08-25 | Locked: RA tab, Allocated & Billable = on SOW, exclude harpin/internal. |
| Draft | 2026-08-25 | Spec Draft from Inbox 40554541. |

---

## Change requests

(Post-approval customer edits only; merge into the main body at ship.)

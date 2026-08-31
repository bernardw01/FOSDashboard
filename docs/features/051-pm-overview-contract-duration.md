# Feature: PM Overview - contract duration on project select

> **Status:** Shipped **v3.20.14**  
> **PRD version:** 3.20.14  
> **Feature ID:** **051**  
> **Release type:** Enhancement  
> **Task list:** Delivery  
> **Inbox source:** [Add contract duration to the PM Overview once a contract is selected](https://win.godeap.io/app/tasks/40886771) (form 2026-08-25; requestor **jess.williams@harpin.ai**; priority **Medium**)  
> **Extends:** [041 - PM Overview rebrand](041-pm-overview-rebrand.md), [006 - Delivery project P&L](006-delivery-project-pnl.md) (duration fields on agreement rows)  
> **Depends on:** PM Overview ([041](041-pm-overview-rebrand.md)), Mobile shell ([029](029-mobile-shell-phase-ab.md))  
> **Teamwork notebook:** [Feature 051 - PM Overview contract duration on project select](https://win.godeap.io/app/projects/1615262/notebooks/313602)  
> **Release task:** [v3.20.14 - PM Overview contract duration on project select](https://win.godeap.io/app/tasks/40940299)  
> **Template reference:** `docs/FEATURE_TEMPLATE.md`

---

## Origin / source request

Inbox title: **Add contract duration to the PM Overview once a contract is selected**

> As a PM, when I select an agreement and the bottom of the page loads, also include the contract duration.

**Requestor:** jess.williams@harpin.ai  
**Priority:** Medium

---

## Goal

When a PM selects a project on **PM Overview**, they MUST see the agreement **contract duration** in scannable places: a **bold US short-month date range** in the Project financials **subtitle**, and **Days remaining** / **% elapsed** KPI chips on the **Project Performance** chip row (not the Project financials KPI strip).

**Primary audience:** PMs / Client Engagement reviewing a single project.

**Non-goals:**

- Editing Fibery agreement dates from the Hub.
- Adding contract duration to the Active Projects table columns.
- Replacing or redesigning the **Pacing vs linear plan** strip (feature **v1.21.0** / FR-99).
- New Fibery queries or cache schema bumps (duration is already on each delivery project row).

---

## Questions for Jess (answered 2026-08-31)

| Q | Topic | Answer |
| --- | --- | --- |
| **Q1** | Missing vs hard to find | **B** - Saw dates in subtitle but too easy to miss; wants more visible (larger font). |
| **Q2** | Where to show duration | **Both** - friendly date **range on subtitle**; **days remaining / % elapsed on Project Performance** chip row (not Project financials KPI strip). |
| **Q3** | Chip content | Same as Q2. |
| **Q4** | Label and format | **A** - label **Contract duration**; US short-month dates (not DD/MM). |
| **Q5** | Empty Fibery Duration | **A** - **Not set** chip with Fibery guidance on Project Performance; subtitle shows **Not set**. |
| **Q6** | Scope | **A** - KPI chips only; no Active Projects table column. |

---

## Locked product decisions (Jess-approved)

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Subtitle | Project financials subtitle keeps customer · type · status and appends a **bold, larger** contract date range (`fos-delivery-duration-subtitle`). |
| 2 | Date format | US short-month range when both ends exist (e.g. `Jan 1, 2024 – Dec 31, 2025`). Single known date: `From …` / `Through …`. `executionDate` fallback when `durStart` is missing. |
| 3 | Project Performance | Prepend **Days remaining** and **% elapsed** chips to `#delivery-pnl-perf-kpis` before Planned margin. |
| 4 | Missing duration | Subtitle **Not set**; Performance shows **Not set** chip with Fibery **Agreement Management/Duration** guidance. |
| 5 | Project financials KPI strip | **No** Contract duration chip (financial KPIs unchanged). |
| 6 | Data source | Client-only: `project.durStart`, `project.durEnd`, `project.executionDate` from cached delivery payload. |
| 7 | Activity | `delivery_project_select` metadata includes `hasDuration=true/false`. |
| 8 | Mobile | Subtitle duration wraps; Performance chips wrap in existing KPI strip at &lt; 768px. |

---

## User stories

- As a **PM**, when I select a project on PM Overview, I want a **bold contract date range** in the Project financials subtitle so the engagement window is obvious.
- As a **PM**, when I open **Project Performance**, I want **Days remaining** and **% elapsed** chips so I can see timeline context beside margin KPIs.
- As a **PM** on a project with no Fibery duration, I want **Not set** copy with Fibery guidance so I know to fix data in Fibery.
- As a **mobile user**, I want the same subtitle and Performance chips when I select a project (~390px width).

---

## Acceptance criteria (testable)

- [x] **Given** a selected project with `durStart` and `durEnd`, **when** Project financials renders, **then** the subtitle shows a bold US short-month date range.
- [x] **Given** a selected project with full duration, **when** the user opens **Project Performance**, **then** **Days remaining** and **% elapsed** chips appear before Planned margin.
- [x] **Given** a selected project with only one date (or execution fallback), **when** Performance renders, **then** chips show the partial range and explain the missing start or end.
- [x] **Given** no parsable duration, **when** either surface renders, **then** subtitle shows **Not set** and Performance shows a **Not set** chip with Fibery guidance.
- [x] **Given** Live or historical snapshot mode, **when** a project is selected, **then** duration uses the delivery project row without an extra server call.
- [x] **Given** viewport **&lt; 768px**, **when** a project is selected, **then** subtitle duration wraps and Performance chips remain readable.

---

## UI notes

- **Desktop:** `renderDeliveryPnlHeader()` sets subtitle `innerHTML` with `formatProjectDurationRangeText_()` in a bold span; stores `deliveryState.durationPerfChipHtml` via `buildDeliveryDurationPerfChipsHtml_()`.
- **Project Performance:** `renderDeliveryPerformance_()` prepends duration chips to `#delivery-pnl-perf-kpis`.
- **Mobile:** `.fos-delivery-duration-subtitle` and `.fos-delivery-duration-chip` wrap rules in `@media (max-width: 767.98px)`.
- **Pacing strip:** Unchanged (after monthly P&L load when duration window is complete).

---

## Data model

- Read-only. Uses existing delivery project fields: `durStart`, `durEnd`, `executionDate`.
- No `cacheSchemaVersion` bump (client presentation only).

---

## Verification steps

1. Desktop Live: select project with full Duration → bold range in subtitle; Project Performance → Days remaining + % elapsed chips.
2. Empty Duration → subtitle **Not set**; Performance **Not set** chip with Fibery guidance.
3. Partial dates → subtitle shows known end/start; Performance explains missing field.
4. Mobile ~390px: same behavior with wrapped subtitle and chips.
5. Historical snapshot: same from delivery project row in snapshot payload.

---

## Implementation checklist

- [x] Jess answers Q1-Q6 in notebook
- [x] Implement subtitle + Performance chips in `DashboardShell.html`
- [x] Mobile verification CSS
- [x] FR-157 / AC-119 in `docs/FOS-Dashboard-PRD.md`
- [x] Activity metadata `hasDuration` on `delivery_project_select`
- [x] PRD version **3.20.14** + `src/*` header sweep

---

## Changelog

| Version | Date | Notes |
| --- | --- | --- |
| 3.20.14 | 2026-08-31 | Shipped per Jess review: subtitle date range + Project Performance timing chips. |

---

## Change requests

(Post-approval customer edits only; merge into the main body at ship.)

| Date | Request | Resolution |
| --- | --- | --- |
| | | |

# Feature: PM Overview - SOW role column and SOW-based planned margin

> **Status:** Shipped **v3.20.16**  
> **PRD version:** 3.20.16  
> **Feature ID:** **053**  
> **Release type:** Enhancement  
> **Task list:** Delivery  
> **Inbox source:** [Add SOW margin data and SOW role mappings to the PM Overview](https://win.godeap.io/app/tasks/40876280) (form 2026-08-24; requestor **jess.williams@harpin.ai**; priority **High**)  
> **Extends:** [040 - Project Performance layer](040-project-performance-layer.md), [045 - PM Overview resource time entries](045-pm-overview-resource-time-entries.md), [050 - PM Overview perf allocation drill-down](050-pm-overview-perf-allocation-drilldown.md)  
> **Related:** [049 - Agreement bid/program fields](049-agreement-bid-program-fields.md)  
> **Teamwork notebook:** [Feature 053 - PM Overview SOW role and SOW-based planned margin](https://win.godeap.io/app/projects/1615262/notebooks/313609)  
> **Release task:** [Feature 053 - PM Overview SOW role and SOW-based planned margin](https://win.godeap.io/app/tasks/40944436)  
> **Template reference:** `docs/FEATURE_TEMPLATE.md`

---

## Origin / source request

Inbox title: **Add SOW margin data and SOW role mappings to the PM Overview**

Jess (notebook comment 2026-08-31) confirmed scope and formulas below.

---

## Questions for Jess (answered 2026-08-31)

| Q | Topic | Answer |
| --- | --- | --- |
| **Q1** | **SOW role scope** | Project Performance **table and drill-down** (subtitle + allocation summary). Use **-** when no SOW role. Resource assignments role-on-project-rows is a **follow-on** (not in v3.20.16). |
| **Q2** | **Multiple SOW roles** | **Comma-separated** unique roles when allocated in the selected time frame. Drill-down allocation rows already split by duration. |
| **Q3** | **Planned margin** | Use rates **at the time the SOW was written** (Fibery **SOW Bill Rate** / **SOW Cost Rate** on Resource Allocations). |
| **Q4** | **Projected margin** | Use **updated cost card** rates (Team Member Role bill/cost on allocations). |
| **Q5** | **Partial coverage** | **100% coverage** on billable allocations or show **N/A** (also acceptable: **-**; shipped as **N/A**). |
| **Q6** | **Missing rates** | **N/A** value with **tooltip reason** (e.g. missing cost rate). Subtext **See tooltip**. |
| **Q7** | **No resource plan** | **Yes** - keep **N/A** / no plan when `hasAllocations` is false (**046**). |

---

## Locked product decisions (Jess-approved)

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Column label | **SOW role** on Project Performance desktop table and mobile cards. |
| 2 | Not on SOW | **-** when not **Allocated & Billable** (or orange / no allocation). |
| 3 | Multiple roles | Comma-separated unique **Role on SOW** for billable allocations in range. |
| 4 | Planned margin | Weighted margin from `hours × SOW Bill Rate` vs `hours × SOW Cost Rate` on every billable allocation. |
| 5 | Projected margin | Same formula with **current** Team Member Role bill/cost rates. |
| 6 | Incomplete rates | KPI **N/A**; `plannedMarginReason` / `projectedMarginReason` in tooltip. |
| 7 | Drill-down | Subtitle shows SOW role; allocation **Role on SOW** uses **-** (not N/A) when not billable. |
| 8 | Cache | Delivery P&L **`cacheSchemaVersion` 18** (`performance` adds margin reasons; resources add `sowRoleDisplay`). |
| 9 | AM mirror | `supabaseAmMirror.js` selects SOW rate fields on Resource Allocations for `raw` (next Pull refreshes Supabase). |

---

## User stories

- As a **PM**, I see **SOW role** on Project Performance so I know how each person is listed on the SOW.
- As a **PM**, **Planned margin** reflects SOW-written rates, not a generic target percent.
- As a **PM**, **Projected margin** reflects today's cost card rates on the same allocation plan.
- As a **PM**, when rates are missing, I see **N/A** with a tooltip explaining what to fix in Fibery.
- As a **mobile user**, SOW role and margin KPIs match desktop at ~390px.

---

## Acceptance criteria (testable)

- [x] **Given** Project Performance resource rows, **when** the table renders, **then** column two is **SOW role**.
- [x] **Given** a billable allocation with **Role on SOW**, **when** the row renders, **then** the cell shows that value (even without rate data).
- [x] **Given** not **Allocated & Billable**, **when** the row renders, **then** SOW role is **-**.
- [x] **Given** full SOW rate coverage, **when** Planned margin renders, **then** KPI shows computed % with SOW-rate tooltip.
- [x] **Given** incomplete SOW rates, **when** Planned margin renders, **then** **N/A** and tooltip reason.
- [x] **Given** full cost-card rate coverage, **when** Projected margin renders, **then** KPI uses current role rates.
- [x] **Given** no allocations, **when** Performance loads, **then** plan KPIs remain **N/A** per **046**.
- [x] **Given** viewport **&lt; 768px**, **when** Project Performance renders, **then** mobile cards show SOW role with the same rules.
- [x] **Given** time-entry drill-down, **when** modal opens, **then** subtitle shows SOW role and allocation table uses **-** for non-billable.

---

## UI notes

- **Desktop/mobile:** `renderDeliveryPerfResourceTable_()`, `#delivery-pnl-perf-kpis`, `openDeliveryPerfTimeModal_()`.
- **Tooltips:** `DELIVERY_KPI_TIPS_.planned` / `.projected` + `perf.plannedMarginReason` / `projectedMarginReason`.

---

## Data model

- Fibery **Resource Allocations:** `Role on SOW`, `SOW Bill Rate`, `SOW Cost Rate`; current rates via linked **Team Member Role** `Bill Rate` / `Cost Rate`.
- Server: `projectPerformanceMetrics.js` (`ppComputeAllocationLaborMargin_`, `ppAttachSowRoleDisplay_`).
- Fetch: `deliveryDashboard.js`, `supabasePanelBuilders.js`; mirror `supabaseAmMirror.js`.

---

## Verification steps

1. Live: project with SOW roles and rates → SOW role column populated; Planned margin % matches manual check.
2. Project missing SOW cost rates → Planned margin **N/A**, tooltip names missing cost rate.
3. Project with cost cards but incomplete coverage → Projected margin **N/A**.
4. Drill-down: subtitle shows SOW role; non-billable allocation shows **-** in Role on SOW column.
5. Mobile ~390px: same behavior.
6. Snapshot after schema 18 upgrade: same from `delivery-pnl/<id>.json`.

---

## Implementation checklist

- [x] Jess answers Q1-Q7 in Teamwork notebook
- [x] Server: SOW rate fetch + performance block + cache schema **18**
- [x] Client: SOW role column, margin KPIs, drill-down, mobile
- [x] PRD **FR-160**, **AC-122**, version **3.20.16**
- [ ] Ship Teamwork task + archive inbox (operator)
- [ ] `clasp push` + `check_deployed_matches_git.py`
- [ ] Optional: Resource assignments SOW role on project rows (follow-on)

---

## Change log

| Date | Change |
| --- | --- |
| 2026-08-31 | Shipped **v3.20.16** per Jess notebook answers. |
| 2026-08-31 | Draft spec from Inbox **40876280**. |

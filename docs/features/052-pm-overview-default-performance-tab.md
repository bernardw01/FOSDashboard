# Feature: PM Overview - default Project Performance tab on project select

> **Status:** Shipped **v3.20.15**  
> **PRD version:** 3.20.15  
> **Feature ID:** **052**  
> **Release type:** Enhancement  
> **Task list:** Delivery  
> **Inbox source:** [PM Overview: When a project is selected, make Project Performance the default tab](https://win.godeap.io/app/tasks/40926670)  
> **Extends:** [040 - Project Performance layer](040-project-performance-layer.md), [041 - PM Overview rebrand](041-pm-overview-rebrand.md)  
> **Depends on:** PM Overview mobile shell ([029](029-mobile-shell-phase-ab.md))  
> **Template reference:** `docs/FEATURE_TEMPLATE.md`

---

## Goal

When a user selects a project on **PM Overview**, the bottom **Project financials** card MUST open on the **Project Performance** tab by default (not Accounting P&L), so PMs land on performance KPIs and resource rows without an extra click.

**Exception:** users on team **FINANCE** still default to **Accounting P&L** (unchanged from feature **040**).

**Session persistence:** if the user already chose a tab this browser session, that choice still wins when selecting another project.

---

## Acceptance criteria

- [x] **Given** a non-FINANCE user with no session tab preference, **when** they select a project, **then** **Project Performance** is the active tab.
- [x] **Given** a FINANCE user with no session preference, **when** they select a project, **then** **Accounting P&L** is active.
- [x] **Given** the user chose **Accounting P&L** this session, **when** they select another project, **then** Accounting remains active.
- [x] **Given** mobile width (&lt; 768px), **when** a project is selected, **then** the same default tab behavior applies.

---

## Implementation

- `resolveDefaultDeliveryCardMode_()`: default `performance` except team `FINANCE` → `accounting`; sessionStorage `fos_delivery_pnl_card_mode_v1` overrides.
- `selectDeliveryProject_()`: applies resolved default before P&L load.
- Initial `deliveryState.cardMode`: `performance`.

---

## Changelog

| Version | Date | Notes |
| --- | --- | --- |
| 3.20.15 | 2026-08-31 | Shipped from inbox 40926670. |

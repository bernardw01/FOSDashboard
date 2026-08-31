# Feature: Agreement Bid / Program fields in Datastore

> **Status:** Shipped (**v3.19.0**)  
> **PRD version 3.19.0** - see `docs/FOS-Dashboard-PRD.md` (**FR-155**, **AC-117**).  
> **Feature ID:** **049** | **Release type:** Enhancement | **Task list:** Data platform  
> **Git spec:** `docs/features/049-agreement-bid-program-fields.md`  
> **Release task:** [v3.19.0 - Agreement Bid/Program fields mirrored to Datastore](https://win.godeap.io/app/tasks/40925930)

## Goal

Mirror new Fibery Agreement fields (**Bid Cost**, **Bid Margin**, **Bid Revenue**, **Initial Planned Hours**, **Program**, **Program Name**) into Supabase so Agreement and Delivery dashboards can read them from Datastore without a Fibery round-trip.

## User Stories

- As a dashboard developer, I want Bid and Program fields on `fos_agreements` so that new KPIs and filters can use typed columns.
- As an ADMIN, I want Pull / nightly hydrate to backfill these fields so Live panels stay current after Fibery edits.
- As a finance user, I want Program and bid metrics available on agreement context so Delivery and Agreement views can surface them when product UI is added.

## Acceptance Criteria (testable)

- [x] Given migration **052**, when applied, then `fos_programs` exists and `fos_agreements` has `bid_cost`, `bid_margin`, `bid_revenue`, `initial_planned_hours`, `program_id`, `program_name`.
- [x] Given AM mirror runs, when the `programs` then `agreements` steps complete, then Program entities upsert into `fos_programs` and agreement rows carry the new columns from Fibery.
- [x] Given Agreement Dashboard Live build, when agreements are normalized, then `bidCost`, `bidMargin` (percent), `bidRevenue`, `initialPlannedHours`, `programId`, `programName` are present; cache schema **5**.
- [x] Given Delivery P&L agreement context from Supabase, when an agreement is loaded, then the same fields are on the agreement object.
- [x] **Mobile:** No new primary UI in this release; existing Agreement / Delivery mobile chrome unchanged. Fields are data-model only until a later UI feature consumes them.

## UI Notes

- Routes/pages impacted: Agreement Dashboard payload shape; Delivery P&L agreement context (additive fields only).
- No new panels, filters, or columns in this ship.
- **Desktop / Mobile:** unchanged chrome.

## Data Model

- Fibery: `Agreement Management/Agreements` fields listed in PRD §6.2; `Agreement Management/Program` entity.
- Supabase:
  - `fos_programs` (`fibery_id` PK, `public_id`, `name`, timestamps, `raw`)
  - `fos_agreements` columns above; index on `program_id`
- Migration: `052_fos_agreements_bid_program_fields.sql` (applied remotely as `fos_agreements_bid_program_fields`)
- AM mirror: new `programs` entity step before `agreements`; extended agreement select/map

## Operations

- Queries: AM mirror Fibery selects; panel builders `supabaseSelectAll_` on `fos_agreements`
- Actions: ADMIN **Pull from Fibery** / nightly hydrate to backfill after deploy

## Edge Cases

- Null Program / empty bid fields: store null / omit gracefully; `program_name` prefers **Program Name** lookup, else relation **Name**
- Bid Margin stored as Fibery fraction in DB; panel scale to percent like Current/Target Margin
- Cache schema 5 invalidates client/session Agreement caches until rebuild

## Verification Steps

1) Desktop: confirm columns on `fos_agreements` / rows in `fos_programs` after Pull
2) Spot-check one agreement with Program set: Datastore `program_id` / `program_name` match Fibery
3) **Mobile (~390px):** open Agreements or Delivery; confirm no layout regression (additive payload only)
4) Agreement payload `cacheSchemaVersion === 5`

## Implementation Checklist

- [x] Update feature spec checkboxes as implemented
- [x] **Mobile UI** N/A for this data-only ship (no shell change beyond schema constant)
- [x] Migration applied on FinOps Hub
- [x] AM mirror + panel builders + Fibery live select/normalize updated
- [x] PRD 3.19.0 + FR-155 / AC-117 + overview / snapshot docs
- [ ] Run ADMIN Pull from Fibery after clasp deploy (operator)
- [ ] Commit with message: feat: mirror Agreement Bid/Program fields to Datastore

## Change Log

| Date | Version | Notes |
| --- | --- | --- |
| 2026-08-25 | 3.19.0 | Initial ship: migration 052, AM mirror, agreement cache schema 5 |

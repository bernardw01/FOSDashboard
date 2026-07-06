# Feature: Sales OS pipeline (spreadsheet + HubSpot merge)

> **PRD version 2.21.3** - **Status: Released v2.21.0** (merge); **v2.21.1** (resizable table columns); **v2.21.2** (July mockup alignment, column order); **v2.21.3** (overview UX fixes). Extends feature **016** with the sales team's **Opportunity Tracker** spreadsheet merged into **`buildPipelineDashboardPayload_()`**, five Sales OS views, HubSpot delta asterisks, and **`cacheSchemaVersion: 3`**.

## Goal

Align the FOS **Sales Pipeline** panel with the sales team's **Sales OS** workflow: spreadsheet-owned stage and ACV, HubSpot/Fibery enrichment (owner, close date, pipeline motion), five navigable views, and visible deltas when sheet and HubSpot disagree.

## User Stories

- As a **sales leader**, I want tracker rows merged with HubSpot deals so that pipeline numbers match our operating spreadsheet.
- As a **Client Engagement** user, I want **Overview**, **Ex-Princess**, **All Deals**, **Concentration**, and **Next Steps** views so that I can review pipeline the way the sales team does in their HTML dashboard.
- As an **operator**, I want unmatched Fibery-only deals hidden so that the dashboard reflects the opportunity tracker as the deal list of record.

## Acceptance Criteria (testable)

- [x] Given the Opportunity Tracker spreadsheet is configured, when **`getPipelineDashboardData()`** runs, then each output deal originates from a **sheet row** (merged or sheet-only) and Fibery-only deals without a sheet match are **excluded**.
- [x] Given a sheet row links to HubSpot via **`Hubspot Deal ID`**, when stage or ACV differs from Fibery, then the **sheet value wins** and the UI shows an **asterisk (*)** with a tooltip describing the HubSpot value.
- [x] Given multiple HubSpot pipelines, when the user is on **Overview** or **All Deals**, then **New Logo / X-Man / Partner** appear as **filter chips** (default **All sales**, excluding Existing Client motion).
- [x] Given **Ex-Princess** view, when Princess / PCL companies are present, then they are excluded from KPIs and tables in that view.
- [x] Given row 4 **One Line Read** text on the tracker tab, when live or snapshot payload loads, then the **Overview** insight card shows that text once (no duplicate top banner).
- [x] **Mobile:** Given viewport width **< 768px**, when the user opens Pipeline, then sales view and HubSpot pipeline filters use bottom sheets, KPI grids stay scannable, and charts remain behind **Show charts**.

## UI Notes

- **Route:** `pipeline` / `#panel-pipeline` (Sales nav group unchanged).
- **Views:** Overview (KPIs, stage grid, accordion, charts), Ex-Princess, All Deals (search + filters + sortable table), Concentration (account bars + vertical chart), Next Steps (focus cards + due table).
- **Table column order:** Company, **Stage**, **Next step**, **Notes** (then view-specific columns). Notes cells expand on click.
- **HubSpot filter chips:** `#pipeline-hubspot-filter` on Overview and All Deals only.
- **Desktop:** Sales view tabs inline; dark `.fos-agreement-root` chrome. Pipeline deal tables (**Ex-Princess**, **All Deals**, **Next Steps**) support **drag-to-resize** column headers; cell text wraps when columns are narrowed; widths persist in `sessionStorage` for the session.
- **Mobile:** `pipeline-mobile-sales-view-btn`, `pipeline-mobile-hubspot-btn`, `pipeline-mobile-charts-btn`; 2-column KPI grid per feature **029**.

## Data Model

| Source | Role |
| --- | --- |
| Opportunity Tracker (sheet) | Primary list; **stage**, **ACV**, **weighted ACV**, **probability**, vertical, product, contact, notes, next step |
| Fibery `HubSpot/Deal` | Join on parsed **`hubspotLink`** `/deal/{id}`; supplies owner, close date, days in stage, HubSpot pipeline, comparison fields |
| Merge key | `Hubspot Deal ID` column ↔ parsed HubSpot deal id |

Payload fields per deal include: `salesOppId`, `hubspotDealId`, `salesStage`, `hubspotStage`, `amount`, `hubspotAmount`, `weightedAmount`, `hubspotWeightedAmount`, `hubspotDelta`, `hasHubspotDelta`, `sourceRecord` (`merged` \| `sheet-only`).

**`cacheSchemaVersion: 3`** (`PIPELINE_CACHE_SCHEMA_VERSION_` / client `PIPELINE_CACHE_SCHEMA_VERSION`).

Script Properties (admin registry group **pipeline-dashboard**): `SALES_PIPELINE_SPREADSHEET_ID`, `SALES_PIPELINE_DEALS_SHEET_NAME`, `SALES_PIPELINE_STAGE_DEFS_SHEET_NAME`, `SALES_PIPELINE_HEADER_ROW`, `SALES_PIPELINE_MAX_ROWS`.

## Operations

- **Queries:** `getPipelineDashboardData()` → `buildPipelineDashboardPayload_()` → `readSalesPipelineSheetRows_()` + Fibery paginated fetch.
- **Snapshots:** `pipeline.json` via same builder (feature **009**); schema **3**.

## Edge Cases

- Sheet row with HubSpot ID but no Fibery match: included as **sheet-only**; warning in `warnings[]`.
- Missing spreadsheet or tab: `ok: false` with safe message.
- Snapshot dates before v2.21.0 may carry schema **2** (Fibery-only); client invalidates browser cache on schema bump.

## Verification Steps

1. Desktop: open Pipeline live; confirm ~44 tracker rows, matched HubSpot asterisks where stage/ACV differ, no unmatched Fibery-only deals in any view.
2. Toggle HubSpot chips on Overview; confirm KPIs and accordion respect filter.
3. Ex-Princess: confirm PCL / Princess excluded from totals.
4. Export CSV includes delta column and sheet-first stage/amount.
5. **Mobile (~390px):** sales view sheet, HubSpot sheet on Overview/Deals, charts behind toggle.
6. Run `_diag_runSnapshotForDate('YYYY-MM-DD')`; confirm `pipeline.json` `cacheSchemaVersion: 3`.

## Implementation Checklist

- [x] `src/salesPipelineSheet.js` reader
- [x] `src/pipelineDashboard.js` merge + schema 3
- [x] `#panel-pipeline` five views + HubSpot chips + delta UI
- [x] Admin registry + activity events
- [x] Feature **009** / **016** cross-refs
- [x] PRD **2.21.0** + header sweep

## Changelog

| Date | Version | Change |
| --- | --- | --- |
| 2026-06-09 | 2.21.3 | Deals-by-stage accordion collapsed by default; One Line Read shown once on Overview insight card. |
| 2026-06-09 | 2.21.2 | July mockup alignment: Next Step/Notes after Stage, stage pills, insight card, priority next-step cards, concentration ranks, doughnut vertical chart, TCV column on Ex-Princess. |
| 2026-06-09 | 2.21.0 | Initial release: spreadsheet merge, Sales OS views, delta asterisks, cache schema 3. |

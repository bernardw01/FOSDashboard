# Feature: Portfolio P&L Excel export (outline / collapse)

> **PRD version 2.22.0** - Released **v2.22.0**  
> **Feature id:** 031 | **Task list:** Finance  
> **Status:** Released (**v2.22.0**)  
> **Extends:** [Feature 022 - Portfolio Project P&L](022-portfolio-project-pnl.md), [Feature 025 - Portfolio P&L performance](025-portfolio-pnl-performance-and-load-source-ux.md)  
> **Implementation plan:** [031-portfolio-pnl-excel-export-implementation-plan.md](031-portfolio-pnl-excel-export-implementation-plan.md)  
> **Teamwork:** Ship as `v2.22.0 - Portfolio P&L Excel export` when publishing the release task.

## Goal

Let finance and executive users **download the Portfolio P&L grid as a formatted Excel (`.xlsx`) workbook** that preserves the same hierarchical drill-down as the Web App: expand and collapse **Customer → Project → Revenue/Costs detail** using Excel’s built-in row outlining (group `/` `−` controls), without rebuilding the grid manually in a spreadsheet.

## User Stories

- As a **finance reviewer**, I want to **Export Excel** from Portfolio P&L so I can share or annotate the portfolio grid offline in Excel / Google Sheets.
- As an **executive**, I want the workbook to **collapse and expand by customer and project** the same way the dashboard does, so I can start from a summary view and drill into detail without scrolling a flat CSV.
- As a **finance reviewer**, I want the export to **respect my current filters and toggles** (Subscription / Services, Group by quarter, Include projected months) so the file matches what I see on screen for columns and scope.
- As a **finance reviewer**, I want **costs in parentheses** and **negative margins in red** in Excel, consistent with the in-app styling (**v2.21.4**).
- As a **mobile user**, I want Export Excel available from the Portfolio P&L toolbar (or an equivalent mobile control) so I can download without needing desktop-only UI.

## Acceptance Criteria (testable)

### Access and placement

- [x] Given a user who can open **Portfolio P&L** (Finance team / EXEC / ADMIN), when the panel has finished loading (or partial load with available projects), then an **Export Excel** control is visible in the Portfolio P&L toolbar next to Refresh.
- [x] Given a user **without** Portfolio P&L access, then they cannot invoke the export API (server returns the same gate as other portfolio endpoints).
- [x] Given **snapshot** or **Drive cache** data mode, when Export Excel runs, then the workbook is built from the **already loaded** client panel data (no Fibery refetch solely for export).

### Hierarchy and Excel outlining

- [x] Given a successful export, when the `.xlsx` is opened in **Microsoft Excel** desktop, then **row groups / outline levels** allow collapsing and expanding Customer → Project → Revenue/Costs → leaf metrics.
- [x] Given the default dashboard behavior, when the workbook opens, then outline starts collapsed to approximately **customer-level** summary (projects/detail behind groups).
- [x] Given **Portfolio Revenue** as the top total row, when outlined, then customers nest beneath portfolio as detail.

### Content fidelity

- [x] Given the current **Subscription / Services** type filters, when exporting, then only projects in the active filtered set appear.
- [x] Given **Group by quarter** is on, when exporting, then columns are **Q1–Q4 + FY** only; when off, interleaved months + quarters + FY.
- [x] Given **Include projected months** is off/on, when exporting, then projected months match the grid; projected month headers can be tinted when included.
- [x] Given cost rows, when exported, then values use parenthesized/red expense formatting; negative margins use red font.
- [x] Given empty amounts, when exported, then cells are blank rather than `$0`.
- [x] Given a **partial** portfolio load, when exporting, then **Export notes** lists failed project names.

### File format and UX

- [x] Successful download uses **`Portfolio-PnL-YYYY-yyyyMMdd-HHmm.xlsx`**.
- [x] Busy / disabled state while building; user-safe errors on failure.
- [x] Row-count soft cap with clear message when too large.

### Mobile

- [x] **Mobile:** Export Excel remains in the Portfolio toolbar (min-height 44px); same download path as desktop.

### Observability

- [x] Activity event **`portfolio_pnl_export_excel`** whitelisted and logged.

## UI Notes

- **Route / panel:** `portfolio-pnl` / `#panel-portfolio-pnl` only (no new nav route).
- **Desktop:** Add **Export Excel** button in the existing Portfolio toolbar (near Refresh). Optional secondary **Copy CSV** remains out of scope unless product asks to revive Feature **022** Phase B CSV in the same release.
- **Mobile (`DashboardShell.html`, &lt; 768px):** Keep Export in the collapsing toolbar row; ensure filters + export remain usable without sidebar-only chrome (feature **029** patterns). Download still uses the same blob / anchor pattern as desktop Web App downloads.
- **Not in scope for v1 of this feature:** editable live formulas linked to Fibery; PivotTables; multiple calendar years in one file; emailing the workbook from the server.

## Data Model

No new Fibery entities. Export is a **read-only materialization** of the already-computed portfolio rollup:

| Input | Source |
| --- | --- |
| Project index + filters | Client `portfolioPnlState` / server bundle from Feature **025** |
| Per-project monthly metrics | Same metrics used by `renderPortfolioPnlGrid_` (revenue splits, labor employee/contractor, ODC, margins) |
| Column set | `portfolioPnlPeriodColumns_` / display columns after Group by quarter |
| Projected flag | Per-month `projected` + Include projected toggle |

**Suggested server response shape (conceptual):**

```javascript
{
  ok: true,
  fileName: 'Portfolio-PnL-2026-....xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // Prefer one of:
  contentBase64: '...',      // client triggers download
  // or driveFileId + temporary download URL if product chooses Drive delivery
  meta: {
    calendarYear: 2026,
    projectCount: 24,
    includeProjected: true,
    collapseMonthsByQuarter: false,
    includeSubscription: true,
    includeServices: true,
    generatedAt: 'ISO-8601'
  }
}
```

**Migration:** none. No `cacheSchemaVersion` bump for portfolio bundle payloads.

## Operations

- **Queries / builds:** New server helper (proposed) `buildPortfolioPnlExcelExport_(options)` assembling the full outline tree and writing a temporary Spreadsheet (or OOXML blob), then returning bytes for download. Prefer reusing existing aggregation helpers from Feature **022** / **025** rather than re-querying Fibery when the client already has `pnlById`.
- **Actions:** Client `portfolioPnlExportExcel_()` gathers current filter/toggle state + loaded `pnlById` snapshot (or asks server to rebuild from Drive cache / slim builder with same options), calls `google.script.run`, downloads file.
- **Auth:** Same as `getPortfolioPnLDashboardData` / Expenses Finance gate.

## Edge Cases

| Case | Behavior |
| --- | --- |
| Empty filter (no types selected) | Disable export or toast: select at least one agreement type |
| Zero projects after filter | Disable export or empty workbook with message sheet |
| Snapshot missing `portfolio-pnl.json` | Use same unavailable path as panel; no export of empty live scrape |
| Very large portfolio | May hit Apps Script time/memory; plan documents batch / “server rebuild from Drive daily cache” and soft fail message |
| Excel for Mac / Sheets outline quirks | Primary acceptance: Microsoft Excel desktop; Google Sheets secondary (outline may present differently) |
| Special characters in project names | Escape for sheet XML / SpreadsheetApp; truncate sheet name if multi-sheet later |

## Verification Steps

1. **Desktop:** Load Portfolio P&L (live or Drive cache). Leave Group by quarter off, projected on or off. Click **Export Excel**. Open file in Excel. Confirm outline `−` / `+` on Customer and Project rows; expand to Revenue → Subscription/Services and Costs → Employee/Contractor/ODC. Confirm FY and month totals match the on-screen grid for a sample customer (e.g. Marriott).
2. Toggle **Group by quarter**, export again; confirm only quarter + FY columns.
3. Toggle type filter to Subscription-only; export; confirm Services-only projects absent.
4. Confirm cost cells are parenthesized and red; negative margin red; headers sticky/freeze optional per plan.
5. Force a partial failure in test (or use existing failed project note) and confirm notes surface in the file.
6. **Mobile (~390px):** Open Portfolio P&L; confirm Export Excel is tappable; download completes (or documents platform limitation if WebView blocks downloads - call out in ship notes).
7. Confirm activity log row `portfolio_pnl_export_excel` appears for an ADMIN viewing User Activity.

## Implementation Checklist

- [x] Spec approved (decisions locked 2026-07-08)
- [x] Server Excel builder + auth-gated RPC (`portfolioPnlExcelExport.js`)
- [x] Client Export Excel button + download + loading UX + mobile accommodation
- [x] Activity event whitelist
- [x] Feature **022** / PRD **FR-125** / **AC-84**
- [ ] Smoke on deployed Web App (`clasp push`)
- [ ] Teamwork ship ritual + notebook sync

## Decisions (locked 2026-07-08)

| Topic | Decision |
| --- | --- |
| Export tree | **Always full hierarchy** with Excel outline groups (not limited to currently expanded UI rows) |
| Primary acceptance | **Microsoft Excel desktop** `.xlsx` (Google Sheets outline is secondary / best-effort) |
| Data freshness | Built from **already loaded panel data** only (no Fibery refetch on export) |
| Export availability | **Export Excel disabled** until Portfolio P&L panel data has finished loading (successful or partial) |
| Default outline state in Excel | Collapse so **customers show; projects/detail collapsed** (mirror Feature **022** default) |
| Filter fidelity | Export reflects **current** Subscription/Services, Group by quarter, Include projected |
| Generation tech | **SpreadsheetApp** temp workbook + row grouping + export as `.xlsx` blob to client |
| Delivery | **Browser download** of base64 (no permanent Drive file) |
| CSV | Out of scope for 031 |
| Number blanks | Prefer Excel blank for zero |
| Filename | `Portfolio-PnL-{year}-{yyyyMMdd-HHmm}.xlsx` |

## Change requests

*(Post-approval edits go here, then merge into body at ship.)*

## Changelog

| Date | Version | Change |
| --- | --- | --- |
| 2026-07-08 | 2.22.0 | Implemented Export Excel from loaded panel data; full hierarchy with outline groups; button disabled until load completes. |
| 2026-07-08 | Draft | Initial feature request: formatted Excel export with collapse/expand groups matching Portfolio P&L hierarchy. |

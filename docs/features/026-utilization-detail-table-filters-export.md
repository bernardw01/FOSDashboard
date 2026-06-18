# Feature: Utilization detail table filters and CSV export

> **PRD version 2.17.1** - **Shipped v2.17.0+** (feature **026**). **v2.17.1:** filtered Hours + Cost footer totals.

> **Implementation plan:** [`026-utilization-detail-table-filters-export-implementation-plan.md`](026-utilization-detail-table-filters-export-implementation-plan.md)

## Status

| Phase | Scope | Target | Status |
| --- | --- | --- | --- |
| **Phase A - Table toolbar filters** | Detail entries card: Company · Person · Role multi-select; table-only filter pipeline; count + empty state | v2.17.0 | **Shipped** |
| **Phase B - CSV export** | Copy CSV for all table-matching rows (not current page only); visible columns only; status flash; activity log | v2.17.0 | **Shipped** |
| **Phase C - Persistence** | `localStorage` for table filter state; Clear table filters; prune on global filter change | v2.17.0 | **Shipped** |

## Goal

Give operators **secondary, table-scoped** filters on the Utilization **Detail entries** grid so they can narrow row-level labor entries by **Company**, **Person**, and **Role** within the current top-level (global) filter set, without changing KPIs, charts, alerts, or the heatmap. Add **Copy CSV** for the same row set the table shows, using **only the columns visible in the detail table**.

## Filter hierarchy (reviewer decision)

Table filters are a **subset** of the top-level page filters:

1. **Top-level (global) filters** (`utilState.filters`) define the dashboard view: date range, Customer, Project, Person, Role, Billable, Internal labor. They drive KPIs, charts, alerts, and heatmap.
2. **Detail table filters** (`utilState.detailFilters`) apply **only on top of** the globally filtered rows. They never widen the view beyond what the global filters already allow.
3. Dropdown options for Company / Person / Role on the table are built **exclusively** from distinct values in the **globally filtered** row set.
4. When global filters change, any table filter selection that no longer appears in the new global subset is **auto-removed** (`pruneUtilDetailTableFilters_`).
5. **Global Clear filters** also clears detail table filters (table filters cannot outlive their parent scope).

Charts and KPIs continue to reflect **global** filters only; the detail table reflects **global ∩ table**.

## User stories

- As an **engineering manager**, I want to filter the detail table to one **person** and **role** within my current customer drill-down so I can audit rows without changing chart context.
- As a **finance reviewer**, I want to filter detail rows by **Clockify User Company** (employer) within the active date range and global filters to reconcile partner spend.
- As an **analyst**, I want to **export** the table-filtered rows to CSV using the **same columns I see in the grid**.
- As an **operator**, I want table filter choices to **stay valid** when I change global filters (invalid picks drop automatically).

## Scope boundaries

| In scope | Out of scope |
| --- | --- |
| Table toolbar on `#panel-operations` Detail entries section | New global filter bar dimensions |
| Client-only filters over globally filtered `payload.rows` | Server / Fibery query changes |
| CSV of table-filtered rows (visible columns only) | Extra CSV columns not shown in the table |
| Activity events for table filter + export | Adding a Company column to the detail table |
| Reuse existing multi-select dropdown pattern | Replacing global Person / Role filters |

## Terminology

| UI label | Fibery source | Normalized row field | Notes |
| --- | --- | --- | --- |
| **Company** | `Agreement Management/Clockify User Company` → `enum/name` | `clockifyUserCompany` | Clockify employer (e.g. Harpin, Coherent). **Not** Customer (`Agreement → Customer → Name`). Same field as Labor Hours **Company** (feature **007**). |
| **Person** | `Time Entry User Name` / `User ID` | `userName` / `userId` | Table filter key: `personKeyForRow_(row)` (same as global person filter). |
| **Role** | `User Role → Name` / `Clockify User Role` | `userRole` / `clockifyUserRole` | Table filter key: `roleKeyForRow_(row)` (same as global role filter). |

## Visible detail table columns (CSV must match)

| Column | Sort key | Export header |
| --- | --- | --- |
| Date | `day` | `Date` |
| Person | `userName` | `Person` |
| Customer | `customer` | `Customer` |
| Project | `projectName` | `Project` |
| Role | `role` | `Role` |
| Hours | `hours` | `Hours` |
| Cost | `cost` | `Cost` |
| Bill rate | `userRoleBillRate` | `Bill rate` |

No Company column in the grid for v1; Company is filter-only.

## Filtered totals (v2.17.1)

A sticky **Total (filtered)** row in `<tfoot>` sums **Hours** and **Cost** for every row matching global + table filters (full result set, not the current page). Hidden when zero rows match. Updates on any filter or data refresh.

## Acceptance criteria (testable)

- [x] **Given** the Utilization panel is loaded with labor rows, **when** the user opens the Detail entries card, **then** a toolbar shows **Company**, **Person**, and **Role** multi-select dropdowns (same `multi-trigger` / checkbox menu pattern as the global filter bar) plus **Clear table filters** and **Copy CSV**.
- [x] **Given** global filters are active (e.g. one Customer), **when** the user selects a Person in the **table** filter only, **then** KPIs and charts still reflect the **global** filter set, but the detail table shows only rows matching **global ∩ table** filters.
- [x] **Given** table filter dropdowns, **when** they render, **then** every option corresponds to at least one row in the **globally filtered** set (table filters are a subset of the top-level filter scope).
- [x] **Given** the user changes a global filter so a table filter value no longer exists in the global subset, **when** `renderUtilDashboard()` runs, **then** that table filter value is removed automatically and menus re-render.
- [x] **Given** the user clicks global **Clear filters**, **when** filters reset, **then** detail table filters are cleared as well.
- [x] **Given** table filters for Company / Person / Role, **when** any table filter changes, **then** pagination resets to page 1, sort order is preserved, and `#util-detail-count` reflects the table-filtered total.
- [x] **Given** no rows match global ∩ table filters, **when** the table renders, **then** the existing empty message appears ("No rows match the current filters.") and Copy CSV is disabled or copies headers only with a user-visible status message.
- [x] **Given** table filters match N rows (N may exceed page size), **when** the user clicks **Copy CSV**, **then** all **N** rows are serialized (not only the current page) with columns **Date, Person, Customer, Project, Role, Hours, Cost, Bill rate** only; clipboard write uses `writeTextToClipboard_` with textarea fallback; success flashes for ~3s.
- [x] **Given** table filter state changes, **when** the mutation completes, **then** `logActivity_` emits `util_detail_table_filter` with `Route = operations` and a short label (e.g. `company=2 · person=1 · role=0`).
- [x] **Given** CSV copy succeeds, **when** the action completes, **then** `logActivity_` emits `util_detail_export_csv` with `Route = operations` and `rows=<n>`.
- [x] **Given** the user reloads the Web App, **when** they return to Utilization, **then** table filter selections restore from `localStorage` key `fos_utilization_detail_filters_v1` (`schemaVersion: 1`) after prune against the current global subset; schema mismatch clears stored state.
- [x] **Given** historical snapshot mode (FR-105), **when** Utilization is read-only from snapshot, **then** table filters and CSV still work client-side on snapshot payload rows (no Fibery calls).
- [x] **Given** filtered detail rows exist, **when** the table renders, **then** a **Total (filtered)** footer shows the sum of **Hours** and **Cost** for all matching rows (not only the visible page) and updates when filters change.

## UI notes

### Placement

Extend the Detail entries section header (`#util-detail-heading` row) in `src/DashboardShell.html`:

```
Detail entries · {count} rows          [Company ▾] [Person ▾] [Role ▾] [Clear table filters] [Copy CSV] [status]
```

- Filters align right on wide viewports; wrap on narrow (same flex pattern as Labor Hours toolbar).
- **Clear table filters** only clears `utilState.detailFilters` (not global `utilState.filters`).
- **Global Clear filters** clears both global and table filters (subset contract).

### Filter behavior

1. `globalRows = applyFilters(payload.rows)` (top-level filters).
2. `pruneUtilDetailTableFilters_(globalRows)` drop table selections not in `globalRows`.
3. `detailRows = applyUtilDetailTableFilters_(globalRows)` with AND across dimensions, OR within each multi-select.
4. `renderUtilDetailTable(detailRows)`.

Company filter values: `row.clockifyUserCompany` from Fibery `Agreement Management/Clockify User Company`, with blank → `(No company)`.

Person dropdown: **case-insensitive alphabetical** sort (match FR-87). Company and Role: **alpha** for scanability within the global subset.

### CSV

- Button id: `util-detail-export-csv-btn`
- Status span: `util-detail-csv-status`
- Header row: `Date,Person,Customer,Project,Role,Hours,Cost,Bill rate`
- Cell formatting matches table display (`formatHours`, `formatMoneyCompact`, `formatRate`, ` - ` for null bill rate).

## Data model

No server payload change. `clockifyUserCompany` is already read from `Agreement Management/Clockify User Company` and normalized in `fiberyUtilizationDashboard.js`.

### Client state

```javascript
utilState.detailFilters = {
  companies: {},  // clockifyUserCompany key -> true
  persons: {},    // personKey -> true
  roles: {},      // roleKey -> true
};
```

Persisted shape (`localStorage` `fos_utilization_detail_filters_v1`):

```json
{
  "schemaVersion": 1,
  "companies": ["Harpin"],
  "persons": ["user@example.com"],
  "roles": ["Solutions Architect"]
}
```

On load, prune persisted table filters against the current global row subset before applying.

## Operations

- **Queries:** none (client-side only).
- **Actions:** extend `renderUtilDashboard()` pipeline; wire dropdown menus once in util panel wire-once block.
- **Activity whitelist:** add `util_detail_table_filter` and `util_detail_export_csv` to `userActivityLog.js` (and feature **004** on ship).

## Edge cases

- Blank `clockifyUserCompany` → bucket `(No company)` in filter menu only (not a table column).
- Table filters with zero selections in a dimension = no constraint on that dimension within the global subset.
- Row click → drawer: unchanged.
- Snapshot + live: export uses in-memory rows only.
- Clipboard denied: show "Copy failed" in status span (red).

## Verification steps

1. Open Web App → **Operations** → Utilization; confirm Detail entries toolbar shows three dropdowns + Copy CSV.
2. Set global Customer filter; confirm table Company/Person/Role menus only list values from that customer’s rows.
3. Select table Company filter; confirm table narrows; charts unchanged.
4. Change global Customer to exclude a table-filtered company; confirm that company drops from table filter state.
5. Global **Clear filters**; confirm table filters clear too.
6. Paginate to page 2; export CSV; confirm row count equals `#util-detail-count` and columns match the eight visible headers.
7. Reload browser; confirm table filters restore and prune correctly.
8. Inspect **User Activity** for `util_detail_table_filter` and `util_detail_export_csv`.

## Implementation checklist

- [x] Feature spec approved in Teamwork
- [x] Sync notebook → this file
- [x] Implement per implementation plan
- [x] Update feature **005** status row when shipped
- [x] PRD: new **FR-121** / **AC-80** on ship
- [x] `userActivityLog.js` event types
- [ ] Manual smoke on live + snapshot

## Changelog (feature doc)

| Date | Change |
| --- | --- |
| 2026-06-09 | **v2.17.1** - Sticky **Total (filtered)** footer sums Hours + Cost for all filtered rows. |
| 2026-06-09 | **Shipped v2.17.0** - Detail entries table filters + CSV per implementation plan. |
| 2026-06-09 | Reviewer feedback: Company = Fibery `Agreement Management/Clockify User Company`; CSV = visible columns only; table filters are a subset of top-level global filters (prune on global change; global Clear clears table). |
| 2026-06-09 | Initial spec: table-local Company / Person / Role filters + CSV export for Utilization detail entries. |

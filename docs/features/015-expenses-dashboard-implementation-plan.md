# Implementation plan - Expenses dashboard (spreadsheet-backed)

> Companion to [015-expenses-dashboard.md](015-expenses-dashboard.md). **Status: shipped** - web app **v2.5.0** / PRD **2.5.0** (**FR-109**, **AC-65**). **Snapshot `expenses.json`:** shipped **v2.8.0** (feature **009** / **010**).

## Summary

| Item | Choice |
| --- | --- |
| **Release** | **MINOR** (`X.Y.0`) recommended - new top-level surface + server endpoint + FR/AC lift. Use **PATCH** only if product treats this as a narrow additive slice after a pending MINOR. |
| **PRD gate** | Add **FR-* / AC-*** rows to `docs/FOS-Dashboard-PRD.md`; bump **`FOS_PRD_VERSION`** + every `src/*` header + touched `docs/features/*` per `.cursor/rules/google-apps-script-core.mdc`. |
| **Auth** | Same as rest of app: **`requireAuthForApi_()`** on server; no **`fibery_access`** gate unless product changes spec. |
| **Data** | `SpreadsheetApp.openById(AUTH_SPREADSHEET_ID)` · tab from **`AUTH_EXPENSES_SHEET_NAME`** (default `expenses`) · **17** columns A - Q per feature spec. |
| **Server** | New module e.g. **`src/expensesDashboard.js`** - `getExpensesDashboardData()` returns normalized `{ rows, fetchedAt, partial?, warnings?, meta?, cacheSchemaVersion }`. |
| **Client** | **`src/DashboardShell.html`** - `#panel-expenses`, filters, KPIs, **Chart.js** stacked bars (department + category), detail table, **`.fos-util-drawer`** drill-down, optional **`sessionStorage`** cache. |
| **Nav** | **`src/Code.js`** - `buildNavigationModel_()` adds top-level **`{ id: 'expenses', label: 'Expenses' }`** (icon in `NAV_ICONS`). |

## Phased delivery

### Phase 1 - Server read + normalize (0.5 - 1 d)

| Step | Task | Notes |
| --- | --- | --- |
| 1.1 | Create **`src/expensesDashboard.js`** with JSDoc + public **`getExpensesDashboardData()`**. | Mirror header/comment style from `fiberyAgreementDashboard.js`. |
| 1.2 | Read Script Properties: **`AUTH_SPREADSHEET_ID`** (existing), **`AUTH_EXPENSES_SHEET_NAME`** (default `expenses`), **`AUTH_EXPENSES_MAX_ROWS`** (default 20000), column override keys from spec. | Reuse **tolerant header** pattern from `authUsersSheet.js` (`findHeaderIndex_` or copy helper into module). |
| 1.3 | Parse rows: dates (`Date` / string), amount (currency strip, parentheses), **effective date** cascade **Purchase → Posted → Submission**, skip **undated** or warn per spec. | Emit **`warnings[]`** for skipped/bad rows counts; **`partial: true`** when row cap hit. |
| 1.4 | Drop **zero / immaterial** amounts: **`Math.abs(amount) ≤ 0.005`**. | No per-row warning; optional **`meta.skippedZeroAmountCount`**. |
| 1.5 | Emit **`cacheSchemaVersion: 1`** on payload. | Client cache key **`fos_expenses_dashboard_v1`**. |
| 1.6 | Register file in **`src/appsscript.json`** if clasp manifest lists `.gs/.js` files explicitly. | Many projects auto-include **`src/**/*.js`** - verify project convention. |

### Phase 2 - Navigation + shell panel skeleton (0.5 d)

| Step | Task | Notes |
| --- | --- | --- |
| 2.1 | **`buildNavigationModel_()`** - insert **`expenses`** top-level item (after Home or before Agreement - match product; keep groups unchanged). | Update **`getDashboardNavigation`** JSDoc union if needed. |
| 2.2 | **`DashboardShell.html`** - **`#panel-expenses.fos-agreement-root`**, title **Expenses**, **`dataSourceState` / `showExpenses`** guard: **hide or show empty state when Data source ≠ Live** (per spec Phase A = live only - mirror pattern used for disabled Refresh in snapshot mode). | Prefer **inline notice** + disabled Refresh over silent wrong data. |
| 2.3 | Wire **`onNavClick`**, **`setActiveNav`**, **`els.panelExpenses`**, top bar title, **`NAV_ICONS['expenses']`** (e.g. `bi-receipt-cutoff` or `bi-wallet2`). | Copy **`showRevenueReview` / `showLaborHours`** visibility pattern. |
| 2.4 | **Lazy fetch** on first open: `google.script.run.getExpensesDashboardData()`, loading overlay on **`.fos-agreement-inner`**. | Reuse existing overlay toggles. |

### Phase 3 - View-model + filters + KPIs (1 d)

| Step | Task | Notes |
| --- | --- | --- |
| 3.1 | Client **`expensesViewModel_`** (or inline `renderExpenses_(payload)`) holding **`rows`**, filter state, **`sort`** for table. | Persist optional filters in **`localStorage`** key e.g. **`fos_expenses_filters_v1`** - product choice. |
| 3.2 | **Global filters** (client-side slice of `rows`): date range, department multi, customer mode, search tokens (vendor, memo, transaction id, employee). | Document default range (e.g. last 12 months) in PR. |
| 3.3 | **KPI strip**: total, attributed %, unattributed %, distinct departments. | **`formatMoneyCompact`**, **`formatPct`**. |

### Phase 4 - Aggregations + two stacked bar charts (1 - 1.5 d)

| Step | Task | Notes |
| --- | --- | --- |
| 4.1 | Build **`byMonthDept`** and **`byMonthCategory`** from filtered rows; month key = **`effectiveDate`** **`yyyy-mm`**. | |
| 4.2 | **Top N + Other** for both department and category (**`EXPENSES_CHART_CATEGORY_TOP_N`**, **`EXPENSES_CHART_DEPT_TOP_N`** optional props). | **`Uncategorized`** for blank category. |
| 4.3 | For **category Other**, retain **mapping raw category string → month → membership** so drawer filter matches segment total. | Same idea for department **Other** if used. |
| 4.4 | **`loadChartJs()`** once; two **`Chart`** instances (`type: 'bar'`, stacked). | Destroy/recreate on **re-render** after filter change to avoid leaks. |
| 4.5 | **`onClick`**: resolve **month + stack segment** (`getElementsAtEventForMode` **nearest** / **intersect** per Chart.js v4). | Dept chart → drawer context `{ type: 'dept', month, department }`; category → `{ type: 'category', month, categoryBucket }`. |
| 4.6 | Tooltips: month total, segment amount, % of month. | |

### Phase 5 - Customer section + detail table + drawer (1 - 1.5 d)

| Step | Task | Notes |
| --- | --- | --- |
| 5.1 | **Customer attribution** bars/table from **`byCustomer`** (+ Unattributed); click → drawer. | |
| 5.2 | **Sortable table** (`fos-util-detail-table`), keyboard + row **click** → drawer single row. | Reuse **Revenue review** sort helpers if easy. |
| 5.3 | Reuse **`.fos-util-drawer`** (Utilization): **open/close**, backdrop, **Esc**, title from context, body table or definition list, **Copy CSV** optional. | One shared drawer or panel-scoped **`#expenses-drawer`** - avoid ID clashes. |
| 5.4 | **`expenses_drawer_open`** via **`logActivity_`** / **`google.script.run.logUserActivity`** with **non-PII label** (route + context type + month key + bucket id). | Whitelist in **`userActivityLog.js`**. Also **`expenses_refresh`**, **`expenses_filter_change`**, **`expenses_export_csv`**, **`expenses_sort`** if table sort logs. |

### Phase 6 - Polish + docs release (0.5 - 1 d)

| Step | Task | Notes |
| --- | --- | --- |
| 6.1 | **Copy CSV** for main table / drawer (clipboard + fallback). | Emit **`expenses_export_csv`**. |
| 6.2 | **Optional TTL** + **Stale** badge - only if product wants parity with Agreement; otherwise manual Refresh only v1. | |
| 6.3 | **`adminSettingsRegistry.js`** - document new Script Properties + tooltips. | |
| 6.4 | **`docs/FOS-Dashboard-PRD.md`** - FR + AC + changelog; **`docs/features/000-overview.md`** - shipped line. | |
| 6.5 | **Historical snapshot** (**FR-105**): either **document “not in bundle v1”** or add **`expenses.json`** to snapshot job in a **follow-up PR** (out of scope Phase A). | |

## File touch list (expected)

| File | Action |
| --- | --- |
| `src/expensesDashboard.js` | **Add** - sheet read, normalize, caps, warnings. |
| `src/appsscript.json` | **Update** only if manifest requires enumerating each script file. |
| `src/Code.js` | Navigation model + any thin re-export (if project convention requires). |
| `src/DashboardShell.html` | Panel HTML, CSS scoping under `#panel-expenses`, JS render + charts + drawer. |
| `src/userActivityLog.js` | Whitelist **`expenses_*`** event types + validation branches. |
| `src/adminSettingsRegistry.js` | New property keys/tooltips for expenses. |
| `docs/FOS-Dashboard-PRD.md` | FR/AC + §13 row + version bump. |
| `docs/features/000-overview.md` | Shipped feature blurb. |
| `docs/features/015-expenses-dashboard.md` | Flip **Draft** → **Released** table + version line when shipped. |

## Risk / dependency notes

| Risk | Mitigation |
| --- | --- |
| **Large sheet** row reads | Cap + **`partial`**; consider **batched getRange** only if profile shows timeout (unlikely &lt;20k rows). |
| **Other bucket** mismatch | Unit-test or manual script: segment sum === sum of filtered drawer rows. |
| **Snapshot mode** | Disable fetch; clear message - do not call **`getExpensesDashboardData`** from snapshot bundle until artifact exists. |
| **PII in activity labels** | Log **hashes or counts** only - not full memo/vendor in **`label`**. |

## Test plan

| # | Steps | Expected |
| --- | --- | --- |
| T1 | Authorized user → **Expenses** (Live data) | Panel loads; KPIs + charts + table populated or empty state. |
| T2 | Snapshot / non-Live data selected | No live fetch; user sees spec’d notice; no script errors. |
| T3 | Missing **`expenses`** tab | Friendly error; optional pointer to **`AUTH_EXPENSES_SHEET_NAME`**. |
| T4 | Filter department + date | Charts/table/drawer all respect filter; totals consistent. |
| T5 | Department chart segment click | Drawer rows match **month + department** (`COUNTIFS`-style sanity). |
| T6 | Category chart segment (**Software**, **Uncategorized**, **Other**) | Drawer rows match bucket; **Other** totals match chart segment. |
| T7 | Customer row click (attributed / unattributed) | Drawer filtered correctly. |
| T8 | Main table row + keyboard | Drawer shows line detail. |
| T9 | Rows with amount **0** / **0.001** | Excluded everywhere. |
| T10 | **Copy CSV** (if shipped) | Clipboard receives expected columns. |
| T11 | **Activity** sheet | **`expenses_*`** rows accepted server-side for ADMIN review. |

## Definition of done

- Feature spec **[015](015-expenses-dashboard.md)** acceptance checklist satisfied.
- Main PRD + **semver** synced; App Versions registry row on next deploy (**`FOS_RELEASE_DESCRIPTION`** in `Code.js`).
- No new secrets; spreadsheet id remains **`AUTH_SPREADSHEET_ID`** only.

## Changelog (this plan)

| Date | Change |
| --- | --- |
| 2026-05-27 | Initial implementation plan from feature spec (**nav**, **`expensesDashboard.js`**, **DashboardShell** charts + drawer, activity, snapshot, tests). |

# Feature: Expenses dashboard (spreadsheet-backed)

> **PRD version 2.6.1** — shipped in web app **v2.5.0+** with **FR-109** / **AC-65**; nav under **Finance** group (**v2.5.1**); **Finance team / ADMIN only** (**v2.5.3**, broadened to **FINANCE team / EXEC / ADMIN** in **v2.6.1**); chart layout + risk map (**v2.5.5**–**v2.5.6**); customer table under Sankey (**v2.5.7**).

> **Implementation plan:** [`docs/features/015-expenses-dashboard-implementation-plan.md`](015-expenses-dashboard-implementation-plan.md) — **Status:** implemented (PRD **2.5.0**).

## Data source review

**Intent:** The dashboard reads **card / expense report lines** (YTD spend export style) from the **same** spreadsheet as authorization (`AUTH_SPREADSHEET_ID`), tab name **`expenses`** (configurable via Script Property, see below).

### Deployed schema (authoritative)

The **`expenses`** tab in **`AUTH_SPREADSHEET_ID`** has **17** columns (**A–Q**). Exactly **one** column is named **`Vendor`** (payee). **`Transaction ID`** is the last column (`Q`).

### Reference sample workbook (validation only)

A **Year-to-Date Spend** `.xlsx` was used early in spec work (single sheet `sheet`, **1708** data rows in that file). **Do not** assume that file’s column count matches production: an extra trailing **`Vendor`** column existed in the export and has been **dropped** in the live sheet. All implementation and pivots MUST use § **Sheet columns (as deployed)** below.

**Data-quality signals from that sample** (approximate — re-validate on current data):

| Signal | Approx. count |
| --- | ---: |
| Rows with **`GL Customer Name`** present | **288** (**~17%**) → customer-attributed |
| Rows missing **`Purchase date`** | **576** (**~34%**) → need **effective date fallback** |
| Rows missing **`Posted Date`** | Many (posted often null on pending lines) |

**Approval state** (sample distribution): includes `Actioned`, `Approved`, `Missing Requirements`, `Requested`, `(None)` — optional **filter-by-approval** for a later phase; v1 may show **`Approval state`** in the drawer only.

**Department** diversity (sample top): `Finance`, `Technology Delivery`, `Revenue Operations`, `Client Engagement`, `Solutions Engineering`, `Delivery Management`, `Product Management`, `Chief Operations Officer`, `Operations`, `Sales`.

**Attributed customers** (sample top): e.g. `Princess Cruise Lines, Ltd.`, `Internal harpin`, `Travel + Leisure Operations, Inc.`, `Marriott International, Inc.` (full list emerges from sheet).

### R0 — confirm on live Sheets tab

1. Open **`AUTH_SPREADSHEET_ID`** → tab **`expenses`** (or configured name).
2. Confirm **17** headers **A–Q** match § **Sheet columns (as deployed)** (one **`Vendor`** column).
3. Map each header to **canonical fields** via tolerant matching + overrides (same pattern as `AUTH_USERS_SHEET_NAME` / column overrides in `src/authUsersSheet.js`).

**Minimum columns (product contract) — map from this export:**

| Canonical field | Source column | Notes |
| --- | --- | --- |
| `effectiveDate` | See cascade below | Month rollups use **`Purchase date` → `Posted Date` → `Submission Date`**. |
| `amount` | `Amount by category` | Single currency per row; use `Amount (by category) - Currency` for display. **Positive = spend.** |
| `department` | `Department Name` | Primary stack / filter dimension. |
| `customer` | `GL Customer Name` | **Blank = unattributed** overhead. |

**Strongly recommended (present in export; use in drawer + table):**

| Canonical field | Source column |
| --- | --- |
| `vendor` | `Vendor` |
| `category` | `Category` |
| `memo` | `Memo` |
| `transactionId` | `Transaction ID` |

**nice-to-have (present in export):**

| Canonical field | Source column (sample export) |
| --- | --- |
| `employeeId` | `Employee - ID` |
| `employeeName` | `Full name` (or `Employee`) |
| `activityType` | `Activity type` |
| `submissionDate` | `Submission Date` |
| `postedDate` | `Posted Date` |
| `approvalState` | `Approval state` |
| `currencyCode` | `Amount (by category) - Currency` |
| `attendees` | `Attendees` |

**Effective date for month rollup (recommended):**

`expenseEffectiveDate = Purchase date ?? Posted Date ?? Submission Date`

- Prefer **`Purchase date`** for charts when present (reflects behavior on the ground).
- When null, cascade so **missing purchase date (~34% in sample)** still lands in a month bucket — otherwise charts under-count badly.
- Optional `payload.warnings` entry when **>0 rows** relied on fallback (no per-row spam).

**Zero amounts (dashboard scope):** After parsing **`Amount by category`**, **drop** any row whose amount is effectively **nil spend** (`amount === 0` or **`Math.abs(amount) ≤ $0.005`** to ignore float/format dust). Such rows MUST **not** appear in **`rows[]`**, KPI totals, charts, the main grid, drawer drill-downs, or CSV export — only **non-material** spreadsheet lines remain in Sheet for audit; the dashboard is **non-zero spend only**.

---

## Export / Sheets quirks

1. **Currency column:** `Amount (by category) - Currency` is separate from **`Amount by category`**; assume **USD-only** unless multiple codes appear later (future: FX or filter by currency).
2. **`GL Customer Name`:** Canonical **`customer`**; empty / null ⇒ **Unattributed** (overhead).

If the sheet uses different labels after manual cleanup, use **Script Property column overrides** so operators do not fight the ingest.

---

## Goal

Add a **top-level** navigation route **Expenses** that surfaces **spend by department by month**, highlights **customer-attributed** vs **unattributed** spend, and supports **drill-down to individual expense lines** via a **right-hand slide-out** (reuse the existing Utilization **row-detail drawer** pattern: `.fos-util-drawer` in `DashboardShell.html`).

**Primary audience:** Finance / ops leadership reviewing monthly spend and customer allocations.

**Non-goals (v1):**

- Writing back to the sheet or approving expenses in-app.
- Replacing QuickBooks or the spreadsheet as the system of record.
- Fibery integration (unless later linked by customer name to `companies[]` — optional future).

---

## User stories

- As a **finance viewer**, I want to see **total spend by month stacked or grouped by department** so I can spot trends and concentration.
- As a **finance viewer**, I want **spend by expense category by month** as a **stacked bar chart** and to **open the underlying transactions** when I click a segment so I can reconcile category mix quickly.
- As an **ops lead**, I want to see **what share of spend is tied to a customer** so I can separate pass-through / client-related costs from overhead.
- As any **authorized user**, I want to **click a month, department, or customer slice** and open a **drawer with the underlying expense lines** so I can audit without leaving the dashboard.
- As a **power user**, I want **filters** (date range, department, customer, text search) and **Copy CSV** so I can export what I see.

---

## Proposed dashboard layout (UX)

Use **dark Operations / Agreement chrome**: `#panel-expenses.fos-agreement-root` + `.fos-agreement-inner`, loading overlay, section cards (same family as Revenue review / Labor hours).

### A. Header row

- Title: **Expenses**
- Subtitle: data range covered (min–max **`effectiveDate`** in filtered set), **row count**, **last refreshed** timestamp from server.
- **Refresh** (manual) + optional **Auto-refresh** / TTL (follow Agreement / Revenue review pattern; respect snapshot mode — see § Snapshot mode).
- **Filters** (collapsible or inline):
  - **Date range** (defaults e.g. last **12** complete months + current month, or “all time” if row count is small — product choice in R0).
  - **Department** (multi-select or “All”).
  - **Customer** (All / Attributed only / Unattributed only / pick customer).
  - **Search** (vendor, memo, **`Transaction ID`**, employee name — client-side over normalized rows).

### B. KPI strip (3–4 cards)

| Card | Suggestion |
| --- | --- |
| **Total spend** | Sum of `amount` in current filter. |
| **Customer-attributed** | Sum where `customer` non-empty; subtext: **% of total**. |
| **Unattributed** | Sum where `customer` empty; subtext: **% of total**. |
| **Departments** | Count of distinct `department` in filter (or “largest month” — optional fourth card). |

### C. Primary chart — **Spend by department by month**

- **X-axis:** Month (`yyyy-mm` labels, chronological).
- **Y-axis:** Currency (compact format, existing `formatMoneyCompact`).
- **Series:** One **stacked bar** per month, segments = **department** (top N departments by total; remainder **Other**), **or** grouped bars if stacking is too busy (R0: pick one; stacked is better for “total per month”).
- **Interaction:** Clicking a **stack segment** (month + department) opens the **drawer** filtered to those expenses (see § G). Clicking **month** background or legend could apply month-only filter.

**Accessibility:** Table-first or “data table” toggle for users who cannot read charts (optional Phase B).

### D. **Spend by category by month** (stacked bar + drill-down)

- **Placement:** Second primary chart card (below or beside § C — product choice on `lg` breakpoint).
- **X-axis:** Month (`yyyy-mm`), same filter window as the rest of the panel.
- **Y-axis:** Currency (`formatMoneyCompact`).
- **Series:** **Stacked bar** per month; each segment = **`Category`** (sheet column **Category** → normalized `category`). **Top N** categories by total spend in the filtered set; long tail merged into **Other** (same pattern as department chart; default **N = 8–10**, configurable constant).
- **Empty / null category:** Bucket as **`Uncategorized`** (single stack color, listed in legend).
- **Interaction (required):** **`onClick`** (or equivalent) on a **stack segment** resolves **month + category** (including **`Other`** / **`Uncategorized`** semantics) and opens the **same right-hand drawer** (§ G) listing **only** expense lines matching that **month ∩ category** (and still respecting global filters: department, customer, date range, search). Matches **Delivery** P&L chart → month drill-down pattern (`onClick` → modal/drawer), but filter dimension is **category** instead of revenue month items.
- **Optional:** Click **month** baseline (total bar height) → drawer for **all** lines in that month (no category slice); legend click → highlight only (out of scope unless product asks).
- **Implementation note:** Lazy-load **Chart.js** once for Expenses panel; use `getElementsAtEventForMode(..., 'nearest', { intersect: true })` (or Chart.js v4 equivalent) so **segment** hits are reliable; tooltip shows category + amount + % of month.

### E. Secondary section — **Customer attribution**

- **Horizontal bar** or **donut:** Top **customers** by attributed spend + **Unattributed** bucket.
- Small table: Customer · Total · % of attributed · % of overall.
- **Interaction:** Click customer or Unattributed → drawer with filtered lines.

### F. Detail table (sortable)

- One row per **expense line** (post-filter), default columns: **Purchase date · Effective date (if differs) · Amount · Currency · Department · GL Customer · Vendor · Category · Activity type · Employee · Approval state · Transaction ID · Memo** (trim for density; drawer shows full detail).
- Sortable headers (client-side), paginate or virtualize if >500 rows (R0: cap server rows with `EXPENSES_MAX_ROWS` + `partial: true` warning).
- Row click / Enter → same **drawer** for that single line (or multi-select later — out of scope v1).

### G. Right slide-out drawer (drill-down)

Reuse **`.fos-util-drawer`** pattern (backdrop + `open` class, close affordance, keyboard Esc):

- **Title:** context label, e.g. `March 2026 · Engineering` or `March 2026 · Software` (category) or `Customer: Acme Corp` or `Expense detail`.
- **Body:** scrollable list or mini-table of **expense lines** matching the filter context.
- **Row content:** all canonical + optional fields; mask sensitive ids if needed.
- **Footer:** optional **Copy CSV** for drawer contents; **Close**.

**Contexts to support (v1):**

1. From **department** chart: `{ month, department? }`
2. From **category** chart: `{ month, category }` — category is the **display** bucket name (`Other`, `Uncategorized` included)
3. From customer viz: `{ customer | UNATTRIBUTED }`
4. From main table: `{ rowId }` or full row payload passed client-side

---

## Functional requirements (draft FR placeholders)

*Lift into `docs/FOS-Dashboard-PRD.md` with official FR-/AC- numbers when scheduled.*

1. **Navigation:** `buildNavigationModel_()` adds a **top-level** item `{ id: 'expenses', label: 'Expenses' }` (icon: e.g. `bi-receipt` or `bi-cash-stack`).
2. **Authorization (v2.6.1):** `canAccessExpensesDashboard_()` allows access when **any** of `Team = FINANCE`, `Role = EXEC`, or `Role = ADMIN` is true; nav omits the **Finance** group and the server returns **FORBIDDEN** otherwise.
3. **Server endpoint:** e.g. `getExpensesDashboardData()` reads the configured tab from `AUTH_SPREADSHEET_ID`, normalizes rows, returns `{ rows: [...], fetchedAt, warnings?, partial? }` with stable field names. **Normalize excludes zero-amount rows** (see “Zero amounts” under Data source review); returned **`rows`** contain only spends that contribute to KPIs/charts/tables/export.
4. **Client:** New `#panel-expenses`; lazy fetch on first open; `sessionStorage` cache + TTL optional (key e.g. `fos_expenses_dashboard_v1`, `cacheSchemaVersion: 1`). Client MUST NOT re-introduce discarded zero rows unless product adds an explicit “Raw sheet rows” toggle (out of scope v1). **Charts:** At minimum **two** stacked bar charts (§ C **department** × month, § D **category** × month) using shared **Chart.js** load path; **category** chart **segment click** MUST open the drawer with **transaction-level** rows for that **month + category** (see § G).
5. **Snapshot / Live data:** If **Live data** is off (FR-105), either hide Expenses with explanation or ship a snapshot artifact in a later phase (recommend: **Phase A = Live only** with clear empty state in snapshot mode).
6. **Activity logging:** Whitelist events such as `expenses_refresh`, `expenses_filter_change`, `expenses_drawer_open` (label includes drill context: `dept \| category \| customer \| row`), `expenses_export_csv` (labels include filter summary, no PII beyond what’s already logged elsewhere).

---

## Acceptance criteria (draft)

- [ ] Sidebar shows **Expenses** as a **top-level** route; panel loads without errors for an authorized user when the tab exists and has valid headers.
- [ ] **Department chart (stacked bar):** Months on X-axis; **department** stacks; bar **totals** match sum of detail rows for the same filters.
- [ ] **Category chart (stacked bar):** Months on X-axis; **`Category`** stacks (**top N + Other**); **null/blank** category shows as **`Uncategorized`**. Clicking a **segment** opens the **drawer** with **all transactions** in that **month ∩ category** (respecting global filters). Segment totals match **`SUMIFS`** on month + category bucket.
- [ ] **KPI** cards show **total**, **attributed**, **unattributed**, and correct **percentages** for the filtered set.
- [ ] Clicking a **department chart** segment opens the **drawer** with only expenses for that **month** (and **department** when applicable).
- [ ] **Customer** section lists attributed totals and **Unattributed**; clicking each opens the drawer with the correct rows.
- [ ] **Main table** is sortable; activating a row opens the drawer with that expense’s fields.
- [ ] Rows with **`Amount by category`** parsing to **zero** (within **$0.005** epsilon) never appear anywhere on the dashboard; totals match Sheets **SUMIFS** excluding those rows.
- [ ] **Empty states:** Missing tab → friendly error + Settings hint for sheet name property; zero rows after filter → “No expenses match filters.”
- [ ] **Large sheets:** Optional row cap with `partial: true` and UI warning (mirror Delivery partial labor cap pattern).

---

## Data model

### Script Properties (proposed)

| Property | Default | Purpose |
| --- | --- | --- |
| `AUTH_EXPENSES_SHEET_NAME` | `expenses` | Tab name |
| `AUTH_EXPENSES_MAX_ROWS` | `20000` | Safety cap |
| `AUTH_EXPENSES_COL_PURCHASE_DATE` | `Purchase date` | Primary date |
| `AUTH_EXPENSES_COL_POSTED_DATE` | `Posted Date` | Fallback 1 |
| `AUTH_EXPENSES_COL_SUBMISSION_DATE` | `Submission Date` | Fallback 2 |
| `AUTH_EXPENSES_COL_AMOUNT` | `Amount by category` | Numeric amount |
| `AUTH_EXPENSES_COL_DEPARTMENT` | `Department Name` | |
| `AUTH_EXPENSES_COL_CUSTOMER` | `GL Customer Name` | |
| `AUTH_EXPENSES_COL_VENDOR` | `Vendor` | |
| `AUTH_EXPENSES_COL_CATEGORY` | `Category` | Drives § D stacked chart + drill-down |
| `EXPENSES_CHART_CATEGORY_TOP_N` | `10` | (optional Script Property) Smallest categories roll into **Other** |
| `AUTH_EXPENSES_COL_MEMO` | `Memo` | |
| `AUTH_EXPENSES_COL_TRANSACTION_ID` | `Transaction ID` | Stable line id + search |
| … | … | Additional overrides as needed (`Activity type`, `Approval state`, employee fields) |

### Normalized row (server → client)

```ts
/** Example shape — finalize in implementation. Only non-zero spend rows (see spec). */
{
  id: string;              // row index + fetchedAt or Transaction ID when present
  purchaseDate: string | null;   // yyyy-mm-dd
  effectiveDate: string;       // yyyy-mm-dd (after fallback chain)
  amount: number;              // always |amount| > 0.005 after server filter
  currencyCode?: string;   // e.g. USD
  department: string;
  customer: string;        // from GL Customer Name; empty => unattributed
  vendor?: string;
  category?: string;
  activityType?: string;
  employeeId?: string;
  employeeName?: string;
  memo?: string;
  submissionDate?: string | null;
  postedDate?: string | null;
  approvalState?: string | null;
  attendees?: string | null;
  transactionId?: string | null;
}
```

### Aggregations (client-side)

- Input set = server payload **`rows`** (already excludes zero amounts).
- Month key from **`effectiveDate`** (never from purchase-only if absent).
- `byMonthDept: Map<yyyy-mm, Map<department, sum>>` — § C chart
- `byMonthCategory: Map<yyyy-mm, Map<categoryDisplay, sum>>` — § D chart (**`Uncategorized`**, **`Other`** as needed)
- `byCustomer: Map<customerKey, sum>` including `''` → Unattributed
- Derived: KPIs, chart series, table rows, drawer filters

---

## Operations

### Server

- `SpreadsheetApp.openById(AUTH_SPREADSHEET_ID).getSheetByName(...).getDataRange().getValues()`.
- Header row detection + tolerant column match (reuse `findHeaderIndex_` style from auth).
- Date parsing: support Sheets `Date` objects and ISO-like strings.
- Amount parsing: `Number`, strip `$`, handle parentheses negatives if finance uses accounting notation — then **discard** row if **`Math.abs(parsedAmount) ≤ 0.005`** (treat as zero for dashboard purposes; no warning per row unless product wants an aggregate “N zero-amount rows skipped” in **`payload.meta`** optional).

### Client

- `google.script.run.withSuccessHandler(...).getExpensesDashboardData()` (or success handler pattern used elsewhere).
- **Chart.js** lazy-load once per panel open (reuse `loadChartJs()` pattern from Delivery / Agreement). **Two** `bar` charts, `scales.x.stacked: true`, `scales.y.stacked: true`; register **stacked bar click** handlers that map `datasetIndex` + `dataIndex` → **month + series key** (department name or category bucket). **Category** chart: resolving **`Other`** requires client to retain mapping from display label → set of raw category strings (or “all categories in Other for this dataset”).

---

## Edge cases

- **Missing columns:** Fail soft — if `department` missing, show single “Unknown” series and log warning.
- **Missing category:** Blank / null **`Category`** cell → **`Uncategorized`** bucket in § D chart and drawer drill-down titles.
- **Bad dates / amounts:** Skip row with warning counter in `payload.warnings` (invalid/unparseable).
- **Zero / immaterial amounts:** Omit from payload (**no** KPI/chart/table/drawer/CSV visibility); epsilon **$0.005** aligns with Revenue review variance materiality elsewhere in app.
- **Ambiguous headers:** If two columns share the same header label, header-based lookup is unsafe — fail with a clear **`payload.warnings`** message (unique names or explicit column-index mapping required).
- **Effective date cascade:** Rows with **all three** dates null — skip row or park under **“Undated”** bucket with KPI warning (rare).
- **Timezone:** Month bucket uses **consistent** TZ (recommend **America/Chicago** to match snapshot job, or **user local** — pick one in R0).

---

## Verification steps (when built)

1. Configure tab `expenses` with known test rows; set `AUTH_EXPENSES_SHEET_NAME` if different.
2. Sign in as authorized user → open **Expenses** → confirm KPIs match spreadsheet pivot for same filter.
3. **Department chart:** click a stack segment → drawer count matches **`COUNTIFS`** on **`effectiveDate` month** + **Department Name** in Sheets (same global filters).
4. **Category chart:** click a segment (e.g. **Software**, **Uncategorized**, **Other**) → drawer lists every transaction in that **month + category bucket**; summed amounts match segment height (**Other** must include all rolled-up categories for that month).
5. Filter **Unattributed only** → customer KPI shows 100% unattributed; drawer rows have blank **GL Customer Name**.
6. Spot-check **~34%** of rows with missing **Purchase date** still appear in month chart using **Posted** / **Submission** date.
7. Add a sheet row with **`Amount by category` = 0** (and one with **0.001**) → confirm neither appears in UI or exports; non-zero control row still appears.
8. **Copy CSV** (if shipped) → paste into Sheets and verify columns.

---

## Implementation checklist

- [ ] R0: Confirm live **`expenses`** tab headers match § “Sheet columns (as deployed)” (**17** columns; single **`Vendor`**). *(Operator / deploy-time.)*
- [x] Add server module + `getExpensesDashboardData` + tests via manual verification script.
- [x] `Code.js` navigation + `DashboardShell.html` panel + **two stacked bar charts** (department × month, category × month) + shared drawer wiring + Chart.js segment `onClick`.
- [x] `userActivityLog.js` whitelist new event types.
- [x] `adminSettingsRegistry.js` optional: document new Script Properties.
- [x] Main PRD FR/AC + version bump on release (**2.5.0**).

---

## Sheet columns (as deployed)

| # | Column header |
| ---: | --- |
| A | Employee - ID |
| B | Employee |
| C | Full name |
| D | Department Name |
| E | Activity type |
| F | Category |
| G | Vendor |
| H | Memo |
| I | Purchase date |
| J | Submission Date |
| K | Amount (by category) - Currency |
| L | Amount by category |
| M | GL Customer Name |
| N | Attendees |
| O | Approval state |
| P | Posted Date |
| Q | Transaction ID |

---

## Changelog (feature doc)

| Date | Change |
| --- | --- |
| 2026-05-27 | **v2.5.8** — Expenses drilldowns now use a sortable **modal table** (no slide-out drawer); copy CSV shows temporary **Data copied to clipboard** alert. |
| 2026-05-27 | **v2.5.7** — **Customer attribution** table directly under Sankey; risk map MoM **0%** when prior month spend is zero. |
| 2026-05-27 | **v2.5.6** — **Software vendor risk map:** Software category only; bubbles = vendors (color = vendor); **focus-month** range slider; metrics per selected month. |
| 2026-05-27 | **v2.5.5** — Dept + category monthly charts **side by side**; **software × vendor × month** stacked bar; **category risk map** bubble (MoM % vs YTD, txn size, quadrant interpretation). Script Properties **`EXPENSES_SOFTWARE_CATEGORY_MATCH`**, **`EXPENSES_CHART_VENDOR_TOP_N`**. |
| 2026-05-27 | **v2.5.3** — **Clear all filters**; **Finance** `Team` or **ADMIN** `Role` required (nav + server). |
| 2026-05-28 | **v2.6.1** — Access broadened: visible when **any** of `Team = FINANCE`, `Role = EXEC`, or `Role = ADMIN` (`canAccessExpensesDashboard_`). |
| 2026-05-27 | **v2.5.2** — Removed **Expense lines** table; **Sankey** (dept → attributed/unattributed → customer); checkbox multi-select filters (dept, employee, customer) + summary/chips. |
| 2026-05-27 | **Nav v2.5.1** — **Expenses** moved under new sidebar **Finance** group (after **Delivery**); route id unchanged. |
| 2026-05-27 | **Shipped v2.5.0** — feature doc + plan status updated; implementation checklist marked done (R0 remains operator). |
| 2026-05-27 | **[Implementation plan](015-expenses-dashboard-implementation-plan.md)** — phased server/client/nav/charts/drawer/test checklist added. |
| 2026-05-27 | **Category × month stacked bar:** Second chart (**`Category`** stacks, top N + **Other**, **Uncategorized**); **segment click** → drawer with underlying transactions (**month ∩ category**). Aggregations **`byMonthCategory`**, Chart.js **`onClick`**, AC + verification expanded. Optional **`EXPENSES_CHART_CATEGORY_TOP_N`**. |
| 2026-05-27 | **Zero-amount rows:** Omit from **`rows`** and all aggregates/UI/export after parse; **`|amount| ≤ $0.005`** epsilon. Server filter + acceptance + verification updated. |
| 2026-05-27 | **Sheet schema finalized:** **`expenses`** = **17** columns **A–Q**; single **`Vendor`**; **`Transaction ID`** in column **Q**. Reference `.xlsx` had an obsolete second **`Vendor`** — removed from spec narrative; quirks/R0/checklist normalized. Consolidated changelog entries. |
| 2026-05-27 | Initial proposal: top-level Expenses route, department × month, customer attribution, drawer drill-down. |

---

## References

- `src/authUsersSheet.js` — spreadsheet read + header tolerance.
- `src/DashboardShell.html` — `.fos-util-drawer`, panel patterns, `formatMoneyCompact`.
- `src/Code.js` — `buildNavigationModel_()` for top-level routes.
- `docs/features/010-dashboard-historical-data-source.md` — Live vs snapshot (FR-105).
- `docs/features/004-user-activity-logging.md` — activity whitelist pattern.

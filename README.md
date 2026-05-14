# Harpin FOS Dashboard

**FOS** (Finance & Operations Snapshot) is a **Google Apps Script** web application that gives authorized Workspace users a single place to open **harpin AI Ops Dashboards**: a shell with navigation, spreadsheet-backed access control, an **Agreement Dashboard** view (Fibery-backed Agreement Management), a **Utilization Management Dashboard** (Fibery-backed Labor Costs), and a **Delivery Dashboard** (Active Projects table with substring search + per-project monthly P&L with chart / table view, per-month Revenue drill-down, projected-month coverage, Copy CSV, and as of **v1.21.0** a pacing strip, delivery-signals strip, and portfolio margin-flow Sankey) — all aligned with the product baseline in `[docs/FOS-Dashboard-PRD.md](docs/FOS-Dashboard-PRD.md)`.

The app **reads and presents** data from configured sources (today: stub agreement payload; planned: Fibery, Sheets metric layers, and other connectors). It does **not** replace upstream systems of record (for example the Clockify → Fibery pipeline described in `[docs/PRD.md](docs/PRD.md)`).

---

## Current functionality


| Area              | Behavior                                                                                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Web App entry** | `doGet` serves either `**DashboardShell.html`** (authorized) or `**NotAuthorized.html**` (not listed, misconfiguration, or missing email under the deployment identity).                                                                                                                    |
| **Authorization** | Active user’s email is matched against a **Google Sheet** tab (default name `**Users`**) in a spreadsheet whose ID is stored in **Script Properties**. **Role** and **Team** come from that row and appear in the sidebar user chip.                                                        |
| **Server API**    | `getDashboardNavigation()` and `getAgreementDashboardData()` use `**requireAuthForApi_()`** so `google.script.run` cannot bypass the sheet gate.                                                                                                                                            |
| **Shell UI**      | Bootstrap **dark** layout: left nav (icons + labels), **Home** welcome copy, **Settings** (gear) at bottom of sidebar with a “coming soon” placeholder.                                                                                                                                     |
| **Agreement Dashboard** | Opens the **Agreement Management Dashboard** panel: harpin branding tokens (see agreement PRD §9.5–9.7), header, six KPI cards, **Attention items** panel, **Agreement status** + **Agreement type mix** donuts, **Revenue recognition** stacked bar, **Customer contract value** bar, **Customer relationship cards**, **Forward revenue pipeline**, tabbed **Financial performance** table (as of **v1.18.0** every row is keyboard-activatable and opens a **milestones modal** listing the agreement's Revenue Items as Milestone · Target amount · Target date · Invoice status, sourced from a new `payload.revenueItemsByAgreement` map with zero extra Fibery fetches), and the **D3 revenue-flow Sankey** (Status → Customer → Type). As of **v1.13.0** the panel header carries only the page title + subtitle — the in-panel harpin logo + separator divider were removed for cross-dashboard consistency; the sidebar `.fos-brand-logo` is now the single rendered brand mark across the entire web app. As of **v1.13.1** every server fetch (initial load, Refresh, background stale-refresh) surfaces a **semi-transparent loading overlay** with a centered animated spinner, and navigating away and back **no longer re-renders the panel** when the cached payload's `fetchedAt` matches what's already on screen — Chart.js + Sankey state is preserved across nav toggles. Live data is fetched from Fibery via the server (REST `/api/commands`, credentials in Script Properties `FIBERY_HOST` + `FIBERY_API_TOKEN`). The client uses **`sessionStorage`** key `fos_agreement_dashboard_v2` (no secrets in cache) and an **Auto-refresh** selector (5 / 10 / 30 min / Off, default 10 min, persisted in `localStorage`) that surfaces a **Stale** badge and refreshes in the background when the cache exceeds the TTL. Chart.js v4 and D3 v7 + d3-sankey are lazy-loaded from jsDelivr on first render. Internal route id is **`agreement-dashboard`** (DOM panel `#panel-agreement-dashboard`, activity-log Route field); the legacy `finance` route id was retired in **v1.11.0**, but historical `User Activity` rows tagged `Route = finance` and event type `finance_table_tab` remain queryable alongside new `agreement-dashboard` / `agreement_table_tab` rows. |
| **Operations (Utilization Management Dashboard)** | Opens the **Utilization Management Dashboard** panel (route id `operations`, DOM panel `#panel-operations`) introduced in **v1.12.0**, extended in **v1.13.0** with cross-filter drill-down + the Detail Table, polished in **v1.13.1** with a semi-transparent loading overlay + sticky panel render, and **extended in v1.14.0** with the **Phase C** surfaces: a **Utilization Alerts panel** above the KPI strip (under-utilized / over-allocated / stale approval rules from `src/utilizationAlerts.js`; rendered as collapsible groups, with the grouping axis switched from per-person (v1.16.0) to **per alert kind** in **v1.17.0** — Under-utilized · Over-allocated · Stale approvals. **As of v1.21.1** kind-based groups **start collapsed** until the user expands a header; a **Collapse all** pill closes every group in one click), a **Person × Week heatmap** (top 30 contributors; **heatmap-local Role filter** distinct from the global Role multi-select; partial-week hatch overlay; as of **v1.18.0** a cell click opens a modal listing the contributing labor entries — Date · Customer · Agreement · Project · Task · Hours · Cost · Approval — replacing the prior pin-Person + switch-range drill that forced a fresh server fetch on every click), a **Pending Approvals widget** (cap 50, Show all toggle, amber / red age badges), and an off-canvas **row-detail drawer** with an **Open in Fibery →** deep link (as of **v1.15.0** the URL is composed from a server-supplied template — `FIBERY_PUBLIC_SCHEME` + `FIBERY_DEEP_LINK_HOST` (or `FIBERY_HOST`) + `FIBERY_LABOR_COST_PATH_TEMPLATE` — and the anchor is gated by a new **`fibery_access`** column on the Users sheet; users without the flag never receive the deep-link config and the anchor + footer are hidden). Reads `Agreement Management/Labor Costs` from Fibery through a paginated `/api/commands` query (date-filtered on `Start Date Time`), normalizes rows (coerces `Hours` from text, derives `week` / `isPending` / `isInternal` / `revenueFromLabor`), and returns the KPI strip (Total Hours, Billable Hours, Utilization %, Total Cost, Effective Bill Rate + coverage label, Pending Approvals) plus **six** Chart.js v4 surfaces: **Hours by Customer** (top-N bar), **Hours by Project** (top-N bar, colored by customer), **Weekly trend** (line), **Billable vs Non-billable** (stacked bar per week), **Hours by Role** (doughnut, Phase B), and **Hours by Person** (top-N bar, colored by primary role, Phase B). Global filter bar: date-range preset (default 90 days), **Customer / Project / Person / Role** multi-selects (as of **v1.18.0** the **Persons** menu is alpha-sorted while the heatmap still uses the server's hours-desc order for top-contributor row ranking), **Billable** segmented toggle (All / Billable / Non-billable), **Internal labor** segmented toggle (Include / Exclude — removes rows where `isInternal = true` from every chart + KPI when set to Exclude), chip row with removable filters, **Clear filters** affordance. Every chart is a control surface: clicking a Customer / Project / Role / Person / Billable element toggles that value in the corresponding filter set. **Detail Table** (Phase B) below the charts shows the row-level entries matching the active filter — sortable columns (Date · Person · Customer · Project · Role · Hours · Cost · Bill rate · Approval), paginated 100 rows / page, Approval rendered as a colored pill. Cache: `sessionStorage` (`fos_utilization_dashboard_v1`, `cacheSchemaVersion: 1`) + `localStorage` TTL preference (`fos_utilization_dashboard_ttl_minutes_v1`, default 10 min); **filter state** persists across reloads in `localStorage` `fos_utilization_filters_v1` (schemaVersion 1; customers / projects / persons / roles / billable / internalLabor — `range` excluded by design). |
| **Delivery (Delivery Dashboard)** | Opens the **Delivery Dashboard** panel (route id `delivery`, DOM panel `#panel-delivery`) introduced in **v1.19.0** (Phase A), extended in **v1.20.0** (Phase B), and in **v1.21.0** (Phase C) with a **pacing strip** on the P&L card (linear plan vs recognized + trailing 3-mo average), a **Delivery signals** attention strip above the table (rules on cached project rows only), and a **portfolio margin-flow Sankey** (D3 + d3-sankey on visible rows). Top: an **Active Projects** table — Project · Customer · Type · Status · Contract value · Recognized · % Complete (colored progress bar) · Margin (target-variance dot) — with a **client-side substring search input** in the header (Project + Customer, debounced, persisted in `fos_delivery_filters_v1`). Reuses `getAgreementDashboardData()` server-side so no extra Fibery round-trip is needed for the list. Bottom: a **Profit & Loss** card seeded lazily on row click. The KPI strip (Contract value · Revenue recognized · Total cost · Gross profit · Margin vs target) renders synchronously from the cached project; the **monthly P&L grid** is fetched on demand via `getDeliveryProjectMonthlyPnL(<agreementId>)` and cached per-project in `sessionStorage` under `fos_delivery_pnl_<agreementId>_v2` (cache schema **v2** — Phase B bumped from v1 because each month row now carries `projected: bool` + `revenueItems[]` for drill-down). The server issues three small Fibery queries (Labor Costs · Other Direct Costs · Revenue Items, all scoped to the agreement, full project lifetime — Phase B dropped the recognized-only filter on Revenue Items so future-dated milestones surface in projected months), aggregates them into one row per calendar month spanning the project Duration (with an italic `(OOR)` marker on stray activity outside the window per decision M.3), and computes Revenue · Labor · Expenses · Total cost · Margin $ · Margin % with margin-bucket coloring (green / amber / red) keyed against the agreement's Target Margin per decision M.7. **Phase B P&L card additions:** a **Table / Chart view toggle** above the grid (the Chart view lazy-loads Chart.js and renders stacked Labor + Expenses bars with an overlaid Revenue line; projected months use muted fill colors so the actual-vs-projected split pops); a **Projected** pill + muted row treatment on every month later than the current UTC month; a **per-month Revenue drill-down** (clicking any Revenue cell — or a chart bar — opens `#deliveryRevenueMonthModal` with the contributing milestones table sourced from `month.revenueItems[]`, zero extra Fibery fetches); a **Copy CSV** button that serializes the visible months + Lifetime total row (columns Month, Revenue, Labor, Expenses, Total cost, Gross profit, Margin %, Projected, Out of range) to the clipboard. Server Script Properties: `DELIVERY_CACHE_TTL_MINUTES`, `DELIVERY_ACTIVE_STATES` (CSV whitelist; empty = default rule), `DELIVERY_EXCLUDE_INTERNAL` (default true), `DELIVERY_PNL_INCLUDE_PROJECTED_ODC` (Phase B default: **true** — Projected ODC included; set `false` to restore Phase A actual-only behavior), `DELIVERY_PNL_MAX_LABOR_ROWS` (default 10000 — a `Partial data` badge surfaces when the cap is reached per decision M.6). A §M.9 reconciliation caption surfaces when summed monthlies diverge from the agreement's lifetime fields by more than 5% (decision M.5). Activity events: the Phase A/B set plus **`delivery_attention_click`**; `delivery_project_select` labels include `source=<table|click|attention|restore>`. **Agreement Attention** gains three delivery-risk rules in `src/agreementAlerts.js` (v1.21.0). |
| **Version**       | Sidebar footer and not-authorized page show **PRD version** from `FOS_PRD_VERSION` in `[src/Code.js](src/Code.js)` (must match the version line in `docs/FOS-Dashboard-PRD.md`).                                                                                                            |

## Script properties (Apps Script project settings)

Configuration for this Web App lives in the Apps Script project under **Project settings → Script properties** (string key/value pairs). These are **not** OS environment variables; the server reads them with `PropertiesService.getScriptProperties()`. Behavior and defaults are implemented in `src/` and described in `[docs/features/](docs/features/)` (notably `002` auth, `003` Agreement, `004` activity log, `005` Utilization, `006` Delivery).

**PRD version** is **not** a Script Property: it is the `FOS_PRD_VERSION` constant in `[src/Code.js](src/Code.js)` and must stay aligned with `[docs/FOS-Dashboard-PRD.md](docs/FOS-Dashboard-PRD.md)`.

| Property | Required | Purpose | Typical default |
| --- |:---:| --- | --- |
| **Authorization & Users sheet** | | | |
| `AUTH_SPREADSHEET_ID` | **Yes** | Spreadsheet ID that contains the authorized-users tab. | — |
| `AUTH_USERS_SHEET_NAME` | No | Tab name for the user roster. | `Users` |
| `AUTH_COL_EMAIL` | No | Header for the email column (case-sensitive match to row 1). | `Email` |
| `AUTH_COL_ROLE` | No | Header for role. | `Role` |
| `AUTH_COL_TEAM` | No | Header for team. | `Team` |
| `AUTH_COL_FIBERY_ACCESS` | No | Header for per-user **Open in Fibery** on the Operations drawer; blank/missing column → deny. | `fibery_access` |
| **User activity log** | | | |
| `AUTH_USER_ACTIVITY_SHEET_NAME` | No | Tab name for append-only usage logging (must exist with documented headers). | `User Activity` |
| `USER_ACTIVITY_LOGGING_ENABLED` | No | Kill-switch: `false` / `no` / `0` (case-insensitive) disables writes; unset or other → enabled. | *(on)* |
| **Fibery API (shared)** | | | |
| `FIBERY_HOST` | **Yes** (for Fibery routes) | Fibery workspace host for REST `/api/commands` (no scheme), e.g. `harpin-ai.fibery.io`. Default host for deep links when `FIBERY_DEEP_LINK_HOST` is unset. | — |
| `FIBERY_API_TOKEN` | **Yes** (for Fibery routes) | Fibery API token (server-only; never exposed to the browser). | — |
| **Fibery deep links (Operations drawer)** | | | |
| `FIBERY_PUBLIC_SCHEME` | No | Scheme when composing **Open in Fibery** URLs. | `https` |
| `FIBERY_DEEP_LINK_HOST` | No | Public web host for deep links if it differs from `FIBERY_HOST`. | falls back to `FIBERY_HOST` |
| `FIBERY_LABOR_COST_PATH_TEMPLATE` | No | Path template with `{slug}` and `{publicId}` for labor-cost entity URLs. | `/Agreement_Management/Labor_Costs/{slug}-{publicId}` |
| **Agreement Dashboard** | | | |
| `AGREEMENT_CACHE_TTL_MINUTES` | No | Server seed for the client Auto-refresh TTL (minutes). | `10` |
| `AGREEMENT_THRESHOLD_LOW_MARGIN` | No | Low-margin warning threshold for Attention alerts (percent). | `35` |
| `AGREEMENT_THRESHOLD_INTERNAL_LABOR` | No | Internal-labor warning threshold (dollars). | `5000` |
| `AGREEMENT_THRESHOLD_EXPIRY_DAYS` | No | Renewal / expiring-agreement window (days). | `60` |
| `AGREEMENT_TOP_N_RECOGNITION_BARS` | No | Top-N agreements in the revenue recognition stacked bar. | `10` |
| `AGREEMENT_INTERNAL_COMPANY_NAMES` | No | Comma-separated internal company names (internal classification). | `harpin.ai` |
| `AGREEMENT_SANKEY_LINK_OPACITY` | No | Revenue Flow Sankey link opacity (`0`–`1`). | `0.35` |
| `AGREEMENT_SANKEY_INCLUDE_INTERNAL` | No | Include **Internal** type agreements in the Sankey aggregate. | `false` |
| **Delivery table + P&L (Script Properties)** | | | |
| `DELIVERY_CACHE_TTL_MINUTES` | No | Server seed for Delivery client cache TTL (minutes). | `10` |
| `DELIVERY_ACTIVE_STATES` | No | Comma-separated whitelist of workflow states counted as “active”; empty → default rule (not Closed-Lost). | *(empty)* |
| `DELIVERY_EXCLUDE_INTERNAL` | No | When `true`, hide **Internal** type projects from the Active Projects list. | `true` |
| `DELIVERY_PNL_INCLUDE_PROJECTED_ODC` | No | When `true`, include **Projected** Other Direct Costs rows in monthly P&L. | `true` |
| `DELIVERY_PNL_MAX_LABOR_ROWS` | No | Max Labor Cost rows fetched per project (`0` = unlimited); partial badge when capped. | `10000` |
| **Delivery visuals + Agreement Attention (shared)** | | | |
| `DELIVERY_COMPLETION_UNDER_PCT` | No | §D.11 `% Complete` bar — upper bound of “under” bucket (%). Resolved in `[src/agreementThresholds.js](src/agreementThresholds.js)`. | `25` |
| `DELIVERY_COMPLETION_BUILDING_PCT` | No | §D.11 — upper bound of “building” bucket (%). | `75` |
| `DELIVERY_COMPLETION_OVER_PCT` | No | §D.11 — “over” when completion **exceeds** this (%). | `100` |
| `DELIVERY_MARGIN_VARIANCE_AMBER_PTS` | No | §D.10 margin vs target — amber band width below target (percentage points); also Agreement Attention delivery rules. | `5` |
| **Utilization Management Dashboard** | | | |
| `UTILIZATION_CACHE_TTL_MINUTES` | No | Server seed for Operations client cache TTL (minutes). | `10` |
| `UTILIZATION_DEFAULT_RANGE_DAYS` | No | Default date-range length when the client does not pass explicit bounds. | `90` |
| `UTILIZATION_MAX_RANGE_DAYS` | No | Hard cap on requested range length (days). | `365` |
| `UTILIZATION_WEEKLY_CAPACITY_HOURS` | No | Per-person weekly capacity baseline for utilization % (hours). | `40` |
| `UTILIZATION_TARGET_PERCENT` | No | Target utilization % (top of green bucket in utilization coloring). | `85` |
| `UTILIZATION_UNDER_PERCENT` | No | Under-utilized alert threshold (mean of last 3 complete weeks). | `60` |
| `UTILIZATION_OVER_PERCENT` | No | Over-allocated alert threshold (consecutive weeks). | `110` |
| `UTILIZATION_INTERNAL_COMPANY_NAMES` | No | Comma-separated Clockify/company names treated as internal labor. | `harpin.ai,Harpin` |
| `UTILIZATION_TOP_N_PERSONS` | No | Cap for Hours-by-Person chart rows. | `20` |
| `UTILIZATION_TOP_N_PROJECTS` | No | Cap for Hours-by-Project chart rows. | `20` |
| `UTILIZATION_TOP_N_CUSTOMERS` | No | Cap for Hours-by-Customer chart rows. | `20` |
| `UTILIZATION_HEATMAP_TOP_N_PERSONS` | No | Max heatmap rows (separate from Top-N persons for the bar chart). | `30` |
| `UTILIZATION_STALE_APPROVAL_WARN_DAYS` | No | Stale-approval alert: warning age (days). | `7` |
| `UTILIZATION_STALE_APPROVAL_CRIT_DAYS` | No | Stale-approval alert: critical age (days); must be **>** warn days. | `14` |

---

## Repository layout


| Path                         | Purpose                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `[src/](src/)`               | **Only** what **clasp** pushes to Apps Script (`.gs`, `.html`, `appsscript.json`).                   |
| `[docs/](docs/)`             | PRDs and feature specs; **not** uploaded to the script project (see `[.claspignore](.claspignore)`). |
| `[.clasp.json](.clasp.json)` | Links this repo to a Google Apps Script project (`scriptId`) and sets `**rootDir`: `src`**.          |


---

## Prerequisites

- **Google account** with access to the target Apps Script project and (for deploy) the auth spreadsheet.
- **[clasp](https://github.com/google/clasp)** (CLI for Apps Script). Install globally, for example: `npm install -g @google/clasp`.
- **Node.js** (for `npm` / `npx` if you prefer not to install clasp globally).

---

## Instantiate the project (local + Apps Script)

### 1. Clone and log in

```bash
git clone <your-git-remote-url> FOSDashboard
cd FOSDashboard
clasp login
```

### 2. Connect to an Apps Script project

**Option A — You already have this repo and a shared script:** ensure `[.clasp.json](.clasp.json)` contains the correct `**scriptId`** and that your Google user has **Editor** (or Owner) on that Apps Script project.

**Option B — New Apps Script project:** in [script.google.com](https://script.google.com), create a project → **Project settings** → copy **Script ID**. Set it in `.clasp.json`:

```json
{
  "scriptId": "YOUR_SCRIPT_ID_HERE",
  "rootDir": "src"
}
```

Then pull any remote files (optional, if the project is not empty):

```bash
clasp pull
```

Overwrite or merge with the contents of `[src/](src/)` from this repository as needed.

### 3. Push code from `src/`

```bash
clasp push
```

Only files under `**src/**` are pushed; `README.md`, `docs/`, `.git/`, etc. are excluded by `[.claspignore](.claspignore)`.

### 4. Configure Script Properties

In the Apps Script editor: **Project settings** → **Script properties** (or **File → Project properties** in the older UI). The **full list** of keys (Fibery, Agreement, Utilization, Delivery, activity log, deep links) is in [**Script properties (Apps Script project settings)**](#script-properties-apps-script-project-settings) above. Minimum for sheet-backed auth:

| Property                | Required | Description                                                |
| ----------------------- | -------- | ---------------------------------------------------------- |
| `AUTH_SPREADSHEET_ID`   | **Yes**  | Google Spreadsheet ID containing the authorized users tab. |
| `AUTH_USERS_SHEET_NAME` | No       | Tab name (default `**Users`**).                            |
| `AUTH_COL_EMAIL`        | No       | Email column header (default `**Email**`).                 |
| `AUTH_COL_ROLE`         | No       | Role column header (default `**Role**`).                   |
| `AUTH_COL_TEAM`         | No       | Team column header (default `**Team**`).                   |
| `AUTH_COL_FIBERY_ACCESS` | No      | **Open in Fibery** gate column header (default `**fibery_access**`). |


The **Users** sheet must have a **header row** with those columns; each authorized user is one row with a Workspace **email** that matches `Session.getActiveUser().getEmail()` when the Web App runs as **User accessing the web app**.

For live Fibery-backed dashboards, set `FIBERY_HOST` and `FIBERY_API_TOKEN` (and any optional keys from the catalog). **Never** commit tokens or spreadsheet IDs to git.

### 5. Deploy as a Web App

1. In Apps Script: **Deploy → New deployment** → type **Web app**.
2. **Execute as:** *User accessing the web app* (so authorization sees the viewer’s email).
3. **Who has access:** choose the audience your org requires (often *Anyone within domain* or a specific group).
4. Copy the **Web App URL** and open it while signed into an authorized Workspace account.

---

## Maintain the project in Apps Script

### Day-to-day workflow

1. Edit files under `**src/`** in your IDE (or pull doc-only changes from `docs/` for reference).
2. Run `**clasp push**` to upload `.gs` / `.html` / `appsscript.json` changes.
3. Re-test the **Web App** URL (or create a **Test deployment** first).
4. Keep `**FOS_PRD_VERSION`** in `[src/Code.js](src/Code.js)` and the `**PRD version**` line in each `src/*` file header in sync with `[docs/FOS-Dashboard-PRD.md](docs/FOS-Dashboard-PRD.md)` whenever that document’s version changes (see `[.cursor/rules/google-apps-script-core.mdc](.cursor/rules/google-apps-script-core.mdc)` if you use Cursor rules).

### If someone edited code in the browser

```bash
clasp pull
```

Review diffs carefully: `**clasp pull**` overwrites local `src/` files with the server’s copy for matching filenames.

### Documentation and PRDs

Requirements and feature breakdowns live under `**docs/**`. They are **not** deployed with clasp; treat them as the source of truth for behavior and update them when you change product scope (for example `[docs/features/003-agreement-dashboard-fibery-client-cache.md](docs/features/003-agreement-dashboard-fibery-client-cache.md)` for the Agreement Dashboard route).

### Useful clasp commands


| Command                   | Use                                                   |
| ------------------------- | ----------------------------------------------------- |
| `clasp open`              | Open the script project in the browser.               |
| `clasp deployments`       | List deployments and versions.                        |
| `clasp version "message"` | Save a named version snapshot before deploying.       |
| `clasp logs`              | Stream Stackdriver-style logs (when logging is used). |


---

## Related documents

- `[docs/FOS-Dashboard-PRD.md](docs/FOS-Dashboard-PRD.md)` — main product PRD for this Web App.
- `[docs/agreement-dashboard-prd-v2.md](docs/agreement-dashboard-prd-v2.md)` — agreement dashboard visuals, Fibery model, and thresholds (the Agreement Dashboard view pulls from this where applicable).
- `[docs/PRD.md](docs/PRD.md)` — separate Clockify ↔ Fibery sync PRD (related data pipelines).


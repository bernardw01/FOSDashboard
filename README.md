# Harpin FOS Dashboard

**FOS** (Finance & Operations Snapshot) is a **Google Apps Script** web application that gives authorized Workspace users **harpin AI Ops Dashboards**: shell + sheet auth, Fibery-backed **Agreement** and **Operations** (Utilization + Labor hours) views, and **Delivery** (**Projects & P&L** + **Revenue review**). Product baseline: `[docs/FOS-Dashboard-PRD.md](docs/FOS-Dashboard-PRD.md)`.

The app **reads and presents** data from configured sources (Fibery, the authorization spreadsheet, and optional Script Properties). It does **not** replace upstream systems of record (for example the Clockify → Fibery pipeline in `[docs/PRD.md](docs/PRD.md)`).

---

## Current functionality

Cross-cutting **platform** behavior (not tied to a single dashboard route):

| Concern | Behavior |
| --- | --- |
| **Web App entry** | `doGet` serves `DashboardShell.html` (authorized) or `NotAuthorized.html` (denied / misconfiguration / missing email under the deployment identity). |
| **Authorization** | Active user email matched to a **Google Sheet** tab (default `Users`; spreadsheet ID in Script Properties). **Role** and **Team** surface in the sidebar chip. Optional **`fibery_access`** gates Fibery deep-link config in the nav payload. |
| **Server API gate** | `google.script.run` entry points (e.g. `getDashboardNavigation()`, `getAgreementDashboardData()`, `getUtilizationDashboardData()`, `getDeliveryProjectMonthlyPnL()`) use server-side auth helpers so the sheet gate cannot be bypassed from the client. |
| **Shell UI** | Bootstrap **dark** layout: left nav (icons + labels), **Home** welcome card, nested **Operations** and **Delivery** groups, **Settings** (gear) placeholder at bottom of sidebar. |
| **PRD version** | Sidebar footer + not-authorized page show **`FOS_PRD_VERSION`** in `[src/Code.js](src/Code.js)` — must match `[docs/FOS-Dashboard-PRD.md](docs/FOS-Dashboard-PRD.md)` and every `src/*` file header. |

### Agreement Dashboard

Route **`agreement-dashboard`** · panel **`#panel-agreement-dashboard`**. Fibery via REST `/api/commands` (`FIBERY_HOST` + `FIBERY_API_TOKEN`). Client cache **`sessionStorage`** key `fos_agreement_dashboard_v2`; TTL 5 / 10 / 30 / Off in `localStorage` + **Stale** badge + background refresh. Chart.js and D3 + d3-sankey lazy-loaded from jsDelivr.

| Version | Capabilities |
| --- | --- |
| **v1.8.0** | Live Fibery wiring: KPI strip, attention panel, four Chart.js charts, tabbed **Financial performance** table, Sankey-oriented data prep; client TTL + cache schema **`fos_agreement_dashboard_v2`**. |
| **v1.10.0** | **Customer relationship cards**, **Forward revenue pipeline**, **D3 revenue-flow Sankey** (Status → Customer → Type). |
| **v1.11.0** | Internal route id **`finance` → `agreement-dashboard`**; historical `User Activity` rows under `finance` remain queryable. |
| **v1.13.0** | **Single brand mark** in sidebar only (in-panel logo removed from Agreement + Operations for consistency). |
| **v1.13.1** | **Loading overlay** on fetch; **skip full re-render** when returning to the panel if cache `fetchedAt` already matches the DOM (preserves Chart.js + Sankey state). |
| **v1.18.0** | Financial table rows open **milestones modal** from **`revenueItemsByAgreement`** (zero extra Fibery fetches for that modal). |

### Utilization Management Dashboard

Route **`operations`** · panel **`#panel-operations`**. Data from Fibery **`Agreement Management/Labor Costs`** (paginated, date-filtered). Cache **`fos_utilization_dashboard_v1`** (`cacheSchemaVersion` **2** from v1.14.0 onward for alerts + heatmap payload). Six Chart.js surfaces + KPI strip + global filters; **`localStorage`** `fos_utilization_filters_v1` (range not persisted).

| Version | Capabilities |
| --- | --- |
| **v1.12.0** | **Phase A**: Labor Costs pipeline, KPI strip, six charts, Customer / Project / Billable / Internal filters, chip bar, click-to-toggle drill on charts, `sessionStorage` cache + TTL preference. |
| **v1.13.0** | **Phase B**: **Person** + **Role** multi-selects, **Hours by Role** doughnut + **Hours by Person** bar, **Detail Table** (sort, pagination, 100 rows/page), filter persistence. |
| **v1.13.1** | Loading overlay + **sticky panel** (same pattern as Agreement). |
| **v1.14.0** | **Phase C**: **Utilization Alerts**, **Person × Week heatmap** (heatmap-local Role filter, top 30 rows), **Pending Approvals**, **row-detail drawer**; cache schema bump **1 → 2**. |
| **v1.15.0** | **Open in Fibery** from server-supplied **`FIBERY_*`** templates; anchor hidden without **`fibery_access`** or row `publicId` / `name`. |
| **v1.16.0** | Alerts **grouped by person** (collapsible). |
| **v1.17.0** | Alerts grouped by **`kind`** (Under-utilized / Over-allocated / Stale approvals) + **Collapse all**; `util_alert_group_toggle` label uses `kind=`. |
| **v1.18.0** | Heatmap cell → **read-only modal** (labor lines for that cell); **Persons** menu **alpha-sorted** (heatmap row order unchanged). |
| **v1.21.1** | Kind-based alert groups **start collapsed**; **Collapse all** still available. |

### Labor hours

Route **`labor-hours`** · panel **`#panel-labor-hours`**. Reuses normalized labor rows from the Utilization payload; **`laborHours`** object on that payload (Script Property–driven targets).

| Version | Capabilities |
| --- | --- |
| **v1.22.0** | **Mon–Sun week** picker (default last completed week), Over / Under / On-target **sortable** tables, **Internal labor** filter aligned with Utilization, **cache-first** week slice when `fos_utilization_dashboard_v1` date range already covers the selected week (skips redundant `getUtilizationDashboardData`). |
| **v1.23.0** | **Zero hours** KPI + chip roster from `dimensions.persons`; KPI tiles **scroll** to sections (click + keyboard); optional **`LABOR_HOURS_COMPANY_TARGETS_JSON`**, **`LABOR_HOURS_EXCLUDED_PERSON_SUBSTRINGS`**. |
| **v1.24.0** | **Expandable project / task** `<details>` in Projects column; **Copy CSV**; **print** rules; dedicated **`labor_hours_*`** activity events. |

### Delivery — Projects & P&L

Route **`delivery`** · panel **`#panel-delivery`**. Project list from **`getAgreementDashboardData()`** (no extra list query). Per-project monthly grid via **`getDeliveryProjectMonthlyPnL(agreementId)`**; cache **`fos_delivery_pnl_<agreementId>_v2`**.

| Version | Capabilities |
| --- | --- |
| **v1.19.0** | **Phase A**: **Active Projects** table (completion + margin visuals), **P&L card** on row select, monthly aggregation + **(OOR)** out-of-range months, dual `sessionStorage` caches + TTL. |
| **v1.20.0** | **Phase B**: **Table / Chart** toggle (Chart.js), **projected** months + pills, **Revenue drill-down** modal from `month.revenueItems[]`, **Copy CSV**, **search** (debounced, persisted in `fos_delivery_filters_v1`), cache schema **v2** for P&L. |
| **v1.21.0** | **Phase C**: **Pacing strip** on P&L, **Delivery signals** strip (cached `projects[]` only), **portfolio margin-flow Sankey**; **Agreement Attention** gains delivery-risk rules in `agreementAlerts.js`. |

### Revenue review

Route **`revenue-review`** · panel **`#panel-revenue-review`**. Under sidebar **Delivery** group. Reads the same browser cache as Agreement: **`fos_agreement_dashboard_v2`** + shared TTL / Stale behavior.

| Version | Capabilities |
| --- | --- |
| **v1.25.0** | **Delivery** becomes a **nav group**: **Projects & P&L** + **Revenue review**; six **KPI** cards, **Agreement expiry** strip, **Future revenue pre-recognition** banner; **`revenue_review_refresh`** logging. |
| **v1.26.0** | Sortable **tables** (prior/current milestone months, portfolio, revenue by customer, overdue, variance); **Copy CSV** (per section + all); **print** with expanded milestone `<details>`; milestone **drill-down** tree (customer → agreement); persisted table sort in `sessionStorage`; additional **`revenue_review_*`** events. |
| **v1.27.0** | Milestone tree groups by **agreement Customer** then **agreement**; **Revenue by customer** rows open the **shared row-detail drawer** with company + rollups and **Open in Fibery → Companies** when **`fibery_access`** and company **`publicId`** exist; **`revenue_review_drawer_*`** activity events. |

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
| **Fibery deep links (browser URLs, gated by `fibery_access`)** | | | |
| `FIBERY_PUBLIC_SCHEME` | No | Scheme when composing **Open in Fibery** URLs. | `https` |
| `FIBERY_DEEP_LINK_HOST` | No | Public web host for deep links if it differs from `FIBERY_HOST`. | falls back to `FIBERY_HOST` |
| `FIBERY_LABOR_COST_PATH_TEMPLATE` | No | Path template with `{slug}` and `{publicId}` for labor-cost entity URLs. | `/Agreement_Management/Labor_Costs/{slug}-{publicId}` |
| `FIBERY_AGREEMENT_PATH_TEMPLATE` | No | Path template for Agreement entity URLs (milestones modal, etc.). | `/Agreement_Management/Agreements/{slug}-{publicId}` |
| `FIBERY_COMPANY_PATH_TEMPLATE` | No | Path template for **Companies** entity URLs (Revenue review drawer). | `/Agreement_Management/Companies/{slug}-{publicId}` |
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
| `LABOR_HOURS_DEFAULT_WEEKLY_TARGET` | No | Default weekly hour target for Labor hours / `laborHours` payload (hours). | `40` |
| `LABOR_HOURS_PARTNER_WEEKLY_TARGET` | No | Weekly target when `clockifyUserCompany` matches a partner substring (hours). | `45` |
| `LABOR_HOURS_PARTNER_COMPANY_SUBSTRINGS` | No | CSV of case-insensitive substrings matched against `clockifyUserCompany` for partner target. | `ret,coherent,kforce` |
| `LABOR_HOURS_COMPANY_TARGETS_JSON` | No | JSON object: exact `clockifyUserCompany` name → weekly target hours (positive numbers only); name match is case-insensitive and overrides default/partner resolution. | *(empty)* |
| `LABOR_HOURS_EXCLUDED_PERSON_SUBSTRINGS` | No | CSV tokens; case-insensitive substring match on `userName` excludes that person from Labor hours tables and zero-hours chips. | *(empty)* |

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


# Harpin FOS Dashboard

**FOS** (Finance & Operations Snapshot) is a **Google Apps Script** web application that gives authorized Workspace users a single place to open **harpin AI Ops Dashboards**: a shell with navigation, spreadsheet-backed access control, an **Agreement Dashboard** view (Fibery-backed Agreement Management), and a **Utilization Management Dashboard** (Fibery-backed Labor Costs) — all aligned with the product baseline in `[docs/FOS-Dashboard-PRD.md](docs/FOS-Dashboard-PRD.md)`.

The app **reads and presents** data from configured sources (today: stub agreement payload; planned: Fibery, Sheets metric layers, and other connectors). It does **not** replace upstream systems of record (for example the Clockify → Fibery pipeline described in `[docs/PRD.md](docs/PRD.md)`).

---

## Current functionality


| Area              | Behavior                                                                                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Web App entry** | `doGet` serves either `**DashboardShell.html`** (authorized) or `**NotAuthorized.html**` (not listed, misconfiguration, or missing email under the deployment identity).                                                                                                                    |
| **Authorization** | Active user’s email is matched against a **Google Sheet** tab (default name `**Users`**) in a spreadsheet whose ID is stored in **Script Properties**. **Role** and **Team** come from that row and appear in the sidebar user chip.                                                        |
| **Server API**    | `getDashboardNavigation()` and `getAgreementDashboardData()` use `**requireAuthForApi_()`** so `google.script.run` cannot bypass the sheet gate.                                                                                                                                            |
| **Shell UI**      | Bootstrap **dark** layout: left nav (icons + labels), **Home** welcome copy, **Settings** (gear) at bottom of sidebar with a “coming soon” placeholder.                                                                                                                                     |
| **Agreement Dashboard** | Opens the **Agreement Management Dashboard** panel: harpin branding tokens (see agreement PRD §9.5–9.7), header, six KPI cards, **Attention items** panel, **Agreement status** + **Agreement type mix** donuts, **Revenue recognition** stacked bar, **Customer contract value** bar, **Customer relationship cards**, **Forward revenue pipeline**, tabbed **Financial performance** table, and the **D3 revenue-flow Sankey** (Status → Customer → Type). As of **v1.13.0** the panel header carries only the page title + subtitle — the in-panel harpin logo + separator divider were removed for cross-dashboard consistency; the sidebar `.fos-brand-logo` is now the single rendered brand mark across the entire web app. As of **v1.13.1** every server fetch (initial load, Refresh, background stale-refresh) surfaces a **semi-transparent loading overlay** with a centered animated spinner, and navigating away and back **no longer re-renders the panel** when the cached payload's `fetchedAt` matches what's already on screen — Chart.js + Sankey state is preserved across nav toggles. Live data is fetched from Fibery via the server (REST `/api/commands`, credentials in Script Properties `FIBERY_HOST` + `FIBERY_API_TOKEN`). The client uses **`sessionStorage`** key `fos_agreement_dashboard_v2` (no secrets in cache) and an **Auto-refresh** selector (5 / 10 / 30 min / Off, default 10 min, persisted in `localStorage`) that surfaces a **Stale** badge and refreshes in the background when the cache exceeds the TTL. Chart.js v4 and D3 v7 + d3-sankey are lazy-loaded from jsDelivr on first render. Internal route id is **`agreement-dashboard`** (DOM panel `#panel-agreement-dashboard`, activity-log Route field); the legacy `finance` route id was retired in **v1.11.0**, but historical `User Activity` rows tagged `Route = finance` and event type `finance_table_tab` remain queryable alongside new `agreement-dashboard` / `agreement_table_tab` rows. |
| **Operations (Utilization Management Dashboard)** | Opens the **Utilization Management Dashboard** panel (route id `operations`, DOM panel `#panel-operations`) introduced in **v1.12.0**, extended in **v1.13.0** with cross-filter drill-down + the Detail Table, polished in **v1.13.1** with a semi-transparent loading overlay + sticky panel render, and **extended in v1.14.0** with the **Phase C** surfaces: a **Utilization Alerts panel** above the KPI strip (under-utilized / over-allocated / stale approval rules from `src/utilizationAlerts.js`; rendered as collapsible groups, with the grouping axis switched from per-person (v1.16.0) to **per alert kind** in **v1.17.0** — Under-utilized · Over-allocated · Stale approvals — so managers can triage one class of issue at a time. Critical and single-alert groups default-expanded; others collapsed. A **Collapse all** pill in the panel header closes every group in one click), a **Person × Week heatmap** (top 30 contributors; **heatmap-local Role filter** distinct from the global Role multi-select; partial-week hatch overlay; cell click pins Person + switches range to the clicked week → server fetch), a **Pending Approvals widget** (cap 50, Show all toggle, amber / red age badges), and an off-canvas **row-detail drawer** with an **Open in Fibery →** deep link (as of **v1.15.0** the URL is composed from a server-supplied template — `FIBERY_PUBLIC_SCHEME` + `FIBERY_DEEP_LINK_HOST` (or `FIBERY_HOST`) + `FIBERY_LABOR_COST_PATH_TEMPLATE` — and the anchor is gated by a new **`fibery_access`** column on the Users sheet; users without the flag never receive the deep-link config and the anchor + footer are hidden). Reads `Agreement Management/Labor Costs` from Fibery through a paginated `/api/commands` query (date-filtered on `Start Date Time`), normalizes rows (coerces `Hours` from text, derives `week` / `isPending` / `isInternal` / `revenueFromLabor`), and returns the KPI strip (Total Hours, Billable Hours, Utilization %, Total Cost, Effective Bill Rate + coverage label, Pending Approvals) plus **six** Chart.js v4 surfaces: **Hours by Customer** (top-N bar), **Hours by Project** (top-N bar, colored by customer), **Weekly trend** (line), **Billable vs Non-billable** (stacked bar per week), **Hours by Role** (doughnut, Phase B), and **Hours by Person** (top-N bar, colored by primary role, Phase B). Global filter bar: date-range preset (default 90 days), **Customer / Project / Person / Role** multi-selects, **Billable** segmented toggle (All / Billable / Non-billable), **Internal labor** segmented toggle (Include / Exclude — removes rows where `isInternal = true` from every chart + KPI when set to Exclude), chip row with removable filters, **Clear filters** affordance. Every chart is a control surface: clicking a Customer / Project / Role / Person / Billable element toggles that value in the corresponding filter set. **Detail Table** (Phase B) below the charts shows the row-level entries matching the active filter — sortable columns (Date · Person · Customer · Project · Role · Hours · Cost · Bill rate · Approval), paginated 100 rows / page, Approval rendered as a colored pill. Cache: `sessionStorage` (`fos_utilization_dashboard_v1`, `cacheSchemaVersion: 1`) + `localStorage` TTL preference (`fos_utilization_dashboard_ttl_minutes_v1`, default 10 min); **filter state** persists across reloads in `localStorage` `fos_utilization_filters_v1` (schemaVersion 1; customers / projects / persons / roles / billable / internalLabor — `range` excluded by design). Script Properties: `UTILIZATION_CACHE_TTL_MINUTES`, `UTILIZATION_DEFAULT_RANGE_DAYS` (default 90), `UTILIZATION_MAX_RANGE_DAYS` (default 365), `UTILIZATION_WEEKLY_CAPACITY_HOURS` (default 40), `UTILIZATION_INTERNAL_COMPANY_NAMES` (CSV, default `harpin.ai,Harpin`), and the Top-N + bucket-threshold knobs. Phase C will add the Person × Week heatmap, Pending Approvals widget, and alerts panel. |
| **Other routes**  | **Delivery** still opens the shared **coming soon** modal.                                                                                                                                                                                                                                  |
| **Version**       | Sidebar footer and not-authorized page show **PRD version** from `FOS_PRD_VERSION` in `[src/Code.js](src/Code.js)` (must match the version line in `docs/FOS-Dashboard-PRD.md`).                                                                                                            |


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

In the Apps Script editor: **Project settings** → **Script properties** (or **File → Project properties** in the older UI). Add at least:


| Property                | Required | Description                                                |
| ----------------------- | -------- | ---------------------------------------------------------- |
| `AUTH_SPREADSHEET_ID`   | **Yes**  | Google Spreadsheet ID containing the authorized users tab. |
| `AUTH_USERS_SHEET_NAME` | No       | Tab name (default `**Users`**).                            |
| `AUTH_COL_EMAIL`        | No       | Email column header (default `**Email**`).                 |
| `AUTH_COL_ROLE`         | No       | Role column header (default `**Role**`).                   |
| `AUTH_COL_TEAM`         | No       | Team column header (default `**Team**`).                   |


The **Users** sheet must have a **header row** with those columns; each authorized user is one row with a Workspace **email** that matches `Session.getActiveUser().getEmail()` when the Web App runs as **User accessing the web app**.

Fibery and other API tokens belong in Script Properties as well when those connectors are implemented; **never** commit them to git.

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


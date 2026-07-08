# Harpin FOS Dashboard

**FOS** (Finance & Operations Snapshot) is a **Google Apps Script** web application that gives authorized harpin Workspace users a single place to review **ops, delivery, finance, and sales** metrics drawn from systems the company already uses (primarily **Fibery**, curated **Google Sheets**, and sync pipelines such as Clockify → Fibery).

**Current product version:** **2.22.0** (`FOS_PRD_VERSION` in [`src/Code.js`](src/Code.js))  
**Product PRD:** [`docs/FOS-Dashboard-PRD.md`](docs/FOS-Dashboard-PRD.md)  
**Feature map:** [`docs/features/000-overview.md`](docs/features/000-overview.md)

The app **reads and presents** data. It does **not** replace systems of record or upstream sync jobs (for example the Clockify ↔ Fibery work in [`docs/PRD.md`](docs/PRD.md)).

---

## What the solution is

FOS is a published **Apps Script Web App** (`DashboardShell.html`) with:

| Layer | What it does |
| --- | --- |
| **Authorization** | Matches the signed-in Google account to a **Users** sheet row (`AUTH_SPREADSHEET_ID`). Denied users see `NotAuthorized.html`. |
| **Role / team entitlements** | Sidebar routes and `google.script.run` APIs are gated by **Role** and **Team** (plus optional **`fibery_access`** for “Open in Fibery” links). |
| **Live dashboards** | Server modules fetch Fibery (or Sheets), normalize payloads, and the browser caches them in `sessionStorage` with configurable TTL. |
| **Historical mode** | A daily job writes dashboard JSON to **Google Drive**. Users can switch the sidebar **Data source** from **Live** to a dated snapshot and browse without Fibery calls. |
| **Admin Settings** | **ADMIN** users edit Script Properties, view usage analytics, and run operator actions (for example AI usage sync) from the in-app Settings panel. |
| **Mobile shell** | Below **768px**: bottom nav, data-source pill, filter bottom sheets, and mobile layouts for Home, Agreements, and Pipeline. |

App title in the browser: **harpin AI Ops Dashboards**.

---

## How clients access and use the dashboard

### Access

1. Open the **published Web App URL** for the FOS deployment (shared by harpin ops / your admin).
2. Sign in with a **Google Workspace** account that appears on the authorization **Users** sheet.
3. Deployment must run as **User accessing the web app** so Apps Script can resolve your email.

If your email is missing, blank, or the sheet is misconfigured, you see the **Access not granted** page (not the dashboard).

| Access rule | Who sees it |
| --- | --- |
| **Home**, **Operations** (Agreements, Utilization, Labor hours), **Delivery** | All authorized users |
| **Sales → Pipeline** | `Team = CLIENT-ENGAGEMENT`, or `Role = EXEC` / `ADMIN` |
| **Operations → Resource assignments** | Same as Pipeline (CLIENT-ENGAGEMENT / EXEC / ADMIN) |
| **Finance** (Portfolio P&L, Expenses, AI Usage) | `Team = FINANCE`, or `Role = EXEC` / `ADMIN` |
| **Settings** | `Role = ADMIN` only |
| **Open in Fibery** deep links | Users with truthy **`fibery_access`** on the Users sheet |

Admins control roster and entitlements in the auth spreadsheet; most Script Properties are editable in **Settings**.

### Day-to-day use

1. **Home** - Welcome, quick links (mobile), and a glance at agreement attention when Agreement data is already cached in the browser.
2. **Data source** (sidebar on desktop; top-bar pill on mobile) - Choose **Live data** or a **historical snapshot** date. Snapshot mode disables live Refresh / Fibery writes where applicable.
3. Open a dashboard from the left nav (or mobile bottom nav: Home, Agreements, Ops, Delivery, More).
4. Use **Refresh** when you need a fresh Fibery/Sheets pull (Live mode only, subject to that panel’s cache TTL).
5. Use filters, charts, tables, **Copy CSV**, and drill-downs as documented per panel below.
6. **ADMIN**: open **Settings** for environment keys, usage (last 30 days), App Versions registry, and AI usage sync controls.

Loading overlays show a **Source:** line (Live Fibery, Browser cache, Snapshot, Drive cache, Spreadsheet) so you know where the numbers came from.

---

## Features in the solution (by nav area)

Routes and panels below match `buildNavigationModel_()` in [`src/Code.js`](src/Code.js).

### Home

| Capability | Notes | Spec |
| --- | --- | --- |
| Welcome / hero | Brand shell; hero image embedded at first paint | [001](docs/features/001-dashboard-shell-navigation.md) |
| Mobile quick access + attention glance | Authorized shortcuts; agreement attention from browser cache | [029](docs/features/029-mobile-shell-phase-ab.md) |

### Sales

| Route | Capability | Spec |
| --- | --- | --- |
| **`pipeline`** | **Sales OS Pipeline**: Opportunity Tracker sheet merged with Fibery `HubSpot/Deal`; sheet wins stage/ACV (HubSpot deltas marked `*`); views Overview, Ex-Princess, All Deals, Concentration, Next Steps; HubSpot pipeline chips; Charts; Export CSV; historical `pipeline.json`; mobile filter sheets | [030](docs/features/030-sales-os-pipeline.md) · [016](docs/features/016-pipeline-dashboard.md) |

### Operations

| Route | Capability | Spec |
| --- | --- | --- |
| **`agreement-dashboard`** | **Agreements**: Fibery agreement KPIs, attention, charts, financial table, milestones modal, customer cards, forward revenue, revenue-flow Sankey; client cache | [003](docs/features/003-agreement-dashboard-fibery-client-cache.md) |
| **`operations`** | **Utilization**: Labor Costs KPIs, charts, filters, detail table (Company/Person/Role filters + CSV + filtered totals), alerts, Person × Week heatmap, row drawer + Fibery deep links | [005](docs/features/005-utilization-management-dashboard.md) · [026](docs/features/026-utilization-detail-table-filters-export.md) |
| **`labor-hours`** | **Labor hours**: ISO week picker, Over/Under/On/Zero (Active roster), project/task expand, CSV, print; reuses utilization labor rows | [007](docs/features/007-labor-hours-dashboard.md) |
| **`resource-assignments`** | **Resource assignments**: portfolio Resource Allocations by ISO week; heatmap; ending-soon / over-allocation alerts; By person / By project plan vs actual; CSV; snapshot `resource-assignments.json` | [027](docs/features/027-resource-assignment-dashboard.md) · [028](docs/features/028-resource-assignments-plan-vs-actual.md) |

### Delivery

| Route | Capability | Spec |
| --- | --- | --- |
| **`delivery`** | **Projects & P&L**: Active projects table, monthly P&L (table/chart), labor by role, allocated cost (plan) line, month modal + assignment variance, resource assignments modal, status updates (Live write to Fibery; snapshot read-only), delivery signals, portfolio margin Sankey, client filters | [006](docs/features/006-delivery-project-pnl.md) · [018](docs/features/018-agreement-status-updates-delivery-pnl.md) · [019](docs/features/019-resource-allocation-pnl-chart.md) · [020](docs/features/020-delivery-pnl-month-modal-allocation-variance.md) · [021](docs/features/021-pnl-allocated-line-color.md) · [024](docs/features/024-delivery-pnl-resource-assignments-modal.md) |
| **`revenue-review`** | **Revenue review**: Executive KPIs, tables (billing, variance, portfolio, overdue), milestone tree, customer drawer, CSV, print; shares Agreement cache | [008](docs/features/008-revenue-review-dashboard.md) |

### Finance

| Route | Capability | Spec |
| --- | --- | --- |
| **`portfolio-pnl`** | **Portfolio P&L**: Portfolio → Customer → Project grid (Subscription + Services), type filters, projected months, Drive daily cache + snapshot bundle, load **Source:** UX; negative cost/margin styling | [022](docs/features/022-portfolio-project-pnl.md) · [025](docs/features/025-portfolio-pnl-performance-and-load-source-ux.md) |
| **`expenses`** | **Expenses**: Spreadsheet-backed lines, Sankey, charts (department/category/software risk/submission cycle), filters, drilldown modal, CSV; snapshot `expenses.json` | [015](docs/features/015-expenses-dashboard.md) |
| **`ai-usage`** | **AI Usage**: Fibery Claude API Costs (Anthropic), filters, charts, CSV; Drive daily `ai-usage-cache/`; Refresh rebuilds from Fibery | [023](docs/features/023-ai-usage-dashboard.md) |

### Platform (cross-cutting)

| Capability | Spec |
| --- | --- |
| Shell navigation, branding, Settings link affordance | [001](docs/features/001-dashboard-shell-navigation.md) |
| Spreadsheet user authorization + Fibery access gate | [002](docs/features/002-spreadsheet-user-authorization.md) |
| User Activity logging | [004](docs/features/004-user-activity-logging.md) |
| Daily Drive historical snapshots (+ Expenses, Pipeline, Resource assignments, Portfolio P&L) | [009](docs/features/009-dashboard-historical-snapshots.md) |
| Live vs snapshot **Data source** selector | [010](docs/features/010-dashboard-historical-data-source.md) |
| ADMIN Settings (Script Properties) | [011](docs/features/011-admin-settings-environment-panel.md) |
| Settings usage analytics + collapsible groups | [012](docs/features/012-admin-settings-usage-analytics-collapsible.md) |
| App Versions registry + update banner (**Available** column) | [013](docs/features/013-app-versions-registry.md) |
| AI platform usage sync (Anthropic → Fibery) + Settings **Run sync now** | [017](docs/features/017-ai-platform-usage-fibery-sync.md) |
| Mobile shell Phase A + B | [029](docs/features/029-mobile-shell-phase-ab.md) |

### Planned (not yet shipped)

| Feature | Spec |
| --- | --- |
| Portfolio P&L Excel export | [031](docs/features/031-portfolio-pnl-excel-export.md) |
| Scenario Planning (R1) | [014](docs/features/014-scenario-planning.md) |
| AI usage: OpenAI ingest / allocation rules (beyond Anthropic) | [017](docs/features/017-ai-platform-usage-fibery-sync.md) |

---

## Feature specs index

Numbered files under [`docs/features/`](docs/features/). Prefer the overview for “what shipped”; use individual specs for acceptance detail.

| Doc | Scope |
| --- | --- |
| [000-overview.md](docs/features/000-overview.md) | Product overview and shipped-route summary |
| [001-dashboard-shell-navigation.md](docs/features/001-dashboard-shell-navigation.md) | Shell, navigation, `doGet` |
| [002-spreadsheet-user-authorization.md](docs/features/002-spreadsheet-user-authorization.md) | Users sheet, roles, `fibery_access` |
| [003-agreement-dashboard-fibery-client-cache.md](docs/features/003-agreement-dashboard-fibery-client-cache.md) | Agreements dashboard |
| [004-user-activity-logging.md](docs/features/004-user-activity-logging.md) | User Activity tab |
| [005-utilization-management-dashboard.md](docs/features/005-utilization-management-dashboard.md) | Utilization |
| [006-delivery-project-pnl.md](docs/features/006-delivery-project-pnl.md) | Delivery Projects & P&L |
| [007-labor-hours-dashboard.md](docs/features/007-labor-hours-dashboard.md) | Labor hours |
| [008-revenue-review-dashboard.md](docs/features/008-revenue-review-dashboard.md) | Revenue review |
| [009-dashboard-historical-snapshots.md](docs/features/009-dashboard-historical-snapshots.md) | Daily Drive snapshots |
| [010-dashboard-historical-data-source.md](docs/features/010-dashboard-historical-data-source.md) | Data source selector |
| [011-admin-settings-environment-panel.md](docs/features/011-admin-settings-environment-panel.md) | Settings Script Properties UI |
| [012-admin-settings-usage-analytics-collapsible.md](docs/features/012-admin-settings-usage-analytics-collapsible.md) | Settings usage analytics |
| [013-app-versions-registry.md](docs/features/013-app-versions-registry.md) | App Versions registry |
| [014-scenario-planning.md](docs/features/014-scenario-planning.md) | Scenario Planning (planned) |
| [015-expenses-dashboard.md](docs/features/015-expenses-dashboard.md) | Expenses |
| [016-pipeline-dashboard.md](docs/features/016-pipeline-dashboard.md) | Pipeline (base) |
| [017-ai-platform-usage-fibery-sync.md](docs/features/017-ai-platform-usage-fibery-sync.md) | AI usage sync |
| [018-agreement-status-updates-delivery-pnl.md](docs/features/018-agreement-status-updates-delivery-pnl.md) | Delivery status updates |
| [019-resource-allocation-pnl-chart.md](docs/features/019-resource-allocation-pnl-chart.md) | Allocated cost on P&L chart |
| [020-delivery-pnl-month-modal-allocation-variance.md](docs/features/020-delivery-pnl-month-modal-allocation-variance.md) | Month modal allocation variance |
| [021-pnl-allocated-line-color.md](docs/features/021-pnl-allocated-line-color.md) | Allocated line color |
| [022-portfolio-project-pnl.md](docs/features/022-portfolio-project-pnl.md) | Portfolio Project P&L |
| [023-ai-usage-dashboard.md](docs/features/023-ai-usage-dashboard.md) | AI Usage dashboard |
| [024-delivery-pnl-resource-assignments-modal.md](docs/features/024-delivery-pnl-resource-assignments-modal.md) | P&L resource assignments modal |
| [025-portfolio-pnl-performance-and-load-source-ux.md](docs/features/025-portfolio-pnl-performance-and-load-source-ux.md) | Portfolio load + Source labels |
| [026-utilization-detail-table-filters-export.md](docs/features/026-utilization-detail-table-filters-export.md) | Utilization detail filters + CSV |
| [027-resource-assignment-dashboard.md](docs/features/027-resource-assignment-dashboard.md) | Resource assignments |
| [028-resource-assignments-plan-vs-actual.md](docs/features/028-resource-assignments-plan-vs-actual.md) | Plan vs actual |
| [029-mobile-shell-phase-ab.md](docs/features/029-mobile-shell-phase-ab.md) | Mobile shell |
| [030-sales-os-pipeline.md](docs/features/030-sales-os-pipeline.md) | Sales OS pipeline |
| [031-portfolio-pnl-excel-export.md](docs/features/031-portfolio-pnl-excel-export.md) | Portfolio Excel export (planned) |

---

## Script properties (Apps Script project settings)

Configuration lives in **Project settings → Script properties** (`PropertiesService`). **ADMIN** users can edit most keys in the Web App **Settings** panel ([feature 011](docs/features/011-admin-settings-environment-panel.md)); the registry of labels, tooltips, and defaults is [`src/adminSettingsRegistry.js`](src/adminSettingsRegistry.js).

**PRD version** is **not** a Script Property: it is `FOS_PRD_VERSION` in [`src/Code.js`](src/Code.js) and must match [`docs/FOS-Dashboard-PRD.md`](docs/FOS-Dashboard-PRD.md) and every `src/*` header.

### Minimum to load the Web App

| Property | Required | Purpose | Typical default |
| --- |:---:| --- | --- |
| `AUTH_SPREADSHEET_ID` | **Yes** | Spreadsheet with the Users (and related) tabs | - |
| `AUTH_USERS_SHEET_NAME` | No | Authorized users tab | `Users` |
| `AUTH_COL_EMAIL` / `AUTH_COL_ROLE` / `AUTH_COL_TEAM` | No | Column headers | `Email` / `Role` / `Team` |
| `AUTH_COL_FIBERY_ACCESS` | No | Fibery deep-link gate column | `fibery_access` |

### Common connector keys

| Property | Required | Purpose |
| --- |:---:| --- |
| `FIBERY_HOST` | **Yes** (Fibery panels) | Workspace host for `/api/commands` (no scheme), e.g. `harpin-ai.fibery.io` |
| `FIBERY_API_TOKEN` | **Yes** (Fibery panels) | Server-only API token (never commit) |
| `FIBERY_PUBLIC_SCHEME` / `FIBERY_DEEP_LINK_HOST` | No | Browser deep-link composition |
| `FIBERY_LABOR_COST_PATH_TEMPLATE` | No | Labor Cost URLs (`{slug}`, `{publicId}`) |
| `FIBERY_AGREEMENT_PATH_TEMPLATE` | No | Agreement URLs |
| `FIBERY_COMPANY_PATH_TEMPLATE` | No | Companies URLs (Revenue review drawer) |
| `AUTH_USER_ACTIVITY_SHEET_NAME` | No | Activity log tab (default `User Activity`) |
| `AUTH_APP_VERSIONS_SHEET_NAME` | No | App Versions tab (default `App Versions`) |
| `USER_ACTIVITY_LOGGING_ENABLED` | No | Kill-switch (`false` / `no` / `0`) |

Panel-specific thresholds (Agreement, Utilization, Labor hours, Delivery, Pipeline, Expenses, AI usage, Portfolio, snapshots, Sales OS sheet IDs) are documented in the feature specs above and editable in **Settings**. **Never** commit tokens or spreadsheet IDs to git.

---

## Repository layout

| Path | Purpose |
| --- | --- |
| [`src/`](src/) | **Only** what **clasp** pushes (`.js`, `.html`, `appsscript.json`) |
| [`src/assets/`](src/assets/) | Binaries (favicon, Home hero); embed scripts write data URLs into `src/` |
| [`scripts/`](scripts/) | Embed helpers, Teamwork workflow utilities |
| [`docs/`](docs/) | PRDs and feature specs (**not** uploaded; see [`.claspignore`](.claspignore)) |
| [`.clasp.json`](.clasp.json) | Apps Script `scriptId` + `"rootDir": "src"` |

---

## Prerequisites

- Google account with Editor (or Owner) on the Apps Script project and access to the auth spreadsheet.
- **[clasp](https://github.com/google/clasp)** (`npm install -g @google/clasp`).
- Node.js (for `npm` / `npx` if clasp is not global).

---

## Instantiate the project (local + Apps Script)

### 1. Clone and log in

```bash
git clone <your-git-remote-url> FOSDashboard
cd FOSDashboard
clasp login
```

### 2. Connect to an Apps Script project

**Option A - Existing shared script:** ensure [`.clasp.json`](.clasp.json) has the correct `scriptId` and your user has Editor access.

**Option B - New project:** create a project at [script.google.com](https://script.google.com), copy **Script ID**, then:

```json
{
  "scriptId": "YOUR_SCRIPT_ID_HERE",
  "rootDir": "src"
}
```

```bash
clasp pull   # optional if remote is empty
clasp push
```

Only files under **`src/`** push; `README.md`, `docs/`, `.git/`, etc. stay local via [`.claspignore`](.claspignore).

### 3. Configure Script Properties

In Apps Script: **Project settings → Script properties**. Set at least `AUTH_SPREADSHEET_ID` and the Users-sheet headers. For live Fibery panels, set `FIBERY_HOST` and `FIBERY_API_TOKEN`. See [Script properties](#script-properties-apps-script-project-settings) and **Settings** in the Web App after you have an ADMIN user.

### 4. Deploy as a Web App

1. **Deploy → New deployment → Web app**.
2. **Execute as:** *User accessing the web app*.
3. **Who has access:** typically *Anyone within domain* (or your org’s policy).
4. Share the **Web App URL** with authorized users.
5. On first authorized load, the deployment can auto-register an **App Versions** row; set **Available = TRUE** (and preferred URL) when that deployment should drive the update banner ([013](docs/features/013-app-versions-registry.md)).

### 5. Optional operators (editors)

| Task | How |
| --- | --- |
| Install daily snapshot trigger | Run `installDailySnapshotTrigger()` / `ensureSnapshotDriveFolder()` (feature [009](docs/features/009-dashboard-historical-snapshots.md)) |
| AI usage sync | Daily trigger and/or Settings **Run sync now** ([017](docs/features/017-ai-platform-usage-fibery-sync.md)) |
| Snapshot diagnostics | `_diag_snapshotPreflight()`, `_diag_runSnapshotForDate('YYYY-MM-DD')` |

---

## Maintain the project

1. Edit under **`src/`** (or docs under `docs/` for product scope).
2. **`clasp push`** to upload.
3. Retest the Web App URL (or a Test deployment).
4. On every product change: bump [`docs/FOS-Dashboard-PRD.md`](docs/FOS-Dashboard-PRD.md), `FOS_PRD_VERSION` / `FOS_RELEASE_DESCRIPTION` in [`src/Code.js`](src/Code.js), and PRD version headers on all clasp-pushed `src/*` files (see [`.cursor/rules/google-apps-script-core.mdc`](.cursor/rules/google-apps-script-core.mdc)).

If someone edited code in the browser:

```bash
clasp pull
```

Review diffs carefully; pull overwrites matching local `src/` files.

| Command | Use |
| --- | --- |
| `clasp open` | Open the script project in the browser |
| `clasp deployments` | List deployments |
| `clasp version "message"` | Named version snapshot before deploy |
| `clasp logs` | Stream logs when enabled |

---

## Related documents

- [`docs/FOS-Dashboard-PRD.md`](docs/FOS-Dashboard-PRD.md) - main product PRD (FR/AC, changelog).
- [`docs/features/000-overview.md`](docs/features/000-overview.md) - shipped summary vs planned work.
- [`docs/agreement-dashboard-prd-v2.md`](docs/agreement-dashboard-prd-v2.md) - Agreement visuals / Fibery model notes.
- [`docs/PRD.md`](docs/PRD.md) - Clockify ↔ Fibery sync (related pipeline, separate product).
- [`docs/teamwork-workflow.md`](docs/teamwork-workflow.md) - Teamwork-first release workflow for this repo.

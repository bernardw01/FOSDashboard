# FinOps Performance Hub

**FinOps Performance Hub** (formerly harpin FOS / Finance & Operations Snapshot) is a **Google Apps Script** web application that gives authorized harpin Workspace users a **single pane of glass** for **ops, delivery, finance, and sales** performance. It aggregates curated metrics from systems the company already uses (primarily **Fibery**, **Google Sheets**, and sync pipelines such as Clockify → Fibery) and presents them with clear freshness indicators, role-based access, and optional historical browse.

**Current product version:** **2.26.0** (`FOS_PRD_VERSION` in [`src/Code.js`](src/Code.js))
**Product PRD:** [`docs/FOS-Dashboard-PRD.md`](docs/FOS-Dashboard-PRD.md)
**Feature map:** [`docs/features/000-overview.md`](docs/features/000-overview.md)
**Feature template:** [`docs/FEATURE_TEMPLATE.md`](docs/FEATURE_TEMPLATE.md)
**Teamwork workflow:** [`docs/teamwork-workflow.md`](docs/teamwork-workflow.md)

### Intent (what this product is)

| In scope | Out of scope |
| --- | --- |
| **Read and present** KPIs, tables, charts, and alerts from configured sources | Full BI / ad-hoc “slice any dimension” explorer |
| Google Workspace-native **published Web App** (HtmlService + `clasp`) | Replacing Fibery, Sheets, Clockify, or the ledger as system of record |
| Spreadsheet-based **authorization** (Role / Team / optional Fibery access) | Mobile-native apps (responsive web is the mobile surface) |
| **Live** Fibery/Sheets loads plus **historical Drive snapshots** and same-day Drive caches where shipped | Unscoped write-back to external systems (except explicitly specified features such as Delivery status updates) |
| Personal **Profile** for opt-in alert email digests and an in-app notification tray | SMS / push / Slack channels (v1) |

The app sits **alongside** upstream sync jobs; it does not replace them. Related Clockify ↔ Fibery sync product notes live in [`docs/PRD.md`](docs/PRD.md).

---

## What the solution is

FinOps Performance Hub is a published **Apps Script Web App** (`DashboardShell.html`) with:

| Layer | What it does |
| --- | --- |
| **Authorization** | Matches the signed-in Google account to a **Users** sheet row (`AUTH_SPREADSHEET_ID`). Denied users see `NotAuthorized.html` with distinct reason codes. |
| **Role / team entitlements** | Sidebar routes and `google.script.run` APIs are gated by **Role** and **Team** (plus optional **`fibery_access`** for “Open in Fibery” links). |
| **Live dashboards** | Server modules fetch Fibery (or Sheets), normalize payloads, and the browser caches them in `sessionStorage` with configurable TTL. **Agreements**, **Portfolio P&L**, and **AI Usage** also use same-day Drive caches; Portfolio cold builds continue in bounded server batches. |
| **Historical mode** | A daily job writes dashboard JSON to **Google Drive**. Users switch **Data source** from **Live** to a dated snapshot and browse without Fibery calls. Stale snapshot schemas can be upgraded via an operator job. |
| **Profile and notifications** | Every authorized user has a **Profile** panel (sidebar, above Settings) for opt-in **Hourly / Daily / Weekly** HTML alert digests; a header **bell** opens the in-app notification tray backed by a Notification Log. |
| **Admin Settings** | **ADMIN** users edit Script Properties, view usage analytics, manage App Versions, and run operator actions (AI usage sync, hourly digest) from Settings. |
| **Mobile shell** | Below **768px**: bottom nav, data-source pill, filter bottom sheets, and mobile layouts for Home, Agreements, Pipeline, Profile, and the notification tray. |

App title in the browser: **FinOps Performance Hub**.

---

## How clients access and use the dashboard

### Access

1. Open the **published Web App URL** for the FinOps Performance Hub deployment (shared by harpin ops / your admin).
2. Sign in with a **Google Workspace** account that appears on the authorization **Users** sheet.
3. Deployment must run as **User accessing the web app** so Apps Script can resolve your email.

If your email is missing, blank, or the sheet is misconfigured, you see the **Access not granted** page (not the dashboard).

| Access rule | Who sees it |
| --- | --- |
| **Home**, **Operations** (Agreements, Utilization, Labor hours), **Delivery**, **Profile**, notification bell | All authorized users |
| **Sales → Pipeline** | `Team = CLIENT-ENGAGEMENT`, or `Role = EXEC` / `ADMIN` |
| **Operations → Resource assignments** | Same as Pipeline (CLIENT-ENGAGEMENT / EXEC / ADMIN) |
| **Finance** (Portfolio P&L, Expenses, AI Usage) | `Team = FINANCE`, or `Role = EXEC` / `ADMIN` |
| **Settings** | `Role = ADMIN` only |
| **Open in Fibery** deep links | Users with truthy **`fibery_access`** on the Users sheet |

Admins control roster and entitlements in the auth spreadsheet (including optional **Profile** JSON on the Users tab). Most Script Properties are editable in **Settings**.

### Day-to-day use

1. **Home** - Welcome, quick links (mobile), and a glance at agreement attention when Agreement data is already cached in the browser.
2. **Data source** (sidebar on desktop; top-bar pill on mobile) - Choose **Live data** or a **historical snapshot** date. Snapshot mode disables live Refresh / Fibery writes where applicable.
3. Open a dashboard from the left nav (or mobile bottom nav: Home, Agreements, Ops, Delivery, More).
4. Use **Refresh** when you need a fresh Fibery/Sheets pull (Live mode only, subject to that panel’s cache TTL).
5. Use filters, charts, tables, **Copy CSV** / **Export Excel** (where shipped), and drill-downs as documented per panel below.
6. **Profile** (sidebar footer, above Settings) - Opt in to alert email digests; open the header **bell** to review and clear in-app notifications.
7. **ADMIN**: open **Settings** for environment keys, usage (last 30 days), App Versions registry, AI usage sync, and digest operator controls.

Loading overlays show a **Source:** line (Live Fibery, Browser cache, Snapshot, Drive cache, Spreadsheet) so you know where the numbers came from.

---

## Features in the solution (by nav area)

Routes and panels below match `buildNavigationModel_()` in [`src/Code.js`](src/Code.js) plus Profile / Settings affordances in the shell.

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
| **`portfolio-pnl`** | **Portfolio P&L**: Portfolio → Customer → Project grid (Subscription + Services), type filters, projected months, Drive daily cache + snapshot bundle, load **Source:** UX; negative cost/margin styling; **Export Excel** with row outline groups | [022](docs/features/022-portfolio-project-pnl.md) · [025](docs/features/025-portfolio-pnl-performance-and-load-source-ux.md) · [031](docs/features/031-portfolio-pnl-excel-export.md) |
| **`expenses`** | **Expenses**: Spreadsheet-backed lines, Sankey, charts (department/category/software risk/submission cycle), filters, drilldown modal, CSV; snapshot `expenses.json` | [015](docs/features/015-expenses-dashboard.md) |
| **`ai-usage`** | **AI Usage**: Fibery Claude API Costs (Anthropic), filters, charts, CSV; Drive daily `ai-usage-cache/`; Refresh rebuilds from Fibery | [023](docs/features/023-ai-usage-dashboard.md) |

### Account and notifications

| Capability | Notes | Spec |
| --- | --- | --- |
| **Profile** (`#panel-profile`) | Sidebar identity above Settings; opt-in fine-grained alert subscriptions (Hourly / Daily / Weekly); preferences on Users-tab **Profile** JSON | [033](docs/features/033-user-profile-alert-email-notifications.md) |
| **Notification tray** | Header bell + slide-out list; dismiss per item; backed by Notification Log | [033](docs/features/033-user-profile-alert-email-notifications.md) |
| **Email digests** | HTML digests with deep links for subscribed Agreement + Utilization alerts; scheduled jobs (+ ADMIN Run hourly now) | [033](docs/features/033-user-profile-alert-email-notifications.md) |

### Platform (cross-cutting)

| Capability | Spec |
| --- | --- |
| Shell navigation, branding, Settings / Profile affordances | [001](docs/features/001-dashboard-shell-navigation.md) |
| Spreadsheet user authorization + Fibery access gate | [002](docs/features/002-spreadsheet-user-authorization.md) |
| User Activity logging | [004](docs/features/004-user-activity-logging.md) |
| Daily Drive historical snapshots (+ Expenses, Pipeline, Resource assignments, Portfolio P&L) and schema upgrade for stale dates | [009](docs/features/009-dashboard-historical-snapshots.md) |
| Live vs snapshot **Data source** selector | [010](docs/features/010-dashboard-historical-data-source.md) |
| ADMIN Settings (Script Properties) | [011](docs/features/011-admin-settings-environment-panel.md) |
| Settings usage analytics + collapsible groups | [012](docs/features/012-admin-settings-usage-analytics-collapsible.md) |
| App Versions registry + update banner (**Available** column) | [013](docs/features/013-app-versions-registry.md) |
| AI platform usage sync (Anthropic → Fibery) + Settings **Run sync now** | [017](docs/features/017-ai-platform-usage-fibery-sync.md) |
| Mobile shell Phase A + B | [029](docs/features/029-mobile-shell-phase-ab.md) |
| User Profile + alert email notifications + notification tray | [033](docs/features/033-user-profile-alert-email-notifications.md) |
| Live Agreement warm cache, Delivery Agreement reuse, Portfolio continuation builds | [034](docs/features/034-live-dashboard-warm-cache-and-portfolio-batching.md) |

### Planned (not yet shipped)

| Feature | Spec |
| --- | --- |
| FinOps Ask (panel-scoped AI Q&A) | [032](docs/features/032-finops-ai-ask-panel.md) |
| Scenario Planning (R1) | [014](docs/features/014-scenario-planning.md) ([plan](docs/features/014-scenario-planning-implementation-plan.md)) |
| AI usage: OpenAI ingest / allocation rules (beyond Anthropic) | [017](docs/features/017-ai-platform-usage-fibery-sync.md) ([plan](docs/features/017-ai-platform-usage-fibery-sync-implementation-plan.md)) |

---

## Feature specs index

Numbered files under [`docs/features/`](docs/features/). Prefer the [overview](docs/features/000-overview.md) for “what shipped”; use individual specs for acceptance detail. Implementation plans (where present) sit beside the matching `0NN-*.md` file.

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
| [009-dashboard-historical-snapshots.md](docs/features/009-dashboard-historical-snapshots.md) | Daily Drive snapshots + schema upgrade |
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
| [031-portfolio-pnl-excel-export.md](docs/features/031-portfolio-pnl-excel-export.md) | Portfolio Excel export |
| [032-finops-ai-ask-panel.md](docs/features/032-finops-ai-ask-panel.md) | FinOps Ask (planned) |
| [033-user-profile-alert-email-notifications.md](docs/features/033-user-profile-alert-email-notifications.md) | Profile + alert emails + tray |
| [034-live-dashboard-warm-cache-and-portfolio-batching.md](docs/features/034-live-dashboard-warm-cache-and-portfolio-batching.md) | Live warm cache + Portfolio continuation batches |

Supporting / engineering notes (not full feature specs): [017 Fibery schema API](docs/features/017-fibery-schema-api.md), [017 Fibery schema setup](docs/features/017-fibery-schema-setup.md), [017 phase-0 gap memo](docs/features/017-phase0-gap-memo.md).

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
| `AUTH_COL_PROFILE` | No | Per-user Profile JSON (notifications) | `Profile` |

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

Panel-specific thresholds (Agreement, Utilization, Labor hours, Delivery, Pipeline, Expenses, AI usage, Portfolio, snapshots, Sales OS sheet IDs, notification jobs) are documented in the feature specs above and editable in **Settings**. **Never** commit tokens or spreadsheet IDs to git.

---

## Repository layout

| Path | Purpose |
| --- | --- |
| [`src/`](src/) | **Only** what **clasp** pushes (`.js`, `.html`, `appsscript.json`) |
| [`src/assets/`](src/assets/) | Binaries (favicon, Home hero); embed scripts write data URLs into `src/` |
| [`scripts/`](scripts/) | Embed helpers, Teamwork workflow utilities |
| [`docs/`](docs/) | PRDs and feature specs (**not** uploaded; see [`.claspignore`](.claspignore)) |
| [`docs/teamwork-manifest.json`](docs/teamwork-manifest.json) | Teamwork project ids, notebooks, release tasks |
| [`.clasp.json`](.clasp.json) | Apps Script `scriptId` + `"rootDir": "src"` |
| [`.cursor/rules/`](.cursor/rules/) | Cursor agent rules (PRD versioning, snapshots, mobile, Teamwork) |

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
| Upgrade stale snapshot schemas | `_diag_listStaleSnapshots()` / `_diag_startSnapshotSchemaUpgrade()` ([009](docs/features/009-dashboard-historical-snapshots.md)) |
| AI usage sync | Daily trigger and/or Settings **Run sync now** ([017](docs/features/017-ai-platform-usage-fibery-sync.md)) |
| Alert email digests | Hourly / Daily / Weekly jobs + Settings **Run hourly now** ([033](docs/features/033-user-profile-alert-email-notifications.md)) |
| Snapshot diagnostics | `_diag_snapshotPreflight()`, `_diag_runSnapshotForDate('YYYY-MM-DD')` |

---

## Maintain the project

1. Edit under **`src/`** (or docs under `docs/` for product scope).
2. **`clasp push`** to upload.
3. Retest the Web App URL (or a Test deployment).
4. On every product change: bump [`docs/FOS-Dashboard-PRD.md`](docs/FOS-Dashboard-PRD.md), `FOS_PRD_VERSION` / `FOS_RELEASE_DESCRIPTION` in [`src/Code.js`](src/Code.js), and PRD version headers on all clasp-pushed `src/*` files (see [`.cursor/rules/google-apps-script-core.mdc`](.cursor/rules/google-apps-script-core.mdc)).
5. For customer-facing features: follow [`docs/teamwork-workflow.md`](docs/teamwork-workflow.md) (Teamwork notebook + release task; sync to `docs/features/` at approval and ship).

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

### Product and features

- [`docs/FOS-Dashboard-PRD.md`](docs/FOS-Dashboard-PRD.md) - main product PRD (FR/AC, changelog).
- [`docs/features/000-overview.md`](docs/features/000-overview.md) - shipped summary vs planned work.
- [`docs/FEATURE_TEMPLATE.md`](docs/FEATURE_TEMPLATE.md) - template for new feature notebooks / specs.
- [`docs/agreement-dashboard-prd-v2.md`](docs/agreement-dashboard-prd-v2.md) - Agreement visuals / Fibery model notes.
- [`docs/release-highlights-since-2.8.md`](docs/release-highlights-since-2.8.md) - narrative release highlights since v2.8.

### Process and adjacent products

- [`docs/teamwork-workflow.md`](docs/teamwork-workflow.md) - Teamwork-first release workflow for this repo.
- [`docs/teamwork-manifest.json`](docs/teamwork-manifest.json) - notebook and release-task ids.
- [`docs/PRD.md`](docs/PRD.md) - Clockify ↔ Fibery sync (related pipeline, separate product).
- [`docs/financial_scenario_modeling_prd.md`](docs/financial_scenario_modeling_prd.md) - scenario / FP&A modeling notes (feeds planned feature [014](docs/features/014-scenario-planning.md)).
- [`docs/ai-spend-impact-measurement.md`](docs/ai-spend-impact-measurement.md) - AI spend impact measurement guide (related to [017](docs/features/017-ai-platform-usage-fibery-sync.md) / [023](docs/features/023-ai-usage-dashboard.md)).

### Engineering conventions

- [`docs/cursor-apps-script-rules.md`](docs/cursor-apps-script-rules.md) - Apps Script conventions for this codebase.
- [`.cursor/rules/google-apps-script-core.mdc`](.cursor/rules/google-apps-script-core.mdc) - PRD version bump + `src/` header sync.
- [`.cursor/rules/dashboard-snapshot-cache-sync.mdc`](.cursor/rules/dashboard-snapshot-cache-sync.mdc) - live cache ↔ historical snapshot alignment.
- [`.cursor/rules/mobile-ui-shell.mdc`](.cursor/rules/mobile-ui-shell.mdc) - mobile accommodations for shell UI.
- [`.cursor/rules/teamwork-product-workflow.mdc`](.cursor/rules/teamwork-product-workflow.mdc) - Teamwork ↔ git sync rules.
- [`.cursor/rules/documentation-style.mdc`](.cursor/rules/documentation-style.mdc) - docs style (no em dashes).

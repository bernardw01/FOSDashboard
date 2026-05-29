# Overview

> **PRD version 2.6.4** — see `docs/FOS-Dashboard-PRD.md` (must match `src/` file headers and `FOS_PRD_VERSION` in `Code.js`).

## Goal

Ship the **Harpin FOS (Finance & Operations Snapshot) Dashboard**: a **Google Apps Script** Web App (HtmlService) that gives authorized Workspace users one place to see **key metrics, KPIs, and financial performance** aggregated from harpin’s existing tools (for example curated **Google Sheets** metric layers, **Fibery**, **Clockify**, accounting APIs, and other connectors as we add them).

The dashboard **reads and presents** data; it sits alongside—does not replace—pipelines that move data into systems of record (for example Clockify → Sheets → Fibery sync work documented in `docs/PRD.md`).

Requirements baseline: **`docs/FOS-Dashboard-PRD.md`**.

**Shipped:** **v2.6.4** — **Home** hero uses canonical `src/assets/home-hero-deap.png` (embed script + docs). **v2.6.3** — **Home** hero quote card restored above welcome panel. **v2.6.2** — Delivery **P&L** projected months use milestone **Target Amount**; lifetime total shows recognized + forecast. **v2.6.1** — **Sales** group (Pipeline) visible to **CLIENT-ENGAGEMENT** team / **EXEC** / **ADMIN**; **Finance** group (Expenses) visible to **FINANCE** team / **EXEC** / **ADMIN**. **v2.6.0** — **[Pipeline dashboard](016-pipeline-dashboard.md)**: new **Sales** nav group (beneath Home) with a **Pipeline** route (`#panel-pipeline`) reading **`HubSpot/Deal`** from Fibery via `src/pipelineDashboard.js`; view tabs, KPI strip, deals-by-stage accordion, revenue-by-quarter chart, funnel, Export CSV; Fibery-access gated; `pipeline_*` activity types. **v2.5.8** — Global loading modal, Expenses drilldown modal table, Sankey terminal labels left of final nodes. **v2.5.7** — Expenses customer table under Sankey; risk MoM zero when prior month zero. **v2.5.6** — Expenses **software vendor risk map** with month slider. **v2.5.5** — Expenses side-by-side monthly charts, **software × vendor** chart. **v2.5.4** — Labor hours **Company** multi-select filter; zero-hours roster fix (60-day fetch). **v2.5.3** — Utilization **Last 60 days** default; Expenses **Clear all filters** + Finance/**ADMIN** access gate. **v2.5.2** — **Expenses** Sankey + checkbox filters (`route id = expenses`): department + category stacked charts (Chart.js), customer rollup, filters, shared `.fos-util-drawer` drill-down, `getExpensesDashboardData` / `src/expensesDashboard.js`, live-only under historical snapshots (FR-105). Prior: **v2.4.1** — Agreement / Delivery **Sankey** full-width layout (right labels outside nodes). **[App Versions registry](013-app-versions-registry.md)** — **v2.4.0** auth spreadsheet **App Versions** tab; auto-register releases; update banner when not on latest; ADMIN registry in Settings. **[Admin settings — usage analytics & collapsible groups](012-admin-settings-usage-analytics-collapsible.md)** — **v2.3.0** Settings **Usage** section (30-day route + user tables, stacked chart from User Activity); all config groups collapsible (collapsed by default). **[Admin settings environment panel](011-admin-settings-environment-panel.md)** — **v2.2.0** ADMIN-only Settings UI for Script Properties (grouped, tooltips, use-default toggles). **[Historical data source selector](010-dashboard-historical-data-source.md)** — **v2.1.0** sidebar Live vs snapshot; all dashboards from Drive bundle without Fibery until Live is selected. **[Dashboard historical snapshots](009-dashboard-historical-snapshots.md)** — **v2.0.0** daily Drive snapshot job (Agreement, Utilization, Delivery list, per-project P&L); historical date UI later. **[Labor Hours Dashboard](007-labor-hours-dashboard.md)** — **v1.22.0** Phase A, **v1.23.0** Phase B (zero KPI, KPI scroll, company JSON, exclusions), **v1.24.0** Phases **C–D** (expandable project/task breakdown, Copy CSV, print, `labor_hours_*` activity types). **[Revenue review](008-revenue-review-dashboard.md)** — **v1.25.0** Phases **A–B** (Delivery nav group, `#panel-revenue-review`, Agreement cache + KPI strip, expiry + pre-recognition); **v1.26.0** Phases **C–D** (tables, sort, CSV, print, milestone `<details>` drill-down, `revenue_review_*` events beyond refresh); **v1.27.0** Phase **E** (customer-first milestone grouping, revenue-by-customer row drawer, Fibery Companies deep link + `publicId` on companies query).

**Planned:** Optional **Revenue review** Phase E (HTML snapshot export) or PRD FR/AC lift per [008](008-revenue-review-dashboard.md).

## Non-goals

- **Full BI / ad-hoc analytics** (no generic explorer for arbitrary dimensions in v1).
- **System of record** for money or time (no replacing the ledger or sync destinations).
- **Write-back** from the dashboard into external systems (unless explicitly scoped later).
- **Non–Workspace-first hosting** (v1 is Apps Script + published Web App).

## Definition of Done

- Published Web App loads for **allowed-domain** users with a stable **dashboard shell** (layout, sections, loading/error states).
- At least one **end-to-end metric path** works server-side (e.g. Sheets-backed or one API connector), with **freshness** or “last updated” surfaced in the UI.
- **Manual refresh** (and/or scheduled snapshot refresh, if implemented) completes within Apps Script limits and updates the UI without exposing secrets to the client.
- **Operational visibility**: admins can see whether a refresh succeeded or which connector failed (e.g. log sheet or equivalent), without secrets in logs.
- Source managed with **clasp** (`rootDir: src`); **`clasp push`** / **`clasp pull`** documented for the team.

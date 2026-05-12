# Harpin FOS Dashboard (Google Workspace Web App)

**PRD version 1.9.2** — `src/Code.js` constant `FOS_PRD_VERSION` and all `src/*` file headers MUST match the version line below.

Product Requirements Document

Version 1.9.2 - 2026-05-11

## 1) Overview

### Purpose

Build a **Google Apps Script**–hosted web application—the **Harpin FOS (Finance & Operations Snapshot) Dashboard**—that gives authorized harpin users a single place to see **key metrics, KPIs, and financial performance** drawn from the systems the company already uses (for example time and labor, agreements and delivery data, and accounting). The dashboard complements point integrations (such as Clockify → Fibery sync) by **aggregating and presenting** cross-system signals rather than replacing those pipelines.

### Product Vision

Provide a **lightweight, Google Workspace–native** experience that:

- authenticates users in the harpin Google Workspace domain and **authorizes** them against a **maintained Google Sheet** (users tab) before showing any dashboard UI,
- loads curated metrics and summaries from configured APIs and/or Google Sheets “metric store” layers,
- presents a clear, scannable layout with optional drill-down where data allows,
- refreshes on a sensible cadence (manual refresh, scheduled server refresh, or both),
- for the **Finance / agreement** view, reads **live Fibery** data through the server (no persistent server-side cache of that payload) while allowing a **browser-side cache** for responsiveness and an explicit **Refresh** action,
- stays maintainable as new data sources and KPIs are added.

### Goals

- **Single pane of glass** for leadership and finance/ops stakeholders on agreed KPIs.
- **No local runtime**—deploy as a published Web App bound to an Apps Script project.
- **Secure by default**: domain restriction, least-privilege service accounts or OAuth patterns as appropriate per connector, secrets in Script Properties or Secret Manager–compatible patterns.
- **Observable operations**: structured logs, last-success timestamps, and clear error surfaces for admins.
- **Extensible architecture**: separate modules for auth shell, data fetch, normalization, and presentation.
- **Brand-aligned UI**: consistent with harpin presentation standards (typography, color, layout patterns established on other internal Web Apps).

### Out of Scope (v1)

- Full **business intelligence** or ad-hoc query builder (no generic “slice any dimension” explorer in v1).
- **Authoritative ledger or ERP replacement**—the dashboard reads from sources of record; it does not become the system of record for financial transactions.
- **Write-back** to external systems from dashboard actions (except explicitly scoped future features).
- **Non–Google Workspace** primary hosting (the product is defined as Apps Script + HtmlService Web App).
- **Mobile-native apps** (responsive web is sufficient for v1).

## 2) Users and Use Cases

### Primary Users

- **Executive and leadership** users who need periodic snapshots of revenue, margin, utilization, cash, or other agreed KPIs.
- **Finance and operations** staff who monitor performance against plan and need trustworthy freshness indicators.
- **Internal admins** who configure data sources, thresholds, and access.

### Core Use Cases

- Open the published dashboard only after the system confirms the user appears on the **authorized users** sheet with a defined **role** and **team**; otherwise see a **not authorized** page.
- Open the published dashboard and see **today’s or period’s** KPI snapshot without hunting across tools.
- **Refresh** metrics on demand and understand **when data was last updated** and from which source.
- Compare **actual vs plan** (or prior period) where those series exist in the metric layer.
- **Troubleshoot** a stale or failed panel using admin-visible logs or status (without exposing secrets).

## 3) Functional Requirements

Each numbered **FR**, **AC** (Acceptance Criteria), and **NFR** (Non-Functional Requirements) item carries a status tag:

| Tag | Meaning |
| --- | --- |
| **[Released]** | Implemented in the current Apps Script project (including Web App deployment behaviors). |
| **[In-Progress]** | Partially implemented or not yet validated end-to-end. |
| **[Backlog]** | Not yet implemented. |

As of **version 1.9.2**, spreadsheet authorization (FR-05–FR-08a), shell navigation affordances (FR-10a–FR-10b), **whole-app branding contract to `agreement-dashboard-prd-v2.md` §9.5–§9.7 (FR-50)**, **Fibery Agreement Management data contract (`## 6)`)**, **agreement dashboard with live Fibery data, configurable client-side TTL, attention panel, four Chart.js charts, and the financial performance table (`## 7)`, FR-52–FR-56b)**, and **user activity logging (`## 3.8`, FR-60–FR-66)** are documented; acceptance criteria through **AC-19** are tracked; implementation status follows each **[Released]** / **[Backlog]** tag.

### 3.1 Access, Identity, and Configuration

- FR-01 **[Backlog]**: The Web App MUST restrict access to users in the **harpin Google Workspace** domain (or an explicitly configured allowlist of domains) consistent with Apps Script execution identity and deployment settings, **in addition to** spreadsheet-based authorization (FR-05–FR-08).
- FR-02 **[Backlog]**: The system MUST store non-secret configuration (feature flags, sheet IDs, tab names, API base URLs, **authorization sheet column names**) in **Script Properties** or an equivalent documented store; secrets MUST NOT be committed to source control.
- FR-03 **[Backlog]**: The system MUST fail fast with operator-readable errors when required configuration is missing for a given panel or connector.
- FR-04 **[Backlog]**: The solution SHOULD support a minimal **environment** or **tier** concept (`dev` / `prod`) for separate Script Properties sets if multiple deployments are used.
- FR-05 **[Released]**: The system MUST read **authorized users** from a designated **Google Sheet** tab (default name **`Users`**, overridable via Script Property **`AUTH_USERS_SHEET_NAME`**) within a spreadsheet identified by **`AUTH_SPREADSHEET_ID`** stored in Script Properties.
- FR-06 **[Released]**: The first row of the users tab MUST be a **header row** with stable column names. The system MUST resolve the active user by **email** using a configurable column (default **`Email`**) with **case-insensitive** comparison after **trimming** whitespace.
- FR-07 **[Released]**: When a row matches the active user, the system MUST read **`Role`** and **`Team`** from that row using configurable column names (defaults **`Role`**, **`Team`**). These values MUST drive server-side navigation filtering and future dashboard entitlements; the client MUST NOT be the source of truth for role or team.
- FR-08 **[Released]**: When the active user **does not** appear in the users tab (or email is empty / cannot be resolved under **Execute as: User accessing the web app**), the system MUST respond with a dedicated **not authorized** HtmlService page (no main dashboard shell, no embedded metrics, no `google.script.run` exposure of privileged data for that session beyond the error page itself).
- FR-08a **[Released]**: Every **server function** invokable via `google.script.run` that returns or mutates sensitive data MUST **re-verify** authorization using the same rules as `doGet` (or a shared helper), so bypassing the initial HTML load cannot grant access.

### 3.2 Dashboard Shell and Navigation

- FR-10 **[Backlog]**: The published UI MUST provide a **dashboard shell**: title, optional period selector (e.g. month/quarter), and a consistent content grid for KPI cards and sections.
- FR-10a **[Released]**: Primary **left navigation** entries MUST show a **familiar icon** beside each dashboard label (implemented: **Bootstrap Icons** via CDN, mapped by route id: Home, Finance, Operations, Delivery).
- FR-10b **[Released]**: The **bottom of the left sidebar** MUST expose **Settings** with a **gear** icon (replacing the prior **Profile** control), **rendered as a plain navigation-style link** (e.g. an `<a>` with the same `.fos-nav-btn` chrome used by the dashboard entries — no outlined or pill button styling); until the settings surface exists, the control MUST keep the same **coming soon** placeholder behavior as other inactive destinations, and the click handler MUST `preventDefault()` so a placeholder `href="#"` does not push a hash onto the URL.
- FR-11 **[Backlog]**: The shell MUST display **data freshness** per section or globally (e.g. “Last updated: … UTC”) when the server provides that metadata.
- FR-12 **[Backlog]**: Server-invoked actions from the UI (e.g. refresh) MUST use `google.script.run` (or documented successor) with clear loading and completion states.
- FR-13 **[Backlog]**: The layout MUST be **responsive** for desktop-first use; primary content SHOULD be centered with a sensible max width and accessible contrast.

### 3.3 Data Acquisition and Metric Layer

- FR-20 **[Backlog]**: The system MUST support reading **normalized metric definitions** from a documented location (recommended: Google Sheets “metric catalog” tab or structured JSON in Drive) describing id, label, unit, source, and refresh policy.
- FR-21 **[Backlog]**: The system MUST support at least one **server-side** aggregation path: pull from **Google Sheets** tables maintained by existing processes (including ETL or sync jobs such as Clockify → Sheets → Fibery pipelines) without requiring the browser to hold service credentials.
- FR-22 **[Backlog]**: The system SHOULD support additional connectors behind a shared interface (e.g. **Fibery** query, **Clockify** summary, **accounting API**) with per-connector rate limiting and timeouts.
- FR-23 **[Backlog]**: Each connector MUST emit structured results: **success**, **partial** (degraded panel), or **failed** with a safe user message and detailed server log.
- FR-24 **[Backlog]**: Long-running refreshes MUST be **bounded** (chunking, batching, or async continuation patterns) to remain within Apps Script execution limits.
- FR-25 **[Backlog]**: Any **Fibery** read path used for agreement, revenue, or portfolio surfaces MUST conform to **`## 6) Fibery data model requirements (Agreement Management)`** (field paths, databases, and enum semantics). If a workspace diverges, the connector or mapping layer MUST be updated and this PRD’s §6 SHOULD be revised in the same release.

### 3.4 KPI Presentation

- FR-30 **[Backlog]**: The UI MUST render a **KPI card** pattern: label, primary value, optional delta vs comparison period, and optional sparkline or mini-chart when data is available.
- FR-31 **[Backlog]**: Numeric formatting MUST respect **locale-appropriate** grouping and currency/percent units declared in the metric definition.
- FR-32 **[Backlog]**: Panels with missing or failed data MUST show an explicit **empty or error state**, not a misleading zero.
- FR-33 **[Backlog]**: The UI SHOULD support **grouping** (e.g. “Revenue”, “Delivery”, “People & utilization”, “Cash & liquidity”) driven by configuration.

### 3.5 Operations and Observability

- FR-40 **[Backlog]**: The system MUST append or write **structured execution logs** for refresh cycles (timestamp, operation, duration, per-source counts, errors) to a dedicated **log sheet** or consolidated log mechanism documented for admins.
- FR-41 **[Backlog]**: Admins MUST be able to determine **which connector failed** and whether the user-visible dashboard is partial or stale.
- FR-42 **[Backlog]**: Optional **time-driven triggers** SHOULD refresh a cached snapshot on a schedule, with manual refresh still available in the Web App.

### 3.6 Branding and Documentation

- FR-50 **[Released]**: The published HTML UI MUST follow **`agreement-dashboard-prd-v2.md` §9.5 (Design System)**, **§9.6 (Brand Identity)**, and **§9.7 (Layout)** across the **entire** application surface — sidebar, topbar, Home view, modals, not-authorized page, and Finance / agreement panel — using a single set of root CSS variables (`--bg #061B30`, `--surface #092747`, `--surface2 #0d2e4a`, `--border #1a4060`, `--accent #52C9E5`, `--accent2 #007FA7`, `--accent3 #20B4C4`, `--accent4 #43D6BA`, `--text #FFFEFC`, `--text-muted #A0AEC0`, `--text-dim #2a5a7a`, `--danger #fc5c65`) and the **Inter** typeface at **14px** base. Surface-specific tokens (e.g. the `--ag-*` family inside `.fos-agreement-root`) MUST resolve to those root variables via aliases rather than introduce parallel palettes. The **Finance / agreement** surface additionally MUST meet **`## 7)`** subsection **7.2** for header / KPI semantics.
- FR-51 **[Released]**: The Web App SHOULD display the **current PRD version** (this document’s version string) so stakeholders can align feedback with the documented baseline (sidebar footer + not-authorized page; `FOS_PRD_VERSION` in `src/Code.js` must match this document’s version line).

### 3.7 Agreement dashboard (Fibery + client cache)

- FR-52 **[Released]**: The **Finance / agreement** dashboard MUST fetch portfolio data from **Fibery** only through **authorized** `google.script.run` server handlers; it MUST **not** use a **persistent server-side datastore** (Script Properties, Sheet snapshots, or Drive files) whose purpose is to cache Fibery dashboard payloads for serving this view—**Fibery remains authoritative** for that slice. Server queries use Fibery's REST **`/api/commands`** (batched `fibery.entity/query`) via `UrlFetchApp` with credentials read from Script Properties **`FIBERY_HOST`** and **`FIBERY_API_TOKEN`**; neither value is ever returned to the client.
- FR-53 **[Released]**: The client MUST support a **browser-side cache** (e.g. `sessionStorage` or `localStorage`) of the last successful normalized dashboard JSON, keyed by a **schema version**, so repeat views avoid redundant Fibery round-trips until **Refresh** (or the configured TTL elapses, per FR-56b). Cache key: **`fos_agreement_dashboard_v2`**; `cacheSchemaVersion: 2`.
- FR-54 **[Released]**: The agreement dashboard UI MUST expose a visible **Refresh** control that re-invokes the server fetch, updates the client cache on success, and shows **loading**, **error**, and **last refreshed** states derived from server timestamps.
- FR-55 **[Released]**: Visual design for the agreement dashboard MUST follow **`## 7) Agreement revenue dashboard`** (subsection **7.2**) and the **branding tokens** in `agreement-dashboard-prd-v2.md` **§9.5–§9.7** and **§9.6** (deep navy surfaces, cyan/teal accents, **Inter**, `logo.svg` at 32px with separator, danger red reserved for errors and negative margin signals).
- FR-56 **[Released]**: Charts, tables, KPI semantics, and color thresholds MUST match **`agreement-dashboard-prd-v2.md` §7–§8** for the in-scope **Phase A** widgets — KPI strip (§7.2), Attention Items panel (§7.7), Agreement Status Donut (§7.3), Agreement Type Mix Donut (§7.10), Revenue Recognition Progress stacked bar (§7.9), Customer Contract Value bar (§7.4), and Financial Performance Table (§7.5). The Customer Relationship Cards (§7.6), Forward Revenue Pipeline (§7.8), and Revenue Flow Sankey (§7.11) remain **[Backlog]**. Implementation uses **Chart.js v4** from the jsDelivr CDN, lazy-loaded the first time the Finance panel renders.
- FR-56a **[Released]**: §8 thresholds and color maps MUST be defined as code constants with optional **Script Property overrides**: `AGREEMENT_THRESHOLD_LOW_MARGIN` (default 35), `AGREEMENT_THRESHOLD_INTERNAL_LABOR` (default 5000), `AGREEMENT_THRESHOLD_EXPIRY_DAYS` (default 60), `AGREEMENT_TOP_N_RECOGNITION_BARS` (default 10), and `AGREEMENT_INTERNAL_COMPANY_NAMES` (comma-separated). No DB-backed admin store ships in this phase.
- FR-56b **[Released]**: The client cache MUST expose a **configurable TTL** in the Finance panel UI (selector with at minimum **5 min / 10 min / 30 min / Off**, default **10 min**) persisted in `localStorage` under key **`fos_agreement_dashboard_ttl_minutes_v1`**. When the user opens the Finance panel and the cached payload is older than the TTL, the client MUST render the cache immediately **and** trigger a background refresh; a visible **Stale** badge MUST appear in the refresh row whenever the cache is past the TTL. With TTL set to **Off**, no auto-refresh occurs and the stale badge MUST be hidden. The server-side default TTL minutes are exposed via **`getAgreementCacheTtlMinutes()`** (Script Property **`AGREEMENT_CACHE_TTL_MINUTES`**, default 10) so operators can shift the seed value without a client deploy.

### 3.8 User Activity Logging

These requirements govern the **page-request activity log** the FOS Dashboard writes for downstream reporting (who used the dashboard, when, and which dashboard view they opened). The store is the **same spreadsheet** as the **Users** tab (FR-05), in a dedicated **`User Activity`** tab. This log is **append-only** and **separate** from the operational logs defined in **FR-40** (connector refresh telemetry); the two SHOULD NOT be merged.

- FR-60 **[Released]**: The system MUST write activity rows to a designated **Google Sheet** tab (default name **`User Activity`**, overridable via Script Property **`AUTH_USER_ACTIVITY_SHEET_NAME`**) inside the spreadsheet identified by **`AUTH_SPREADSHEET_ID`**.
- FR-61 **[Released]**: A logging toggle Script Property **`USER_ACTIVITY_LOGGING_ENABLED`** (default **`true`**) MUST disable all activity writes when set to `false` without throwing errors to clients (graceful no-op).
- FR-62 **[Released]**: Each event row MUST capture, at minimum: **`Timestamp`** (ISO 8601 UTC, server-generated), **`Email`** (resolved server-side from `Session.getActiveUser`), **`Role`** and **`Team`** (snapshot from the Users tab at the moment of the event), **`Event Type`**, **`Route`**, **`Label`** (optional short context), **`Session ID`** (best-effort client token), **`User Agent`** (truncated, best-effort, client-supplied for client-initiated events).
- FR-63 **[Released]**: The supported **`Event Type`** vocabulary in v1 MUST include at minimum: `page_load` (server-recorded on `doGet` for authorized users), `nav_view` (client-recorded on SPA panel switch), `refresh` (client-recorded when a panel-level refresh control is used), and `server_call` (server-recorded for selected privileged handlers). Additional event types MAY be added in later versions without renaming existing ones.
- FR-64 **[Released]**: The server-side logging handler MUST be invokable from `google.script.run` and MUST **re-verify** spreadsheet authorization (same rules as **FR-08a**) before writing any row; events from unauthorized callers MUST NOT be persisted. The handler MUST be **fire-and-forget safe** (failures do not break the user-visible UI).
- FR-65 **[Released]**: Activity writes MUST use a **single batched append per event** under a **script-level lock** with a short wait (recommended ≤ 2 seconds). Because the FOS Dashboard is a **standalone** Apps Script Web App (not container-bound to the Users spreadsheet), the implementation MUST use **`LockService.getScriptLock()`** — **`LockService.getDocumentLock()`** returns `null` for standalone scripts and MUST NOT be used. On lock-acquisition timeout the event MAY be dropped silently, but a warning MUST be logged via `Logger`/`console.warn` for admin visibility.
- FR-66 **[Released]**: The activity log MUST NOT contain **secrets**, raw request payloads, or **PII beyond** what is already present on the Users tab (email, role, team) plus user-agent and route identifiers. Free-text **`Label`** fields MUST be bounded (recommended ≤ 120 chars) and MUST NOT include Fibery tokens, Script Property keys, or any field captured from form inputs.

## 4) Non-Functional Requirements

- NFR-01 (Security) **[Backlog]**: Secrets and tokens MUST never be logged or exposed to the client; use server-side only storage and redacted error messages for end users.
- NFR-02 (Privacy) **[Backlog]**: The dashboard MUST only surface data appropriate for the authenticated audience; **role** and **team** from the users sheet SHOULD inform which metrics or sections appear as the model matures. Row-level rules SHOULD be documented when multiple roles exist.
- NFR-03 (Reliability) **[Backlog]**: Partial connector failures MUST NOT blank the entire dashboard unless the failure is catastrophic; unaffected panels remain usable.
- NFR-04 (Performance) **[Backlog]**: Initial page load SHOULD complete within a target budget (documented per deployment) using caching, parallel fetches where safe, and minimal payload sizes.
- NFR-05 (Maintainability) **[Backlog]**: Codebase MUST separate **UI**, **orchestration**, **connectors**, and **metric mapping** into testable modules following the same discipline as other harpin Apps Script projects.
- NFR-06 (Auditability) **[Backlog]**: Figures shown in the UI SHOULD be traceable to source rows or API responses via documented mapping (for finance review).
- NFR-07 (Client cache) **[Backlog]**: Browser-side caches of dashboard JSON MUST NOT contain **secrets** (Fibery tokens, Script Property keys, service account material); payloads MUST be limited to data already safe for the signed-in viewer.
- NFR-08 (Activity-log privacy) **[Backlog]**: The **User Activity** tab MUST be treated as PII (it ties **email** to **timestamped usage**). Access to the underlying spreadsheet MUST be restricted to admins/operators, and the dashboard UI MUST NOT expose raw activity rows to non-admin users. Retention SHOULD be documented per harpin data policy (no v1 default beyond what the underlying sheet retains).

## 5) Target Architecture (Apps Script)

```text
User (Workspace) → Published Web App (HtmlService)
  -> doGet: Session identity → Users sheet lookup (email → role, team)
       -> if unauthorized: NotAuthorized.html  (no activity row written)
       -> if authorized: DashboardShell.html + server context (role, team)
                         + append `page_load` row → User Activity tab
  -> google.script.run → (each handler re-checks authorization)
       -> Dashboard Orchestrator
       -> Metric catalog (Sheets / Drive JSON)
       -> Connector: Google Sheets metric store
       -> Connector(s): REST APIs (Fibery, Clockify, accounting, …)
       -> Normalize + validate → View models
       -> Optional: write snapshot cache (Script Properties / Sheet tab) for non–Finance panels only when adopted
       -> Structured logs (admin sheet or Stackdriver-style logging if adopted)
       -> logUserActivity(event): append `nav_view` / `refresh` / `server_call`
                                  row → User Activity tab (LockService append)
  <- JSON view models → Client render (KPI cards, sections, freshness)
       -> Finance / agreement route: optional sessionStorage/localStorage cache of last Fibery JSON (no secrets); Refresh re-fetches from server
       -> SPA panel switches + Refresh → google.script.run.logUserActivity()
```

Optional **scheduled trigger** path: time-driven run → refresh **allowed** snapshot caches (excluding the Finance Fibery payload cache if absent by policy) → log row, without requiring a user session. The **User Activity** tab is **only** written for end-user-initiated events (no synthetic scheduled rows).

## 6) Fibery data model requirements (Agreement Management)

This section incorporates **Section 3 — Fibery Data Model Requirements** from `docs/agreement-dashboard-prd-v2.md` (**version 2.5**, March 2026). It is the **normative schema contract** for FOS features that consume **Agreement Management** data from Fibery (direct API, MCP, or Sheets/materialized views derived from the same fields). If field names or structures differ in a given workspace, **connectors and queries MUST be updated** to match; the business meanings and classifications below remain the reference for harpin.

### 6.1 Required databases

| Database       | Space                | Purpose                                |
| -------------- | -------------------- | -------------------------------------- |
| `Agreements`   | Agreement Management | Core entity for all contract records   |
| `Companies`    | Agreement Management | Customer and client records            |
| `Revenue Item` | Agreement Management | Milestone-based billing records        |
| `Labor Costs`  | Agreement Management | Time-tracked labor cost entries        |
| `Contacts`     | Agreement Management | Customer contacts linked to agreements |

### 6.2 Agreements — required fields

| Field Name            | Fibery Field Path                                             | Type             | Notes                                                  |
| --------------------- | ------------------------------------------------------------- | ---------------- | ------------------------------------------------------ |
| Name                  | `Agreement Management/Name`                                   | Text             | Agreement display name                                 |
| Workflow State        | `workflow/state` → `enum/name`                                | Enum             | See §6.5 for expected values                           |
| Agreement Type        | `Agreement Management/Agreement Type` → `enum/name`         | Enum             | See §6.6                                               |
| Agreement Progress    | `Agreement Management/Agreement Progress` → `enum/name`       | Enum             | See §6.7                                               |
| Customer              | `Agreement Management/Customer` → `Agreement Management/Name` | Relation         | Links to Companies                                     |
| Total Planned Revenue | `Agreement Management/Total Planned Revenue`                  | Number (formula) | Sum of all linked Revenue Item target amounts          |
| Rev Recognized        | `Agreement Management/Rev Recognized`                         | Number (formula) | Sum of Revenue Items where `Revenue Recognized = true` |
| Total Labor Costs     | `Agreement Management/Total Labor Costs`                      | Number (formula) | Sum of linked Labor Cost entries                       |
| Total Materials & ODC | `Agreement Management/Total Materials & ODC`                  | Number (formula) | Other direct costs                                     |
| Current Margin        | `Agreement Management/Current Margin`                         | Number (formula) | Computed per Fibery (operational definition in agreement PRD §5.1) |
| Target Margin         | `Agreement Management/Target Margin`                          | Number           | Agreed target margin at scoping                        |
| Duration              | `Agreement Management/Duration`                               | Date Range       | Agreement start and end dates                          |
| Execution Date        | `Agreement Management/Execution Date`                         | Date             | Contract signing date                                  |
| Clockify Project ID   | `Agreement Management/Clockify Project ID`                    | Text             | External time-tracking reference                       |

### 6.3 Companies — required fields

| Field Name                    | Fibery Field Path                                    | Type             | Notes                                               |
| ----------------------------- | ---------------------------------------------------- | ---------------- | --------------------------------------------------- |
| Name                          | `Agreement Management/Name`                          | Text             | Company display name                                |
| Funnel Stage                  | `Agreement Management/Funnel Stage` → `enum/name`    | Enum             | See §6.8                                            |
| Segment                       | `Agreement Management/Segment` → `enum/name`         | Enum             | Industry/vertical                                   |
| Lead Source                   | `Agreement Management/Lead Source` → `enum/name`     | Enum             | Origin of the relationship                          |
| Total Customer Contract Value | `Agreement Management/Total Customer Contract Value` | Number (formula) | Sum of planned revenue across all linked agreements |
| NDA Completed                 | `Agreement Management/NDA Completed`                 | Boolean          | Whether NDA is in place                             |

### 6.4 Revenue Item — required fields

| Field Name         | Fibery Field Path                                              | Type     | Notes                               |
| ------------------ | -------------------------------------------------------------- | -------- | ----------------------------------- |
| Name               | `Agreement Management/Name`                                  | Text     | Milestone name                      |
| Target Amount      | `Agreement Management/Target Amount`                           | Number   | Planned billing amount              |
| Actual Amount      | `Agreement Management/Actual Amount`                           | Number   | Amount actually invoiced            |
| Target Date        | `Agreement Management/Target Date`                             | Date     | Planned billing date                |
| Revenue Recognized | `Agreement Management/Revenue Recognized`                      | Boolean  | Whether revenue has been recognized |
| Workflow State     | `workflow/state` → `enum/name`                               | Enum     | Billing status                      |
| Agreement          | `Agreement Management/Agreement` → `Agreement Management/Name` | Relation | Parent agreement                    |
| Customer           | `Agreement Management/Customer` → `Agreement Management/Name`  | Relation | Customer (via agreement)            |

### 6.5 Agreement workflow states

The following workflow states are expected. Additional states may exist; FOS views MUST handle at minimum the list below (including treating **Closed-Lost** as inactive for default active/portfolio views per agreement PRD query rules).

| State                       | Dashboard classification             |
| --------------------------- | ------------------------------------ |
| Identified Opportunity      | Pre-delivery / Pipeline              |
| First Client Call Completed | Pre-delivery / Pipeline              |
| Proposal Delivered          | Proposal                             |
| Closed-Won                  | Pre-delivery                         |
| Delivery In Progress        | Active                               |
| Contract Complete           | Complete                             |
| Closed-Lost                 | Inactive (exclude from active views) |

### 6.6 Agreement types

| Value        | Display                                           |
| ------------ | ------------------------------------------------- |
| Subscription | Recurring / subscription revenue                  |
| Services     | Project-based professional services               |
| License      | Software license                                  |
| Internal     | Internal cost-tracking only — no external revenue |

### 6.7 Agreement progress values

| Value       | Meaning                    |
| ----------- | -------------------------- |
| Not Started | Delivery not yet begun     |
| In Progress | Active delivery underway   |
| Delayed     | Delivery behind schedule   |
| Closing     | Final stages               |
| Complete    | All deliverables fulfilled |

### 6.8 Company funnel stages

| Value    | Meaning                           |
| -------- | --------------------------------- |
| Lead     | Early-stage, no formal engagement |
| Prospect | Active sales pursuit              |
| Customer | At least one completed agreement  |
| Client   | Ongoing active engagement         |

**Further detail** (Fibery query text, computed metrics, alerts, UI components): `docs/agreement-dashboard-prd-v2.md` §4 onward; FOS adoption is tracked in **`## 7)`** below and in **`docs/features/003-agreement-dashboard-fibery-client-cache.md`**.

## 7) Agreement revenue dashboard (Fibery live data + client cache + visual contract)

This section defines how the **Finance** (agreement / revenue) view behaves in the **Google Apps Script** Web App. It **imports** product intent from `docs/agreement-dashboard-prd-v2.md` (**§4–§8** for queries, logic, alerts, components, and color/threshold configuration; **§9.5–§9.7** and **§9.6** for branding and layout) and **does not** require the agreement PRD’s **React/npm static deploy**, **Fly.io**, **Resend**, **MCP-only** transport, or **persisted admin threshold databases**—see **`docs/features/003-agreement-dashboard-fibery-client-cache.md`** for the explicit in/out matrix.

### 7.1 Data and caching rules

- **Fibery** is the **source of truth** for agreement portfolio data for this view.
- The **server** runs Fibery reads through **`UrlFetchApp`** against the REST **`/api/commands`** endpoint (batched `fibery.entity/query` per §4 of `agreement-dashboard-prd-v2.md`), normalizes responses, computes alerts, KPIs, chart view models, and the financial table, and returns JSON only through **`google.script.run`** handlers that **re-check** spreadsheet authorization. Credentials live in Script Properties **`FIBERY_HOST`** and **`FIBERY_API_TOKEN`**; thresholds and palettes live in `src/agreementThresholds.js` with optional Script Property overrides (FR-56a).
- The solution **MUST NOT** persist Fibery dashboard payloads in **Script Properties**, **Sheet tabs**, or **Drive files** for the purpose of serving this dashboard (other operational logging remains under **FR-40**).
- The **client** caches the last successful JSON in **`sessionStorage`** under key **`fos_agreement_dashboard_v2`** (`cacheSchemaVersion: 2`); payload includes `fetchedAt`, `ttlMinutes`, and the precomputed `kpis`, `alerts`, `charts`, and `financialTable` blocks.
- A **Refresh** control **MUST** trigger a new server fetch; on success it **MUST** replace the cache and update **last refreshed**; on recoverable failure it **SHOULD** keep showing the prior cache when present while surfacing an error state.
- The client honors a **configurable TTL** stored in `localStorage` under **`fos_agreement_dashboard_ttl_minutes_v1`** (default 10 min, options 5 / 10 / 30 / Off, FR-56b). When the panel is opened with a stale cache, the cache is rendered first and a background refresh is dispatched.

### 7.2 Branding and layout (normative)

The Finance / agreement panel **MUST** follow **`agreement-dashboard-prd-v2.md` §9.5 Design System**, **§9.6 Brand Identity**, and **§9.7 Layout**: CSS variables (e.g. `--bg` `#061B30`, `--surface` `#092747`, `--accent` `#52C9E5`, `--text` `#FFFEFC`, `--border` `#1a4060`), **Inter** (weights 400–800, base 14px), logo **`https://harpin.ai/wp-content/uploads/logo.svg`** at **32px** height with **`onerror`** hide, **1px** separator **`rgba(82,201,229,0.3)`** at **28px** height beside the title, **deep navy** surfaces (not pure black), **danger `#fc5c65`** reserved for errors and negative margin (and related alert severity), cards **20px** padding / **12px** radius / **1px** border, primary grid **≤900px** single column, **4px** custom scrollbar track using border color.

### 7.3 Components and charts

Implemented widgets **SHOULD** match **`agreement-dashboard-prd-v2.md` §7** (e.g. **§7.1** header, **§7.2** KPI bar) and colors/thresholds in **§8**. Charting **MAY** use **Chart.js** or other **CDN** libraries suited to HtmlService instead of **Recharts** / bundled **D3**, provided mappings remain consistent with **§8.2–§8.5**.

## 8) Relationship to Prior Google Workspace Work

The **Clockify to Fibery Sync** product (see `docs/PRD.md`) remains the **system of record pipeline** for time data into Fibery and related staging sheets. The **FOS Dashboard**:

- **Reads** from curated layers (Sheets tabs, Fibery queries, APIs) rather than re-implementing sync logic.
- **Does not** replace incremental checkpoints, labor staging tabs, or Fibery push semantics defined in that PRD.
- **May** surface operational health derived from those processes (e.g. last sync timestamp from a shared log tab) when agreed and implemented.

## 9) Acceptance Criteria

- AC-01 **[Backlog]**: A user in the allowed domain opens the Web App and sees the dashboard shell with at least one configured KPI section.
- AC-02 **[Backlog]**: **Refresh** (or initial load) populates KPI values from the configured metric layer without client-side secrets.
- AC-03 **[Backlog]**: When a connector fails, the affected panel shows a clear error or stale state and other panels still render if their data succeeded.
- AC-04 **[Backlog]**: Finance-relevant numbers use correct units (currency, percent, count) per metric definition.
- AC-05 **[Backlog]**: A successful refresh cycle writes a **log row** (or equivalent) with timestamp and per-source outcome for admin review.
- AC-06 **[Backlog]**: The UI displays **last updated** metadata that matches the server’s latest successful refresh for that panel or global scope.
- AC-07 **[Backlog]**: README (or project index doc) links to this PRD as the dashboard requirements baseline.
- AC-08 **[Released]**: The published UI shows the **PRD version** string (sidebar + not-authorized page; version constant in code).
- AC-09 **[Released]**: A user whose email appears in the configured **users** tab receives the **dashboard shell**; the server response includes **role** and **team** derived from that row (shown in the user chip from `getDashboardNavigation`).
- AC-10 **[Released]**: A user who is **signed in** but **not** listed in the users tab receives only the **not authorized** page with a clear message that access has not been granted; they do **not** see dashboard navigation or KPI placeholders.
- AC-11 **[Released]**: With required Script Properties **missing** for the authorization sheet, the deployment fails **closed** (user sees the configuration-oriented message on the not-authorized page **without** exposing internal keys).
- AC-12 **[Released]**: `getDashboardNavigation` **re-checks** authorization via `requireAuthForApi_()` and throws if the user is not on the sheet, so the client does not receive the navigation model when unauthorized.
- AC-13 **[Released]**: The left nav shows **icons + labels** for each dashboard entry, and the sidebar footer shows **Settings** with a **gear** icon; inactive targets still open the **coming soon** modal.
- AC-14 **[Released]**: The **Finance** nav entry opens the **agreement dashboard** panel (not the generic “coming soon” modal) with **Refresh**, **last refreshed** text, **sessionStorage** cache of the last successful server payload (key `fos_agreement_dashboard_v2`, `cacheSchemaVersion: 2`), and visuals aligned with **`## 7)`** subsection **7.2**; `getAgreementDashboardData` re-checks authorization, runs the §4 Fibery queries in one batched `/api/commands` round-trip, and returns live KPIs, alerts, chart view models, and the financial table. When `FIBERY_HOST` or `FIBERY_API_TOKEN` are unset (or Fibery is unreachable), the call returns `ok:false` with a friendly message and the UI keeps the prior cache rendered.
- AC-15 **[Released]**: When an authorized user opens the Web App, the server appends a `page_load` row to the **`User Activity`** tab containing **Timestamp**, **Email**, **Role**, **Team**, and the event metadata defined in **FR-62**; an unauthorized session writes **no** row (the not-authorized page does not log).
- AC-16 **[Released]**: When an authorized user navigates between dashboard panels (Home, Finance, Operations, Delivery) or invokes the agreement-dashboard **Refresh**, the client calls the server logging handler and a corresponding `nav_view` or `refresh` row appears in the **`User Activity`** tab tagged with the **Route** (e.g. `finance`) and the user’s **Session ID**.
- AC-17 **[Released]**: With **`USER_ACTIVITY_LOGGING_ENABLED`** set to `false`, no new rows are written to the **`User Activity`** tab for any event, and dashboard navigation continues to work without user-visible errors; with the property unset or `true`, logging is on by default.
- AC-18 **[Released]**: The dashboard shell, not-authorized page, Home panel, “coming soon” modal, and Finance / agreement panel all draw colors and typography from the same root CSS variables defined per **`agreement-dashboard-prd-v2.md` §9.5** (declared once at `:root` in `src/DashboardShell.html` and again in `src/NotAuthorized.html`); the `--ag-*` family inside `.fos-agreement-root` resolves via aliases to those globals, and **no** `--harpin-navy*` / `--harpin-teal*` legacy tokens remain. The **Settings** control at the bottom of the sidebar is an `<a>` element using the `.fos-nav-btn` class (no outlined or pill chrome), with its click handler calling `preventDefault()` before opening the **coming soon** modal.
- AC-19 **[Released]**: With Fibery credentials configured, the Finance panel renders, in addition to the KPI strip, the **Attention items** panel (sorted Critical → Warning → Informational, all-clear card when empty), the **Agreement status** donut, the **Agreement type mix** donut, the **Revenue recognition progress** stacked bar (top N agreements, default 10, excluding Internal), the **Customer contract value** horizontal bar (non-Internal companies with ≥ 1 agreement), and the **Financial performance** table with three working tabs (**All active**, **Top customer**, **Other customers**) including margin bars colored per §8.4. The **Auto-refresh** selector defaults to **10 min**, persists across reloads via `localStorage`, surfaces the **Stale** badge when the cache exceeds the TTL, and triggers a background refresh when the panel is opened with a stale cache; setting the selector to **Off** suppresses both the stale indicator and any auto-refresh.

## 10) Open Questions (for product refinement)

- Which **v1 KPI set** is mandatory for launch (exact list, owners, and source per metric)?
- **Single deployment** vs separate dev/prod Apps Script projects and Web App URLs?
- Preferred **metric catalog** format: Sheets-only v1 vs JSON in Drive vs hybrid?
- **Role model**: one dashboard for all internal viewers vs role-specific layouts? (**Partially answered** for v1: role and team come from the users sheet; layout rules TBD per feature 002 delivery.)

## 11) Change Log

| Date | Version | Change Summary | Author |
| --- | --- | --- | --- |
| 2026-05-11 | 1.0 | Initial FOS Dashboard PRD; structure aligned with `docs/PRD.md`; all requirements tagged Backlog pending implementation. | Cursor |
| 2026-05-12 | 1.1 | Added spreadsheet **users** tab authorization (FR-05–FR-08a), not-authorized page requirement, server re-check rule, AC-09–AC-12, architecture update. | Cursor |
| 2026-05-12 | 1.2 | Implemented sheet auth (`authUsersSheet.js`), `NotAuthorized.html`, `doGet` gate, `getDashboardNavigation` re-check, role/team in nav payload, PRD version in UI; PRD headers in all `src` text files; FR-05–FR-08a, FR-51, AC-08–AC-12 marked **Released**. | Cursor |
| 2026-05-12 | 1.3 | Shell navigation: **Bootstrap Icons** on left menu items (FR-10a); **Settings** + gear replaces **Profile** with same placeholder behavior (FR-10b); **AC-13**; sync `FOS_PRD_VERSION` and all `src/` PRD headers to **1.3**. | Cursor |
| 2026-05-12 | 1.4 | Pulled **Fibery Agreement Management data model** from `docs/agreement-dashboard-prd-v2.md` §3 into new **`## 6) Fibery data model requirements`**; renumbered sections 6→10; **FR-25** (connector conformance); version and `src` headers → **1.4**. | Cursor |
| 2026-05-12 | 1.5 | **Agreement / Finance dashboard** contract: new **`## 7)`** (Fibery live + **no server datastore** for this slice + **client cache** + **§9.5–§9.7** branding); **FR-52–FR-56**, **NFR-07**, architecture note; renumbered sections 7→11; feature **`docs/features/003-agreement-dashboard-fibery-client-cache.md`**; **AC-14**; initial UI + `getAgreementDashboardData` stub; version and `src/` headers → **1.5**. | Cursor |
| 2026-05-11 | 1.6 | **User activity logging**: new **`§3.8`** with **FR-60–FR-66** describing the **`User Activity`** tab in the Users spreadsheet, Script Properties (`AUTH_USER_ACTIVITY_SHEET_NAME`, `USER_ACTIVITY_LOGGING_ENABLED`), event vocabulary (`page_load`, `nav_view`, `refresh`, `server_call`), `LockService` append semantics, and PII-bound payload; **NFR-08** activity-log privacy; **AC-15–AC-17**; architecture diagram updated; feature **`docs/features/004-user-activity-logging.md`**; implementation: new `src/userActivityLog.js` (`logUserActivity`, `recordPageLoad_`, `writeActivityRow_`, sanitizers), `doGet` page-load hook in `src/Code.js`, and `nav_view` / `refresh` hooks + `sessionStorage` session-ID + 250 ms throttle in `src/DashboardShell.html`; FR-60–FR-66 + AC-15–AC-17 marked **Released**; FR-65 corrected to **`LockService.getScriptLock()`** (the standalone Web App is not container-bound, so `getDocumentLock()` returns `null` and would surface as a spurious "lock timeout" warning on the first `page_load` row); version and `src/` headers → **1.6**. | Cursor |
| 2026-05-11 | 1.7 | **Whole-app branding consolidation**: `FR-50` strengthened from SHOULD/Finance-only to **MUST** across the entire app, anchored to **`agreement-dashboard-prd-v2.md` §9.5–§9.7** with the full root-variable list spelled out; `FR-10b` clarified — **Settings** at the bottom of the sidebar is now a **plain navigation-style link** (`<a>` with `.fos-nav-btn`), no outlined or pill button chrome, click handler `preventDefault()`s the `href="#"`; new **AC-18** asserting single-palette compliance and the link-style Settings affordance. Implementation: `src/DashboardShell.html` promotes `--bg / --surface / --accent / --text / --border / …` tokens to `:root`, aliases the `--ag-*` family inside `.fos-agreement-root` to those globals, retires the legacy `--harpin-navy*` / `--harpin-teal*` palette and the `.btn-fos-sidebar-footer` class, promotes the 4px custom scrollbar from the agreement scope to the whole document, rebuilds sidebar / topbar / nav / Home card / modal selectors against the new tokens, and replaces the Settings outlined pill with a `.fos-nav-btn` `<a>` (with `event.preventDefault()` on the handler); `src/NotAuthorized.html` adopts the same root tokens (deep-navy surface, 12px radius, Inter); feature **`docs/features/001-dashboard-shell-navigation.md`** updated with new design line, AC for whole-app token compliance, AC clarifying Settings link affordance, and implementation checkboxes; version and `src/` headers → **1.7**. | Cursor |
| 2026-05-11 | 1.9.2 | **Fibery `q/order-by` syntax fix — second attempt (the right one).** The 1.9.1 object form (`{"field": "q/desc"}`) is what the Fibery MCP wrapper accepts, but the raw REST `/api/commands` endpoint that the Apps Script orchestrator hits rejects it with the same `Unknown order by expression {"v":"…"}` warning. The actual REST form is **`[[[field-path-segments], "q/asc"\|"q/desc"]]`** — i.e. the field path itself must be wrapped in a vector even for single-segment paths, matching the `q/where` field-path convention. All three call sites in `src/fiberyAgreementDashboard.js` (agreements / historical / future revenue items) corrected. Code comment now warns future maintainers off the bare-string and object forms. | Cursor |
| 2026-05-11 | 1.9.1 | **Fibery `q/order-by` syntax fix — first attempt (wrong form).** Replaced the array-of-tuples-with-bare-strings form (`[["field","q/desc"]]`) with the object form (`{ "field": "q/desc" }`) in all three queries built by `src/fiberyAgreementDashboard.js`. The previous form surfaced as `Fibery: command error: Unknown order by expression {"v":"…"}`. **Superseded by 1.9.2** — the object form is what the Fibery MCP accepts, but the raw REST `/api/commands` endpoint produces the same warning. First release on the new MAJOR.MINOR.PATCH versioning scheme — see the updated cursor rule (`.cursor/rules/google-apps-script-core.mdc` §"Version-number rules"). | Cursor |
| 2026-05-11 | 1.9 | **Phase A live-wiring schema corrections** (verified end-to-end against the live Fibery workspace via the Fibery MCP). Four field-path / shape mismatches were corrected in `src/fiberyAgreementDashboard.js`: (1) `Agreement Management/Duration` is a `fibery/date-range` whose sub-fields are **not** addressable via the `["Field","sub-field"]` form — the whole field is now selected as `duration` and unpacked to `durStart` / `durEnd` during normalization from the `{start, end}` payload (the Fibery error was `"fibery/end" field was not found in "fibery/date-range" database.`); (2) Revenue Item's customer relation is `Agreement Management/Agreement Customer` (lookup through the parent agreement), **not** `Agreement Management/Customer` — both the historical and future revenue-item queries were corrected; (3) Fibery returns `Current Margin` and `Target Margin` as decimal **fractions** (0–1) rather than percent units, so a `scaleFractionToPercent_` helper now multiplies during normalization so the §6/§8 thresholds (35, 60, …) remain in percent terms across alerts, KPIs, the financial-table margin bar, and §8.4 bucket colors; (4) `Agreement Management/Segment` is a **multi-select** that returns an array — `normalizeCompanies_` now preserves a `segments[]` array (with the joined string surfaced as `segment` for display), and `isInternalCompany_` (`src/agreementThresholds.js`) checks each entry. No PRD section / FR text changes; this is a correctness patch to the v1.8 implementation. Version and `src/` headers → **1.9**. | Cursor |
| 2026-05-11 | 1.8 | **Agreement / Finance dashboard — Phase A live wiring**: `FR-52`–`FR-56` flipped to **Released** and rewritten to reflect the Fibery REST **`/api/commands`** transport; new `FR-56a` (§8 thresholds/colors as code constants with Script Property overrides) and `FR-56b` (configurable client-side TTL — 5 / 10 / 30 / Off, default 10 min, persisted in `localStorage`, with **Stale** badge and background refresh-on-open semantics); `AC-14` rewritten for the live wiring; new **AC-19** for the Phase A charts/table/attention-panel rendering and TTL behavior. Implementation: new server modules **`src/fiberyClient.js`** (single batched `UrlFetchApp` wrapper, error mapping, no payload logging), **`src/agreementThresholds.js`** (§8.1–§8.6 constants + Script Property overrides), **`src/agreementAlerts.js`** (§6.1–§6.7 rule evaluator), and rewritten **`src/fiberyAgreementDashboard.js`** (4 queries, normalization, enrichment with scheduling status + revenue-item counts, KPIs, chart view models, financial table builder, `getAgreementCacheTtlMinutes()`, and the `_diag_pingFibery` / `_diag_sampleAgreementPayload` editor helpers); cache schema **bumped to v2** (key `fos_agreement_dashboard_v2`); `src/DashboardShell.html` adds an **Auto-refresh** selector, **Stale** badge, an Attention Items panel, four Chart.js canvases (lazy-loaded from jsDelivr CDN), and the Financial Performance tabbed table (All active / Top customer / Other customers); feature **`docs/features/003-agreement-dashboard-fibery-client-cache.md`** updated with Phase A delivered + Phase B/C scoped + Script Property reference; version and `src/` headers → **1.8**. | Cursor |

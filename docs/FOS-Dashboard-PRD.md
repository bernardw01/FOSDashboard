# Harpin FOS Dashboard (Google Workspace Web App)

Product Requirements Document

Version 1.0 - 2026-05-11

## 1) Overview

### Purpose

Build a **Google Apps Script**–hosted web application—the **Harpin FOS (Finance & Operations Snapshot) Dashboard**—that gives authorized harpin users a single place to see **key metrics, KPIs, and financial performance** drawn from the systems the company already uses (for example time and labor, agreements and delivery data, and accounting). The dashboard complements point integrations (such as Clockify → Fibery sync) by **aggregating and presenting** cross-system signals rather than replacing those pipelines.

### Product Vision

Provide a **lightweight, Google Workspace–native** experience that:

- authenticates users in the harpin Google Workspace domain,
- loads curated metrics and summaries from configured APIs and/or Google Sheets “metric store” layers,
- presents a clear, scannable layout with optional drill-down where data allows,
- refreshes on a sensible cadence (manual refresh, scheduled server refresh, or both),
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

- Open the published dashboard and see **today’s or period’s** KPI snapshot without hunting across tools.
- **Refresh** metrics on demand and understand **when data was last updated** and from which source.
- Compare **actual vs plan** (or prior period) where those series exist in the metric layer.
- **Troubleshoot** a stale or failed panel using admin-visible logs or status (without exposing secrets).

## 3) Functional Requirements

Each numbered **FR**, **AC** (section 7), and **NFR** (section 4) item carries a status tag:

| Tag | Meaning |
| --- | --- |
| **[Released]** | Implemented in the current Apps Script project (including Web App deployment behaviors). |
| **[In-Progress]** | Partially implemented or not yet validated end-to-end. |
| **[Backlog]** | Not yet implemented. |

As of **version 1.0**, all functional and acceptance items below are **[Backlog]** unless and until the implementation checklist in the repository marks them otherwise.

### 3.1 Access, Identity, and Configuration

- FR-01 **[Backlog]**: The Web App MUST restrict access to users in the **harpin Google Workspace** domain (or an explicitly configured allowlist of domains) consistent with Apps Script execution identity and deployment settings.
- FR-02 **[Backlog]**: The system MUST store non-secret configuration (feature flags, sheet IDs, tab names, API base URLs) in **Script Properties** or an equivalent documented store; secrets MUST NOT be committed to source control.
- FR-03 **[Backlog]**: The system MUST fail fast with operator-readable errors when required configuration is missing for a given panel or connector.
- FR-04 **[Backlog]**: The solution SHOULD support a minimal **environment** or **tier** concept (`dev` / `prod`) for separate Script Properties sets if multiple deployments are used.

### 3.2 Dashboard Shell and Navigation

- FR-10 **[Backlog]**: The published UI MUST provide a **dashboard shell**: title, optional period selector (e.g. month/quarter), and a consistent content grid for KPI cards and sections.
- FR-11 **[Backlog]**: The shell MUST display **data freshness** per section or globally (e.g. “Last updated: … UTC”) when the server provides that metadata.
- FR-12 **[Backlog]**: Server-invoked actions from the UI (e.g. refresh) MUST use `google.script.run` (or documented successor) with clear loading and completion states.
- FR-13 **[Backlog]**: The layout MUST be **responsive** for desktop-first use; primary content SHOULD be centered with a sensible max width and accessible contrast.

### 3.3 Data Acquisition and Metric Layer

- FR-20 **[Backlog]**: The system MUST support reading **normalized metric definitions** from a documented location (recommended: Google Sheets “metric catalog” tab or structured JSON in Drive) describing id, label, unit, source, and refresh policy.
- FR-21 **[Backlog]**: The system MUST support at least one **server-side** aggregation path: pull from **Google Sheets** tables maintained by existing processes (including ETL or sync jobs such as Clockify → Sheets → Fibery pipelines) without requiring the browser to hold service credentials.
- FR-22 **[Backlog]**: The system SHOULD support additional connectors behind a shared interface (e.g. **Fibery** query, **Clockify** summary, **accounting API**) with per-connector rate limiting and timeouts.
- FR-23 **[Backlog]**: Each connector MUST emit structured results: **success**, **partial** (degraded panel), or **failed** with a safe user message and detailed server log.
- FR-24 **[Backlog]**: Long-running refreshes MUST be **bounded** (chunking, batching, or async continuation patterns) to remain within Apps Script execution limits.

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

- FR-50 **[Backlog]**: The published HTML UI SHOULD align with **harpin.ai** visual standards (primary palette, typography, icon set) consistent with other internal Apps Script Web Apps.
- FR-51 **[Backlog]**: The Web App SHOULD display the **current PRD version** (this document’s version string) so stakeholders can align feedback with the documented baseline.

## 4) Non-Functional Requirements

- NFR-01 (Security) **[Backlog]**: Secrets and tokens MUST never be logged or exposed to the client; use server-side only storage and redacted error messages for end users.
- NFR-02 (Privacy) **[Backlog]**: The dashboard MUST only surface data appropriate for the authenticated audience; row-level or metric-level access rules SHOULD be documented when multiple roles exist.
- NFR-03 (Reliability) **[Backlog]**: Partial connector failures MUST NOT blank the entire dashboard unless the failure is catastrophic; unaffected panels remain usable.
- NFR-04 (Performance) **[Backlog]**: Initial page load SHOULD complete within a target budget (documented per deployment) using caching, parallel fetches where safe, and minimal payload sizes.
- NFR-05 (Maintainability) **[Backlog]**: Codebase MUST separate **UI**, **orchestration**, **connectors**, and **metric mapping** into testable modules following the same discipline as other harpin Apps Script projects.
- NFR-06 (Auditability) **[Backlog]**: Figures shown in the UI SHOULD be traceable to source rows or API responses via documented mapping (for finance review).

## 5) Target Architecture (Apps Script)

```text
User (Workspace) → Published Web App (HtmlService)
  -> google.script.run → Dashboard Orchestrator
       -> Metric catalog (Sheets / Drive JSON)
       -> Connector: Google Sheets metric store
       -> Connector(s): REST APIs (Fibery, Clockify, accounting, …)
       -> Normalize + validate → View models
       -> Optional: write snapshot cache (Script Properties / Sheet tab)
       -> Structured logs (admin sheet or Stackdriver-style logging if adopted)
  <- JSON view models → Client render (KPI cards, sections, freshness)
```

Optional **scheduled trigger** path: time-driven run → refresh snapshot cache → log row, without requiring a user session.

## 6) Relationship to Prior Google Workspace Work

The **Clockify to Fibery Sync** product (see `docs/PRD.md`) remains the **system of record pipeline** for time data into Fibery and related staging sheets. The **FOS Dashboard**:

- **Reads** from curated layers (Sheets tabs, Fibery queries, APIs) rather than re-implementing sync logic.
- **Does not** replace incremental checkpoints, labor staging tabs, or Fibery push semantics defined in that PRD.
- **May** surface operational health derived from those processes (e.g. last sync timestamp from a shared log tab) when agreed and implemented.

## 7) Acceptance Criteria

- AC-01 **[Backlog]**: A user in the allowed domain opens the Web App and sees the dashboard shell with at least one configured KPI section.
- AC-02 **[Backlog]**: **Refresh** (or initial load) populates KPI values from the configured metric layer without client-side secrets.
- AC-03 **[Backlog]**: When a connector fails, the affected panel shows a clear error or stale state and other panels still render if their data succeeded.
- AC-04 **[Backlog]**: Finance-relevant numbers use correct units (currency, percent, count) per metric definition.
- AC-05 **[Backlog]**: A successful refresh cycle writes a **log row** (or equivalent) with timestamp and per-source outcome for admin review.
- AC-06 **[Backlog]**: The UI displays **last updated** metadata that matches the server’s latest successful refresh for that panel or global scope.
- AC-07 **[Backlog]**: README (or project index doc) links to this PRD as the dashboard requirements baseline.
- AC-08 **[Backlog]**: The published UI shows the **PRD version** string when FR-51 is implemented.

## 8) Open Questions (for product refinement)

- Which **v1 KPI set** is mandatory for launch (exact list, owners, and source per metric)?
- **Single deployment** vs separate dev/prod Apps Script projects and Web App URLs?
- Preferred **metric catalog** format: Sheets-only v1 vs JSON in Drive vs hybrid?
- **Role model**: one dashboard for all internal viewers vs role-specific layouts?

## 9) Change Log

| Date | Version | Change Summary | Author |
| --- | --- | --- | --- |
| 2026-05-11 | 1.0 | Initial FOS Dashboard PRD; structure aligned with `docs/PRD.md`; all requirements tagged Backlog pending implementation. | Cursor |

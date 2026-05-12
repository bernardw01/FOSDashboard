# Feature: Agreement / Finance dashboard (Fibery + client cache)

> **PRD version 1.9.2** — see `docs/FOS-Dashboard-PRD.md`.

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| **Phase A — live wiring** | KPI strip · Attention panel · Status donut · Type Mix donut · Recognition stacked bar · Customer Contract Value bar · Financial Performance table · configurable client-side TTL | **Delivered v1.8** |
| **Phase B — relationship surfaces** | Customer Relationship Cards (§7.6) · Forward Revenue Pipeline (§7.8) | Backlog |
| **Phase C — flow visualization** | Revenue Flow Sankey (§7.11) — D3 + d3-sankey from CDN | Backlog |

## Goal

Deliver the **initial Agreement Management / revenue-style dashboard** in the FOS Web App **Finance** route: visuals and semantics aligned with `docs/agreement-dashboard-prd-v2.md` **§7 (components), §8 (thresholds/colors), and §9.5–§9.7 (design system / brand / layout)**, with **data live from Fibery** via authorized server handlers and **no persistent server-side datastore** for dashboard payloads. Use a **browser cache** (`sessionStorage`) for speed, plus a **Refresh** control that re-fetches from the server and a **configurable TTL** (5 / 10 / 30 / Off, default 10 min) that drives a quiet refresh-on-open when the cache is stale.

## User stories

- As an **authorized user**, I want to open **Finance** and see the **agreement dashboard layout** (header, KPI strip, attention items, status/type donuts, recognition + customer bars, financial performance table) with **harpin** branding consistent with the agreement PRD.
- As a **user**, I want the dashboard to **load quickly** when I return in the same session by reading **cached** data while still seeing **when** data was last refreshed and whether it is **stale**.
- As a **user**, I want to choose **how often** the cache is treated as stale (5 / 10 / 30 min, or **Off**) and have that preference stick across sessions.
- As a **user**, I want **Refresh** to pull the **latest** Fibery-backed payload from the server and update the UI and cache on success.
- As an **admin**, I want **no Fibery tokens or secrets** in the client or in cached JSON beyond what is already safe for the browser (no API keys).

## Pulled from `agreement-dashboard-prd-v2.md` (in scope for Apps Script)

| Agreement PRD | FOS interpretation |
| --- | --- |
| **§3** Fibery model | Normative in FOS **`## 6)`**; connector field paths must match. |
| **§4** Queries | Server-side Fibery queries via **REST `/api/commands`** (batched `fibery.entity/query`); normalize to view models. |
| **§5** Computed values | KPIs (5.2/5.3) computed in Apps Script; `Current Margin` (5.1) and `Total Customer Contract Value` (5.4) read directly as Fibery formulas; scheduling status (5.6) derived server-side from future revenue items. |
| **§6** Alerts | Attention panel rules; severity ordering — implemented in `src/agreementAlerts.js`. |
| **§7.1** Page header | Logo 32px, separator, title `Agreement Management Dashboard`, subtitle with counts/date. |
| **§7.2** KPI summary bar | Six cards, tooltips, compact number formatting (4 digits rule). |
| **§7.3–7.5, §7.7, §7.9, §7.10** | Phase A — Chart.js (CDN) renders donuts, stacked bar, customer bar; HTML/CSS for attention panel and financial table tabs. |
| **§7.6, §7.8, §7.11** | Phase B / C — backlog. |
| **§8** Thresholds & color maps | Constants in `src/agreementThresholds.js` with Script Property overrides (no DB admin store this phase). |
| **§9.5–9.7, §9.6** Branding | Root CSS variables in `src/DashboardShell.html` (already promoted in v1.7); the agreement scope aliases through to those globals. |

## Explicitly ignored (deployment / stack-specific)

- **§9.1** static handoff / `file://` single HTML file as the product artifact.
- **§9.2** shadcn/ui + React component tree.
- **§9.3** npm generation / Tailwind build pipeline.
- **§9.4** Recharts + D3 **as npm-only** requirement — Phase A uses **Chart.js** from CDN; Phase C will load D3 + d3-sankey from CDN.
- **§6.8** site-wide React router, **Settings** Fibery sync button tied to a separate static app.
- **§8** “persisted thresholds in `DashboardThresholds` DB” — v1 uses **code constants** with optional Script Property overrides (FR-56a).
- **Fly.io, Resend, MCP** as mandatory parts of the shipped FOS Web App (Fibery is queried over its REST API).

## Branding (normative summary)

Copy **`agreement-dashboard-prd-v2.md` §9.5–§9.7** into the Finance panel scope:

- Surfaces: `--bg` `#061B30`, `--surface` `#092747`, borders `#1a4060`, text `#FFFEFC` / muted `#A0AEC0`.
- Accents: `#52C9E5`, `#007FA7`, `#20B4C4`, `#43D6BA`; danger **`#fc5c65`** only for errors / negative margin / critical alerts.
- **Inter** (Google Fonts) weights 400–800; base **14px** on dashboard body.
- Logo: `https://harpin.ai/wp-content/uploads/logo.svg` at **32px** height in page header; `onerror` hide; **1px** separator `rgba(82,201,229,0.3)` **28px** tall between logo and title.
- Cards: **20px** padding, **12px** radius, **1px solid** border; grid collapses **≤900px**; scrollbar **4px** track `var(--border)`.

## Client cache contract

- **Key:** `fos_agreement_dashboard_v2` (prefix + schema version 2).
- **Value:** JSON string of last **successful** server payload (`fetchedAt`, `cacheSchemaVersion: 2`, `ttlMinutes`, normalized arrays, plus precomputed `kpis`, `alerts`, `charts`, `financialTable`).
- **TTL:** Configurable client-side via the **Auto-refresh** selector in the panel (5 / 10 / 30 min / Off, default 10 min), persisted in `localStorage` under `fos_agreement_dashboard_ttl_minutes_v1`. When the panel opens with `Date.now() - fetchedAt > ttl`, the UI **renders the stale cache immediately** and triggers a background `getAgreementDashboardData()` call. A **Stale** badge appears in the refresh row whenever the cache is past the TTL.
- **Secrets:** Never store Script Properties or raw Fibery tokens in `sessionStorage` / `localStorage`.

## Server contract

- **`getAgreementDashboardData()`** — `requireAuthForApi_()`; runs four batched Fibery queries in one `/api/commands` POST, normalizes results, enriches each agreement with revenue-item counts + §5.6 scheduling status, computes KPIs / alerts / chart view models / financial table rows, and returns the full payload. On Fibery errors (missing host/token, 4xx, network), returns `{ ok: false, message, warnings }` and the client keeps the prior cache rendered.
- **`getAgreementCacheTtlMinutes()`** — `requireAuthForApi_()`; returns the server-side TTL seed (default 10, override via Script Property `AGREEMENT_CACHE_TTL_MINUTES`).
- **No** writing dashboard payloads to Script Properties / Sheet / Drive for this feature.

## Required Script Properties

| Key | Purpose | Default |
| --- | --- | --- |
| `FIBERY_HOST` | Fibery workspace host (no scheme, e.g. `harpinai.fibery.io`) | — (required) |
| `FIBERY_API_TOKEN` | Fibery API token; never returned to the client | — (required) |
| `AGREEMENT_CACHE_TTL_MINUTES` | Default seed TTL for the client selector | `10` |
| `AGREEMENT_THRESHOLD_LOW_MARGIN` | §6.2 warning threshold (%) | `35` |
| `AGREEMENT_THRESHOLD_INTERNAL_LABOR` | §6.4 internal-labor threshold ($) | `5000` |
| `AGREEMENT_THRESHOLD_EXPIRY_DAYS` | §6.6 renewal/expiry warning window (days) | `60` |
| `AGREEMENT_TOP_N_RECOGNITION_BARS` | §7.9 top-N agreements in stacked bar | `10` |
| `AGREEMENT_INTERNAL_COMPANY_NAMES` | §8.6 comma-separated internal company names | `harpin.ai` |

## Acceptance criteria (testable)

- [x] **Given** an authorized user, **when** they click **Finance**, **then** the main area shows the **agreement-branded** panel (not the generic “coming soon” modal) with header, KPI strip, Attention items, four charts, Financial performance tabs, **Refresh**, **Auto-refresh** selector, and **last refreshed** text.
- [x] **Given** a successful prior fetch and TTL = **Off**, **when** the user navigates away and back to Finance, **then** the UI repopulates from **sessionStorage** without a server round-trip until Refresh.
- [x] **Given** a successful prior fetch and TTL = **10 min** (default), **when** the user returns after > 10 minutes, **then** the cache renders immediately, the **Stale** badge appears, and a background refresh is dispatched. On success, the badge clears and `last refreshed` updates.
- [x] **Given** the user clicks **Refresh**, **when** the server responds successfully, **then** cache and UI update and **last refreshed** matches server `fetchedAt`.
- [x] **Given** the server returns an error (e.g. missing `FIBERY_API_TOKEN`), **then** the user sees a clear message and **prior** cache remains visible if present.
- [x] **Given** an unauthorized session, **then** `google.script.run` handlers do not return dashboard data (**NOT_AUTHORIZED**).

## Components / files

| File | Role |
| --- | --- |
| `src/DashboardShell.html` | Finance panel markup, agreement CSS tokens, nav routing for `finance`, cache + refresh + TTL client script, Chart.js lazy loader, render functions. |
| `src/fiberyAgreementDashboard.js` | `getAgreementDashboardData()` orchestrator: queries, normalization, enrichment, KPIs, alerts, chart VMs, financial table; `getAgreementCacheTtlMinutes()`; `_diag_*` editor helpers. |
| `src/fiberyClient.js` | `UrlFetchApp` wrapper for batched `/api/commands` calls; credential read; error mapping; ping helper. |
| `src/agreementThresholds.js` | §8.1–§8.6 constants, color maps, margin bucket helper, internal-company predicate, Script Property override loader. |
| `src/agreementAlerts.js` | §6.1–§6.7 rule evaluators + severity sorter. |
| `src/authUsersSheet.js` | Reuse `requireAuthForApi_()` (no change in this feature). |
| `docs/FOS-Dashboard-PRD.md` | **§7** agreement dashboard contract; FR-52–FR-56b; AC-14, AC-19; version **1.8**. |

## Phase B / C — backlog

- **§7.6 Customer Relationship Cards** — uses the already-fetched `companies` array (no new server query). Card per non-Internal company sorted by TCV desc; show initials, name, agreement count, funnel stage, segment, NDA check, formatted TCV.
- **§7.8 Forward Revenue Pipeline** — uses the already-fetched `futureRevenueItems` array. Aggregate by agreement, compute monthly rate per §5.5, render with Chart.js horizontal bar.
- **§7.11 Revenue Flow Sankey** — load D3 + d3-sankey from jsDelivr CDN; build `{nodes, links}` per §7.11.7; render into a dedicated container.

## Execution notes

- Chart library: **Chart.js v4** via jsDelivr CDN, lazy-loaded on Finance panel render to stay within HtmlService limits and keep the Home payload light.
- Thresholds: defaults from agreement **§8.1** in code (`src/agreementThresholds.js`); Script Properties overlay at request time (FR-56a).
- Diagnostics: run **`_diag_pingFibery`** and **`_diag_sampleAgreementPayload`** from the Apps Script editor to verify credentials and inspect raw Fibery row shapes after a schema change.

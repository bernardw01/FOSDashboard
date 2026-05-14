# Feature: Agreement Dashboard (Fibery + client cache)

> **PRD version 1.26.0** — see `docs/FOS-Dashboard-PRD.md`.

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| **Phase A — live wiring** | KPI strip · Attention panel · Status donut · Type Mix donut · Recognition stacked bar · Customer Contract Value bar · Financial Performance table · configurable client-side TTL | **Delivered v1.8** (live-wiring corrections v1.9 / v1.9.2) |
| **Phase B — relationship surfaces** | Customer Relationship Cards (§7.6) · Forward Revenue Pipeline (§7.8) | **Delivered v1.10.0** |
| **Phase C — flow visualization** | Revenue Flow Sankey (§7.11) — D3 + d3-sankey from CDN | **Delivered v1.10.0** |
| **Cosmetic (v1.13.0)** | Removed the duplicate in-panel harpin logo + `.agreement-logo-sep` divider from the panel header — the app sidebar (`.fos-brand-logo`) is now the single rendered brand mark. **Page heading + subtitle stay** in `#panel-agreement-dashboard` (panel structure unchanged). Cross-reference: shipped jointly with the Utilization Management Dashboard Phase B cleanup in `docs/features/005-utilization-management-dashboard.md`. | **Delivered v1.13.0** |
| **UX polish (v1.13.1)** | (1) Semi-transparent **`.fos-loading-overlay`** added inside `#panel-agreement-dashboard .fos-agreement-inner` — toggled on at the start of every `fetchAgreementFromServer()` call and off in both handlers, covering initial load / Refresh / background stale-refresh. (2) **Sticky panel render** — navigating away and back no longer re-runs `applyAgreementPayload(cached)` when the cached payload's `fetchedAt` matches what the DOM already shows, preserving Chart.js + Sankey + Financial-Performance table state. Stale-detection + background fetch logic (FR-56b) still fires. See main PRD **FR-54**, **AC-27**. | **Delivered v1.13.1** |
| **Agreement milestones modal (v1.18.0)** | Every row in the Financial performance table (across all three tabs) is now a focusable button (`role="button"`, `tabindex="0"`); click + Enter / Space open `#finAgreementModal` listing the agreement's Revenue Items as **Milestone · Target amount · Target date · Invoice status**. Backed by a new server-supplied `payload.revenueItemsByAgreement` map built by re-keying the existing historical + future revenue-item arrays — **no new Fibery queries**. Within each agreement, items are sorted by `targetDate` ascending (null-date items pushed to the bottom). The Invoice-status pill color is keyed off the Revenue Item's workflow `state` via substring match (paid / invoiced / recognized → green, scheduled / planned → amber, pending → orange, cancelled / void → red, fallback → gray). The modal emits an `agreement_milestones_open` activity-log event on every open. See main PRD **FR-86**, **AC-41**. | **Delivered v1.18.0** |

## Goal

Deliver the **Agreement Management / revenue-style dashboard** in the FOS Web App as the **Agreement Dashboard** left-nav entry (route id `agreement-dashboard`, panel id `panel-agreement-dashboard`; the legacy `finance` route id was retired in v1.11.0): visuals and semantics aligned with `docs/agreement-dashboard-prd-v2.md` **§7 (components), §8 (thresholds/colors), and §9.5–§9.7 (design system / brand / layout)**, with **data live from Fibery** via authorized server handlers and **no persistent server-side datastore** for dashboard payloads. Use a **browser cache** (`sessionStorage`) for speed, plus a **Refresh** control that re-fetches from the server and a **configurable TTL** (5 / 10 / 30 / Off, default 10 min) that drives a quiet refresh-on-open when the cache is stale.

## User stories

- As an **authorized user**, I want to open **Agreement Dashboard** and see the **agreement dashboard layout** (header, KPI strip, attention items, status/type donuts, recognition + customer bars, financial performance table) with **harpin** branding consistent with the agreement PRD.
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
| **§7.1** Page header | Title `Agreement Management Dashboard` + subtitle with counts/date. **No in-panel logo** as of v1.13.0 — the sidebar `.fos-brand-logo` is the single brand surface. (Phase A–C through v1.12.0 carried an in-panel 32px logo + 28px separator divider; both were removed in v1.13.0.) |
| **§7.2** KPI summary bar | Six cards, tooltips, compact number formatting (4 digits rule). |
| **§7.3–7.5, §7.7, §7.9, §7.10** | Phase A — Chart.js (CDN) renders donuts, stacked bar, customer bar; HTML/CSS for attention panel and financial table tabs. |
| **§7.6, §7.8** | **Phase B — delivered v1.10.0.** Plain HTML/CSS rendering against the new `customerCards` and `forwardPipeline` view models. |
| **§7.11** | **Phase C — delivered v1.10.0.** D3 v7 + d3-sankey loaded lazily from jsDelivr; nodes/links built server-side per §7.11.7. |
| **§8** Thresholds & color maps | Constants in `src/agreementThresholds.js` with Script Property overrides (no DB admin store this phase). |
| **§9.5–9.7, §9.6** Branding | Root CSS variables in `src/DashboardShell.html` (already promoted in v1.7); the agreement scope aliases through to those globals. |

## Explicitly ignored (deployment / stack-specific)

- **§9.1** static handoff / `file://` single HTML file as the product artifact.
- **§9.2** shadcn/ui + React component tree.
- **§9.3** npm generation / Tailwind build pipeline.
- **§9.4** Recharts + D3 **as npm-only** requirement — Phase A uses **Chart.js** from CDN; Phase C uses **D3 v7 + d3-sankey** from CDN (both lazy-loaded on first Agreement Dashboard render).
- **§6.8** site-wide React router, **Settings** Fibery sync button tied to a separate static app.
- **§8** “persisted thresholds in `DashboardThresholds` DB” — v1 uses **code constants** with optional Script Property overrides (FR-56a).
- **Fly.io, Resend, MCP** as mandatory parts of the shipped FOS Web App (Fibery is queried over its REST API).

## Branding (normative summary)

Copy **`agreement-dashboard-prd-v2.md` §9.5–§9.7** into the Agreement Dashboard panel scope:

- Surfaces: `--bg` `#061B30`, `--surface` `#092747`, borders `#1a4060`, text `#FFFEFC` / muted `#A0AEC0`.
- Accents: `#52C9E5`, `#007FA7`, `#20B4C4`, `#43D6BA`; danger **`#fc5c65`** only for errors / negative margin / critical alerts.
- **Inter** (Google Fonts) weights 400–800; base **14px** on dashboard body.
- Brand mark: rendered **once** in the app sidebar as `.fos-brand-logo` (`https://harpin.ai/wp-content/uploads/logo.svg`). The Agreement Dashboard panel header (`#panel-agreement-dashboard`) intentionally has **no** in-panel logo as of v1.13.0; the prior 32px logo + 28px `.agreement-logo-sep` divider were removed for cross-dashboard consistency with the Utilization Management Dashboard.
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
| `FIBERY_HOST` | Fibery workspace host (no scheme, e.g. `harpin-ai.fibery.io`) | — (required) |
| `FIBERY_API_TOKEN` | Fibery API token; never returned to the client | — (required) |
| `AGREEMENT_CACHE_TTL_MINUTES` | Default seed TTL for the client selector | `10` |
| `AGREEMENT_THRESHOLD_LOW_MARGIN` | §6.2 warning threshold (%) | `35` |
| `AGREEMENT_THRESHOLD_INTERNAL_LABOR` | §6.4 internal-labor threshold ($) | `5000` |
| `AGREEMENT_THRESHOLD_EXPIRY_DAYS` | §6.6 renewal/expiry warning window (days) | `60` |
| `AGREEMENT_TOP_N_RECOGNITION_BARS` | §7.9 top-N agreements in stacked bar | `10` |
| `AGREEMENT_INTERNAL_COMPANY_NAMES` | §8.6 comma-separated internal company names | `harpin.ai` |
| `AGREEMENT_SANKEY_LINK_OPACITY` | §7.11 link-band fill opacity (0–1) | `0.35` |
| `AGREEMENT_SANKEY_INCLUDE_INTERNAL` | §7.11 include `Internal`-type agreements in the Sankey | `false` |

## Acceptance criteria (testable)

- [x] **Given** an authorized user, **when** they click **Agreement Dashboard**, **then** the main area shows the **agreement-branded** panel (not the generic “coming soon” modal) with header, KPI strip, Attention items, four Chart.js charts (Status / Type Mix donuts, Recognition stacked bar, Customer Contract Value bar), Customer Relationship Cards, Forward Revenue Pipeline, Financial performance tabs, the D3 Revenue Flow Sankey, **Refresh**, **Auto-refresh** selector, and **last refreshed** text.
- [x] **Given** a successful prior fetch and TTL = **Off**, **when** the user navigates away and back to Agreement Dashboard, **then** the UI repopulates from **sessionStorage** without a server round-trip until Refresh.
- [x] **Given** a successful prior fetch and TTL = **10 min** (default), **when** the user returns after > 10 minutes, **then** the cache renders immediately, the **Stale** badge appears, and a background refresh is dispatched. On success, the badge clears and `last refreshed` updates.
- [x] **Given** the user clicks **Refresh**, **when** the server responds successfully, **then** cache and UI update and **last refreshed** matches server `fetchedAt`.
- [x] **Given** the server returns an error (e.g. missing `FIBERY_API_TOKEN`), **then** the user sees a clear message and **prior** cache remains visible if present.
- [x] **Given** an unauthorized session, **then** `google.script.run` handlers do not return dashboard data (**NOT_AUTHORIZED**).

## Components / files

| File | Role |
| --- | --- |
| `src/DashboardShell.html` | Agreement Dashboard panel markup (`#panel-agreement-dashboard`), agreement CSS tokens, nav routing for route id `agreement-dashboard`, cache + refresh + TTL client script, Chart.js + D3 lazy loaders, render functions. |
| `src/fiberyAgreementDashboard.js` | `getAgreementDashboardData()` orchestrator: queries, normalization, enrichment, KPIs, alerts, chart VMs, financial table; `getAgreementCacheTtlMinutes()`; `_diag_*` editor helpers. |
| `src/fiberyClient.js` | `UrlFetchApp` wrapper for batched `/api/commands` calls; credential read; error mapping; ping helper. |
| `src/agreementThresholds.js` | §8.1–§8.6 constants, color maps, margin bucket helper, internal-company predicate, Script Property override loader. |
| `src/agreementAlerts.js` | §6.1–§6.7 rule evaluators + severity sorter. |
| `src/authUsersSheet.js` | Reuse `requireAuthForApi_()` (no change in this feature). |
| `docs/FOS-Dashboard-PRD.md` | **§7** agreement dashboard contract; FR-52–FR-56b; AC-14, AC-19; version **1.8**. |

## Phase B + Phase C — delivered v1.10.0

- **§7.6 Customer Relationship Cards** — `buildCustomerCards_` reads the already-fetched `companies` array (no new server query), computes initials, picks the §8.5 palette color (or the §8.3 Internal color for internal entities), sorts by TCV desc with internal companies pushed to the bottom. Client renders a scrollable vertical list of cards.
- **§7.8 Forward Revenue Pipeline** — `buildForwardPipeline_` aggregates `futureRevenueItems` by agreement, computes the §5.5 monthly billing rate (`SUM(targetAmount) ÷ distinct calendar months`), and returns one row per non-Internal agreement (including active agreements with no future items, surfaced with `monthlyRate: null` for the §5.6 "No Pipeline Items" treatment). The client renders a vertical bar list (not Chart.js — needed per-row opacity + dashed border for unscheduled rows).
- **§7.11 Revenue Flow Sankey** — `buildSankey_` builds `{nodes, links}` per §7.11.7 (Status → Customer → Type), using §8.2 / §8.5 / §8.3 colors per layer; `(Unassigned)` / `(No Status)` fallback nodes for null relations (§7.11.8); `Internal`-type agreements filtered out unless `AGREEMENT_SANKEY_INCLUDE_INTERNAL = true`. The client lazy-loads D3 v7 + d3-sankey from jsDelivr, applies the §7.11.4 sizing rules (20px node width, 12px padding, height `max(400, node_count × 28)` capped at 900), draws nodes as rounded rectangles, and renders links as source→target color gradients at `AGREEMENT_SANKEY_LINK_OPACITY` (default 0.35). Native SVG `<title>` tooltips show name, value, and percent-of-portfolio per §7.11.5.

## Execution notes

- Chart libraries: **Chart.js v4** for §7.3 / §7.4 / §7.9 / §7.10 and **D3 v7 + d3-sankey** for §7.11 — both lazy-loaded from jsDelivr on first Agreement Dashboard panel render to keep the Home payload light. §7.5 / §7.6 / §7.7 / §7.8 render with plain HTML/CSS.
- Thresholds and palettes: defaults from agreement **§8** in code (`src/agreementThresholds.js`); Script Properties overlay at request time (FR-56a, FR-56c).
- Diagnostics: run **`_diag_pingFibery`** and **`_diag_sampleAgreementPayload`** from the Apps Script editor to verify credentials and inspect raw Fibery row shapes after a schema change.

## Possible follow-ups (not in scope for v1.10.0)

- Sankey node click-to-isolate (§7.11.9 selected-state) — currently every band is rendered at the same opacity; clicking a node could fade unrelated links to 0.1.
- Customer color persistence across renders if customers churn between refreshes — today the palette cycles by sorted TCV order each render.
- Optional Sankey node-grouping when more than ~30 customers exist (consolidate the long tail).

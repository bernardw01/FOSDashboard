# Feature: Agreement / Finance dashboard (Fibery + client cache)

> **PRD version 1.6** — see `docs/FOS-Dashboard-PRD.md`.

## Goal

Deliver the **initial Agreement Management / revenue-style dashboard** in the FOS Web App **Finance** route: visuals and semantics aligned with `docs/agreement-dashboard-prd-v2.md` **§7 (components), §8 (thresholds/colors), and §9.5–§9.7 (design system / brand / layout)**, with **data live from Fibery** via authorized server handlers and **no persistent server-side datastore** for dashboard payloads. Use a **browser cache** (e.g. `sessionStorage`) for speed, plus a **Refresh** control that re-fetches from the server and updates the cache.

## User stories

- As an **authorized user**, I want to open **Finance** and see the **agreement dashboard layout** (header, KPI strip, placeholders for charts) with **harpin** branding consistent with the agreement PRD.
- As a **user**, I want the dashboard to **load quickly** when I return in the same session by reading **cached** data while still seeing **when** data was last refreshed.
- As a **user**, I want **Refresh** to pull the **latest** Fibery-backed payload from the server and update the UI and cache on success.
- As an **admin**, I want **no Fibery tokens or secrets** in the client or in cached JSON beyond what is already safe for the browser (no API keys).

## Pulled from `agreement-dashboard-prd-v2.md` (in scope for Apps Script)

| Agreement PRD | FOS interpretation |
| --- | --- |
| **§3** Fibery model | Normative in FOS **`## 6)`**; connector field paths must match. |
| **§4** Queries | Server-side Fibery (Graph) queries; normalize to view models. |
| **§5** Computed values | Same formulas in Apps Script (or Fibery-side if precomputed). |
| **§6** Alerts | Attention panel rules; severity ordering. |
| **§7.1** Page header | Logo 32px, separator, title `Agreement Management Dashboard`, subtitle with counts/date. |
| **§7.2** KPI summary bar | Six cards, tooltips, compact number formatting (4 digits rule). |
| **§7.3–7.11** Charts/tables | Same **data meaning** and colors (**§8**); implementation via **Chart.js / CDN** or similar instead of Recharts/D3 npm. |
| **§8** Thresholds & color maps | Constants in server or shared client config; no separate admin DB until product asks for it. |
| **§9.5–9.7, §9.6** Branding | CSS variables, Inter, deep navy surfaces, cyan/teal accents, logo URL, card geometry, grid breakpoints. |

## Explicitly ignored (deployment / stack-specific)

- **§9.1** static handoff / `file://` single HTML file as the product artifact.
- **§9.2** shadcn/ui + React component tree.
- **§9.3** npm generation / Tailwind build pipeline.
- **§9.4** Recharts + D3 **as npm-only** requirement — replace with **CDN** charting where needed.
- **§6.8** site-wide React router, **Settings** Fibery sync button tied to a separate static app.
- **§8** “persisted thresholds in `DashboardThresholds` DB” — v1 uses **code constants** or Script Properties if we add operator tuning later.
- **Fly.io, Resend, MCP** as mandatory parts of the shipped FOS Web App (Fibery may still be queried by server using HTTP API).

## Branding (normative summary)

Copy **`agreement-dashboard-prd-v2.md` §9.5–§9.7** into the Finance panel scope:

- Surfaces: `--bg` `#061B30`, `--surface` `#092747`, borders `#1a4060`, text `#FFFEFC` / muted `#A0AEC0`.
- Accents: `#52C9E5`, `#007FA7`, `#20B4C4`, `#43D6BA`; danger **`#fc5c65`** only for errors / negative margin / critical alerts.
- **Inter** (Google Fonts) weights 400–800; base **14px** on dashboard body.
- Logo: `https://harpin.ai/wp-content/uploads/logo.svg` at **32px** height in page header; `onerror` hide; **1px** separator `rgba(82,201,229,0.3)` **28px** tall between logo and title.
- Cards: **20px** padding, **12px** radius, **1px solid** border; grid collapses **≤900px**; scrollbar **4px** track `var(--border)`.

## Client cache contract

- **Key:** `fos_agreement_dashboard_v1` (prefix + schema version).
- **Value:** JSON string of last **successful** server payload (include `fetchedAt`, `cacheSchemaVersion`, normalized arrays).
- **TTL (optional):** If implemented, store `expiresAt` in the same object; when expired, UI shows “stale” and still renders cache until Refresh succeeds.
- **Secrets:** Never store Script Properties or raw Fibery tokens in `sessionStorage` / `localStorage`.

## Server contract (initial)

- **`getAgreementDashboardData()`** (or equivalent name): `requireAuthForApi_()`; returns normalized object; **stub** may return empty arrays with `partial: true` until Fibery is wired.
- **No** writing dashboard payloads to Script Properties/Sheet for this feature.

## Acceptance criteria (testable)

- [ ] **Given** an authorized user, **when** they click **Finance**, **then** the main area shows the **agreement-branded** panel (not the generic “coming soon” modal) with header, KPI placeholders or values, **Refresh**, and **last refreshed** text.
- [ ] **Given** a successful prior fetch, **when** the user navigates away and back to Finance, **then** the UI repopulates from **sessionStorage** without a server round-trip until Refresh (or TTL policy if added).
- [ ] **Given** the user clicks **Refresh**, **when** the server responds successfully, **then** cache and UI update and **last refreshed** matches server `fetchedAt`.
- [ ] **Given** the server returns an error, **then** the user sees a clear message and **prior** cache remains visible if present (unless product later specifies otherwise).
- [ ] **Given** an unauthorized session, **then** `google.script.run` handlers do not return dashboard data (**NOT_AUTHORIZED**).

## Components / files

| File | Role |
| --- | --- |
| `src/DashboardShell.html` | Finance panel markup, agreement CSS tokens, nav routing for `finance`, cache + refresh client script. |
| `src/fiberyAgreementDashboard.js` | `getAgreementDashboardData()` server stub and future Fibery `UrlFetchApp` implementation. |
| `src/authUsersSheet.js` | Reuse `requireAuthForApi_()` (no change unless shared helpers move). |
| `docs/FOS-Dashboard-PRD.md` | **§7** agreement dashboard contract, **FR-52–FR-56**, version **1.5**. |

## Execution notes

- Chart library: prefer **Chart.js** from jsDelivr CDN on the Finance panel only, to stay within HtmlService limits.
- Thresholds: start with defaults from agreement **§8.1** in code; document keys for future Script Properties override.

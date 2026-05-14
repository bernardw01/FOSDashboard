# Feature: Dashboard shell and navigation (FOS Web App)

> **PRD version 1.27.0** — see `docs/FOS-Dashboard-PRD.md`.

## Goal

Deliver a **responsive** Google Apps Script Web App shell: **left navigation** (including **Settings** rendered as a **plain navigation-style link** with a **gear** icon at the **bottom of the sidebar** — no outlined button, no pill chrome), **main content area**, with **Home** as the primary landing view. The **Agreement Dashboard** entry (route id `agreement-dashboard`; legacy `finance` retired in v1.11.0, historical log rows still queryable) is activated as the agreement dashboard shell (**`docs/features/003-agreement-dashboard-fibery-client-cache.md`**). The **Operations** entry (route id `operations`) is activated as of v1.12.0 as the **Utilization Management Dashboard** (**`docs/features/005-utilization-management-dashboard.md`**). **Delivery** and **Settings** still show a **“Coming soon”** dialog until those pages are built. Visual chrome — sidebar, topbar, Home card, modals, scrollbars, not-authorized page, Agreement Dashboard panel, and Operations panel — draws from a single set of root CSS variables defined per **`docs/agreement-dashboard-prd-v2.md` §9.5 (Design System)**, **§9.6 (Brand Identity)**, and **§9.7 (Layout)** (FR-50, AC-18). Lay groundwork for **role-based menu visibility** without activating full RBAC yet.

## User Stories

- As an **authenticated Workspace user**, I want a **clear layout** (menu + main panel) so I can orient myself in the FOS Dashboard.
- As a **user with limited access**, I want the **sidebar to only list dashboards I am allowed to see** (stubbed in v1; wiring documented below).
- As any **user**, I want **Settings** and **inactive** dashboard links to respond with an explicit **coming soon** message instead of a broken page.

## Acceptance Criteria (testable)

- [ ] **Given** the Web App is opened as **Execute as: User accessing the web app**, **when** the page loads, **then** the user sees a **left nav** (with **Settings** at the bottom of the nav), **main panel**, and no separate fixed footer bar for Settings.
- [ ] **Given** the viewport is **desktop width**, **when** the layout renders, **then** the sidebar stays **visible** beside the main panel without overlapping content.
- [ ] **Given** the viewport is **narrow (mobile)**, **when** the user opens the **menu control**, **then** the sidebar is usable (drawer/overlay) and can be dismissed without trapping focus permanently.
- [ ] **Given** the user clicks **Home**, **when** the click completes, **then** the main panel shows **home content** (placeholder welcome is acceptable) and **no** “coming soon” dialog for Home.
- [ ] **Given** the user clicks any **non-activated dashboard** nav item, **when** the click completes, **then** a **modal or native dialog** appears with a **coming soon** message and a clear **dismiss** action.
- [ ] **Given** the user clicks **Settings** at the bottom of the left nav, **when** the click completes, **then** the same **coming soon** pattern appears (not a navigation to a new URL). Settings is rendered as a navigation-style link (`<a>` element with the `.fos-nav-btn` class, gear icon + label, identical chrome to other nav entries) — **not** as an outlined or pill button.
- [ ] **Given** any rendered surface (sidebar, topbar, Home card, “coming soon” modal, not-authorized page, Agreement Dashboard panel), **when** inspected, **then** every color and font value resolves through the root CSS variables defined per `agreement-dashboard-prd-v2.md` §9.5 (`--bg #061B30`, `--surface #092747`, `--accent #52C9E5`, `--text #FFFEFC`, `--border #1a4060`, …, **Inter** 14px base); the `.fos-agreement-root` scope aliases `--ag-*` to those globals rather than declaring a parallel palette.
- [ ] **Given** the server builds the nav model, **when** the model is produced, **then** it contains **only** entries the user is allowed to see (v1 may use a **stub filter**; document the contract in code comments and this spec).

## UI Notes

- **Routes/pages impacted**: Single-page shell only (`doGet` → `DashboardShell.html`). No additional Html files for Home/Settings/dashboard bodies in this feature.
- **Components to create/edit**:
  - `src/DashboardShell.html` — layout, nav (icons + labels; **Settings** rendered as a `.fos-nav-btn` `<a>` link at the bottom of the sidebar), main, Bootstrap modal for “coming soon”, responsive offcanvas sidebar. Root CSS variables (`--bg`, `--surface`, `--surface2`, `--border`, `--accent`, `--accent2/3/4`, `--text`, `--text-muted`, `--text-dim`, `--danger`, `--warn`) are declared once at `:root` per `agreement-dashboard-prd-v2.md` §9.5; the `.fos-agreement-root` scope aliases `--ag-*` to those globals.
  - `src/NotAuthorized.html` — same root tokens (deep navy `--bg`, surface card, 12px radius, Inter typography) so the access-denied page matches the rest of the app.
  - `src/Code.js` — `doGet`, `getDashboardNavigation_()` (or equivalent) for nav + user hints passed to template or client.
- **Design**: Desktop-first responsive; sidebar **~280px** on large screens; **Bootstrap 5** themed with the **`agreement-dashboard-prd-v2.md` §9.5 design tokens** and **§9.6 brand identity** — deep-navy `#061B30` background, surface `#092747`, cyan `#52C9E5` primary accent, off-white `#FFFEFC` text, **Inter** typography 400–800 at 14px base, **12px** card border-radius and **20px** card padding (§9.7), **1px** borders in `#1a4060`, custom **4px** scrollbars with `var(--border)` track and `var(--accent2)` thumb. The single pill-style action button (`.btn-fos-primary`, used by the “coming soon” modal close button and equivalents) stays pill-shaped; the Settings control at the bottom of the sidebar is a nav-style link (no button chrome) per FR-10b.

## Data Model

- **Entities**: None persisted in this feature.
- **Server inputs**: `Session.getActiveUser()` email (and optional display name where available) for future RBAC; **no PII** logged beyond operational need.
- **Navigation model** (conceptual): `{ userEmail, items: [{ id, label, route, enabled }] }` where `enabled === false` items are omitted or hidden; inactive routes still appear in nav but open “coming soon” when `activated === false` (or separate flag `isPlaceholder: true`).

## Operations

- **Queries**: `Session.getActiveUser()` for identity; optional `google.script.run` to refresh nav if extended later.
- **Actions**: None that mutate data; dialog open/close is client-only.

## Edge Cases

- **User email empty** (rare in Web App “User accessing”): show safe fallback label (“Signed-in user”) and still render shell.
- **Script running inside editor preview**: `google.script.run` behavior differs; verification should use **deployed Web App** URL.
- **Keyboard / a11y**: Dialog dismiss via Escape and a visible **Close** control; focus moves to dialog when opened.

## Verification Steps

1. Deploy (or update deploy) as Web App: **Execute as: Me** or **User accessing web app** per your security model; **Who has access** limited to harpin domain if required.
2. Open the deployment URL in a browser (not only the editor preview).
3. Resize to **mobile width** (~375px): open/close sidebar; confirm main content remains usable.
4. Click **Home**: main panel updates or stays on home; **no** coming soon for Home.
5. Click **Delivery**: **coming soon** dialog appears and dismisses cleanly. Click **Agreement Dashboard**: agreement dashboard panel appears (not the coming soon modal). Click **Operations**: the **Utilization Management Dashboard** panel appears (`#panel-operations`, activated in v1.12.0 — see **`docs/features/005-utilization-management-dashboard.md`**), not the coming soon modal.
6. Click **Settings** (bottom of left nav, rendered as a gear-icon **link** styled like the other nav entries): **coming soon** modal appears; URL hash does **not** change (the click handler calls `preventDefault()`).

## Implementation Checklist

- [x] Add `DashboardShell.html` with responsive layout + dialog.
- [x] Wire `doGet` in `Code.js`; nav loaded via `google.script.run.getDashboardNavigation()` on page load.
- [x] Stub **authorization filter** (`filterNavItemsForUser_` in `Code.js`: full menu for `@harpin.ai`, **Home only** for other domains / empty email).
- [x] Promote **`agreement-dashboard-prd-v2.md` §9.5–§9.7** tokens to the document root (`--bg`, `--surface`, `--accent`, `--text`, `--border`, …); alias `--ag-*` inside `.fos-agreement-root` to the globals so there is a single palette across the app.
- [x] Apply the same root tokens to `src/NotAuthorized.html` (deep-navy surface, 12px radius, Inter, off-white text).
- [x] Promote the **4px custom scrollbar** (track `var(--border)`, thumb `var(--accent2)`) out of the agreement scope and onto the whole document.
- [x] Replace the outlined Settings pill button with a `.fos-nav-btn` `<a>` link at the bottom of the sidebar (gear icon + “Settings”); add `event.preventDefault()` to the click handler so `href="#"` does not scroll the page.
- [x] Delete the legacy `.btn-fos-sidebar-footer` CSS block and the legacy `--harpin-navy*` / `--harpin-teal*` palette from `DashboardShell.html` / `NotAuthorized.html`.
- [ ] Manual Web App verification (steps above) on a **deployed** URL (`Execute as: User accessing the web app` recommended for real `Session.getActiveUser()`).
- [x] `clasp push` succeeds; no secrets sent to the client (only labels + user display string).

## Execution Plan

| Phase | What | Outcome |
| --- | --- | --- |
| **1. Shell & static layout** | Add `DashboardShell.html` with semantic regions (`nav`, `main`, sidebar footer for Settings), Bootstrap + theme CSS, and empty states. | Pixel-stable desktop layout. |
| **2. Responsive nav** | Implement sidebar + mobile drawer (toggle, backdrop, `aria-expanded`). | Usable on phone and desktop. |
| **3. Client behaviors** | Home switches main panel content; other nav + Settings open shared **coming soon** Bootstrap **modal**. | Matches “not activating those pages” requirement. |
| **4. Server contract** | `doGet` + `getDashboardNavigation_()` builds allowed menu from email + stub rules; pass into template. | Single source of truth for “what appears in nav.” |
| **5. Hardening** | Focus trap / Escape, empty email fallback, basic contrast checks. | Fewer a11y and edge-case surprises. |
| **6. Deploy & doc** | Web App deploy, add verification notes to this file’s checkboxes. | Stakeholders can try the shell. |

### Follow-up (not this feature)

- Real **dashboard modules** (separate HTML partials or client routes) and **Settings** page content.
- **Authorization source** (Sheet, Fibery, Groups, or Directory API) replacing stub filter.
- **Audit logging** of page views if required by security policy.

# Mobile shell - Phase A and B (Home, Agreements, Pipeline)

> **PRD version 2.20.1** - see `docs/FOS-Dashboard-PRD.md` (**FR-123**, **AC-82**).

## Goal

Improve phone and narrow-viewport use of the FOS Dashboard Web App with a **mobile shell** (bottom navigation, top-bar data source control, reusable filter bottom sheet) and **mobile-first layouts** for **Home**, **Agreements**, and **Pipeline** without changing server payloads or cache contracts.

## Status

**Delivered v2.20.0**

## User stories

- As a **mobile user**, I want **primary dashboards one tap away** so I do not hunt through the full sidebar tree on a phone.
- As a **mobile user**, I want **Live vs snapshot** visible in the top bar so I know what data I am viewing without opening the menu.
- As an **executive on the go**, I want **Home** to surface quick links and top agreement attention items so I can see what needs follow-up before opening a full dashboard.
- As a **sales or ops user on a phone**, I want **Agreements** and **Pipeline** KPIs and alerts first, with charts optional behind a toggle, so the screen stays scannable.

## Acceptance criteria (testable)

- [ ] **Given** viewport width **&lt; 768px**, **when** navigation loads, **then** a fixed **bottom nav** shows **Home**, **Agreements**, **Ops**, **Delivery**, and **More** (items omitted when the user lacks access); **More** opens the existing offcanvas sidebar.
- [ ] **Given** mobile width, **when** the top bar renders, **then** a **data source pill** shows the active Live or snapshot label and opens a **bottom sheet** to change source (same behavior as the sidebar `<select>`).
- [ ] **Given** mobile width on **Home**, **when** the panel is visible, **then** **Quick access** cards (authorized routes only) and up to **three** agreement attention items from browser agreement cache appear when cache exists; **View agreements** navigates to Agreements.
- [ ] **Given** mobile width on **Agreements**, **when** the panel opens, **then** KPIs render in a **2×2** grid, **attention items** stay visible, **financial table** filter uses the bottom sheet, and **charts / Sankey / customer cards** are hidden until **Show charts** is tapped.
- [ ] **Given** mobile width on **Pipeline**, **when** multiple pipeline views exist, **then** the view picker uses the bottom sheet; KPIs use **2 columns**; forecast chart and funnel are hidden until **Show charts** is tapped.
- [ ] **Given** desktop width **≥ 768px**, **when** the shell renders, **then** bottom nav, mobile data source pill, and mobile-only controls are hidden; sidebar data source remains available.

## UI notes

- **File:** `src/DashboardShell.html` only (client layout/CSS/JS).
- **Phase A:** `#fos-mobile-bottom-nav`, `#fos-mobile-filter-sheet`, `#fos-mobile-data-source-btn`, `body.fos-mobile`, `wireMobileShellOnce_()`, `openMobileFilterSheet_()`.
- **Phase B:** `#fos-home-quick-grid`, `#fos-home-glance-section`; Agreement/Pipeline mobile toolbar buttons and `.fos-*-mobile-extra` sections.

## Data model

- No server or cache schema changes.
- Home glance reads **`readAgreementCache()`** client-side only (best-effort; empty when no cache).

## Operations

- **Activity (whitelist in `userActivityLog.js`):** `mobile_bottom_nav`, `mobile_data_source_open`, `mobile_filter_sheet_open`, `mobile_filter_sheet_select`, `home_quick_nav`, `agreement_mobile_charts_toggle`, `pipeline_mobile_charts_toggle`.

## Edge cases

- Users without **Agreements** in nav: bottom **Agreements** item hidden; home glance hidden.
- **Pipeline** quick link and view sheet hidden when `pipelineAccess === false`.
- Filter sheet no-ops on desktop (`isLargeViewport()`).
- Opening Agreements/Pipeline resets **charts open** state to collapsed on each visit.

## Verification steps

1. `clasp push` and open the deployed Web App on a phone or DevTools device mode (~390px width).
2. Confirm bottom nav switches Home, Agreements, Ops, Delivery; **More** opens sidebar.
3. Tap data source pill; pick a snapshot; confirm banner and pill label update.
4. On **Home**, confirm quick cards and glance items (after visiting Agreements once to populate cache).
5. On **Agreements**, confirm 2×2 KPIs, **Filter** sheet for financial tabs, **Show charts** reveals donuts/Sankey.
6. On **Pipeline** (Client Engagement / Exec / Admin), confirm view sheet and chart toggle.
7. Widen to desktop: bottom nav and mobile controls hidden.

## Implementation checklist

- [x] Mobile shell CSS, bottom nav, filter sheet, data source pill
- [x] Home quick access + agreement glance
- [x] Agreement + Pipeline mobile layouts
- [x] Activity whitelist + PRD **2.20.0**

## Changelog

| Version | Date | Notes |
| --- | --- | --- |
| 2.20.1 | 2026-06-09 | Fix: `agreementAttentionKindLabel_` syntax error blocked all mobile shell JS; viewport meta + early chrome init. |
| 2.20.0 | 2026-06-09 | Initial delivery: Phase A shell + Phase B Home/Agreements/Pipeline mobile layouts. |

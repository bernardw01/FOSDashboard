# Feature: Monthly Revenue Review (under Delivery)

> **PRD version 1.27.0** — see `docs/FOS-Dashboard-PRD.md` (must match `src/` file headers and `FOS_PRD_VERSION` in `Code.js` when this feature ships).

> **Imported baseline PRD:** `docs/implementation-notes/revenue-review-dashboard-PRD.html` (static generator spec, v2.4 narrative + changelog through 2.1).  
> **Reference UI (imported example):** `docs/implementation-notes/revenue-review-may-2026.html` (May 2026 report layout, KPIs, tables, alerts, milestone `<details>` hierarchy, pre-recognition banner).  
> **Parent product baseline:** `docs/FOS-Dashboard-PRD.md` — **FR/AC to be added** when the feature is scheduled for release (mirror pattern used for Labor hours: **FR-101** / **AC-56** etc.).

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| **Phase A — Nav + shell + cache binding** | **Delivery** becomes a **nav group** (label **Delivery**) with children **Delivery** (existing `delivery` route / `#panel-delivery`) and **Revenue review** (new route, e.g. `revenue-review`, `#panel-revenue-review`). New panel uses **Agreement** dark chrome; reads **`fos_agreement_dashboard_v2`** (and in-memory agreement payload if present); **Refresh** triggers `getAgreementDashboardData()` when stale/missing (same auth + TTL patterns as Agreement Dashboard). | **Released (v1.25.0)** |
| **Phase B — Executive KPIs + alerts** | Six KPI cards per imported §4.2 (portfolio value, recognized, prior month close, current month invoiced, variances, overdue/at-risk); **Agreement expiry** strip §4.3; **Future revenue pre-recognition** banner (example + imported changelog 1.6 — purple callout when recognized + future target date + not invoiced). | **Released (v1.25.0)** |
| **Phase C — Tables + portfolio** | Prior-month and current-month **milestone billing** tables §4.4–4.5; **Agreement portfolio** §4.6; **Revenue by customer** §4.7; **Overdue / at-risk** §4.8; client-side **sortable** columns §4.10; optional **Copy CSV** / print (follow Labor hours / Delivery patterns). | **Released (v1.26.0)** |
| **Phase D — Milestone drill-down + polish** | **Full milestone detail** §4.9 (`<details>` by customer → agreement); variance table / KPI scroll behavior aligned with **latest** imported PRD changelog (combined amount + date variance KPI 2.0+ if product confirms); activity logging (`revenue_review_*` or nested route labels); main PRD + version bump. | **Released (v1.26.0)** |
| **Phase E — Customer drill + Fibery Companies link (v1.27.0)** | Milestone detail groups strictly by **agreement Customer** then **agreement**; **Revenue by customer** row opens the shared side drawer (company + panel rollups); **Open in Fibery** to Companies when `fibery_access` and `publicId` present. | **Released (v1.27.0)** |

## Goal

Ship a **Monthly Revenue Review** surface for leadership / finance **inside the Web App**, nested under **Delivery** alongside the existing **Delivery** (projects + P&L) dashboard. It reproduces the **intent and layout** of the imported static HTML report and PRD, but:

1. Uses **existing FOS dark branding** (`agreement-dashboard-prd-v2.md` §9.5–9.7 / `:root` + `.fos-agreement-root` in `DashboardShell.html` — same tokens as Agreement + Delivery + Labor hours), **not** the example’s cream page background.
2. Derives metrics **from the same Fibery-backed dataset** already loaded for the **Agreement Dashboard**: the browser cache `sessionStorage` key **`fos_agreement_dashboard_v2`** (`cacheSchemaVersion` per `src/fiberyAgreementDashboard.js`) and the in-memory payload after `getAgreementDashboardData()`, especially **`agreements[]`**, **`revenueItemsByAgreement`** (and raw **`historicalRevenueItems`** / **`futureRevenueItems`** if needed for edge cases).

Non-goal for v1: replacing the Python/static **file generator** workflow in the imported PRD; the Web App is the **interactive** counterpart. Optional later: “Export HTML” parity with `revenue-review-[month]-[year].html`.

## Mapping: imported PRD → in-app design

| Imported § | Topic | In-app approach |
| --- | --- | --- |
| §1 | Purpose / audience | Same personas; panel subtitle states **review month** (prior + current) and **as-of** date from `payload.fetchedAt`. |
| §2 | Fibery entities | **No new connector** for v1: reuse normalized shapes already produced by `getAgreementDashboardData()` in `src/fiberyAgreementDashboard.js`. |
| §3 | Inclusion rules | Replicate in **client filter**: exclude **Internal** agreement type; exclude agreement **name** containing `test` (case-insensitive). **Contract Complete** still in portfolio; excluded from **expiry alerts** only (PRD §5.4). |
| §4.1–4.10 | Sections + sort | Build sections in order; sortable headers = client-side sort on row arrays (mirror Delivery / Labor hours). |
| §5 | Business logic | Port rules (variance window, on-time, overdue, % collected from agreement-level recognized) into pure functions in the shell (or a small `revenueReviewViewModel.js` **if** we split for size — start inline). Resolve **PRD vs changelog drift** (variance KPI 1.x vs 2.0+) with product before coding KPI copy. |
| §6 | Colors | Map imported badge hexes to **semantic roles** using existing CSS variables (`--ag-danger`, `--ag-warn`, `--accent4`, `--ag-text-muted`, etc.). |
| §7–8 | Refresh / caveats | **Refresh** = same agreement fetch path as Agreement panel; surface `payload.warnings` / `partial` if present. Document **§8.1** pre-recognition / future-dated recognized mismatch in UI copy or footnote. |
| §9–10 | File output / rebuild | Out of scope for Phase A–C; optional Phase E “Download HTML snapshot”. |

## Data strategy (cache-first)

1. **Primary source:** `readAgreementCache()` / equivalent in `DashboardShell.html` — same object written by Agreement Dashboard refresh (`AGREEMENT_CACHE_KEY` = `fos_agreement_dashboard_v2`).
2. **When cache is missing or stale** (TTL / user hits **Refresh** on Revenue review): call `google.script.run.getAgreementDashboardData()` — **same** endpoint as Agreement Dashboard; **do not** add a second Fibery orchestrator unless profiling shows payload gaps.
3. **Field parity:** Confirm each PRD milestone column exists on normalized revenue item rows (e.g. `targetDate`, `actualDate`, `targetAmount`, `actualAmount`, variance, `recognized`, workflow `state`, QBO id if exposed). Document any **renamed** fields in this feature file during implementation (`docs/features/003-agreement-dashboard-fibery-client-cache.md` cross-check).
4. **Delivery panel independence:** Users may open **Revenue review** without visiting Agreement first; the panel must **lazy-fetch** agreement data using the same loading overlay pattern as other `fos-agreement-root` panels.

## Navigation model

Mirror **Operations** group in `src/Code.js` → `buildNavigationModel_()`:

- Replace flat `{ id: 'delivery', label: 'Delivery', ... }` with a **group** `{ type: 'group', id: 'delivery-group', label: 'Delivery', children: [ { id: 'delivery', label: 'Projects & P&L' }, { id: 'revenue-review', label: 'Revenue review' } ] }` (labels TBD in PR review).
- `src/DashboardShell.html`: extend `NAV_ICONS`, `onNavClick`, `setActiveNav`, panel visibility (`#panel-revenue-review`), top bar title, and **lazy wiring** for the new panel (same pattern as `showDelivery` / `showLaborHours`).

**Route id:** recommend **`revenue-review`** (kebab-case, distinct from `delivery`). Activity log **Route** column should match the child route id for queryability.

## Branding

- **Container:** `#panel-revenue-review.fos-agreement-root` + inner `.fos-agreement-inner` (loading overlay, section cards).
- **Do not** port the example’s full-page cream `#F2EFE5` body — keep **dark** dashboard chrome consistent with **Delivery** and **Agreement**.
- **KPI row:** reuse `.fos-agreement-kpi` + existing `kpi-*` / margin bucket classes where semantics align.
- **Tables:** reuse `.fos-util-detail-table` or Delivery-style scoped table classes after a quick visual pass with design.

## Implementation plan (for review)

Below is a suggested **sequenced** plan. Phases can be split across PRs (e.g. A+B then C+D).

### Milestone R0 — Product / UX lock (0.5–1 d)

- [ ] Confirm **review month** UX: default = **calendar prior month + current month** with “as of” = today in user’s timezone vs explicit month picker (imported PRD assumes generator date).
- [ ] Confirm **variance KPI** definition: imported §4.2 table vs PRD HTML **changelog 2.0+** (combined amount + date variance); pick single source of truth.
- [ ] Confirm nav labels: **“Projects & P&L”** vs keeping **“Delivery”** as child label (avoid duplicate word with group).
- [ ] Decide **FR/AC numbers** reserved in main PRD for release (documentation gate).

### Milestone R1 — Navigation + empty panel (0.5–1 d)

- [ ] `src/Code.js`: `buildNavigationModel_()` — **Delivery group** + two children; JSDoc update for nav model union type.
- [ ] `src/DashboardShell.html`: `renderNav` already supports `type: 'group'` — verify `updateNavHintVisibility` / mobile offcanvas if needed.
- [ ] Add `#panel-revenue-review` placeholder (title, subtitle, Refresh, loading overlay id), `d-none` by default; `showRevenueReview()` + `onNavClick` branch; `setActiveNav` integration.
- [ ] `NAV_ICONS` entry for `revenue-review` (e.g. `bi-cash-stack` or `bi-graph-up-arrow`).
- [ ] Smoke: nav between Delivery child panels does not break Agreement cache.

### Milestone R2 — View-model from agreement payload (1–2 d)

- [ ] Implement `resolveRevenueReviewPayload_()` — read cache, validate `cacheSchemaVersion`, return `{ agreements, revenueItemsByAgreement, fetchedAt, warnings }` or null.
- [ ] Implement `filterAgreementsForRevenueReview_(agreements)` — Internal + test name exclusions (§3).
- [ ] Implement `buildRevenueReviewMonthBounds_(reviewDate)` — prior month + current month `yyyy-mm` for table filters.
- [ ] Unit-testable pure helpers (optional): `milestoneInPriorMonth_`, `milestoneInCurrentMonth_`, `isOverdueMilestone_`, `varianceEligible_` (§5.1), `onTimeIndicator_` (§5.2), expiry rules (§5.4).
- [ ] Wire **Refresh** to existing `fetchAgreementFromServer` or thin wrapper that reuses success path and then `renderRevenueReviewFromPayload_()`.

### Milestone R3 — KPIs + alert strips (1–2 d)

- [ ] Render six KPI cards with imported metrics; map colors to design tokens.
- [ ] **Expiry alerts** block (§4.3) — conditional render; exclude Contract Complete.
- [ ] **Pre-recognition** banner (example + changelog 1.6) — conditional; link to PRD §8.1 footnote in subtitle tooltip if useful.

### Milestone R4 — Tables + sorting (2–4 d)

- [ ] Prior month + current month milestone tables (exclude **Not Scheduled** from monthly tables per PRD §4.4–4.5).
- [ ] Portfolio table + customer rollup + overdue table (§4.6–4.8).
- [ ] Shared **sort** helper per table (column key + dir); persist sort state in lightweight `sessionStorage` key optional (nice-to-have).
- [ ] Empty states: no agreements after filter; no milestones in month.

### Milestone R5 — Milestone detail + exports (1–2 d)

- [ ] **§4.9** Collapsible groups (customer → agreement → milestone table) — reuse patterns from Labor hours `<details>` or Agreement modals as appropriate.
- [ ] **Copy CSV** for each major table or one combined export (product choice).
- [ ] `@media print` scoped rules + optional `beforeprint` expand (reuse Labor hours learnings).

### Milestone R6 — Activity, docs, release (0.5–1 d)

- [ ] `logActivity_` events: `nav_view`, `revenue_review_refresh`, `revenue_review_month_change` (if picker), `revenue_review_sort`, `revenue_review_export` — whitelist in `src/userActivityLog.js` per FR-63 extension pattern used for `labor_hours_*`.
- [ ] `docs/FOS-Dashboard-PRD.md`: new FR + AC rows; changelog; version bump.
- [ ] `README.md`: Operations-style row update for Delivery group + Revenue review.
- [ ] `docs/features/000-overview.md`: mark shipped when released.

### Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| **Payload size** — full `revenueItemsByAgreement` in `sessionStorage` | Reuse existing Agreement cache policy; if quota errors appear, document `sessionStorage` fallback behavior (already possible on Agreement). |
| **Field drift** — Fibery field renames vs normalized row | Single normalization path in `fiberyAgreementDashboard.js`; add integration comment + feature doc “Field mapping” subsection when implementing. |
| **PRD / changelog inconsistency** | Lock KPI + variance rules in **R0** before building cards. |

## Acceptance criteria (draft — lift to main PRD at ship time)

1. Authorized user sees **Delivery** group with **two** children; **Revenue review** opens `#panel-revenue-review` without breaking **Projects & P&L** (`delivery`).
2. With a warm **`fos_agreement_dashboard_v2`** cache, opening Revenue review **does not** require a second Fibery round-trip unless TTL stale / user Refresh (same contract as Agreement lazy behavior — exact rule to match current `applyAgreementPayload` / fetch gate).
3. **Internal** and **test** agreements are excluded everywhere this feature aggregates counts/totals, per §3.
4. **Prior month** / **current month** milestone tables match PRD column set and **Not Scheduled** exclusion rules for those tables.
5. **Expiry** and **pre-recognition** strips match PRD §4.3 / example §1.6 logic (including Contract Complete exemption for expiry).
6. Visual design matches **dark Operations / Agreement** tokens; no standalone cream theme for the panel body.

## References

- `docs/implementation-notes/revenue-review-dashboard-PRD.html` — authoritative business rules (imported).
- `docs/implementation-notes/revenue-review-may-2026.html` — layout and density reference.
- `docs/features/003-agreement-dashboard-fibery-client-cache.md` — cache key, TTL, payload overview.
- `docs/features/006-delivery-project-pnl.md` — sibling under Delivery; reuses agreement list.
- `docs/features/007-labor-hours-dashboard.md` — nested nav + panel pattern reference.
- `docs/agreement-dashboard-prd-v2.md` §9.5–9.7 — branding tokens.

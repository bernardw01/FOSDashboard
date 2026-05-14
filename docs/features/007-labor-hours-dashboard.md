# Feature: Labor Hours Dashboard (under Operations)

> **PRD version 1.26.0** — see `docs/FOS-Dashboard-PRD.md` (must match `src/` file headers and `FOS_PRD_VERSION` in `Code.js`).

> **PRD baseline (imported):** `docs/implementation-notes/labor-hours-dashboard-PRD (1).html` (v2.4, static Python report spec).  
> **Reference UI (imported example):** `docs/implementation-notes/labor-hours-week-of-2026-05-04.html` (week-of report with KPIs, tables, zero-hours chips, expandable project breakdown).  
> **Parent PRD:** `docs/FOS-Dashboard-PRD.md` — **FR-101 / AC-56** (Phase A, v1.22.0) + **FR-102 / AC-57** (Phase B, v1.23.0) + **FR-103 / AC-59** (Phases C–D, v1.24.0). This file remains the feature narrative for future tweaks.

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| **Phase A — Nav + panel shell + week slice** | Operations **sub-navigation** (Labor Hours vs existing Utilization view) · new route id + panel `#panel-labor-hours` · **ISO week** selector (Mon–Sun, default = last completed week) · wire to **existing labor rows** (see Data strategy) · KPI row aligned with PRD §6 (counts: total with time, over / under / on target vs weekly target) · single combined table **or** Over / Under / On-target sections (PRD §6) using **FOS dark branding** | **Released (v1.22.0)** |
| **Phase B — Parity with example report** | **Company** column · per-person **weekly hour target** (default / partner substrings / optional **`LABOR_HOURS_COMPANY_TARGETS_JSON`** exact company map) · **Zero hours** cohort (chips from `dimensions.persons` vs filtered week hours) · table sort (client-side) · KPI cards **scroll/jump** to Over / Under / On / Zero sections (click + Enter / Space) · optional **`LABOR_HOURS_EXCLUDED_PERSON_SUBSTRINGS`** on `userName` | **Released (v1.23.0)** |
| **Phase C — Project breakdown UX** | Rich **Projects** column: `<details>` per project with task lines, hours, and **% of person-week**; **+N more** caps for projects and tasks; **Expand** / **Collapse** all controls | **Released (v1.24.0)** |
| **Phase D — Polish** | Activity logging (`labor_hours_week_change`, `labor_hours_refresh`, `labor_hours_export`, `labor_hours_kpi_nav`, `labor_hours_sort`) · loading overlay reuse (existing) · **Copy CSV** · **print** stylesheet + `beforeprint` detail expansion | **Released (v1.24.0)** |

## Goal

Ship a **Labor Hours Dashboard** as a **second surface under Operations** (not a new top-level nav sibling to Agreement / Delivery). It answers the same operational questions as the imported PRD:

- Who logged **over** the weekly target, and by how much?
- Who logged **under** the target, and by how much?
- Who hit the target **exactly** (within float rules)?
- Which **projects** did each person’s time land in?

The in-app implementation **reuses the same Fibery source and normalization** as the Utilization Management Dashboard (`Agreement Management/Labor Costs`) and, where possible, **reuses the client-side utilization payload cache** so switching between “Utilization” and “Labor Hours” does not always trigger a redundant Fibery round-trip.

## Imported PRD vs example HTML (delta to reconcile)

| Topic | PRD (`labor-hours-dashboard-PRD (1).html`) | Example (`labor-hours-week-of-2026-05-04.html`) |
| --- | --- | --- |
| Buckets | Over **40h**, Under **40h**, Exactly **40h** | Over / Under / **On target** / **Zero** (5 KPI cards) |
| Target | Implicit 40 for all | **40h vs 45h** (and others) per **Company** column |
| Tables | Over table, Under table, Exactly chips | Full tables + Company + Target columns; **Zero** as chip list |
| Projects | Up to 3 names + “+N more” | Expandable `<details>` with % of person-week per project / task |

**Recommendation:** Treat the **example HTML** as the **target UX** for v1 in the Web App, but drive thresholds from **Script Properties** (default weekly target 40; optional **per-company** or **per-partner** target map in a later sub-phase). **Exactly 40** in the PRD should become **“on target”** defined as `abs(totalHours - targetHours) < epsilon` (e.g. 0.01h) once targets vary.

## Branding (FOS / Operations)

The imported files use a **light** theme (cream background, navy header). The Web App **must not** introduce a second visual system inside Operations.

- **Container:** reuse `#panel-operations` patterns: `.fos-agreement-root`, `.fos-section-card`, `.fos-agreement-kpi`, existing **loading overlay** (`.fos-loading-overlay`).
- **Tokens:** map semantic colors to existing CSS variables from `agreement-dashboard-prd-v2.md` §9.5–9.7 / `:root` in `DashboardShell.html`:
  - Over target → danger / warn accent (`--ag-danger`, `--warn` or stacked bar reds/oranges already used).
  - Under target → amber (`--ag-warn` / KPI yellow treatment).
  - On target → teal / success (`--accent4`, `--accent`).
  - Zero / muted → `--ag-text-muted`, `--ag-surface2`.
- **Typography:** **Inter**, 14px base — same as Utilization.

## Data strategy — connection to existing “cache”

**Normalized row shape** today: `getUtilizationDashboardData(rangeStart?, rangeEnd?)` in `src/fiberyUtilizationDashboard.js` returns paginated, normalized labor rows; the client stores the payload in `sessionStorage` under `fos_utilization_dashboard_v1` with `cacheSchemaVersion` (see feature **005**).

**Labor Hours** is a **different aggregation** over the **same rows**:

1. **Week bounds:** User picks an ISO week `[weekStartMon, weekEndSun]` (inclusive display; filter uses the same UTC boundary pattern as the imported PRD §4 / §9 — align with existing `startDateTime` filtering on rows).
2. **Cache hit:** If the in-memory or `sessionStorage` cached utilization payload already covers the week (`payload.range.start <= weekStart` and `payload.range.end >= weekEnd` in comparable ISO resolution), **derive** the Labor Hours view **entirely client-side** by filtering `payload.rows` — **no server call**.
3. **Cache miss / partial overlap:** Call `getUtilizationDashboardData(weekStartIso, weekEndIso)` with the **exact** week window (still bounded by `UTILIZATION_MAX_RANGE_DAYS` and auth). Optionally merge into a client-side “union range” cache policy (document tradeoff: larger cache vs fewer fetches).

**Important:** The Utilization dashboard’s **default** range is 90 days — opening Labor Hours for a week **older** than the cached range still requires a fetch with the week-specific bounds.

**Fields required** for PRD/example parity (already on normalized utilization rows unless noted):

| Need | Source (see feature 005) |
| --- | --- |
| Employee | `userName` / `userId` |
| Hours | `hours` (text-coerced) |
| Week bucket | `startDateTime` → ISO week (server may precompute `week` on row; confirm and reuse) |
| Project | `projectName` |
| Company | `clockifyUserCompany` (and internal labor flags if we hide internal-only rows — product choice) |
| Target hours | **New:** derive from company map or constant default |

## Navigation — “sub item under Operations”

Today `getDashboardNavigation()` returns a **flat** list (`home`, `agreement-dashboard`, `operations`, `delivery`) and `renderNav` builds one button per item.

**Planned UX (recommended):**

- **Operations** becomes a **group**: a non-navigating header or expandable parent with two children:
  - **Utilization** — existing panel (current `operations` route id **or** renamed to `operations-utilization` with redirect — **breaking change**; prefer keeping `operations` as Utilization for backward compatibility on activity logs).
  - **Labor hours** — new route id `labor-hours` (or `operations-labor-hours`).

**Alternative (lower shell churn):** Keep a single **Operations** nav button; inside `#panel-operations`, add a **top tab strip**: `Utilization | Labor hours` that toggles two inner panels. Same route id `operations`; activity log uses a `subview=labor_hours` label. **Tradeoff:** user asked for a “route”; inner tabs are weaker for deep links but simpler.

This plan assumes **nested nav** unless product prefers inner tabs (document in PR review).

## Server / client touchpoints (implementation inventory)

| Area | Files / entry points |
| --- | --- |
| Nav model | `src/Code.js` — extend `buildNavigationModel_()` to return nested items or a new shape; or keep flat list with two consecutive entries and `parent: 'operations'` for styling. |
| Shell | `src/DashboardShell.html` — `renderNav`, click routing, new `#panel-labor-hours` (or inner view), week picker, tables, KPIs. |
| Data | Prefer **client slice** of utilization payload; optional thin `getLaborHoursSummary_(weekStart, weekEnd)` in `fiberyUtilizationDashboard.js` only if server-side aggregation is required for performance. |
| Activity log | `src/userActivityLog.js` / client `logActivity_` — new route string consistent with choice above. |
| Thresholds | `src/utilizationThresholds.js` or new `laborHoursThresholds.js` — `LABOR_HOURS_DEFAULT_TARGET`, optional JSON map for company → target. |
| Docs | `docs/FOS-Dashboard-PRD.md` — FR/AC when shipping; **this file** stays the feature spec. |

## Open questions (for stakeholder review before build)

1. **Zero-hours cohort:** Example lists employees with **no** entries that week. Universe = (a) all people appearing in `dimensions.persons` for a wider range, (b) Users sheet roster, or (c) omit v1? **Recommend:** omit Phase A; add Phase B once roster source is defined.
2. **Route id:** Prefer `labor-hours` for activity log clarity vs nesting under `operations` only in UI.
3. **Internal labor:** Include in weekly totals or exclude (Utilization has **Internal labor** toggle — Labor Hours might always exclude non-billable internal or mirror toggle state).
4. **Partner targets (40 vs 45):** Source of truth — Script Property JSON vs Fibery lookup table vs hardcoded map?
5. **EXCLUDE_NAMES** from imported PRD: replicate as Script Property list or Sheet tab for admins?

---

## Implementation plan (for engineering review)

### Milestone M0 — Product lock (0.5d)

- [ ] Confirm nav pattern: **nested sidebar** vs **in-panel tabs**.
- [ ] Confirm **zero-hours** scope for v1 (likely defer).
- [ ] Confirm **weekly target** rules (default 40 + company overrides).

### Milestone M1 — Navigation shell (1–2d)

- [ ] Extend navigation JSON to support Operations children (or flat indented items).
- [ ] Update `renderNav` to render group + children with keyboard accessibility (`aria-expanded` if collapsible).
- [ ] Add `#panel-labor-hours` (hidden by default) with page chrome: title **Labor hours review**, subtitle with selected week, refresh aligned with Utilization patterns.
- [ ] Wire `setActiveNav` / `showOperations` flow: ensure only one Operations child panel visible; preserve Utilization **sticky render** behavior where applicable.

### Milestone M2 — Week selection + data binding (2–3d)

- [ ] Week picker: ISO week widget (Mon–Sun label), default **last completed calendar week** (match PRD §4 semantics; edge test Sunday run).
- [ ] Implement `getLaborRowsForWeek_(cachedPayload, weekStart, weekEnd)` client helper (filter on `startDateTime`).
- [ ] Implement `aggregateLaborHoursByPerson_(rows)` → `{ userKey, displayName, company, totalHours, entries, projects[] }`.
- [ ] Classification: over / under / on-target using `targetHours` from M0 rules; float epsilon for “exact”.
- [ ] Fetch path: if cache miss, `google.script.run.getUtilizationDashboardData(ws, we)` then persist to existing sessionStorage key or write merged policy (document).

### Milestone M3 — UI: KPIs + tables (2–4d)

- [ ] KPI row: reuse `.fos-agreement-kpi` styling; five cards if zero-hours deferred (four if zero omitted).
- [ ] Tables: Over / Under / On-target sections with sortable headers (client-side sort, mirror example `data-sort`).
- [ ] Projects column: Phase A = PRD simple (3 + N more); Phase C = expandable breakdown.

### Milestone M4 — Activity, PRD sync, QA (1–2d)

- [ ] Log `labor_hours_week_select`, `labor_hours_refresh`, `labor_hours_view` (exact names TBD) with week label.
- [ ] Cross-browser check on `sessionStorage` size for week-only fetch.
- [ ] Update `docs/FOS-Dashboard-PRD.md` + `FOS_PRD_VERSION` when feature ships.

### Non-goals (v1)

- **No** Python script, Drive upload, or email distribution inside Apps Script (those remain the separate generator in the imported PRD).
- **No** new Fibery entity; all reads stay on `Labor Costs` through existing client/server stack.

## Acceptance criteria (draft for main PRD lift)

1. Authorized user sees **Labor hours** under **Operations** and can open it without losing Utilization access.
2. Default week is the **last completed Mon–Sun** week; changing week updates KPIs and tables.
3. If utilization cache already covers the selected week, **no** `getUtilizationDashboardData` call is made on panel open (verify in Network / execution count).
4. Over / under / on-target counts match a **manual spot-check** for ≥3 employees against Fibery for that week.
5. Visual design uses **existing Operations** tokens (dark theme); no cream-page background from the static HTML prototype.
6. No Fibery tokens or secrets appear in `sessionStorage` payloads beyond what Utilization already stores.

## References

- `docs/implementation-notes/labor-hours-dashboard-PRD (1).html` — query, pagination, aggregation, classification, layout §§1–10.
- `docs/implementation-notes/labor-hours-week-of-2026-05-04.html` — target UX density, company column, project drilldown pattern.
- `docs/features/005-utilization-management-dashboard.md` — field contract, cache keys, `getUtilizationDashboardData` behavior.
- `docs/agreement-dashboard-prd-v2.md` §9.5–9.7 — branding source of truth.

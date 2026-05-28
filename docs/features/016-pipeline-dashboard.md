# Feature: Pipeline dashboard (Sales — Fibery HubSpot deals)

> **Status: Released v2.6.0.** Shipped as a **MINOR** bump (**PRD 2.6.0**) with **FR-110** and **AC-66**, a new **Sales** nav group, server module `src/pipelineDashboard.js`, and the `#panel-pipeline` client surface. See `016-pipeline-dashboard-implementation-plan.md`.

> **Source mockup:** `harpin-dashboard-v3.html` (harpin AI — Pipeline Dashboard). The mockup wires directly to a HubSpot MCP and ships a light harpin theme. This feature **reuses the mockup's layout and section structure only** — data comes from **Fibery `HubSpot/Deal`** via the existing Fibery client, and the surface adopts the **current dark dashboard chrome**, not the mockup palette.

---

## Data source review

**Intent:** The Pipeline dashboard reads **deal records** from the **Fibery `HubSpot/Deal`** database (HubSpot space, synced into Fibery) through the same server-side **`fiberyClient.js`** path the other Fibery dashboards use. There is **no** new external integration and **no** direct browser → HubSpot MCP call (the mockup's `window.cowork.callMcpTool` path is **not** carried over).

### `HubSpot/Deal` fields available (validated via Fibery schema)

| Canonical field | Fibery field | Type | Use |
| --- | --- | --- | --- |
| `id` | `fibery/id` | uuid | row key |
| `name` | `HubSpot/name` | text | deal / company label |
| `amount` | `HubSpot/Amount` | decimal | KPI + stage totals + funnel |
| `annualContractValue` | `HubSpot/Annual contract value` | decimal | optional secondary metric |
| `totalContractValue` | `HubSpot/Total contract value` | decimal | optional secondary metric |
| `weightedAmount` | `HubSpot/Weighted amount` | decimal | Best Case (prefer over hand-weighting) |
| `forecastAmount` | `HubSpot/Forecast amount` | decimal | forecast lines |
| `probability` | `HubSpot/Deal probability` | decimal | Best Case fallback (`amount × probability`) |
| `stage` | `HubSpot/Deal Stage` | text | stage bucketing |
| `pipeline` | `HubSpot/Pipeline` | text | view filter (New Logo / X-Man / Partner / Existing Client) |
| `dealType` | `HubSpot/Deal Type` | text | metadata |
| `isClosed` | `HubSpot/Is Closed` | text | exclude/segment closed |
| `isWon` | `HubSpot/Is Won` | text | Closed Won detection |
| `closeDate` | `HubSpot/Close Date` | date-time | revenue-by-quarter bucketing |
| `lastActivityDate` | `HubSpot/Last Activity Date` | date-time | idle / staleness |
| `lastStageChangeDate` | `HubSpot/Last Stage Change Date Salesforce` | date | "days in stage" |
| `owner` | `HubSpot/Deal Owner` → `HubSpot/Owner` | relation | owner chip |
| `company` | `HubSpot/company` → `HubSpot/Company` | relation | company label |
| `hubspotLink` | `HubSpot/hubspotLink` | text | optional deep link |
| `description` | `HubSpot/Deal Description` | document | drill-down context (rich text → plain) |
| `nextStep` | `HubSpot/Next Step Date` | document | drill-down next-step note |

### R0 — confirmed on live Fibery workspace (2026-05-28)

`HubSpot/Deal` is queryable through the deployed Fibery path. Confirmed facts:

1. **Pipelines (`HubSpot/Pipeline`, free text):** `New Logo Sales Pipeline`, `X-Man Sales Pipeline`, `Partner Sales Pipeline`, `Existing Client Pipeline`.
2. **Stages (`HubSpot/Deal Stage`, free text):** `Prospecting`, `Discovery`, `Discovery / Demo`, `Solutioning / Validation`, `Proposing`, `Negotiating / Contract`, `Closed Won`, `Closed Lost`, `On Hold`, `Kickoff Scheduled/In Implementation`. The mockup's numeric HubSpot stage ids do **not** apply — bucketing is by **stage-name pattern**.
3. **`Is Won` / `Is Closed` are almost always `null`** in the synced data — they MUST NOT be used for closed/won detection. Derive **won = stage `Closed Won`**, **lost = stage `Closed Lost`**, **closed = either**, from the stage bucket instead.
4. **Numerics arrive as strings or `null`** (`Amount`, `Weighted amount`, `Deal probability`) — coerce with a safe `parseFloat`-style helper (null/blank → 0).
5. **Junk filtering:** exclude deals whose name matches `^test` (e.g. `Test Deal - For Report`). The `STALE - ` name prefix is a **soft signal** (surface as a chip), not an exclusion.
6. **Best Case:** `HubSpot/Weighted amount` is populated for most active deals; prefer it, fall back to `amount × probability` when null.

### Stage bucketing (replaces mockup's hardcoded id maps)

Buckets (display order): **Prospecting → Discovery → Demo → Validation → Proposing → Negotiation/Contract → Closed Won → Closed Lost → On Hold / Implementation**. Active-sales buckets = Prospecting…Negotiation. Commit buckets = `proposing`, `negotiating`. Default pattern map (case-insensitive, overridable via **`PIPELINE_STAGE_BUCKET_MAP_JSON`**):

| Stage text | Bucket |
| --- | --- |
| `Prospecting` | `prospecting` |
| `Discovery` | `discovery` |
| `Discovery / Demo` | `demo` |
| `Solutioning / Validation` | `validation` |
| `Proposing` | `proposing` |
| `Negotiating / Contract` | `negotiating` |
| `Closed Won` | `won` |
| `Closed Lost` | `lost` |
| `On Hold` | `onhold` |
| `Kickoff Scheduled/In Implementation` | `implementation` |
| _(unmatched)_ | `other` (surfaced + `warnings[]`) |

---

## Goal

Add a new **top-level sidebar group "Sales"** — positioned **directly beneath Home and above Operations** — containing a single dashboard, **Pipeline Dashboard** (`route id = pipeline`, panel `#panel-pipeline`). It surfaces the live HubSpot sales pipeline from Fibery with: a **KPI summary** (Total Deal Amount / Commit / Best Case), a **deals-by-stage** breakdown, a **revenue-by-quarter** forecast chart, and a **pipeline funnel** by stage — matching the layout of `harpin-dashboard-v3.html` in the current dashboard branding.

**Primary audience:** Sales leadership and ops reviewing pipeline health, commit, and forecast.

**Non-goals (v1):**

- **Writing back to HubSpot / Fibery.** All deal `Amount` / stage edits in the mockup are **local-only browser overrides**; v1 is **read-only** (drop the editable-cell + override-storage behavior unless explicitly requested).
- The mockup's **Weekly To-Dos** widget and **one-liner banner** (localStorage scratchpads) — **out of scope** for v1.
- Multi-currency FX handling (assume USD unless multiple `Currency` codes appear).
- Replacing the Agreement / Revenue dashboards as the financial system of record.

---

## User stories

- As **sales leadership**, I want a **30-second read** of Total Deal Amount, Commit, and Best Case (deal counts + dollars) so I can gauge the quarter at a glance.
- As a **sales manager**, I want **deals grouped by stage** (expandable, sorted by amount) with owner, days-in-stage, close date, and forecast category so I can run pipeline review.
- As a **forecaster**, I want **revenue by quarter** (Closed Won bars + Pipeline / Best Case / Commit forecast lines bucketed by close date) so I can see the outlook.
- As an **ops lead**, I want a **pipeline funnel** (deals + dollars per active stage) so I can spot shape problems and stage concentration.
- As any **authorized Sales user**, I want to **filter by pipeline view** (e.g. New Logo, X-Man) and **export the visible deals to CSV**.
- As a **viewer**, the panel should match the existing dashboards' look, loading, and refresh behavior (single global loading modal, **Refresh**, client cache).

---

## Acceptance Criteria (testable)

- [ ] **Sales nav group.** The sidebar renders a **Sales** group (with an icon) **immediately below Home and above Operations**, containing one child: **Pipeline** (`route id = pipeline`). Selecting it shows `#panel-pipeline` and logs `nav_view` with Route `pipeline`. Group ordering: Home → **Sales** → Operations → Delivery → Finance.
- [ ] **Access gate.** Visibility follows the same authorization pattern as other Fibery dashboards (visible to Fibery-access users; gating rule confirmed at R0 — default: any authorized user with `fiberyAccess`, optionally narrowed to Sales team / ADMIN like Expenses). Server entry point enforces the same gate it advertises in nav.
- [ ] **Data load.** `getPipelineDashboardData()` (Apps Script, `google.script.run`) returns a payload of normalized deals + derived aggregates from Fibery `HubSpot/Deal`, with `cacheSchemaVersion` and an `asOf` timestamp; no browser-side MCP/HubSpot call exists.
- [ ] **KPI tiles.** Three tiles render: **Total Deal Amount** (count of non-lost active deals + summed `amount`), **Commit** (proposing + negotiating), **Best Case** (active deals weighted: prefer `Weighted amount`, else `amount × probability`). Money formats as `$X.XXM / $XXXK`.
- [ ] **Deals by stage.** A stage breakdown lists buckets in canonical order with per-stage deal count + dollar total; expanding a stage lists its deals sorted by amount desc, each showing company, owner, days-in-stage (fresh/warn/stale coloring), close date, forecast-category pill, stage, and amount. Empty stages render disabled.
- [ ] **Revenue by quarter.** A Chart.js chart renders Closed Won as bars and Pipeline / Best Case / Commit as lines, bucketed by `Close Date` quarter, covering at least the current 4 quarters.
- [ ] **Funnel.** A funnel renders the six active stages with deal count, dollar total, and a proportional bar.
- [ ] **View filter.** A view control filters deals by pipeline (All sales pipelines default; plus per-pipeline views discovered at R0). Changing the view recomputes all four sections without a full reload.
- [ ] **Export CSV.** A **Export CSV** action serializes the visible deals (company, name, pipeline, stage, forecast category, amount, close date, owner, days-in-stage) to the clipboard/file and confirms with the standard copied alert.
- [ ] **Branding.** The panel uses the existing dark `.fos-agreement-root` chrome and brand tokens (`--bg`, `--ag-accent`, etc.), **not** the mockup's light harpin palette. The harpin wordmark/logo continues to use the shell's existing brand logo.
- [ ] **Loading + empty + error.** Uses the **single global loading modal** (per v2.5.8). Empty pipeline shows a friendly empty state; a Fibery error shows a safe, user-friendly message (no stack traces).
- [ ] **PRD / version discipline.** On implementation: PRD version bump, `FOS_PRD_VERSION`, full `src/*` header sweep, §13 changelog row, FR-110 / AC rows, `000-overview.md` update, and this doc's header all land in the same change set.

---

## UI Notes

**Layout (top to bottom), mirroring `harpin-dashboard-v3.html`:**

1. **Header row** — title "Pipeline Dashboard", as-of date, **Refresh** + **Export CSV** buttons (reuse existing dashboard header button styling).
2. **View tabs** — pipeline-view selector (All sales / per-pipeline). Hidden when only one pipeline present.
3. **The 30-Second Read** — 3-up KPI grid (Total Deal Amount / Commit / Best Case), each with deal count + dollars.
4. **Deals by Stage** — collapsible stage groups (accordion), deals sorted by amount; reuse a dark-theme equivalent of the mockup's `.acc-stage` rows; click a stage header to expand.
5. **Revenue by Quarter** — Chart.js mixed bar+line.
6. **Pipeline Shape** — funnel grid of active stages.

- **Routes/panels:** new `#panel-pipeline`; new nav group `sales-group` with child `pipeline` in `buildNavigationModel_()`.
- **Chrome:** `#panel-pipeline.fos-agreement-root` + the inner section-card family used by Revenue review / Expenses. Stage-dot / forecast-pill colors re-expressed against the dark theme (teal/mint accents already in tokens).
- **No editable cells / no Weekly To-Dos / no one-liner** in v1.

## Data Model

- **Source:** Fibery `HubSpot/Deal` (read-only), via `fiberyClient.js`. New server module proposed: `src/pipelineDashboard.js` (builder + normalizer), entry point `getPipelineDashboardData()` in `Code.js`.
- **Normalized deal shape (client payload):** `{ id, name, company, pipeline, stage, bucket, amount, weightedAmount, probability, forecastCategory, forecastCategoryIsDerived, owner, closeDate, lastStageChangeDate, daysInStage, isWon, isClosed, description, nextStep, hubspotLink }`.
- **Aggregates (server-computed):** per-bucket `{ count, total }`, KPI totals (Total/Commit/Best), quarter buckets `{ quarter → { won, commit, best, pipeline } }`.
- **Config (Script Properties):** `PIPELINE_STAGE_BUCKET_MAP_JSON` (stage-name → bucket), `PIPELINE_MAX_ROWS` (cap + `partial` flag), optional `PIPELINE_VIEW_FILTERS_JSON` (pipeline display names), `PIPELINE_DASHBOARD_TTL_MS` (client cache). Registered in `adminSettingsRegistry.js`.
- **Cache:** optional client cache key `fos_pipeline_dashboard_v1` (sessionStorage), `cacheSchemaVersion` on payload, mirroring the Expenses pattern. **Snapshot job:** decide at planning whether to add Pipeline to the Drive snapshot bundle (default v1: **live-only**, not in snapshots — note in `dashboard-snapshot-cache-sync.mdc` if added).
- **Migration:** none (additive feature; no schema changes to existing payloads).

## Operations

- **Queries:** `query_database` / `fiberyClient.js` fetch of `HubSpot/Deal` with the field set above; paginate to `PIPELINE_MAX_ROWS`. Resolve `Deal Owner` → owner name and `company` → company name (relation expansion). Convert `document` fields (description, next step) to plain text safely.
- **Actions (read-only):** `getPipelineDashboardData()` returns payload; client `Refresh` re-fetches; `Export CSV` is client-side only.
- **Activity logging:** whitelist new event types in `src/userActivityLog.js`: `pipeline_refresh`, `pipeline_view_change`, `pipeline_export`, `pipeline_stage_toggle` (Route `pipeline`), plus `nav_view` for the route.

## Edge Cases

- **Free-text stages** not in the bucket map → bucket `other` (surfaced in a catch-all group, flagged in `payload.warnings`).
- **Missing `Close Date`** → excluded from quarter chart but still counted in KPI/funnel/stage totals.
- **Missing `amount`** → treated as `$0`; deal still listed.
- **Missing owner / company** → "Unassigned" / derive label from `name`.
- **Closed deals** (`Is Closed = true`) → excluded from active KPI/funnel; Closed Won contributes to revenue-by-quarter bars; Closed Lost shown only in its stage group.
- **`Weighted amount` absent** → Best Case falls back to `amount × probability`.
- **Empty pipeline / Fibery error / not authorized** → friendly empty state, safe error message, and standard not-authorized handling respectively.
- **Large pipelines** → `PIPELINE_MAX_ROWS` cap with `partial` indicator (same UX as Expenses/Utilization caps).

## Verification Steps

(To be expanded in the implementation plan after approval.)

1. Confirm R0 facts in Fibery: stage values, pipeline values, `Is Won`/`Is Closed` encoding.
2. `clasp push`; open the Web App as a Sales-authorized user; confirm **Sales → Pipeline** appears below Home.
3. Verify KPIs, stage breakdown, quarter chart, and funnel against a known set of deals in Fibery/HubSpot.
4. Toggle view tabs; confirm all sections recompute; confirm Export CSV matches the visible set.
5. Verify global loading modal shows during fetch and clears; verify error + empty states.
6. Confirm activity-log rows for `pipeline_*` events; confirm non-authorized users do not see the group.

## Implementation Checklist

- [ ] Confirm R0 data facts in Fibery (stages, pipelines, won/closed encoding).
- [ ] `src/pipelineDashboard.js` — builder + normalizer; `getPipelineDashboardData()` in `Code.js` with access gate.
- [ ] `buildNavigationModel_()` — add `sales-group` with `pipeline` child, ordered below Home / above Operations; nav icon.
- [ ] `DashboardShell.html` — `#panel-pipeline` (KPIs, stage accordion, quarter chart, funnel, view tabs, Export CSV), dark-theme styling, client cache, global loading wiring.
- [ ] `adminSettingsRegistry.js` — register new Script Properties.
- [ ] `userActivityLog.js` — whitelist `pipeline_*` event types.
- [ ] Decide snapshot inclusion; update `dashboard-snapshot-cache-sync.mdc` artifacts if added.
- [ ] PRD: bump to **2.6.0**, add **FR-110** + **AC-66 / AC-67**, §13 changelog row; sync `FOS_PRD_VERSION` + **all** `src/*` headers; update `000-overview.md` and this doc's header.
- [ ] Run local smoke test; verify acceptance criteria.
- [ ] Commit: `feat: Pipeline dashboard under Sales nav group (PRD 2.6.0)`.

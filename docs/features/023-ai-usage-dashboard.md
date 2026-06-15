# Feature: AI Usage dashboard (Finance)

> **PRD version 2.15.6** - shipped **FR-118** / **AC-76** in web app **v2.15.0+** (schema path fix **v2.15.1**; chart layout **v2.15.5**; cost accuracy **v2.15.6**).
>
> **Teamwork inbox:** [AI Usage Dashboard](https://win.godeap.io/app/tasks/40180160) (updated 2026-06-15).
>
> **Related:** [Feature 017 - AI platform usage sync](017-ai-platform-usage-fibery-sync.md) (Fibery **`AI Usage Data/Usage`** ingest + Settings **Run sync now**); [005 - Utilization Management Dashboard](005-utilization-management-dashboard.md) (filter bar + Refresh UX pattern); [AI spend impact measurement guide](../ai-spend-impact-measurement.md).
>
> **Status:** **Implemented** in **v2.15.0** (live Fibery read path; snapshot artifact deferred).

## Customer request (Teamwork inbox)

Source: task **[40180160](https://win.godeap.io/app/tasks/40180160)**.

> Using the data set we currently have we would like to create an AI usage dashboard that depicts the areas of concern that we should be paying attention to as a leadership team. This dashboard should be available under the finance group. It should appear after the expenses menu item. The dashboard should start with a bar chart showing the spend by clockify user sorted highest to lowest. There should also be a spend trend that shows how dollars are spent over time grouped by month. This dashboard is a work in progress and we will add more content later. If you can think of a useful visualization, please include it.

**Product clarifications (2026-06-15 review):**

- Rows with **no Clockify User** (blank relation) roll into an **Unmatched** bucket so leadership can see spend not tied to a person or product.
- Some **`Clockify Users`** records represent **programs/products**, not people. When **`Agreement Management/AI Usage Tracker`** is **checked** on that Clockify User, treat the row as **product utilization** (separate chart), not a developer/person.
- **Filter + refresh UX** should follow the **Utilization Management Dashboard** pattern: **date range** dropdown (with custom range), **Person** multi-select, **Roles** multi-select, **Refresh** button, last-refreshed timestamp, optional TTL / stale badge.
- **Data load** follows the same model as Agreement / Utilization: server fetch for the selected **date range**; client re-filters by Person and Role without a server roundtrip unless the range changes.

## Goal

Add a **read-only FOS Dashboard panel** under **Finance → AI Usage** (after **Expenses**) that surfaces AI spend from Fibery **`AI Usage Data/Usage`**, split into **developers (people)**, **products/programs**, and **unmatched** spend, with leadership-focused charts and utilization-style controls.

Sync operator controls remain in **Settings** ([017 Phase G](017-ai-platform-usage-fibery-sync.md)); this panel links there but does not duplicate **Run sync now**.

**Primary audience:** Finance and executive leadership.

**Data dependency:** Feature **017** sync populated **`Usage`** rows; **`Agreement Management/Clockify Users`** maintained with **`AI Usage Tracker`** flag for product keys.

## User stories

- As a **leadership reviewer**, I want **Finance → AI Usage** (after **Expenses**) to review AI spend without vendor consoles.
- As a **leadership reviewer**, I want a **bar chart of developer spend by Clockify User** (people only, highest to lowest) for the active date range.
- As a **leadership reviewer**, I want a **separate bar chart of product/program spend** (Clockify Users with **`AI Usage Tracker = true`**) so I can compare **platform product utilization cost vs developer cost**.
- As a **leadership reviewer**, I want an **Unmatched** bucket when **`Clockify User`** is blank so I can see unattributed spend volume and dollars.
- As a **leadership reviewer**, I want a **monthly spend trend** (total dollars by month) across the loaded window.
- As a **resource planner**, I want **date range**, **Person**, and **Roles** filters like Utilization so I can narrow charts and KPIs consistently with Operations dashboards.
- As an **operator**, I want **Refresh**, **last refreshed**, and optional **auto-refresh TTL** like Utilization so I trust the data age.
- As a **finance reviewer**, I want a supporting **detail table** and **Export CSV** for the filtered slice.

## Scope boundaries

### In scope (v1 - Phase A)

| Area | Requirement |
| --- | --- |
| **Nav** | **Finance** group: **AI Usage** after **Expenses** (`route id = ai-usage`, `#panel-ai-usage`). |
| **Access** | Same as Expenses: **`Team = FINANCE`**, **`Role = EXEC`**, or **`Role = ADMIN`**. |
| **Server fetch** | Fibery **`Usage`** for selected date range; join **`Clockify User`** → **`Name`**, **`AI Usage Tracker`**, **`Team Member Role`** (`Agreement Management/Team Member Role` → **`Name`**). No live vendor API calls. |
| **Classification** | Each row: **`unmatched`** (no Clockify User) · **`product`** (`AI Usage Tracker = true`) · **`developer`** (Clockify User present and tracker not true). |
| **Hero chart 1** | **Developer spend by Clockify User** (descending **`Cost USD`**); excludes products and unmatched. |
| **Hero chart 2** | **Product/program spend by Clockify User name** (descending); only **`AI Usage Tracker = true`**. |
| **Concern KPI / bar** | **Unmatched** spend ($ and row count) always visible (KPI + optional single bar on developer chart or small callout). |
| **Hero chart 3** | **Monthly spend trend** (total **`Cost USD`** by calendar month in loaded range). |
| **Optional viz** | **Developers vs products vs unmatched** monthly stacked trend or summary KPI trio (include if low effort at ship). |
| **Filter bar** | Match Utilization: date presets (30 / 60 / 90 / 180 / YTD / custom), **Person** multi-select, **Roles** multi-select, **Clear filters**, filter chips. Person/Role filter client-side on cached rows; range change triggers server fetch. |
| **Refresh row** | **Refresh** button, **Last refreshed**, **Stale** badge, **Auto-refresh** TTL select (5 / 10 / 30 / Off), loading overlay (Utilization pattern). |
| **Activity log** | Whitelist `ai_usage_*` events. |

### Out of scope (v1)

| Item | Rationale |
| --- | --- |
| **Sync controls on panel** | Feature **017** Settings; link only. |
| **Write-back** to Fibery | Read-only v1. |
| **Customer / agreement allocation** | Feature **017** Phase F follow-on. |
| **Drive snapshot `ai-usage.json`** | Optional later ([009](009-dashboard-historical-snapshots.md)). |

## Data source review

### Usage facts

From **`AI Usage Data/Usage`** (Feature **017**): **`Usage Date`**, **`Cost USD`**, **`Clockify User`**, denormalized emails, **`Mapping Status`**, **`Source Platform`**, etc. See [017-fibery-schema-api.md](017-fibery-schema-api.md).

### Clockify User join (classification)

| Fibery field | API path | Dashboard use |
| --- | --- | --- |
| Name | `Agreement Management/Name` | Chart labels |
| AI Usage Tracker | `Agreement Management/AI Usage Tracker` | **`true`** → product chart; **`false`/empty** → developer chart (when user set) |
| Team Member Role | `Agreement Management/Team Member Role` → `Agreement Management/Name` | **Roles** filter (same concept as Utilization **`User Role`**) |
| Clockify User Email | `Agreement Management/Clockify User Email` | Person filter key + fallback label |

**Query pattern:** When loading **`Usage`**, select nested fields on **`AI Usage Data/Actor Mapping Clockify User`** (not `Clockify User`).

### Row classification rules

| Condition | Bucket | Charts |
| --- | --- | --- |
| **`Clockify User`** relation **empty** | **Unmatched** | Unmatched KPI; excluded from developer and product bars |
| **`AI Usage Tracker = true`** | **Product** | Product bar chart only |
| **`Clockify User` set** and tracker **not true** | **Developer** | Developer bar chart only |

**Sort:** Each bar chart descending by summed **`Cost USD`**. Top **N** (default 20) + **Other** per chart.

**Monthly trend:** Sum all rows in range by **`YYYY-MM`** (org TZ). Optional second series: split by bucket (developers / products / unmatched).

### Filter behavior (Utilization-aligned)

| Control | Behavior |
| --- | --- |
| **Date range** | Presets + custom; changing range calls **`getAiUsageDashboardData(start, end)`** (server). Default preset: **Last 90 days** (align with Utilization default unless product chooses 60). |
| **Person** | Multi-select on **`Clockify User`** display name (include **Unmatched** as filter option). Client re-aggregates charts/KPIs from cached **`rows`**. |
| **Roles** | Multi-select on **`Team Member Role`** name; unmatched rows have no role (excluded when any role selected unless **Unmatched** person selected). Client-side. |
| **Clear filters** | Clears Person + Role; does not reset date range. |
| **Persist** | `localStorage` key `fos_ai_usage_filters_v1` for Person + Role (not range), mirroring Utilization. |

### R0 - confirm before implementation

1. **`Usage`** rows exist after Feature **017** sync.
2. **`Cost USD`** populated on sample rows.
3. Product Clockify Users flagged **`AI Usage Tracker = true`** in Fibery (e.g. automation / program API keys).
4. Developer users have tracker **false** or unset.
5. Enum / nested query paths validated against live Fibery.

## Acceptance criteria (testable)

- [ ] **AC-01 (Nav):** **Finance → AI Usage** appears **after Expenses** when `canAccessAiUsageDashboard_()` is true.
- [ ] **AC-02 (Access):** Server returns **FORBIDDEN** without FINANCE / EXEC / ADMIN (same as Expenses).
- [ ] **AC-03 (Payload):** `{ ok, cacheSchemaVersion, range, asOf, rows[], kpis, byDeveloper[], byProduct[], byMonth[], filterOptions{persons[],roles[]}, warnings[] }`; each row includes `bucket`, `personName`, `roleName`, `costUsd`, `usageDate`.
- [ ] **AC-04 (Unmatched):** Rows with blank **`Clockify User`** appear only in **Unmatched** KPI (and optional unmatched bar); never in developer or product charts.
- [ ] **AC-05 (Developer chart):** Bar chart of **`Cost USD`** by person Clockify User, **excluding** products and unmatched, sorted **high → low**.
- [ ] **AC-06 (Product chart):** Separate bar chart for Clockify Users with **`AI Usage Tracker = true`**, sorted **high → low**.
- [ ] **AC-07 (Monthly trend):** Total spend by month across loaded date range.
- [ ] **AC-08 (Date range):** Preset + custom dropdown matches Utilization UX; range change refetches server data.
- [ ] **AC-09 (Person + Role filters):** Multi-select filters re-render charts/KPIs client-side without refetch; chips + Clear filters work.
- [ ] **AC-10 (Refresh):** Refresh button bypasses cache; shows **Last refreshed**; TTL selector 5/10/30/Off; stale badge when TTL exceeded (Utilization pattern).
- [ ] **AC-11 (Empty / error):** No data → empty state + Settings sync hint; safe Fibery errors only.
- [ ] **AC-12 (Export):** Export CSV for filtered rows; activity events logged.
- [ ] **AC-13 (PRD ship):** FR/AC in main PRD, **`FOS_PRD_VERSION`** bump, `src/*` headers, [000-overview.md](000-overview.md).

## UI notes

**Top chrome (Utilization pattern):**

1. Title **AI Usage** + subtitle with active date range.
2. **Refresh** | Last refreshed | Stale | Auto-refresh TTL | fetch error.
3. **Filter bar:** Date range · Person · Roles · Clear filters · chip row.

**Content (customer order):**

4. **KPI strip:** Total spend (filtered), developer $, product $, unmatched $ (and/or row counts).
5. **Chart A:** Developer spend by Clockify User (descending).
6. **Chart B:** Product/program spend by Clockify User (descending).
7. **Chart C:** Monthly spend trend.
8. **Detail table** + Export CSV (below fold).

**Branding:** `.fos-agreement-root`, `.fos-util-filter-bar`, Chart.js, global loading modal.

## Data model

No new Fibery entities. Script Properties (register in `adminSettingsRegistry.js` when implemented):

| Property | Default | Purpose |
| --- | --- | --- |
| `AI_USAGE_DASHBOARD_DEFAULT_RANGE_DAYS` | `90` | Default date preset |
| `AI_USAGE_DASHBOARD_CACHE_TTL_MINUTES` | `10` | Client cache / TTL |
| `AI_USAGE_DASHBOARD_TOP_N` | `20` | Bar chart cap per chart |
| `AI_USAGE_DASHBOARD_MAX_ROWS` | `5000` | Server row cap |

**Server module (proposed):** `src/aiUsageDashboard.js` - `getAiUsageDashboardData(startYmd, endYmd)`.

**Client cache key:** `fos_ai_usage_dashboard_v1`; **`cacheSchemaVersion: 1`**.

## Operations

- Server: query **`Usage`** in `[start, end]` with nested **`Clockify User`** fields; classify rows; precompute aggregates for unfiltered first paint.
- Client: apply Person/Role filters in-memory (mirror `fiberyUtilizationDashboard` + `DashboardShell.html` util filter helpers).
- No Fibery mutations from panel.

## Edge cases

| Case | Behavior |
| --- | --- |
| Product user mis-flagged | Appears on wrong chart until Fibery flag fixed |
| **`AI Usage Tracker` null** on matched user | Treat as **developer** |
| Person filter selects one developer | Charts/KPIs scope to that person; product chart may empty |
| Role filter active | Unmatched rows hidden unless no role filter |
| All spend unmatched | Developer/product charts empty; unmatched KPI dominates |

## Verification steps

1. Flag at least one Clockify User **`AI Usage Tracker = true`** with usage rows.
2. Open **Finance → AI Usage**; confirm developer chart excludes products and unmatched.
3. Confirm product chart totals match Fibery filter `AI Usage Tracker = true`.
4. Confirm unmatched KPI matches rows with no **`Clockify User`**.
5. Change date range → server refetch; change Person/Role → client only.
6. Refresh + TTL behavior matches Utilization spot-check.

## Implementation checklist

- [ ] Customer approves spec (**Spec Approved** in Teamwork)
- [ ] Release task `Feature 023 - AI Usage dashboard` linked to inbox **40180160**
- [ ] `src/aiUsageDashboard.js` + `#panel-ai-usage` + nav after Expenses
- [ ] Document **`AI Usage Tracker`** in [017-fibery-schema-api.md](017-fibery-schema-api.md) when implementing
- [ ] PRD + version bump on ship

## Changelog

| Date | Version | Notes |
| --- | --- | --- |
| 2026-06-15 | Draft | Initial spec from inbox **40180160**. |
| 2026-06-15 | Draft rev. 1 | Teamwork description: Finance nav, user bar, monthly trend, WIP. |
| 2026-06-15 | Draft rev. 2 | Unmatched bucket; product vs developer split via **`AI Usage Tracker`**; Utilization-style filters + Refresh; Teamwork notebook synced. |
| 2026-06-15 | 2.15.1 | **Schema fix:** query **`Actor Mapping Clockify User`** (live Fibery); sync upsert uses same path. |

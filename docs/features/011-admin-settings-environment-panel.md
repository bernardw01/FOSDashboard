# Admin settings — environment configuration panel

> **PRD version 2.2.0** — see `docs/FOS-Dashboard-PRD.md` (**FR-106**, **AC-62**).

## Goal

Give **ADMIN** users a **Settings** surface in the Web App (replacing the current “Coming soon” placeholder) to view and edit **Apps Script Script Properties** that tune dashboard behavior—grouped by functional area—with **tooltips**, **validation**, and a **“use built-in default”** toggle for every setting that has a code default.

Non-admin users must **not** see or invoke this panel.

## Status

**Delivered v2.2.0** — ADMIN-only Settings panel; non-admins do not see the sidebar link. `AUTH_SPREADSHEET_ID` and `FOS_SNAPSHOT_DRIVE_FOLDER_ID` are read-only in the UI.

## Background

Today, configuration lives in **Project settings → Script properties** (`PropertiesService.getScriptProperties()`). Operators edit raw key/value pairs in the Apps Script editor. The README documents ~50 keys across authorization, Fibery, Agreement, Utilization, Labor hours, Delivery, and snapshots ([README § Script properties](../README.md)).

The **Settings** control in the sidebar (`#settings-link`, FR-10b) opens a **coming soon** modal. This feature activates Settings for **ADMIN** only and centralizes safe, validated edits in-product.

## User stories

- As an **ADMIN**, I want to open **Settings** from the sidebar and see all tunable properties **grouped by dashboard or platform area**, so I can adjust behavior without opening the Apps Script editor.
- As an **ADMIN**, I want **tooltips** that explain what each setting does and what values are valid, so I do not misconfigure production.
- As an **ADMIN**, I want to **revert a setting to its built-in default** with one control, so experiments are easy to undo.
- As a **non-admin user**, I want Settings to remain unavailable (hidden or inert), so configuration cannot be changed accidentally.
- As an **operator**, I want **audit-friendly** saves (who changed what, when) logged to **User Activity**, so configuration changes are traceable.

## Role gate (ADMIN)

| Rule | Detail |
|------|--------|
| Source of truth | Users sheet **`Role`** column ([feature 002](002-spreadsheet-user-authorization.md)). |
| Match | `String(role).trim().toUpperCase() === 'ADMIN'`. |
| Server | Every admin API MUST call `requireAuthForApi_()` then `requireAdminRole_(auth)`; non-admin → safe error (`NOT_AUTHORIZED` or `FORBIDDEN` — pick one and document). |
| Client | Navigation model includes `isAdmin: boolean`. Settings link behavior: **ADMIN** → `showSettingsPanel()`; **non-admin** → hide link **or** keep link with “Contact your administrator” (product choice: **hide** recommended). |
| Sheet ops | Admins are assigned by editing the Users tab; no in-app role promotion in v1. |

## UI specification

### Entry and layout

- **Route id:** `settings` (new top-level panel, not nested under Operations/Delivery).
- **Trigger:** Click **Settings** (gear) at the bottom of the sidebar—same `.fos-nav-btn` chrome as today.
- **Panel:** `#panel-settings` in `#main-panel`, consistent with other dashboards (topbar title **Settings**, dark card sections).
- **Structure:**
  1. Page intro (one paragraph): changes apply to **all users** of this Apps Script deployment; may take effect on next dashboard fetch or refresh.
  2. **Accordion or stacked cards** per **group** (see below).
  3. Sticky footer: **Save changes** (primary), **Discard** (secondary), **last saved** timestamp + optional “N unsaved changes” badge.

### Per-setting controls

| Control | Behavior |
|---------|----------|
| **Label** | Human-readable name (not necessarily the Script Property key). |
| **Key** | Monospace sublabel, e.g. `UTILIZATION_TARGET_PERCENT` (read-only). |
| **Tooltip** | Bootstrap tooltip or `title` + info icon (`bi-info-circle`); documents purpose, units, and valid range. |
| **Use default** toggle | When **on**: field disabled; server **deletes** the Script Property key (or companion override flag—see data model); UI shows resolved default value as hint text. When **off**: user edits custom value. |
| **Value input** | Type-appropriate: number, boolean (switch), short text, CSV text, JSON textarea (validated on save). |
| **Required** badge | For keys with no default (e.g. `AUTH_SPREADSHEET_ID`) — toggle hidden; empty = misconfiguration warning. |
| **Sensitive** | Masked display; never echo full secret on load (see security). |

### Groups (display order)

Groups align with README / feature specs so admins think in product terms:

| Group id | Title | Feature specs |
|----------|--------|-----------------|
| `platform-auth` | **Platform — Authorization & sheets** | [002](002-spreadsheet-user-authorization.md) |
| `platform-activity` | **Platform — User activity logging** | [004](004-user-activity-logging.md) |
| `fibery-api` | **Fibery — API connection** | [003](003-agreement-dashboard-fibery-client-cache.md), [005](005-utilization-management-dashboard.md) |
| `fibery-deeplinks` | **Fibery — Deep link templates** | [005](005-utilization-management-dashboard.md), [008](008-revenue-review-dashboard.md) |
| `agreement` | **Agreement Dashboard** | [003](003-agreement-dashboard-fibery-client-cache.md) |
| `utilization` | **Utilization (Operations)** | [005](005-utilization-management-dashboard.md) |
| `labor-hours` | **Labor hours** | [007](007-labor-hours-dashboard.md) |
| `delivery` | **Delivery — Projects & P&L** | [006](006-delivery-project-pnl.md) |
| `snapshots` | **Historical snapshots** | [009](009-dashboard-historical-snapshots.md), [010](010-dashboard-historical-data-source.md) |

Optional **v1.1** group `snapshots-ops`: read-only status (last run, folder id) + links to editor functions—out of scope for v1 unless explicitly approved.

### Visual / a11y

- Reuse root design tokens (FR-50 / AC-18).
- Tooltips keyboard-focusable; toggles have visible labels.
- Validation errors inline per field; save blocked until fixed.
- Mobile: accordion stacks; Save remains reachable.

## Configuration registry (single source of truth)

Introduce **`src/adminSettingsRegistry.js`** (name tentative) exporting a **read-only catalog** used by both server validation and the client render model. Each entry:

```javascript
{
  key: 'UTILIZATION_TARGET_PERCENT',
  group: 'utilization',
  label: 'Target utilization %',
  description: 'Top of the green utilization band; used in KPI coloring and alerts.',
  type: 'number',           // number | boolean | string | csv | json
  defaultValue: 85,         // null if no code default
  min: 1,
  max: 100,
  required: false,
  sensitive: false,
  allowDefaultToggle: true, // false when defaultValue === null
  validate: function(value) { ... }  // optional server-side
}
```

**Resolution rule (server):** at read time, `getResolvedSetting_(key)` returns `parse(property) ?? defaultValue` using the same parsers as `agreementThresholds.js` / `utilizationThresholds.js` today.

**Persistence rule (write):** if **use default** → `deleteProperty(key)`; else `setProperty(key, serializedValue)`.

Do **not** duplicate default literals in the registry and threshold modules long-term—registry defaults should match `*_DEFAULT_` constants or import shared defaults in a follow-up refactor.

## Setting catalog (v1 scope)

### In scope for editable UI

All keys below exist today unless marked **v1 read-only**. Tooltips in the implementation should be copied from the **Tooltip** column (expanded in UI).

#### Platform — Authorization & sheets

| Key | Default | Type | Tooltip (summary) |
|-----|---------|------|-------------------|
| `AUTH_SPREADSHEET_ID` | — | string | **Required.** Google Sheet ID for Users + activity tabs. Wrong ID fails closed for all users. |
| `AUTH_USERS_SHEET_NAME` | `Users` | string | Tab name for authorized users. |
| `AUTH_COL_EMAIL` | `Email` | string | Header name for email column (row 1 exact match). |
| `AUTH_COL_ROLE` | `Role` | string | Header for role; use `ADMIN` for settings access. |
| `AUTH_COL_TEAM` | `Team` | string | Header for team. |
| `AUTH_COL_FIBERY_ACCESS` | `fibery_access` | string | Header for per-user Fibery drawer link gate. |

#### Platform — User activity

| Key | Default | Type | Tooltip (summary) |
|-----|---------|------|-------------------|
| `AUTH_USER_ACTIVITY_SHEET_NAME` | `User Activity` | string | Tab for append-only activity log. |
| `USER_ACTIVITY_LOGGING_ENABLED` | on | boolean | Kill-switch: `false`/`no`/`0` disables logging. |

#### Fibery — API

| Key | Default | Type | Tooltip (summary) |
|-----|---------|------|-------------------|
| `FIBERY_HOST` | — | string | Workspace host **without** `https://` (e.g. `harpin-ai.fibery.io`). Required for live Fibery dashboards. |
| `FIBERY_API_TOKEN` | — | secret | **Required for Fibery.** Bearer token; set-only in UI (never show existing value). |

#### Fibery — Deep links

| Key | Default | Type | Tooltip (summary) |
|-----|---------|------|-------------------|
| `FIBERY_PUBLIC_SCHEME` | `https` | string | `http` or `https` only. |
| `FIBERY_DEEP_LINK_HOST` | *(FIBERY_HOST)* | string | Public browser host if different from API host. |
| `FIBERY_LABOR_COST_PATH_TEMPLATE` | `/Agreement_Management/Labor_Costs/{slug}-{publicId}` | string | `{slug}` and `{publicId}` required placeholders. |
| `FIBERY_AGREEMENT_PATH_TEMPLATE` | `/Agreement_Management/Agreements/{slug}-{publicId}` | string | Agreement entity path template. |
| `FIBERY_COMPANY_PATH_TEMPLATE` | `/Agreement_Management/Companies/{slug}-{publicId}` | string | Companies entity (Revenue review drawer). |

#### Agreement Dashboard

| Key | Default | Type | Tooltip (summary) |
|-----|---------|------|-------------------|
| `AGREEMENT_CACHE_TTL_MINUTES` | `10` | number | Server seed for client auto-refresh TTL (0–1440). |
| `AGREEMENT_THRESHOLD_LOW_MARGIN` | `35` | number | Low-margin alert threshold (%). |
| `AGREEMENT_THRESHOLD_INTERNAL_LABOR` | `5000` | number | Internal labor $ alert threshold. |
| `AGREEMENT_THRESHOLD_EXPIRY_DAYS` | `60` | number | Renewal / expiry window (days). |
| `AGREEMENT_TOP_N_RECOGNITION_BARS` | `10` | number | Top-N agreements in recognition chart (1–50). |
| `AGREEMENT_INTERNAL_COMPANY_NAMES` | `harpin.ai` | csv | Comma-separated internal company names. |
| `AGREEMENT_SANKEY_LINK_OPACITY` | `0.35` | number | Sankey link opacity (0–1). |
| `AGREEMENT_SANKEY_INCLUDE_INTERNAL` | `false` | boolean | Include Internal-type agreements in Sankey. |

#### Utilization

| Key | Default | Type | Tooltip (summary) |
|-----|---------|------|-------------------|
| `UTILIZATION_CACHE_TTL_MINUTES` | `10` | number | Operations panel TTL seed (minutes). |
| `UTILIZATION_DEFAULT_RANGE_DAYS` | `90` | number | Default date range when client sends no bounds. |
| `UTILIZATION_MAX_RANGE_DAYS` | `365` | number | Hard cap on requested range length. |
| `UTILIZATION_WEEKLY_CAPACITY_HOURS` | `40` | number | Weekly capacity hours per person. |
| `UTILIZATION_TARGET_PERCENT` | `85` | number | Target utilization % (top of green band). |
| `UTILIZATION_UNDER_PERCENT` | `60` | number | Under-utilized alert threshold. |
| `UTILIZATION_OVER_PERCENT` | `110` | number | Over-allocated alert threshold. |
| `UTILIZATION_INTERNAL_COMPANY_NAMES` | `harpin.ai,Harpin` | csv | Internal labor company names. |
| `UTILIZATION_TOP_N_PERSONS` | `20` | number | Hours-by-person chart cap. |
| `UTILIZATION_TOP_N_PROJECTS` | `20` | number | Hours-by-project chart cap. |
| `UTILIZATION_TOP_N_CUSTOMERS` | `20` | number | Hours-by-customer chart cap. |
| `UTILIZATION_HEATMAP_TOP_N_PERSONS` | `30` | number | Heatmap row cap. |
| `UTILIZATION_STALE_APPROVAL_WARN_DAYS` | `7` | number | Stale approval warning age (days). |
| `UTILIZATION_STALE_APPROVAL_CRIT_DAYS` | `14` | number | Critical stale approval age; must be > warn. |

#### Labor hours

| Key | Default | Type | Tooltip (summary) |
|-----|---------|------|-------------------|
| `LABOR_HOURS_DEFAULT_WEEKLY_TARGET` | `40` | number | Default weekly hour target (hours). |
| `LABOR_HOURS_PARTNER_WEEKLY_TARGET` | `45` | number | Partner company weekly target. |
| `LABOR_HOURS_PARTNER_COMPANY_SUBSTRINGS` | `ret,coherent,kforce` | csv | Case-insensitive substrings on `clockifyUserCompany`. |
| `LABOR_HOURS_COMPANY_TARGETS_JSON` | *(empty)* | json | Object map: company name → weekly hours (positive numbers). |
| `LABOR_HOURS_EXCLUDED_PERSON_SUBSTRINGS` | *(empty)* | csv | Exclude persons when `userName` contains token. |

#### Delivery

| Key | Default | Type | Tooltip (summary) |
|-----|---------|------|-------------------|
| `DELIVERY_CACHE_TTL_MINUTES` | `10` | number | Delivery panel TTL seed. |
| `DELIVERY_ACTIVE_STATES` | *(empty)* | csv | Active project workflow states; empty = default rule. |
| `DELIVERY_EXCLUDE_INTERNAL` | `true` | boolean | Hide Internal-type projects from list. |
| `DELIVERY_PNL_INCLUDE_PROJECTED_ODC` | `true` | boolean | Include projected ODC in monthly P&L. |
| `DELIVERY_PNL_MAX_LABOR_ROWS` | `10000` | number | Max labor rows per P&L fetch (`0` = unlimited). |
| `DELIVERY_COMPLETION_UNDER_PCT` | `25` | number | % Complete bar — under bucket upper bound. |
| `DELIVERY_COMPLETION_BUILDING_PCT` | `75` | number | % Complete — building bucket upper bound. |
| `DELIVERY_COMPLETION_OVER_PCT` | `100` | number | % Complete — over when above this. |
| `DELIVERY_MARGIN_VARIANCE_AMBER_PTS` | `5` | number | Margin vs target amber band (percentage points). |

#### Historical snapshots

| Key | Default | Type | Tooltip (summary) |
|-----|---------|------|-------------------|
| `FOS_SNAPSHOT_DRIVE_FOLDER_ID` | — | string | **v1 read-only** in UI. Drive folder root; set via `ensureSnapshotDriveFolder()`. Display masked id + copy button. |
| `FOS_SNAPSHOT_TIMEZONE` | `America/Chicago` | string | IANA timezone for snapshot calendar date. |
| `SNAPSHOT_UTILIZATION_LOOKBACK_DAYS` | `90` | number | Utilization window length for daily job (1–365). |
| `SNAPSHOT_PNL_BATCH_SIZE` | `8` | number | Projects per P&L batch (1–25). |
| `SNAPSHOT_RETENTION_DAYS` | `90` | number | Delete snapshot folders older than N days. |
| `SNAPSHOT_TRIGGER_HOUR` | `2` | number | Local hour (0–23) for daily trigger. |
| `FOS_SNAPSHOT_LOG_SHEET_NAME` | `Snapshot Runs` | string | Log tab name on auth spreadsheet. |

### Out of scope for v1 UI (remain editor-only)

| Key | Reason |
|-----|--------|
| `SNAPSHOT_QUEUE_DATE`, `SNAPSHOT_QUEUE_IDS`, `SNAPSHOT_QUEUE_INDEX`, `SNAPSHOT_QUEUE_FAILED_IDS` | Ephemeral job queue state; editing breaks running jobs. |
| `FOS_PRD_VERSION` | Code constant, not a Script Property. |

## Server API (proposed)

| Function | Auth | Returns / behavior |
|----------|------|------------------|
| `getAdminSettingsPanel()` | ADMIN | `{ ok, groups: [{ id, title, settings: [{ key, label, description, type, defaultValue, useDefault, value, min, max, required, sensitive, readOnly }] }] }` |
| `saveAdminSettings(updates)` | ADMIN | `{ ok, saved: string[], errors?: [{ key, message }] }` — atomic validation; partial save **not** allowed if any field invalid. |
| `resetAdminSettingsGroup(groupId)` | ADMIN | Optional v1.1 — delete all keys in group. |

**Navigation:** extend `buildNavigationModel_()` with `isAdmin: boolean` (derived from role).

**Cache invalidation:** after save, client should clear relevant `sessionStorage` caches (agreement, utilization, delivery) and show banner: “Settings saved. Refresh open dashboards to apply.”

## Security

| Topic | Requirement |
|-------|-------------|
| Secrets | `FIBERY_API_TOKEN`: write-only from browser; load shows `••••••••` + “Replace token” flow. |
| IDOR | No property keys outside registry accepted on save. |
| Audit | Log `admin_settings_save` to User Activity with route `settings`, label = comma-separated changed keys (no values). |
| Fibery host/token | Changing host/token does not expose token in API responses. |
| Rate limit | Reuse activity throttle pattern; optional 1 save / 5s per session. |

## Activity logging (proposed whitelist)

| Event | Route | Label |
|-------|-------|-------|
| `settings_panel_open` | `settings` | — |
| `admin_settings_save` | `settings` | `keys=key1,key2,…` |
| `admin_settings_save_error` | `settings` | safe error code |

## Acceptance criteria (testable)

- [ ] **Given** a user with Role **ADMIN**, **when** they click **Settings**, **then** the settings panel opens (no coming soon modal).
- [ ] **Given** a user with Role **not ADMIN**, **when** the shell loads, **then** Settings is **not shown** (or inert per chosen UX) and `getAdminSettingsPanel()` returns forbidden.
- [ ] **Given** the settings panel, **when** rendered, **then** every in-scope key appears in exactly one group with a tooltip.
- [ ] **Given** a setting with a code default, **when** **Use default** is enabled and saved, **then** the Script Property is removed and runtime behavior matches the default.
- [ ] **Given** a setting with **Use default** off, **when** a valid custom value is saved, **then** `PropertiesService` contains the new value and the next dashboard fetch reflects it.
- [ ] **Given** an invalid value (out of range, malformed JSON), **when** Save is clicked, **then** inline errors appear and **no** properties are written.
- [ ] **Given** `FIBERY_API_TOKEN` already set, **when** the panel loads, **then** the token value is **not** returned to the client.
- [ ] **Given** a successful save, **when** User Activity is checked, **then** an `admin_settings_save` row exists without secret values.

## Non-goals (v1)

- Editing the **Users** sheet roster from Settings (remain spreadsheet-only).
- Per-user or per-team overrides (all settings remain deployment-wide).
- Version history / rollback UI for Script Properties.
- Running snapshot jobs or installing triggers from Settings (editor/diagnostic functions only).
- Migrating settings to a dedicated “config” sheet (remain Script Properties).

## Dependencies

- [001 — Dashboard shell](001-dashboard-shell-navigation.md) — Settings affordance, panel pattern.
- [002 — Authorization](002-spreadsheet-user-authorization.md) — Role column, `requireAuthForApi_()`.
- [004 — User activity](004-user-activity-logging.md) — new event types.
- Existing threshold modules — parsers must stay aligned with registry.

## PRD / version (on implementation)

- **MINOR bump → 2.2.0**
- Add **FR-106** (admin settings panel + registry + ADMIN gate)
- Add **AC-62**
- Update [000-overview](000-overview.md), README script-properties section, [001](001-dashboard-shell-navigation.md) (Settings no longer placeholder for ADMIN).

## Related documents

- [Implementation plan](011-admin-settings-environment-panel-implementation-plan.md) — phased delivery, file list, test plan.

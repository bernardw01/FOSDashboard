# Admin settings - collapsible groups & usage analytics

> **PRD version 2.3.0** - see `docs/FOS-Dashboard-PRD.md` (**FR-107**, **AC-63**). *(Current product version is 2.4.0 - see [013](013-app-versions-registry.md).)* Builds on [011 - Admin settings environment panel](011-admin-settings-environment-panel.md) and [004 - User activity logging](004-user-activity-logging.md).

## Goal

Improve the **ADMIN** Settings panel (`#panel-settings`, feature **011**) in two ways:

1. **Collapsible configuration groups** - every dashboard / platform Script Property group is an accordion section; **all sections start collapsed** so the page is scannable before editing.
2. **In-panel usage analytics** - a new **first** section summarizes dashboard adoption from the **`User Activity`** tab in the authorization spreadsheet (`AUTH_SPREADSHEET_ID`, tab name from `AUTH_USER_ACTIVITY_SHEET_NAME`, default **`User Activity`**) for the **past 30 calendar days**, with **by-route** and **by-user** tables plus a **stacked bar chart** (events per day, stacked by route).

Non-admin users remain unchanged (no Settings link).

## Status

**Delivered v2.3.0**

## User stories

- As an **ADMIN**, I want environment settings grouped in **collapsed panels** by default, so I can expand only the area I need without scrolling through every key.
- As an **ADMIN**, I want **usage statistics at the top of Settings**, so I can see whether teams are using each dashboard without opening the auth spreadsheet.
- As an **ADMIN**, I want usage based on the **last 30 days** of **`User Activity`** rows, so the view matches a typical monthly review cadence.
- As an **ADMIN**, I want tables by **route** and by **individual user** (email, role, team, event count), plus a **stacked daily histogram**, so I can spot adoption trends and active users at a glance.
- As a **privacy-conscious operator**, I want usage analytics **ADMIN-only** and loaded **server-side** (aggregates only, not a bulk row export), consistent with **NFR-08**.

## Scope

### In scope (v1)

| Area | Detail |
|------|--------|
| **Collapsible groups** | Wrap existing registry groups (`platform-auth`, `agreement`, `utilization`, …) in Bootstrap collapse; **collapsed on first paint**; chevron / `aria-expanded` on header click. |
| **Usage panel (first)** | New group id `usage-analytics`, title **Usage - last 30 days**; also collapsible, **collapsed by default**. |
| **Data source** | Read-only aggregate from **`User Activity`** tab. Reuse `getUserActivitySheetOrNull_()` / header-by-name resolution from `src/userActivityLog.js`. |
| **Time window** | Rolling **30 calendar days** inclusive of “today” in **`Session.getScriptTimeZone()`**. |
| **Event filter** | `page_load`, `nav_view`, `refresh` only. |
| **By-route table** | Route (friendly label), **Events**, **Unique users**; sorted by events descending. |
| **By-user table** | **Email**, **Role**, **Team**, **Events**; sorted by events descending; shows every user with activity in the window. |
| **Stacked bar chart** | X = calendar day (30 buckets); Y = event count; stacks = top **8** routes + **Other**. Chart.js v4; built when the usage section is first expanded. |
| **Server API** | **`getAdminUsageStats()`** in `src/userActivityStats.js` (ADMIN-only). |
| **Activity audit** | **`settings_usage_view`** whitelisted; logged when usage panel renders successfully. |

### Out of scope (v1)

- Editing or deleting activity rows from Settings.
- Per-team breakdown charts.
- Export CSV / print from usage panel.
- Configurable window (7 / 90 days).
- `sessionStorage` persistence of expanded/collapsed state.

## UI specification

### Panel order

1. Intro card (unchanged from 011).
2. Alerts + loading.
3. **`#settings-usage-host`** - Usage section (first).
4. **`#settings-groups`** - collapsible config groups.
5. Sticky Save / Discard footer.

### Usage panel content

| Block | Spec |
|-------|------|
| **Subtitle** | Tab name · date range · total events · unique users |
| **By route** | Summary table |
| **By user** | Per-user table with email (ADMIN-visible PII by design) |
| **Chart** | Stacked bar, ~280px height |
| **Footnote** | Event allowlist + timezone |

## Data model (server view-model)

`getAdminUsageStats()` returns:

```javascript
{
 ok: true,
 windowDays: 30,
 timezone: 'America/Chicago',
 rangeStart: '2026-04-16',
 rangeEnd: '2026-05-15',
 sheetName: 'User Activity',
 totalEvents: 1234,
 uniqueUsers: 12,
 byRoute: [
 { route: 'agreement-dashboard', label: 'Agreement Dashboard', events: 400, uniqueUsers: 10 }
 ],
 byUser: [
 { email: 'user@example.com', role: 'ADMIN', team: 'Finance', events: 120 }
 ],
 byDay: [ { date: '2026-05-15', total: 42, byRoute: { ... } } ],
 topRoutes: ['agreement-dashboard', 'operations', ...],
 warnings: ['TRUNCATED_ROWS']
}
```

## Acceptance criteria

- [x] Usage section first; all sections collapsed on open.
- [x] By-route and by-user tables match sheet aggregates (±0) for the 30-day window and event filter.
- [x] Stacked chart daily totals match aggregated data.
- [x] Non-admins do not see Settings.
- [x] Missing User Activity tab shows inline message; config groups still load when settings API succeeds.
- [x] **`settings_usage_view`** logged on successful usage render.

## Files

| File | Change |
|------|--------|
| `src/userActivityStats.js` | **New** |
| `src/DashboardShell.html` | Collapsible groups + usage UI |
| `src/userActivityLog.js` | Whitelist `settings_usage_view` |
| `src/Code.js` | `FOS_PRD_VERSION` 2.3.0 |

## Related docs

- [011-admin-settings-environment-panel.md](011-admin-settings-environment-panel.md)
- [004-user-activity-logging.md](004-user-activity-logging.md)
- [Implementation plan](012-admin-settings-usage-analytics-collapsible-implementation-plan.md)

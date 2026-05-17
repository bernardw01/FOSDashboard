# Implementation plan — Admin settings usage analytics & collapsible groups

> Companion to [012-admin-settings-usage-analytics-collapsible.md](012-admin-settings-usage-analytics-collapsible.md). **Delivered v2.3.0**.

## Summary

| Item | Choice |
|------|--------|
| **Version** | **2.3.0** (MINOR) |
| **PRD** | **FR-107**, **AC-63** |
| **Server** | `src/userActivityStats.js` — `getAdminUsageStats()` |
| **Client** | `src/DashboardShell.html` — collapsible groups + usage tables + chart |

## Delivered scope

- All Settings groups (including **Usage — last 30 days**) use Bootstrap **collapse**, **collapsed** initially.
- **`getAdminUsageStats()`** aggregates last **30** days from **User Activity** (`page_load`, `nav_view`, `refresh`).
- **By route** table, **by user** table (email, role, team, events), **stacked bar chart** (lazy Chart.js on first expand of usage section).
- Parallel load: `getAdminSettingsPanel` + `getAdminUsageStats` on Settings open.
- **`settings_usage_view`** activity event whitelisted.

## Test plan

| # | Steps | Expected |
|---|--------|----------|
| T1 | ADMIN → Settings | Usage first; all collapsed |
| T2 | Expand Usage | Route + user tables + chart |
| T3 | Pivot sheet manually | Counts match |
| T4 | Non-ADMIN | No Settings link |
| T5 | Missing activity tab | Usage error message; config still editable if settings load |

# Dashboard historical data source (UI)

> **PRD version 2.1.0** — see `docs/FOS-Dashboard-PRD.md` (**FR-105**, **AC-61**). Storage job: [009-dashboard-historical-snapshots.md](009-dashboard-historical-snapshots.md).

## Goal

A **Data source** control in the left sidebar lets authorized users view all dashboards from **Live Fibery data** (default) or from a **dated Drive snapshot**. In snapshot mode the Web App does not call live Fibery endpoints until the user selects Live data again.

## Status

**Delivered v2.1.0**

## UI

- Sidebar `<select id="fos-data-source">` below the user chip (label: **Data source**).
- Options: **Live data** + one entry per catalog snapshot (`complete` and `partial`; excludes `running` / `failed`).
- Topbar banner when snapshot mode: **Viewing snapshot as of … (not live data).**
- Refresh / Auto-refresh / Utilization date-range controls disabled in snapshot mode (Utilization range is fixed to the snapshot window).

## Client state

- In-memory `dataSourceState` (not mixed with live `sessionStorage` keys for Fibery TTL).
- `localStorage` key **`fos_data_source_v1`**: `{ schemaVersion: 1, mode: 'live'|'snapshot', snapshotDate }`.
- On each page load: `getDashboardSnapshotCatalog()` refreshes the dropdown; restore saved snapshot only if still listed.

## Server API (`dashboardSnapshotStore.js`)

| Function | Purpose |
|----------|---------|
| `getDashboardSnapshotCatalog()` | Authorized list of snapshots + synthetic Live option metadata |
| `getDashboardSnapshotCoreBundle(snapshotDate)` | `agreement`, `utilization`, `deliveryProjects`, `manifest` |
| `getDashboardSnapshotPnl(snapshotDate, agreementId)` | Lazy Delivery P&L artifact |

## Panel behavior (snapshot mode)

| Panel | Data |
|-------|------|
| Agreement | `bundle.agreement` |
| Revenue review | Same agreement payload (written to agreement cache for reuse) |
| Utilization | `bundle.utilization` |
| Labor hours | Week slice from `bundle.utilization` only (no Fibery) |
| Delivery list | `bundle.deliveryProjects` |
| Delivery P&L | `getDashboardSnapshotPnl` per selected project |

## Activity logging

Route **`shell`**: `data_source_change`, `snapshot_bundle_load_start`, `snapshot_bundle_load_done`, `snapshot_bundle_load_error`.

## Known limitations

- Agreement alerts/KPIs in snapshots reflect job **fetch-time** semantics (see feature 009).
- Utilization date range is not user-adjustable in snapshot mode.

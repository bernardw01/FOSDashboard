# Dashboard historical snapshots

> **PRD version 2.1.0** — see `docs/FOS-Dashboard-PRD.md` (**FR-42**, **FR-40**, **FR-104**, **AC-60**).

## Goal

Run a **daily scheduled job** that captures the normalized JSON payloads used by all FOS dashboards and stores them in **Google Drive**, so a future UI can let users view **“as of”** historical data without changing today’s live Fibery fetch behavior.

## Status

**Delivered v2.0.0** — server job + Drive storage. **UI (data source selector):** [010-dashboard-historical-data-source.md](010-dashboard-historical-data-source.md) (**v2.1.0**).

## Storage layout (Option A)

Root folder: Script Property **`FOS_SNAPSHOT_DRIVE_FOLDER_ID`** (create via **`ensureSnapshotDriveFolder()`**).

```
<root>/
  index.json                 # rolling catalog of recent snapshot dates
  YYYY-MM-DD/
    manifest.json
    agreement.json
    utilization.json
    delivery-projects.json
    delivery-pnl/
      <agreementId>.json
```

### Manifest (`snapshotManifestVersion: 1`)

- `snapshotDate`, `timezone`, `startedAt`, `completedAt`
- `status`: `running` | `complete` | `partial` | `failed`
- `datasets[]`: `{ id, fileName, driveFileId, cacheSchemaVersion, byteSize, fetchedAt, params?, partial?, error? }`
- `pnlProgress`: `{ total, completed, failedIds[] }`
- `warnings[]`

## Datasets snapshotted

| Artifact | Source | Notes |
|----------|--------|--------|
| `agreement.json` | `buildAgreementDashboardPayload_(snapshotDate)` | Future revenue filtered as of snapshot date |
| `utilization.json` | `buildUtilizationDashboardPayload_(start, end)` | Default 90-day window ending snapshot date |
| `delivery-projects.json` | `buildDeliveryDashboardPayloadFromAgreement_` | No extra Fibery fetch |
| `delivery-pnl/*.json` | `buildDeliveryProjectMonthlyPnLInternal_` | Batched; continuation trigger if needed |

## Script Properties

| Property | Default | Purpose |
|----------|---------|---------|
| `FOS_SNAPSHOT_DRIVE_FOLDER_ID` | — | Required after setup |
| `FOS_SNAPSHOT_TIMEZONE` | `America/Chicago` | Snapshot calendar date |
| `SNAPSHOT_UTILIZATION_LOOKBACK_DAYS` | `90` | Utilization window |
| `SNAPSHOT_PNL_BATCH_SIZE` | `8` | Projects per execution (max 25) |
| `SNAPSHOT_RETENTION_DAYS` | `90` | Drive folder pruning |
| `SNAPSHOT_TRIGGER_HOUR` | `2` | Daily trigger hour (script timezone) |
| `FOS_SNAPSHOT_LOG_SHEET_NAME` | `Snapshot Runs` | Log tab in `AUTH_SPREADSHEET_ID` |

## Operations runbook

1. In the Apps Script editor, run **`ensureSnapshotDriveFolder()`** once (or set `FOS_SNAPSHOT_DRIVE_FOLDER_ID` manually).
2. Run **`installDailySnapshotTrigger()`** as the account that should own snapshot files.
3. Optional smoke test: **`_diag_runSnapshotForDate('2026-05-14')`** — always pass **`YYYY-MM-DD`** (the editor does not supply parameters if you click Run with no args; use **`_diag_runSnapshotForDate()`** with no args only on builds that default to today, or pass a string literal in the run dialog). Verify the date folder in Drive and a row on **Snapshot Runs**.
4. List recent dates: **`_diag_listSnapshots()`**.
5. Teardown: **`removeDailySnapshotTriggers()`**.

## Modules

- `src/dashboardSnapshotStore.js` — Drive I/O, manifest, retention
- `src/dashboardSnapshotJob.js` — orchestration, triggers, logging

## Out of scope

- Spreadsheet index tab (Option B hybrid)
- GCS backend (Option C)

## Read API (v2.1.0)

Implemented on `dashboardSnapshotStore.js`: `getDashboardSnapshotCatalog`, `getDashboardSnapshotCoreBundle`, `getDashboardSnapshotPnl`. See feature **010**.

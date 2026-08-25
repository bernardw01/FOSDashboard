# Dashboard historical snapshots

> **PRD version 3.15.0** - see `docs/FOS-Dashboard-PRD.md` (**FR-42**, **FR-40**, **FR-104**, **FR-126**, **FR-130**, **FR-137**, **AC-60**, **AC-88**, **AC-92**, **AC-99**; feature **047** B6 keeps resource-assignments schema at **3** with a self-describing `personVariancesCodec`). Feature **034** reuses the snapshot root for Live daily caches without changing historical snapshot artifacts. Agreement `cacheSchemaVersion` **4**; Delivery projects **2**; Delivery P&L **16** (feature **040** R5 `laborByPerson.allocatedCost`; was **15** for resource alias merge; was **14** for `performance` block; was **13** for laborByPerson logged vs allocated + Allocated & Billable; was **12** for person hours only).

## Goal

Run a **daily scheduled job** that captures the normalized JSON payloads used by all FOS dashboards and stores them in **Google Drive**, so a future UI can let users view **"as of"** historical data without changing today's live Fibery fetch behavior.

## Status

**Delivered v2.0.0** - server job + Drive storage. **UI (data source selector):** [010-dashboard-historical-data-source.md](010-dashboard-historical-data-source.md) (**v2.1.0**). **Expenses + Pipeline artifacts:** **v2.8.0**.

## Storage layout (Option A)

Root folder: Script Property **`FOS_SNAPSHOT_DRIVE_FOLDER_ID`** (create via **`ensureSnapshotDriveFolder()`**).

```
<root>/
 index.json # rolling catalog of recent snapshot dates
 agreement-cache/YYYY-MM-DD/ # Live warm cache (feature 034; not a snapshot dataset)
 portfolio-pnl-cache/YYYY-MM-DD/ # Live daily bundle + build state
 YYYY-MM-DD/
 manifest.json
 agreement.json
 utilization.json
 delivery-projects.json
 expenses.json
 pipeline.json
 resource-assignments.json
 delivery-pnl/
 <agreementId>.json
```

The `agreement-cache/` and `portfolio-pnl-cache/` folders are **Live-mode daily caches**, not historical date artifacts and not entries in the snapshot `manifest.json`. Historical snapshot builders continue to call `buildAgreementDashboardPayload_(snapshotDate)` directly and remain isolated from Live cache reads.

### Manifest (`snapshotManifestVersion: 1`)

- `snapshotDate`, `timezone`, `startedAt`, `completedAt`
- `status`: `running` | `complete` | `partial` | `failed`
- `datasets[]`: `{ id, fileName, driveFileId, cacheSchemaVersion, byteSize, fetchedAt, params?, partial?, error? }`
- `pnlProgress`: `{ total, completed, failedIds[] }`
- `warnings[]`

## Datasets snapshotted

| Artifact | Source | Notes |
|----------|--------|--------|
| `agreement.json` | `buildAgreementDashboardPayload_(snapshotDate)` | Future revenue filtered as of snapshot date; `cacheSchemaVersion: 4` (v3.4.4: `assignedOwner`; was **3**) |
| `utilization.json` | `buildUtilizationDashboardPayload_(start, end)` | Default 90-day window ending snapshot date; `cacheSchemaVersion: 7` (v3.10.0: slimmer row shape, feature 047 B1; was **6** in v3.9.1 for Datastore customer/role joins, **5** through v3.9.0). **v3.12.0 (feature 047 B3):** when `PERF_SLIM_VIZ_AGGREGATES` is on, `aggregates.byPersonWeek` is written as positional tuples plus string tables and the artifact carries `aggregates.byPersonWeekCodec`. The version stays **7** on purpose: the codec descriptor is self-describing, so a snapshot written with or without it decodes correctly either way and no re-hydrate is needed to adopt or revert. |
| `delivery-projects.json` | `buildDeliveryDashboardPayloadFromAgreement_` | No extra Fibery fetch; `cacheSchemaVersion: 2` (v3.4.4: `assignedOwner`; was **1**) |
| `expenses.json` | `buildExpensesDashboardPayload_()` | Spreadsheet tab at job run time; `cacheSchemaVersion: 3` (v2.17.2: category column resolution; was **2** through v2.11.2); skip when **`SNAPSHOT_INCLUDE_EXPENSES`** is false |
| `pipeline.json` | `buildPipelineDashboardPayload_()` | Merged Opportunity Tracker + Fibery `HubSpot/Deal`; `cacheSchemaVersion: 3` (v2.21.0; was **2** in v2.11.1); skip when **`SNAPSHOT_INCLUDE_PIPELINE`** is false |
| `resource-assignments.json` | `buildResourceAssignmentDashboardPayload_(start, end)` | Fibery Resource Allocations + Labor Costs actuals; range snapshot date **-30 / +90** days; `cacheSchemaVersion: 3` (v3.7.0 personVariances; was **2** in v2.19.0). **v3.15.0 (feature 047 B6):** when `PERF_SLIM_RA_PERSON_VARIANCES` is on, `personVariances` is written as positional tuples plus string tables with shared byDay dedup and the artifact carries `personVariancesCodec`. The version stays **3** on purpose: the codec descriptor is self-describing, so a snapshot written with or without it decodes correctly either way and no re-hydrate is needed to adopt or revert. |
| `delivery-pnl/*.json` | `buildDeliveryProjectMonthlyPnLInternal_` | Batched; continuation trigger if needed; `cacheSchemaVersion: 16` (v3.7.6 / feature **040** R5: `laborByPerson.allocatedCost`; was **15** in v3.7.3 for resourcesLifetime alias merge; was **14** in v3.6.0 for `performance` block; was **13** in v3.4.12 for laborByPerson allocated hours / % / billable flag; was **12** in v3.4.11 for person hours; was **11** in v3.4.9 for full `resourceAllocations`) |
| `portfolio-pnl.json` | `writePortfolioPnlSnapshotBundle_` (aggregates per-project artifacts) | Written at manifest finalize; schema **1** (v2.16.0 / feature **025**); slim portfolio payloads (`portfolioMode`) |

### Failure policy

| Dataset | On failure |
|---------|------------|
| Agreement | Entire run **failed** |
| Utilization | Warning; continue |
| Delivery projects | Follows agreement |
| Expenses | Warning; manifest may be **partial** |
| Pipeline | Warning; manifest may be **partial** |
| Resource assignments | Warning; manifest may be **partial** |
| Delivery P&L | Per-project failure; manifest **partial** |
| Portfolio P&L bundle | Warning if `portfolio-pnl.json` missing; client may show unavailable message (legacy snapshots) |

## Script Properties

| Property | Default | Purpose |
|----------|---------|---------|
| `FOS_SNAPSHOT_DRIVE_FOLDER_ID` | - | Required after setup |
| `FOS_SNAPSHOT_TIMEZONE` | `America/Chicago` | Snapshot calendar date |
| `SNAPSHOT_UTILIZATION_LOOKBACK_DAYS` | `90` | Utilization window |
| `SNAPSHOT_PNL_BATCH_SIZE` | `8` | Projects per execution (max 25) |
| `SNAPSHOT_RETENTION_DAYS` | `90` | Drive folder pruning |
| `SNAPSHOT_TRIGGER_HOUR` | `2` | Daily trigger hour (script timezone) |
| `FOS_SNAPSHOT_LOG_SHEET_NAME` | `Snapshot Runs` | Log tab in `AUTH_SPREADSHEET_ID` |
| `SNAPSHOT_INCLUDE_EXPENSES` | `true` | When false, job skips `expenses.json` |
| `SNAPSHOT_INCLUDE_PIPELINE` | `true` | When false, job skips `pipeline.json` |
| `SNAPSHOT_INCLUDE_RESOURCE_ASSIGNMENTS` | `true` | When false, job skips `resource-assignments.json` |
| `SNAPSHOT_AUTO_UPGRADE_STALE` | `false` | When true, after finalize scan Drive and queue regeneration for schema-stale dates |

## Operations runbook

1. In the Apps Script editor, run **`ensureSnapshotDriveFolder()`** once (or set `FOS_SNAPSHOT_DRIVE_FOLDER_ID` manually).
2. Run **`installDailySnapshotTrigger()`** as the account that should own snapshot files.
3. Optional smoke test: **`_diag_runSnapshotForDate('2026-05-14')`** - always pass **`YYYY-MM-DD`** (the editor does not supply parameters if you click Run with no args; use **`_diag_runSnapshotForDate()`** with no args only on builds that default to today, or pass a string literal in the run dialog). Verify the date folder in Drive and a row on **Snapshot Runs**.
4. List recent dates: **`_diag_listSnapshots()`**.
5. **After a `cacheSchemaVersion` bump** (or when the Web App reports schema validation errors on historical dates):
   1. **`_diag_listStaleSnapshots()`** - lists dates whose Drive artifacts lag live schema constants.
   2. **`_diag_startSnapshotSchemaUpgrade()`** - queues those dates and regenerates them one-by-one (reuses daily builders + P&L continuation triggers).
   3. Optional cancel: **`_diag_cancelSnapshotSchemaUpgrade()`**.
   4. Optional always-on: Script Property **`SNAPSHOT_AUTO_UPGRADE_STALE=true`** enqueues remaining stale dates after each snapshot finalize (default **false**).
6. Teardown: **`removeDailySnapshotTriggers()`**.

### Schema upgrade caveats

Upgrading is a **full re-snapshot for that calendar date**, not an in-place JSON transform:

- **Agreement / Utilization / Delivery / Resource assignments / Delivery P&L:** rebuilt from Fibery with the original snapshot date as “as of” / range end (same as `_diag_runSnapshotForDate`).
- **Expenses / Pipeline:** rebuilt from the live sheet / Fibery state **at upgrade run time** (those artifacts were already “point-in-time at capture,” not reconstructable purely from `cacheSchemaVersion`).
- Large portfolios take multiple executions (P&L batches + upgrade queue). Watch **Triggers** and **Snapshot Runs**.

## Modules

- `src/dashboardSnapshotStore.js` - Drive I/O, manifest, retention, **`inspectSnapshotDateSchema_` / `listStaleSnapshotDates_`**
- `src/dashboardSnapshotJob.js` - orchestration, triggers, logging, **schema upgrade queue**

## Out of scope

- Spreadsheet index tab (Option B hybrid)
- GCS backend (Option C)
- Pure byte-level schema transforms without re-fetch (would need per-bump migrators)

## Read API (v2.1.0+)

Implemented on `dashboardSnapshotStore.js`: `getDashboardSnapshotCatalog`, `getDashboardSnapshotCoreBundle`, `getDashboardSnapshotPnl`. Core bundle includes optional **`expenses`** and **`pipeline`** (v2.8.0). See feature **010**.

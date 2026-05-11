# Clockify to Fibery Sync (Google Apps Script)

Product Requirements Document

Version 1.19 - 2026-05-11

## 1) Overview

### Purpose

Build a Google Apps Script solution that syncs Clockify time data into Google Sheets as an interim store, then pushes curated records into Fibery's `Agreement Management/Labor Costs` database, replacing the previous desktop Python + SQLite architecture.

### Product Vision

Provide a lightweight, maintainable Google Workspace-native integration that:

- pulls Clockify data from the Clockify REST API,
- transforms and validates it in Apps Script,
- stages normalized records in Google Sheets,
- creates or updates records in Fibery via `/api/commands`,
- runs safely as an on-demand and scheduled sync.

### Goals

- Eliminate the local desktop runtime dependency.
- Run entirely in Google Apps Script with TypeScript-compatible project structure.
- Keep syncs idempotent and safe for repeated execution.
- Preserve operational observability (logs, counters, status, errors).
- Support incremental sync by default with optional full backfill.
- Use Google Sheets as an auditable staging layer before Fibery.
- Provide a simple published HTML UI for sync visibility and manual control.

### Out of Scope (v1)

- Two-way sync back to Clockify.
- Recreating desktop TUI workflows.
- Complex reporting UI in Apps Script.
- Non-time-entry Clockify domains (tasks, expenses, advanced analytics).

## 2) Users and Use Cases

### Primary Users

- Operations/finance teams that need Clockify labor data inside Fibery.
- Internal admins who configure and monitor scheduled syncs.

### Core Use Cases

- Run a manual sync from Apps Script.
- Run automated time-based syncs.
- Push new/updated Clockify entries into Fibery Labor Costs.
- Troubleshoot failures with structured execution logs.

## 3) Functional Requirements

Each numbered **FR**, **AC** (section 7), and **NFR** (section 4) item carries a status tag:

| Tag | Meaning |
| --- | --- |
| **[Released]** | Implemented and expected in the current Apps Script project (including behaviors satisfied via deployed Web App and Script Properties), unless otherwise noted. |
| **[In-Progress]** | Partially implemented or still being validated end-to-end. |
| **[Backlog]** | Not yet implemented in the codebase. |

As of this version, **FR-03** (`SYNC_MODE` Script Property) is the only item tagged **Backlog**; no items are tagged **In-Progress**.

### 3.1 Configuration and Secrets

- FR-01 **[Released]**: The system MUST store `CLOCKIFY_API_KEY`, `CLOCKIFY_WORKSPACE_ID`, `FIBERY_API_TOKEN`, and `FIBERY_WORKSPACE` (Fibery subdomain host segment for `https://{workspace}.fibery.io`) in Script Properties.
- FR-02 **[Released]**: The system MUST fail fast with clear errors when required properties are missing.
- FR-03 **[Backlog]**: The system MUST support a `SYNC_MODE` setting (`incremental` default, `full` optional).
- FR-04 **[Released]**: The system MUST support a stored checkpoint timestamp for incremental Clockify fetches.
- FR-04a **[Released]**: The system MUST store `SPREADSHEET_ID` and required sheet tab names in Script Properties (including optional overrides for **`SHEETS_TAB_FIBERY_LABOR`**).

### 3.2 Clockify Data Ingestion

- FR-05 **[Released]**: The system MUST fetch workspace clients, projects, users, and time entries from Clockify.
- FR-06 **[Released]**: The system MUST support pagination for all endpoint calls.
- FR-06a **[Released]**: Clockify API pagination MUST respect the provider maximum page size (currently 200) and clamp larger requested page sizes.
- FR-07 **[Released]**: Incremental mode MUST request only entries since the stored checkpoint; full mode MUST backfill all available entries.
- FR-08 **[Released]**: The system MUST skip running timers (entries with missing end time) for Fibery create-or-update.
- FR-08a **[Released]**: The system MUST enrich each staged time entry with approval status by reconciling Clockify approval-request data and map values to `NOT_SUBMITTED`, `PENDING`, or `APPROVED`.
- FR-08b **[Released]**: Approval enrichment MUST query approval requests robustly enough to capture both `PENDING` and `APPROVED` records and handle alternate request/item ID shapes used by Clockify payloads.
- FR-08c **[Released]**: Approval enrichment MUST apply deterministic precedence (`APPROVED` over `PENDING` over `NOT_SUBMITTED`) across the entire staged `time_entries` set on each sync run.
- FR-08d **[Released]**: Approval enrichment MUST read nested Clockify approval state from `approvalRequest.status.state` (and equivalent aliases), MUST classify time-entry IDs only from requests whose nested state matches the requested bucket (`PENDING` vs `APPROVED`), matching the filtering behavior of the reference Python client.

### 3.3 Google Sheets Interim Store

- FR-09 **[Released]**: The system MUST write normalized Clockify entities to Google Sheets tabs before Fibery push.
- FR-10 **[Released]**: The solution MUST maintain dedicated tabs for at least `users`, `projects`, and `time_entries`.
- FR-10a **[Released]**: After each Clockify → Sheets staging run (incremental or full), the system MUST rebuild a **`fibery_labor_staging`** tab (name overridable via Script Property **`SHEETS_TAB_FIBERY_LABOR`**) holding one row per Fibery-push-eligible time entry (`PENDING` / `APPROVED`, completed intervals, workspace match): columns **`clockify_time_log_id`**, **`fetched_at`**, **`fibery_payload_json`** (JSON matching Labor Cost payload field names).
- FR-10b **[Released]**: POSTing labor costs to Fibery MUST occur only via an explicit user action from the sync console (**Push Fibery (incremental)** or **Push Fibery (full)**), reading payloads from **`fibery_labor_staging`**, so operators can inspect transformed data before Fibery ingestion.
- FR-11 **[Released]**: The first row in each tab MUST be a stable header schema managed by the script.
- FR-12 **[Released]**: Writes to Sheets MUST be batched with `getRange(...).setValues(...)` and avoid per-row writes in loops.
- FR-13 **[Released]**: Incremental runs MUST append or refresh only changed/new rows, while full mode may rebuild tabs.

### 3.4 Transformation and Mapping

- FR-14 **[Released]**: The system MUST normalize Clockify data into a typed internal model before writing to Sheets and before push.
- FR-15 **[Released]**: The system MUST read push-ready rows from `time_entries` sheet and map them to Fibery `Agreement Management/Labor Costs` with `Agreement Management/Time Log ID` as the conflict key.
- FR-16 **[Released]**: The system MUST resolve optional Fibery relations:
  - Agreement relation from Clockify `project_id` to `Agreement Management/Agreements` via `Agreement Management/Clockify Project ID`.
  - Clockify User relation from Clockify `user_id` to `Agreement Management/Clockify Users` via `Agreement Management/Clockify User ID`.
- FR-17 **[Released]**: When relation matches do not exist, the sync MUST still create or update the labor cost record with text fields populated.

### 3.5 Fibery Push

- FR-18 **[Released]**: The system MUST call Fibery `fibery.entity.batch/create-or-update` using conflict-field `Agreement Management/Time Log ID` and `update-latest`.
- FR-19 **[Released]**: The system MUST push in bounded batches (target: 50 entities/batch).
- FR-20 **[Released]**: The system MUST write these core fields when present:
  - `Agreement Management/Time Log ID`
  - `Agreement Management/Start Date Time`
  - `Agreement Management/End Date Time`
  - `Agreement Management/Seconds`
  - `Agreement Management/Clockify Hours`
  - `Agreement Management/Task`
  - `Agreement Management/Task ID`
  - `Agreement Management/Project ID`
  - `Agreement Management/Billable`
  - `Agreement Management/Time Entry Status`
  - `Agreement Management/User ID`
  - `Agreement Management/Time Entry User Name`
  - `Agreement Management/Time Entry Project Name`
- FR-21 **[Released]**: The system MUST avoid writing formula/computed Fibery fields.

### 3.6 Execution and Operations

- FR-22 **[Released]**: The system MUST expose a manual entry point for ad hoc sync runs.
- FR-23 **[Released]**: The system MUST support Apps Script time-driven triggers for scheduled runs.
- FR-24 **[Released]**: The system MUST emit structured execution logs including counts (fetched, staged, pushed, created/updated, skipped, failed).
- FR-24a **[Released]**: The staging spreadsheet MUST retain an append-only **`sync_activity_log`** worksheet (tab name overridable via Script Property **`SHEETS_TAB_SYNC_ACTIVITY_LOG`**) with a fixed header row. After each successful Clockify → Sheets staging run the script MUST append one row with UTC **`timestamp_utc`**, **`operation`** `clockify_pull`, sync **`mode`**, and counts **`users_pulled`**, **`projects_pulled`**, **`time_entries_pulled`** (time entries fetched from Clockify API in that run). After each Fibery labor push completes successfully from staging, the script MUST append one row with UTC timestamp, **`operation`** `fibery_push`, **`mode`** (`incremental` or `full`), and **`fibery_*`** counters (staging rows read, skipped, pushed, failed, created, updated) in the documented columns (unused **`clockify_*`** cells left blank).
- FR-25 **[Released]**: The system MUST advance the **Clockify** staging checkpoint (`CLOCKIFY_TIME_ENTRIES_CHECKPOINT`) only after successful Clockify → Sheets staging **and** successful rebuild of **`fibery_labor_staging`** in the same run. Fibery ingestion is decoupled (see FR-10b); its baseline is maintained via the **Clockify Update Log** timestamps in Fibery, not the Clockify staging checkpoint.
- FR-25a **[Released]**: HTTP calls to Clockify SHOULD retry transient failures (timeouts, `429`, and `5xx`) with bounded exponential backoff.
- FR-25b **[Released]**: Incremental time-entry pulls SHOULD use per-user latest staged `start_time` values when available.

### 3.7 Published HTML UI

- FR-26 **[Released]**: The solution MUST provide a simple HTML Service web UI published via Google Apps Script Web App deployment.
- FR-27 **[Released]**: The UI MUST display latest sync status including at minimum: last run timestamp, mode, duration (if available), and result state (success/failed/running).
- FR-28 **[Released]**: The UI MUST display summary counters from the latest run (fetched, staged, pushed, skipped, failed).
- FR-28a **[Released]**: The UI MUST display the current PRD version so users can see which documented requirements baseline the app reflects.
- FR-29 **[Released]**: The UI MUST include an on-demand sync button that starts an incremental sync.
- FR-30 **[Released]**: The UI MUST include a separate button to start a full sync (or a clear mode toggle plus run action).
- FR-31 **[Released]**: UI-triggered sync actions MUST call server-side Apps Script functions through `google.script.run`.
- FR-31a **[Released]**: The Web UI MUST expose separate actions for Fibery (**Push Fibery incremental / full**) in addition to Clockify (**Run incremental/full sync**) and MUST block overlapping runs using the same lock as Clockify sync.
- FR-32 **[Released]**: The UI MUST provide immediate user feedback for sync initiation and show completion/failure updates after execution.
- FR-33 **[Released]**: The UI MUST prevent duplicate run starts while a sync is already running.
- FR-34 **[Released]**: While a sync is running, the UI MUST show live progress updates (phase/message/counters) based on server-reported progress state.
- FR-35 **[Released]**: While a sync is running, the UI MUST show an estimated completion percentage and a visual progress indicator.
- FR-36 **[Released]**: The published HTML UI MUST be **centered** in the viewport (primary content column with a sensible max width). It MUST use **Inter** (Google Fonts) for UI typography and a **color palette aligned with harpin.ai** (navy primary, teal action, mint accent on primary actions, neutral greys). **Material Symbols** remain the icon set. **Layout patterns** (elevated surfaces, filled and outlined buttons, linear progress, status banners) follow **Material Design 3–inspired** structure (HtmlService; full Material Web Components not required).
- FR-37 **[Released]**: The Web UI MUST expose a **Source to Target Variance** panel **below** the latest-run summary that compares **Clockify** (live API: completed time entries with end time) and **Fibery** (`Agreement Management/Labor Costs` rows with non-empty **Time Log ID**) on **total entry count** and **counts by approval status** (`NOT_SUBMITTED`, `PENDING`, `APPROVED`), using the same approval-enrichment rules as the Clockify staging pipeline where applicable.
- FR-38 **[Released]**: The Web UI MUST provide a **Refresh variance** action that recomputes the above stats on demand via `google.script.run`, MUST display **last refreshed** (UTC ISO timestamp), MUST show **Fibery − Clockify** deltas per row, and MUST refuse the refresh while the shared sync lock is active (same behavior class as other run actions). Last successful variance MAY be cached in Script Properties (**`SYNC_CONSOLE_VARIANCE_SNAPSHOT`**) so status loads show the prior snapshot without re-querying.

## 4) Non-Functional Requirements

- NFR-01 (Duplicate Safety) **[Released]**: Re-running sync with unchanged source data MUST not create duplicate Fibery entities.
- NFR-02 (Reliability) **[Released]**: Partial failures MUST be surfaced with actionable error logs; next run should safely retry.
- NFR-03 (Security) **[Released]**: Secrets MUST never be hardcoded or logged.
- NFR-04 (Performance) **[Released]**: Execution should stay within Apps Script runtime limits by using pagination, batching, and minimal per-row API calls.
- NFR-05 (Maintainability) **[Released]**: Codebase should separate entry points, API clients, mapping logic, and repository/util helpers.
- NFR-06 (Operational Clarity) **[Released]**: Staged data in Sheets MUST make it easy to inspect what will be pushed to Fibery.

## 5) Target Architecture (Apps Script)

```text
Apps Script Triggers / Manual Run
  -> HTML UI (Web App) for status + manual sync actions
  -> Sync Orchestrator (main.ts entry point)
    -> Clockify Client (UrlFetchApp)
    -> Transform + Validation Layer
    -> Google Sheets Staging (users/projects/time_entries tabs)
    -> Fibery Client (/api/commands)
    -> Script Properties checkpoint update
    -> Structured logs
```

## 6) Data Contract Notes (Fibery-Aligned)

Validated against current Fibery schema:

- Destination type: `Agreement Management/Labor Costs`
- Agreement key field: `Agreement Management/Clockify Project ID` on `Agreement Management/Agreements`
- Clockify user key field: `Agreement Management/Clockify User ID` on `Agreement Management/Clockify Users`
- Primary conflict key for create-or-update: `Agreement Management/Time Log ID`

## 7) Acceptance Criteria

- AC-01 **[Released]**: A manual run successfully stages Clockify data into Google Sheets and then syncs entries into Fibery Labor Costs.
- AC-02 **[Released]**: A scheduled trigger run completes and logs summary counters.
- AC-03 **[Released]**: Incremental runs only process records newer than checkpoint.
- AC-03a **[Released]**: Sync runs do not fail due to Clockify page-size validation errors; requests use a page size at or below the Clockify maximum.
- AC-04 **[Released]**: Full mode can backfill historic records without duplicating Fibery entities.
- AC-04a **[Released]**: Approval status enrichment produces `PENDING` and `APPROVED` where applicable (not only `NOT_SUBMITTED`) in the staged `time_entries` dataset.
- AC-04b **[Released]**: A known approved time entry (for example `695c34a28de10032bd5c25ea`) resolves to `APPROVED` after sync when present in Clockify approval data.
- AC-04c **[Released]**: Approval status precedence is deterministic for conflicting signals (`APPROVED` beats `PENDING`, `PENDING` beats `NOT_SUBMITTED`).
- AC-04d **[Released]**: A time entry that appears only on approval requests whose nested state is `PENDING` (for example `69f90b8df9522d2062e2eb85` when pending in Clockify) MUST NOT be labeled `APPROVED` solely because it appeared in a list response from a different query variant; bucket mapping MUST honor nested request state.
- AC-05 **[Released]**: Entries without Agreement or Clockify User relation matches still sync with fallback text fields.
- AC-06 **[Released]**: Running timers are skipped and counted.
- AC-07 **[Released]**: Failures do not advance checkpoint state.
- AC-08 **[Released]**: README links to this PRD and supporting docs.
- AC-09 **[Released]**: Staging tabs in Google Sheets clearly show the latest normalized data for users, projects, and time entries.
- AC-10 **[Released]**: Published HTML UI shows latest sync status and summary counters from the most recent run.
- AC-10a **[Released]**: Published HTML UI shows the current PRD version.
- AC-11 **[Released]**: Clicking "Run Incremental Sync" in the UI successfully initiates and completes an incremental sync.
- AC-12 **[Released]**: Clicking "Run Full Sync" in the UI successfully initiates and completes a full sync.
- AC-13 **[Released]**: UI blocks duplicate run attempts while a sync is in progress and displays clear completion or failure feedback.
- AC-14 **[Released]**: During an active sync, the UI updates live progress details (phase, message, fetched/staged counters) without requiring manual refresh.
- AC-15 **[Released]**: During an active sync, the UI displays estimated percent complete and a visible progress bar.
- AC-16 **[Released]**: The published Web App layout presents the main column centered horizontally; primary actions use elevated surfaces and filled / outlined button patterns consistent with M3-inspired layout and harpin.ai brand colors (feature 006).
- AC-17 **[Released]**: The spreadsheet **`sync_activity_log`** tab grows by one dated row after each completed Clockify pull and each completed Fibery push, carrying the counters defined in FR-24a.
- AC-18 **[Released]**: After **Refresh variance** completes successfully, the variance panel shows updated Clockify and Fibery totals, per-status counts, deltas, and a non-empty **last refreshed** timestamp; while a sync is in progress the refresh action does not run and the user sees a blocked or **busy** outcome consistent with FR-38.

## 8) Migration from Desktop Python PRD

The previous product assumptions tied to local SQLite storage, Textual TUI, and desktop packaging are replaced by:

- Google Apps Script runtime and trigger-based execution,
- Google Sheets as interim storage for normalized sync data,
- Script Properties for config/state/checkpoints,
- Fibery as the persisted destination of record for synced time entries.

## 9) Change Log

|Date|Version|Change Summary|Author|
|---|---|---|---|
|2026-05-05|1.0|Initial Google Apps Script PRD for Clockify-to-Fibery sync target.|Cursor|
|2026-05-05|1.1|Added Google Sheets interim staging requirements before Fibery push.|Cursor|
|2026-05-05|1.2|Added published HTML UI requirements for sync status visibility and on-demand run controls.|Cursor|
|2026-05-05|1.3|Recorded delivery validation for published HTML sync console (feature 001); docs updated.|Cursor|
|2026-05-05|1.4|Added requirement for the published HTML UI to display the current PRD version.|Cursor|
|2026-05-05|1.5|Added requirements and acceptance criteria for live sync progress updates and estimated completion percent in the UI.|Cursor|
|2026-05-05|1.6|Added Clockify pagination limit requirement (max page size 200) and acceptance criteria; aligned with implemented fix.|Cursor|
|2026-05-05|1.7|Hardened approval-status enrichment to parse broader approval-request payload shapes and ensure `PENDING`/`APPROVED` mapping in staged data.|Cursor|
|2026-05-05|1.8|Expanded approval-request retrieval and ID-shape parsing to resolve missing `PENDING`/`APPROVED` mappings for known entries.|Cursor|
|2026-05-05|1.9|Added parity improvements: deterministic approval precedence across staged rows, transient Clockify retries/backoff, and per-user incremental start usage.|Cursor|
|2026-05-05|1.10|Approval buckets filter by nested `approvalRequest.status.state` (Python parity); fixed `NOT_SUBMITTED` mis-parsing via `SUBMIT` substring; widened time-entry ID extraction under `approvalRequest`.|Cursor|
|2026-05-06|1.11|Required `FIBERY_WORKSPACE` Script Property; implemented Sheets→Fibery labor cost batch push (feature 003), Clockify Update Log append, and Clockify checkpoint advance after successful end-to-end sync.|Cursor|
|2026-05-06|1.12|Fibery-ready **`fibery_labor_staging`** tab rebuilt after every Clockify sync; Fibery push isolated to explicit Web UI buttons reading that tab (FR-10a, FR-10b, FR-31a); Clockify checkpoint advances after staging + rebuilt sheet.|Cursor|
|2026-05-06|1.13|Published sync console centered layout + Material Design 3 styling (Google Fonts text + Material Symbols, M3 surfaces/buttons/progress/banners); FR-36 / AC-16.|Cursor|
|2026-05-06|1.14|Append-only Sheets **`sync_activity_log`** for Clockify pull and Fibery push summary rows (FR-24a / AC-17).|Cursor|
|2026-05-06|1.15|Requirement status tags (**Released** / **In-Progress** / **Backlog**) on each FR, AC, and NFR; FR-03 **`SYNC_MODE`** Script Property marked **Backlog** until implemented.|Cursor|
|2026-05-08|1.16|Source-to-target variance panel (Clockify vs Fibery histograms, refresh, cache **`SYNC_CONSOLE_VARIANCE_SNAPSHOT`**); FR-37 / FR-38 / AC-18 (feature 005).|Cursor|
|2026-05-11|1.17|Sync console visual refresh: **Inter** + **harpin.ai** palette and mint primary CTAs; FR-36 / AC-16 (feature 006).|Cursor|
|2026-05-11|1.18|Fibery variance histogram: fix invalid `q/order-by` / paged query (silent zeros); single `q/no-limit` query + **`fiberyAssertCommandSuccess_`** on Fibery command results (FR-37).|Cursor|
|2026-05-11|1.19|Fibery variance query: select Time Entry Status via **`['field', 'enum/name']`** (enum is not primitive in `fibery.entity/query`); fixes “field is not primitive” error (FR-37).|Cursor|

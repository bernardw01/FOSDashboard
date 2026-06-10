# Implementation plan - Agreement Status Updates on Delivery P&L

> Companion to [018-agreement-status-updates-delivery-pnl.md](018-agreement-status-updates-delivery-pnl.md). **Status: Shipped** - **MINOR PRD 2.12.0**, **FR-112**, **AC-70**.

## Summary

| Item | Choice |
| --- | --- |
| **Release** | **MINOR** (`2.12.0`) - new write path to Fibery + P&L payload extension + Delivery UI surface + snapshot alignment. |
| **Fibery type** | `Agreement Management/Status Updates` (relation to `Agreement Management/Agreements`). |
| **Enum (canonical)** | `Agreement On Track` (Green), `Agreement At Risk` (Yellow), **`Agreement Off Trajectory`** (Red). |
| **Read path** | Extend **`buildDeliveryProjectMonthlyPnLInternal_`** (shared by live API + snapshot job) to attach `statusUpdates`. |
| **Write path** | New **`createAgreementStatusUpdate(agreementId, statusKey, updateContent)`** via `fiberyBatchCommands_` / `fibery.entity/create`. |
| **Cache / snapshot** | **`DELIVERY_PNL_CACHE_SCHEMA_VERSION_` 4 → 5**; client key suffix `_v5`; **`SNAPSHOT_EXPECTED_SCHEMA_VERSIONS_['delivery-pnl']` → 5**. No new Drive artifact - status rows live inside each `delivery-pnl/<agreementId>.json`. |
| **Historical UI** | Snapshot mode: render status chip from bundled P&L; **disable Add status update** (read-only). |
| **Auth** | Read + write: **`requireAuthForApi_()`** (same as Delivery P&L today). |

## Phased delivery

### Phase 0 - Fibery schema fix (operator, ~15 min)

| Step | Task | Notes |
| --- | --- | --- |
| 0.1 | In Fibery UI, open enum **`Agreement Management/Agreement Status`** on type **Status Updates**. | MCP confirmed typo: `Agreement of Trajectory` exists today. |
| 0.2 | **Rename** enum value **`Agreement of Trajectory` → `Agreement Off Trajectory`**. | Update any existing rows if Fibery prompts. |
| 0.3 | Set enum colors if not already: On Track = green, At Risk = yellow/amber, Off Trajectory = red. | Prefer `enum/color` on read; UI falls back to traffic-light map. |
| 0.4 | Re-run MCP `describe_database` on `Agreement Management/Status Updates` and save enum list in feature **018** R0 notes. | Block Phase 1 until enum name matches code constant. |

### Phase 1 - Server read + normalize (1 d)

| Step | Task | Notes |
| --- | --- | --- |
| 1.1 | Add **`src/agreementStatusUpdates.js`** (or extend `deliveryDashboard.js` if small) with header PRD version line. | Prefer dedicated module if >~120 lines. |
| 1.2 | **`STATUS_UPDATE_ENUM_*` constants** + **`statusKeyToEnumName_()`** map: `on_track` → `Agreement On Track`, `at_risk` → `Agreement At Risk`, `off_trajectory` → **`Agreement Off Trajectory`**. | Single source for create + `statusOptions` in payload. |
| 1.3 | **`fetchStatusUpdatesForAgreement_(agreementId, limit)`** - Fibery query filtered by Agreement id, ordered `creation-date` desc, cap from **`DELIVERY_STATUS_UPDATES_MAX_ROWS`** (default 20). | Select: id, creation-date, Submitted by, Agreement Status (enum/name, enum/color), Update (document plain text per R0). |
| 1.4 | **`normalizeStatusUpdateRow_(raw)`** → `{ id, agreementId, agreementStatus, trafficLight, submittedBy, createdAt, updatePlain }`. | `trafficLight` from enum name map; tolerate null status on legacy rows. |
| 1.5 | **`buildStatusUpdatesBlock_(agreementId, rows)`** → `{ latest, history, statusOptions }`. | `latest = history[0]` or null. |
| 1.6 | R0 spike: confirm document read path (inline vs separate document API). Reuse pattern from agreement description if needed. | Log findings in feature **018** § R0. |

### Phase 2 - P&L payload + snapshot alignment (0.5 d)

| Step | Task | Notes |
| --- | --- | --- |
| 2.1 | In **`buildDeliveryProjectMonthlyPnLInternal_`**, after agreement context succeeds, call **`fetchStatusUpdatesForAgreement_`**. | Failure **non-fatal**: empty `statusUpdates` + `warnings[]` entry. |
| 2.2 | Attach **`statusUpdates`** to P&L return object (live + snapshot). | Same shape live and snapshot per `dashboard-snapshot-cache-sync.mdc`. |
| 2.3 | Bump **`DELIVERY_PNL_CACHE_SCHEMA_VERSION_`** **4 → 5** in `deliveryDashboard.js`. | Comment block documents v5 = statusUpdates. |
| 2.4 | Client: **`DELIVERY_PNL_CACHE_SCHEMA_VERSION`** + cache key suffix **`_v5`** in `DashboardShell.html`. | Invalidates `_v4` sessionStorage entries. |
| 2.5 | **`dashboardSnapshotStore.js`**: **`SNAPSHOT_EXPECTED_SCHEMA_VERSIONS_['delivery-pnl']` → 5**. | Legacy snapshot dates keep loading v4 P&L without status chip data. |
| 2.6 | **No `dashboardSnapshotJob.js` logic change** beyond what the shared builder provides - `processSnapshotPnlBatch_` already calls `buildDeliveryProjectMonthlyPnLInternal_`. | Verify manifest rows record `cacheSchemaVersion: 5`. |
| 2.7 | Docs: **`009-dashboard-historical-snapshots.md`** - note `delivery-pnl/*.json` schema **5** includes `statusUpdates`; **`010`** - Delivery P&L snapshot shows status chip read-only. | |

### Phase 3 - Server create (0.5 d)

| Step | Task | Notes |
| --- | --- | --- |
| 3.1 | **`createAgreementStatusUpdate(agreementId, statusKey, updateContent)`** in `agreementStatusUpdates.js`; gate **`requireAuthForApi_()`**. | Public via `google.script.run`. |
| 3.2 | Validate: non-empty `agreementId`, known `statusKey`, non-empty body after trim, length ≤ **`DELIVERY_STATUS_UPDATE_MAX_CHARS`** (default 8000). | Safe user-facing errors. |
| 3.3 | **`submittedBy`** = `Session.getActiveUser().getEmail()` only (ignore any client field). | |
| 3.4 | Sanitize HTML: strip scripts, event handlers, `javascript:` URLs; allow basic tags (p, br, strong, em, ul, ol, li) or convert to plain + `fibery/document-content`. | Match v1 rich-text scope in feature spec. |
| 3.5 | **`fibery.entity/create`** on `Agreement Management/Status Updates` with Agreement relation + enum + Submitted by + Update document. | Optional `Name` if not auto-generated (set `ISO + email` if R0 requires). |
| 3.6 | Return `{ ok, id?, message? }`; log failures with `console.warn` only. | |

### Phase 4 - Client UI: status chip + modal (1 - 1.5 d)

| Step | Task | Notes |
| --- | --- | --- |
| 4.1 | **`#delivery-pnl-kpi-strip` layout** - flex row wraps; after Margin chip, add **`.fos-delivery-status-chip`** container (hidden until P&L loaded). | Match mockup: right of Margin KPI. |
| 4.2 | **`renderDeliveryStatusChip_(statusUpdates)`** - dot color, enum label, submittedBy, short date, `updatePlain` excerpt (e.g. 120 chars). Empty: "No status updates yet". | |
| 4.3 | **Add status update** button → opens **`#deliveryStatusUpdateModal`**. | Bootstrap modal, dark theme. |
| 4.4 | Modal: status `<select>` (Green / Yellow / Red labels), rich-text area (contenteditable or textarea v1), Cancel / Submit. | Disable Submit while in flight. |
| 4.5 | On submit: `google.script.run.createAgreementStatusUpdate(...)` → on success invalidate `fos_delivery_pnl_<id>_v5`, refetch P&L, re-render chip + grid/chart. | |
| 4.6 | Wire into **`renderDeliveryMonthlyPnL_`** / **`loadDeliveryPnLForProject_`** after payload arrives. | Chip updates on cache hit too if payload includes `statusUpdates`. |
| 4.7 | CSS: `.fos-status-dot--green|yellow|red`, modal styles scoped under `#panel-delivery`. | |

### Phase 5 - Historical snapshot mode (0.5 d)

| Step | Task | Notes |
| --- | --- | --- |
| 5.1 | **`getDashboardSnapshotPnl`** already returns stored `delivery-pnl/<id>.json` - no store change once builder ships v5. | |
| 5.2 | When **`!isLiveDataSource_()`**: render status chip from snapshot P&L payload; **hide or disable Add status update**; optional subtitle "Snapshot - status updates are read-only". | |
| 5.3 | Legacy snapshots (P&L schema 4): chip shows "Status updates not in this snapshot" (same pattern as missing expenses/pipeline artifacts). | Use `validateSnapshotArtifactSchema_` warning path. |
| 5.4 | Smoke: select snapshot date in sidebar → Delivery → project → chip shows historical latest; no Fibery create calls in Apps Script transcript. | |

### Phase 6 - Config, activity, PRD, release (0.5 d)

| Step | Task | Notes |
| --- | --- | --- |
| 6.1 | **`adminSettingsRegistry.js`** - `DELIVERY_STATUS_UPDATES_MAX_ROWS`, `DELIVERY_STATUS_UPDATE_MAX_CHARS` under delivery-dashboard group. | |
| 6.2 | **`userActivityLog.js`** - whitelist `delivery_status_update_modal_open`, `delivery_status_update_submit`. | |
| 6.3 | **PRD 2.12.0**: **FR-112**, **AC-70**, §13 changelog; extend **FR-104** / **AC-60** / **AC-61** for P&L schema 5 + snapshot statusUpdates. | |
| 6.4 | Version sweep: `FOS_PRD_VERSION`, all `src/*` headers, `000-overview.md`, feature **006** + **018** headers. | |
| 6.5 | Editor diagnostic: **`_diag_sampleStatusUpdates(agreementId)`** logs fetch + normalize counts. | Optional but helpful. |

## File touch list (expected)

| File | Action |
| --- | --- |
| `src/agreementStatusUpdates.js` | **Add** - query, normalize, create, enum map, sanitization. |
| `src/deliveryDashboard.js` | Extend `buildDeliveryProjectMonthlyPnLInternal_`; bump `DELIVERY_PNL_CACHE_SCHEMA_VERSION_` to **5**. |
| `src/DashboardShell.html` | Status chip, modal, submit flow, P&L cache `_v5`, snapshot read-only gate. |
| `src/dashboardSnapshotStore.js` | Expected schema **5** for `delivery-pnl`. |
| `src/userActivityLog.js` | Whitelist events. |
| `src/adminSettingsRegistry.js` | New Script Properties. |
| `src/Code.js` | Re-export create handler if needed; PRD version on release. |
| `docs/FOS-Dashboard-PRD.md` | FR-112, AC-70, FR-104/AC-60/61 notes, §13 row, **2.12.0**. |
| `docs/features/009-dashboard-historical-snapshots.md` | `delivery-pnl` schema **5** + `statusUpdates`. |
| `docs/features/010-dashboard-historical-data-source.md` | Delivery snapshot status chip behavior. |
| `docs/features/006-delivery-project-pnl.md` | Cross-link **018**; P&L schema v5 note. |
| `docs/features/018-agreement-status-updates-delivery-pnl.md` | Flip to in-progress / released on ship. |
| `docs/features/000-overview.md` | Shipped blurb on release. |

## Risk / dependency notes

| Risk | Mitigation |
| --- | --- |
| Enum rename breaks existing Fibery rows | Fibery typically renames in place; verify sample query after Phase 0. |
| Document field not returned in query | R0 spike; fallback to empty `updatePlain` + warning. |
| Snapshot job runtime (+1 query per project) | Same batching as today; status query is small (limit 20). |
| XSS in rich text | Server-side sanitize before Fibery write; never `innerHTML` unsanitized in chip. |
| Users submit in snapshot mode | Disable button when `!isLiveDataSource_()`. |

## Verification checklist (release gate)

1. Phase 0: enum reads **`Agreement Off Trajectory`** in Fibery MCP.
2. Live: select project → chip + P&L load together; submit all three statuses.
3. Refresh project → latest chip correct without full dashboard reload.
4. `_diag_runSnapshotForDate` → open `delivery-pnl/<id>.json` → contains `statusUpdates` + `cacheSchemaVersion: 5`.
5. Web App snapshot mode → chip visible, Add disabled.
6. User Activity rows for modal open + submit.

## Estimated effort

| Phase | Days |
| --- | --- |
| 0 Fibery operator | 0.25 |
| 1 Server read | 1 |
| 2 P&L + snapshot | 0.5 |
| 3 Server create | 0.5 |
| 4 Client UI | 1.25 |
| 5 Historical UI | 0.5 |
| 6 Release hygiene | 0.5 |
| **Total** | **~4.5 d** |

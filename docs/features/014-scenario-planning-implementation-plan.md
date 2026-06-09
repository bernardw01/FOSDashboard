# Implementation plan - Scenario Planning (Exec, Drive JSON)

> Companion to [014-scenario-planning.md](014-scenario-planning.md). **Status: planned** - not started in `src/` as of PRD **2.8.0**.

## Summary

| Item | Choice |
| --- | --- |
| **Product spec** | [014-scenario-planning.md](014-scenario-planning.md) (phases A-J, Tier 1/2 capabilities) |
| **Imported baseline** | [financial_scenario_modeling_prd.md](../financial_scenario_modeling_prd.md) (intent only; FOS uses Apps Script + Drive, not standalone stack) |
| **Access** | **`Role = EXEC`** only (case-insensitive); **`requireAuthForApi_()`** + **`canAccessScenarioPlanning_()`**; nav omits route for others; APIs return **FORBIDDEN** |
| **Storage** | Google Drive JSON (mirror [009](009-dashboard-historical-snapshots.md)): **`SCENARIO_PLANNING_DRIVE_FOLDER_ID`**, `index.json`, `profiles/`, `scenarios/<id>/` |
| **Actuals (read-only)** | Reuse builders: [003](003-agreement-dashboard-fibery-client-cache.md), [006](006-delivery-project-pnl.md), [005](005-utilization-management-dashboard.md), optional [010](010-dashboard-historical-data-source.md) snapshot bundle |
| **Write-back** | **None** to Fibery, Sheets, QBO, or legacy spreadsheet |
| **PRD lift (at Phase A ship)** | Reserve **FR-111** + **AC-68** (and extend on later phases); first release likely **MINOR** → **2.9.0** per `.cursor/rules/google-apps-script-core.mdc` |
| **Design acceptance test** | Duplicate baseline → add one **enterprise consulting** instance → change **3 → 5 engineers** → Scott/Ray see movement in **Assumptions** + **Compare** without a spreadsheet (see feature spec) |

## Recommended release strategy

Ship in **vertical slices** so Exec users get value early without waiting for the full FP&A surface. Each slice below is independently testable and should get its own PRD version bump when merged.

| Release | Phases | User-visible outcome | Suggested PRD bump |
| --- | --- | --- | --- |
| **R1 - Foundation** | A | Exec sees **Scenario planning** nav; create/duplicate/archive scenarios; empty or shell model in Drive | **2.9.0** MINOR |
| **R2 - Ground truth** | B (+ partial D) | **Seed from Live/snapshot**; **`actualsAsOf`**; **committed** layer; read-only **Executive** tables with **plan vs actual** for elapsed months | **2.11.0** MINOR |
| **R3 - Templates** | C | Profile library + built-in archetypes; instantiate deals with **`profileVersion`** pinning | **2.11.0** MINOR |
| **R4 - Engine** | D, E (core) | **Driver recompute**; hypothetical instances; staffing drives P&L + utilization (cash simplified in R5) | **2.12.0** MINOR |
| **R5 - Outputs** | F | Monthly **P&L**, **cash** (DSO/DPO/payroll lag), FTE, utilization, revenue-by-customer; **`computed`** cache | **2.13.0** MINOR |
| **R6 - Compare & export** | G | **Compare** vs pinned baseline; **Assumptions** registry; **sensitivity strip**; board **CSV/print** | **2.14.0** MINOR |
| **R7 - Live committed** | H | **Refresh committed** from Fibery without wiping hypotheticals | **2.15.0** PATCH or MINOR |
| **Backlog** | I, J | QuickBooks read; polished investor export | TBD |

Adjust version numbers at kickoff; the important part is **one PRD bump per merge-worthy release**, not one giant drop.

## Architecture (modules)

```text
src/scenarioPlanningAuth.js     Exec gate (or extend authUsersSheet.js)
src/scenarioPlanningStore.js    Drive I/O, index, CRUD, duplicate, archive, LockService
src/scenarioPlanningSeed.js     Live + snapshot → committed slice + actualsAsOf
src/scenarioPlanningProfiles.js Profile CRUD, versioning, built-in seeds
src/scenarioPlanningCompute.js  Driver graph, revenue, staffing, P&L, cash, utilization
src/scenarioPlanningApi.js      google.script.run surface (thin facade)
src/Code.js                     buildNavigationModel_ + ensureScenarioPlanningDriveFolder()
src/DashboardShell.html         #panel-scenario-planning UI
src/adminSettingsRegistry.js    SCENARIO_PLANNING_* properties
src/userActivityLog.js          scenario_planning_* whitelist
```

**Reuse (do not duplicate Fibery fetch logic):**

- `buildAgreementDashboardPayload_(asOfDate)` for agreements + revenue items
- `buildUtilizationDashboardPayload_(rangeStart, rangeEnd)` for labor baselines
- `buildDeliveryDashboardPayloadFromAgreement_` + `buildDeliveryProjectMonthlyPnLInternal_` where per-project rollups help seed committed revenue/cost patterns
- `getDashboardSnapshotCoreBundle(snapshotDate)` when user picks a snapshot date at seed time

## Schema versions (initial)

| Artifact | Constant | v1 notes |
| --- | --- | --- |
| Catalog | `indexVersion: 1` | `baselineScenarioId`, `scenarios[]`, `profiles[]` |
| Scenario manifest | `scenarioSchemaVersion: 1` | `scenarioKind`, `locked`, `actualsAsOf`, `seedSource`, … |
| Profile | `profileSchemaVersion: 1` | `templateKind`, `defaults`, monotonic `profileVersion` |
| Model | `modelSchemaVersion: 1` | `globals`, `committed`, `hypothetical`, `years[]` |
| Computed | `computedSchemaVersion: 1` | Sharded to `computed.json` if model grows (open question #12) |
| Client cache | `SCENARIO_PLANNING_CACHE_SCHEMA_VERSION = 1` | `sessionStorage` key `fos_scenario_planning_v1` |

Bump server + client constants together when shape changes (same discipline as snapshot cache sync).

---

## Phase A - Route shell + access + storage (R1)

**Maps to:** feature Phase A | **Tier:** foundation

### Goals

- Exec-only route **`scenario-planning`** / panel **`#panel-scenario-planning`**
- Drive folder + **`ensureScenarioPlanningDriveFolder()`**
- Scenario catalog: **list**, **create**, **duplicate**, **archive**
- Manifest fields: **`scenarioKind`** (`baseline` | `working` | `archived`), **`locked`**, audit fields
- No compute engine yet; UI shows catalog + empty workspace placeholder

### Server tasks

| Step | Task | Notes |
| --- | --- | --- |
| A.1 | **`canAccessScenarioPlanning_()`** in `authUsersSheet.js` (or `scenarioPlanningAuth.js`): true when **`Role === 'EXEC'`** (also allow **`ADMIN`**? **Decision: Exec only per feature spec** unless product expands). | Mirror `canAccessExpensesDashboard_` |
| A.2 | **`scenarioPlanningStore.js`**: `ensureScenarioPlanningDriveFolder()`, read/write `index.json`, `scenarios/<id>/manifest.json`, stub `model.json` (`{ modelSchemaVersion: 1, globals: {}, committed: {}, hypothetical: { instances: [] }, years: [] }`), optional empty `computed.json` | Use **`LockService`** on index mutations (copy `dashboardSnapshotStore.js`) |
| A.3 | **`scenarioPlanningApi.js`**: `getScenarioPlanningCatalog()`, `createScenario_({ name, scenarioKind })`, `duplicateScenario_(id)`, `archiveScenario_(id)`, `getScenarioManifest_(id)` | All call `requireScenarioPlanningAccess_()` |
| A.4 | **`promoteScenarioToBaseline_`**: demote prior baseline → `working`; set new `baseline`, `locked: true`, update `index.baselineScenarioId` | T1.2 prep |
| A.5 | Editor ops: `ensureScenarioPlanningDriveFolder()`, `_diag_listScenarios()`, `_diag_createScenario_` | Match snapshot diagnostics style |
| A.6 | **`adminSettingsRegistry.js`**: group **Scenario planning** with `SCENARIO_PLANNING_DRIVE_FOLDER_ID` (read-only after create), `SCENARIO_PLANNING_ENABLED`, `SCENARIO_PLANNING_MAX_YEARS` | Kill-switch for rollout |

### Client tasks

| Step | Task | Notes |
| --- | --- | --- |
| A.7 | **`buildNavigationModel_()`**: top-level item after **Home** (before Sales): `{ id: 'scenario-planning', label: 'Scenario planning' }`; filter when `!canAccessScenarioPlanning_` | Icon: `bi-diagram-3` or `bi-sliders2` |
| A.8 | **`#panel-scenario-planning`**: `.fos-agreement-root` chrome; toolbar: scenario `<select>`, **New**, **Duplicate**, **Save** (disabled until model edits ship); sub-nav tabs stubbed (Executive disabled except placeholder) | Match [007](007-labor-hours-dashboard.md) / [008](008-revenue-review-dashboard.md) |
| A.9 | Wire `showScenarioPlanning()`, `onNavClick`, topbar title, **coming-soon** guard for non-Exec (should not appear) | |
| A.10 | Load catalog on panel open; `scenario_planning_catalog_load` activity (optional) | |

### Docs / PRD (Phase A merge)

- Add **FR-111**, **AC-68** to `docs/FOS-Dashboard-PRD.md`; changelog; **`FOS_PRD_VERSION` 2.9.0**; header sweep
- Update [002-spreadsheet-user-authorization.md](002-spreadsheet-user-authorization.md) permissions matrix: **Scenario planning** row
- Update [000-overview.md](000-overview.md) planned → in progress for R1

### Phase A test plan

| # | Steps | Expected |
| --- | --- | --- |
| T-A1 | User with **Role = Exec** | Nav shows **Scenario planning**; panel opens |
| T-A2 | User with **Role = ADMIN** only (not Exec) | Nav hidden; API **FORBIDDEN** (unless product adds ADMIN) |
| T-A3 | Create scenario | Drive folder + `index.json` + `scenarios/<id>/manifest.json` |
| T-A4 | Duplicate / archive | Index updates; kinds correct |
| T-A5 | Promote baseline | Single `baselineScenarioId`; prior baseline unlocked/demoted |

---

## Phase B - Baseline from actuals + plan vs actual (R2)

**Maps to:** feature Phase B | **Tier:** T1.3, T1.4 (reforecast stub), T1.7 (committed slice)

### Goals

- **Seed from Live** or **snapshot date** (sidebar data source respected)
- Populate **`committed`** from agreement + utilization (+ delivery patterns where useful)
- Set **`actualsAsOf`**, **`seedSource`**, **`seedSnapshotDate?`**
- **Reforecast** API: re-run seed into **committed** only; preserve **`hypothetical`**
- Executive view (read-only): monthly rows with **actual | plan | variance** for months ≤ `actualsAsOf`

### Server tasks

| Step | Task | Notes |
| --- | --- | --- |
| B.1 | **`scenarioPlanningSeed.js`**: `buildCommittedSliceFromActuals_({ seedSource, snapshotDate?, asOfDate })` | Call existing builders; map to normalized committed schema (agreements, milestones, labor rollups - document field mapping in code comments) |
| B.2 | **`seedScenarioFromActuals_(scenarioId, opts)`** | Writes `model.json`; updates manifest; does **not** call Fibery write APIs |
| B.3 | **`reforecastScenario_(scenarioId, opts)`** | Replace `committed` + bump `actualsAsOf`; clone `hypothetical` unchanged |
| B.4 | **`getScenarioPlanningModel_(id)`** + **`saveScenarioModel_(id, model)`** with validation + size guard | Warn if JSON approaches Apps Script/Drive limits |
| B.5 | Plan vs actual for B: **plan** = zeros or last-saved plan columns in `computed` placeholder; **actual** from committed monthly actuals extractor | Full plan engine waits for Phase D/F; still satisfy T1.3 columns for elapsed months |

### Client tasks

| Step | Task | Notes |
| --- | --- | --- |
| B.6 | **New / Seed wizard**: choose **Live** vs **snapshot** (reuse `getDashboardSnapshotCatalog` + `dataSourceState` or explicit picker) | |
| B.7 | **Executive** tab (read-only tables): revenue rollups, variance columns, `actualsAsOf` banner | Chart.js optional in B |
| B.8 | **Reforecast** button (Exec, confirm dialog) | |

### Dependencies

- Snapshot bundle must include agreement + utilization (and delivery-projects for project list) per [009](009-dashboard-historical-snapshots.md)
- Agreement **future revenue as-of** semantics align with `buildAgreementDashboardPayload_(snapshotDate)` when seeding from snapshot

### Phase B test plan

| # | Steps | Expected |
| --- | --- | --- |
| T-B1 | Seed from **Live** | `seedSource: 'live'`; Fibery unchanged; committed populated |
| T-B2 | Seed from **snapshot date** | `seedSnapshotDate` set; no live Fibery calls during seed |
| T-B3 | Reforecast with hypothetical instance (added in R4) | Hypothetical survives; committed refreshes |
| T-B4 | Months ≤ `actualsAsOf` show actual/plan/variance columns | |

---

## Phase C - Deal templates / profiles (R3)

**Maps to:** feature Phase C | **Tier:** T2.5

### Goals

- `profiles/<profileId>.json` CRUD + **clone**
- Seed built-ins: **subscription-onboarding**, **enterprise-consulting**, **managed-services**
- Scenarios reference **`profileId` + `profileVersion`**; profile edit creates **new version** without mutating old references

### Server tasks

| Step | Task | Notes |
| --- | --- | --- |
| C.1 | **`scenarioPlanningProfiles.js`**: list, get, create, update (bump version), clone | Update = write `profiles/<id>.json` with `profileVersion++` |
| C.2 | **`seedBuiltInProfiles_()`** on first folder setup (idempotent) | Defaults from feature spec JSON examples |
| C.3 | **`attachProfileInstance_(scenarioId, { profileId, profileVersion, overrides, startMonth })`** → `hypothetical.instances[]` | Precedence: instance > profile > globals (document in compute phase) |

### Client tasks

| Step | Task | Notes |
| --- | --- | --- |
| C.4 | **Deals** tab: profile library table + **Add instance** modal | |
| C.5 | Show **profile version** + **Upgrade to latest** affordance per instance | |

---

## Phase D - Driver engine + variables (R4)

**Maps to:** feature Phase D | **Tier:** T1.1, T1.6

### Goals

- Dependency graph: globals → profiles → instances → revenue → P&L inputs (staffing hooks in E)
- **`recomputeScenario_(id)`** with target **≤ 5s** for typical horizon (chunk by year if needed)
- Invalidate **`computed`** on save; surface **stale / computing** in UI

### Server tasks

| Step | Task | Notes |
| --- | --- | --- |
| D.1 | **`scenarioPlanningCompute.js`**: pure functions where possible; `recomputeScenario_(id)` returns `{ ok, computed, warnings, durationMs }` | Log slow recompute to console |
| D.2 | Month grid generator from `years[]` + `globals` (timezone: **`SCENARIO_PLANNING_TIMEZONE`** or reuse snapshot TZ) | |
| D.3 | Revenue engine v1: service milestones, subscription MRR ramp + churn, hybrid rules per instance | Start with monthly only |
| D.4 | Write `computed.json` (or embedded) with `computedSchemaVersion`, `asOf`, `invalidatedAt` | |

### Client tasks

| Step | Task | Notes |
| --- | --- | --- |
| D.5 | On Save: call recompute; spinner on Executive | |
| D.6 | **Years** tab: add/remove calendar years (respect `SCENARIO_PLANNING_MAX_YEARS`) | |
| D.7 | **Assumptions** tab (partial): list globals + instance overrides (full registry completed in G) | |

### Performance tactics

- Cache last `computed` in Drive; skip recompute if model hash unchanged
- If > 5s: set `partial: true`, return last good computed + warning (NFR)

---

## Phase E - Revenue, staffing & capacity (R4/R5)

**Maps to:** feature Phase E | **Tier:** T1, T2.2

### Goals

- **Staffing plan** drives labor P&L lines, capacity hours, utilization denominator
- Changing **3 → 5 engineers** moves P&L, utilization, and (with F) cash together

### Server tasks

| Step | Task | Notes |
| --- | --- | --- |
| E.1 | Extend model: `hypothetical.staffing[]` (FTE/contractor rows: role, startMonth, salary, hours) | |
| E.2 | Demand hours from deal instances (implementation/support hours, fteDemand) | |
| E.3 | Utilization = demand / capacity (document formula; align with [005](005-utilization-management-dashboard.md) where practical - resolve open question #3) | |
| E.4 | Labor cost lines feed monthly P&L | |

### Client tasks

| Step | Task | Notes |
| --- | --- | --- |
| E.5 | **Staffing** tab: editable grid + capacity gap indicators | |

---

## Phase F - Financial outputs + P&L→cash (R5)

**Maps to:** feature Phase F | **Tier:** T1.3 (full), T2.3

### Goals

- Outputs: monthly **P&L**, **cash**, **FTE**, **utilization**, **revenue by customer**
- **Cash**: simplified operating cash via **`dsoDays`**, **`dpoDays`**, **`payrollLagDays`** on globals; **runway months** on KPI strip
- **EBITDA**: include only if open question #2 closed as yes (else omit v1)

### Server tasks

| Step | Task | Notes |
| --- | --- | --- |
| F.1 | Extend compute: P&L rollup, cash timing, customer revenue breakdown | |
| F.2 | Plan vs actual: plan columns from computed; actual from committed extractor | |
| F.3 | Quarterly/annual rollups in `computed` for UI grain toggle | |

### Client tasks

| Step | Task | Notes |
| --- | --- | --- |
| F.4 | **Executive** KPI strip: MRR/ARR, gross margin, FTE, utilization, cash runway | |
| F.5 | Tables with **month / quarter / year** toggle (store preference in `sessionStorage`) | |

---

## Phase G - Dashboards, compare & export (R6)

**Maps to:** feature Phase G | **Tier:** T1.2, T1.5, T2.1, T2.4, T2.6

### Goals

- **Compare** vs **`index.baselineScenarioId`** (pinned)
- **Assumption registry** with diff vs baseline
- **Sensitivity strip**: one-variable KPI delta without new scenario file
- **Export**: CSV + print stylesheet (mirror labor-hours / revenue-review)

### Server tasks

| Step | Task | Notes |
| --- | --- | --- |
| G.1 | **`compareScenarios_({ baselineId, scenarioIds[] })`** | Same KPI definitions as Executive |
| G.2 | **`diffAssumptions_(baselineId, scenarioId)`** | |
| G.3 | **`sensitivityDelta_({ baselineId, scenarioId, assumptionKey, delta })`** | Ephemeral recompute or analytic shortcut - prefer small ephemeral recompute for v1 |
| G.4 | **`exportScenarioSnapshot_(id)`** | CSV sections + metadata for print |

### Client tasks

| Step | Task | Notes |
| --- | --- | --- |
| G.5 | **Compare** tab: scenario multi-select, KPI variance, assumption diff table | |
| G.6 | **Sensitivity** controls on Compare | |
| G.7 | **Export** tab / toolbar: Copy CSV, print | |
| G.8 | Baseline **read-only** in UI unless **Promote** / admin unlock | |

---

## Phase H - Committed layer refresh (R7)

**Maps to:** feature Phase H | **Tier:** T1.7

### Goals

- **Refresh committed** pulls latest Fibery agreements/milestones into **committed** only
- Multi-year contracts (e.g. Princess) update without re-keying spreadsheet

### Server tasks

| Step | Task | Notes |
| --- | --- | --- |
| H.1 | **`refreshScenarioCommitted_(scenarioId)`** | Reuse seed mapping functions; merge, do not delete `hypothetical` |
| H.2 | UI warnings for partial Fibery failures | |

---

## Phase I - QuickBooks read (backlog)

**Maps to:** feature Phase I

- Read-only overlay for revenue, payroll, expenses (MCP/API TBD - open question #10)
- Do not block R1-R6 delivery

---

## Phase J - Investor export (backlog)

**Maps to:** feature Phase J

- Polished investor pack beyond Phase G board snapshot (PDF/HTML - open question #9)

---

## Activity logging

Whitelist in `userActivityLog.js` (Route **`scenario-planning`**):

| Event | When |
| --- | --- |
| `scenario_planning_open` | Panel first open per session |
| `scenario_planning_create` | New scenario |
| `scenario_planning_duplicate` | Duplicate |
| `scenario_planning_seed` | Seed / reforecast |
| `scenario_planning_save` | Model save + recompute |
| `scenario_planning_compare` | Compare tab load |
| `scenario_planning_export` | Export |
| `scenario_planning_refresh_committed` | Phase H |

No PII in labels (scenario ids and counts only).

---

## File touch list (full feature)

| File | Action |
| --- | --- |
| `src/scenarioPlanningAuth.js` | **Add** (optional; may fold into `authUsersSheet.js`) |
| `src/scenarioPlanningStore.js` | **Add** |
| `src/scenarioPlanningSeed.js` | **Add** |
| `src/scenarioPlanningProfiles.js` | **Add** |
| `src/scenarioPlanningCompute.js` | **Add** |
| `src/scenarioPlanningApi.js` | **Add** |
| `src/authUsersSheet.js` | `canAccessScenarioPlanning_()` |
| `src/Code.js` | Nav + `FOS_PRD_VERSION` per release |
| `src/DashboardShell.html` | Panel + tabs + charts |
| `src/adminSettingsRegistry.js` | Script Properties |
| `src/userActivityLog.js` | Event whitelist |
| `docs/FOS-Dashboard-PRD.md` | FR/AC per release |
| `docs/features/002-spreadsheet-user-authorization.md` | Matrix row |
| `docs/features/014-scenario-planning.md` | Status + PRD version on ship |
| `docs/features/000-overview.md` | Shipped lines per release |

---

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| **Apps Script 6 min / payload size** | Shard `computed.json`; cap years via property; chunk recompute by year |
| **Seed mapping complexity** | Phase B documents explicit field mapping table in `scenarioPlanningSeed.js` header; start with agreement + utilization only |
| **Exec-only vs ADMIN** | Spec says Exec; document if ADMIN should inherit (default: **Exec only**) |
| **Concurrent editors** | v1 last-write-wins + audit fields; show `updatedBy` / `updatedAt` on save conflict |
| **Snapshot vs Live drift** | Manifest records `seedSource`; reforecast CTA when `actualsAsOf` stale |
| **Utilization formula mismatch** | Phase E spike: pick Operations formula or planning-specific; document in compute module |
| **Scope creep (15 tabs)** | Stick to phased releases; defer QBO and investor PDF |

---

## Open questions - implementation defaults

| # | Feature open question | Plan default |
| --- | --- | --- |
| 2 | EBITDA in v1? | **Omit** until leadership confirms; gross margin + cash runway required |
| 3 | Utilization formula | **Planning-specific** capacity vs demand; reuse Utilization **labels** only |
| 6 | Legacy spreadsheet import | **Out of scope** R1-R6; seed from FOS actuals only |
| 12 | Shard model vs computed | **`model.json` + `computed.json`** split when computed > ~1MB |
| 13 | Scheduled Fibery refresh | **Manual** Refresh committed in H; no new trigger in v1 |

---

## Suggested first sprint (R1 only)

1. Implement **Phase A** server store + APIs + Exec gate.
2. Wire **nav + empty panel** + catalog UI.
3. PRD **2.9.0** + permissions matrix row + diagnostics.
4. Manual test T-A1 through T-A5 on deployed Web App.

Then proceed to **Phase B** (seed) as the next PR.

---

## Related documents

- [014-scenario-planning.md](014-scenario-planning.md) - full feature spec, acceptance criteria, UI anatomy
- [002-spreadsheet-user-authorization.md](002-spreadsheet-user-authorization.md) - Users sheet contract
- [009-dashboard-historical-snapshots.md](009-dashboard-historical-snapshots.md) - Drive JSON patterns
- [010-dashboard-historical-data-source.md](010-dashboard-historical-data-source.md) - Live vs snapshot for seed UX

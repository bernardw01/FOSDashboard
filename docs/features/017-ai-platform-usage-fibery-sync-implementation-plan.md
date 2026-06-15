# Implementation plan - AI platform usage sync to Fibery

> Companion to [017-ai-platform-usage-fibery-sync.md](017-ai-platform-usage-fibery-sync.md).
>
> **Status:** **In progress** - Phase B Anthropic ingest shipped in PRD **2.10.0**; **Phase G operator UI shipped in 2.14.0**; OpenAI ingest remains after G.
>
> **Last plan review:** 2026-06-15

## Current progress

| Area | Status | Notes |
| --- | --- | --- |
| **Product spec** | Done | Unified fact entity **`AI Usage Data/Usage`** documented in feature spec |
| **Phase 0 gap memo** | Done | [017-phase0-gap-memo.md](017-phase0-gap-memo.md) (2026-06-08) |
| **Redacted samples** | Done | [017-samples/](017-samples/) |
| **Fibery app shell** | Done | App **`AI Usage Data`** exists; API token can see it via MCP `list_databases` |
| **Fibery schema (A.2)** | **Done** | [017-fibery-schema-api.md](017-fibery-schema-api.md); Usage, Actor Mapping, Sync Runs validated |
| **Clockify join target** | Verified | **`Agreement Management/Clockify Users`** (MCP, 2026-05-28) |
| **Local MCP discovery** | Configured | `.cursor/mcp.json` + `.env` (see `.env.example`) |
| **Anthropic API samples** | Done | MCP pull 2026-06-08; see gap memo |
| **OpenAI API samples** | **Blocked** | No `OPENAI_ADMIN_KEY` in `.env` yet |
| **Editor diagnostics** | Done | `src/aiUsageDiagnostics.js` |
| **Admin settings catalog** | Done | `ai-usage-sync` group in `adminSettingsRegistry.js` |
| **Script Properties (prod)** | **Manual** | Set in Apps Script or ADMIN Settings; run `_diag_aiUsageScriptPropertyCheck_()` |
| **`src/` sync modules** | **Anthropic done** | `aiUsageSyncJob.js`, `aiUsageAnthropicClient.js`, `aiUsageNormalize.js`, `aiUsageUserMatch.js`, `aiUsageFiberyWriter.js`; OpenAI client pending |

### Fibery gap (validated 2026-06-08)

MCP `describe_database('AI Usage Data/Database 1')` shows Fibery defaults only:

- `AI Usage Data/Name`, `AI Usage Data/Description`
- No usage fields, enums, or cross-app relations

**Phase A.2 action:** Create **`Usage`**, **`Actor Mapping`**, and **`Sync Runs`** per the [unified data model](017-ai-platform-usage-fibery-sync.md#unified-data-model-ai-usage-datausage). Retire or repurpose **`Database 1`** (rename to **`Usage`** if Fibery allows, or archive after migrating any test rows).

---

## Summary

| Item | Choice |
| --- | --- |
| **Product spec** | [017-ai-platform-usage-fibery-sync.md](017-ai-platform-usage-fibery-sync.md) |
| **Runtime** | **FOS Dashboard** clasp project (`src/`) - not a separate Apps Script app |
| **Fibery storage** | App **`AI Usage Data`** (created). **Single fact entity:** **`AI Usage Data/Usage`**. Supporting: **`Actor Mapping`**, **`Sync Runs`**. |
| **Cross-app links** | **`Agreement Management/Clockify Users`** (read for matching); relation + denormalized **`Clockify User Email`** / **`Clockify User ID`** on every **`Usage`** row |
| **Vendor sources** | Anthropic Admin API (Console + claude.ai via same org + same key), OpenAI Admin API |
| **Schedule** | Daily time-driven trigger + on-demand (`runAiUsageSyncOnDemand`) |
| **Discovery** | Phase 0 MCP/API samples **before** `src/` production modules; local MCP for Cursor, Script Properties + `UrlFetchApp` for production |
| **PRD lift** | Reserve **FR-111** + **AC-68** (+ extend per release); first **code** release likely **MINOR → 2.11.0** when Anthropic ingest ships (schema-only merge can be **2.9.0**) |

---

## Fibery workspace: `AI Usage Data`

### Why a separate app

- Keeps AI cost telemetry out of **Agreement Management** operational tables.
- Allows finance/ops to permission the usage app independently later.
- Sync job still runs in FOS Dashboard with the same `FIBERY_HOST` + `FIBERY_API_TOKEN`.

### Entity layout (canonical)

| Database | Purpose |
| --- | --- |
| **`AI Usage Data/Usage`** | **Only fact table** - all platform usage and cost rows |
| **`AI Usage Data/Actor Mapping`** | Lookup: API keys / projects → Clockify User |
| **`AI Usage Data/Sync Runs`** | Append-only job log (optional mirror of Sheet tab) |

Enums live **inline on `Usage`** (Source Platform, Source Dataset, Mapping Status, Allocation Category, etc.). Do not create separate Fibery enum entity types unless Fibery admin requires it.

**Field catalog:** Do not duplicate here. Implement from [Unified data model: `AI Usage Data/Usage`](017-ai-platform-usage-fibery-sync.md#unified-data-model-ai-usage-datausage) (identity, measures, matching, allocation, audit sections).

### Cross-app relation to Clockify Users

1. Relation **`Clockify User`** on **`Usage`** → **`Agreement Management/Clockify Users`** (configure in Fibery schema UI).
2. Text **`Clockify User Email`** and **`Clockify User ID`** on **`Usage`** (denormalized after match step).
3. **`Actor Mapping`** should also relate to **`Clockify Users`** plus denormalized email text.

Sync code reads **`Agreement Management/Clockify Users`** via `fiberyClient.js`; writes **`AI Usage Data/*`** only.

---

## Local discovery environment (Cursor)

Production sync does **not** use MCP. MCP is for Phase 0 sampling and schema smoke tests only.

| Platform | MCP server | Config | Env var in `.env` |
| --- | --- | --- | --- |
| Fibery | `fibery` (global `~/.cursor/mcp.json`) | Existing harpin token | (in global config) |
| Anthropic Admin | `anthropic-admin` | [`.cursor/mcp.json`](../../.cursor/mcp.json), `--read-only` | `ANTHROPIC_ADMIN_KEY` |
| OpenAI Admin | `openai-usage` | [`.cursor/mcp.json`](../../.cursor/mcp.json); install via `uv tool install "openai-usage-mcp @ git+https://github.com/dlaporte/openai-usage-mcp.git"` | `OPENAI_ADMIN_KEY` |
| claude.ai | *(none)* | Same as Anthropic: `get_claude_code_usage`; filter `customer_type=subscription` | Same `ANTHROPIC_ADMIN_KEY` |

**Important:** `${env:VAR_NAME}` in MCP JSON must reference a **variable name**, not the secret value. Prefer `"envFile": "${workspaceFolder}/.env"` for project servers.

**MCP tools for Phase 0 sampling:**

| Goal | Tool |
| --- | --- |
| Org smoke test | `get_org_info` |
| Console token usage | `get_usage_report` |
| Console USD cost | `get_cost_report` |
| Claude Code (Console + claude.ai) | `get_claude_code_usage` |
| OpenAI spend | `costs`, `usage` |
| Fibery schema verify | `describe_database`, `create_entity` |

---

## Script Properties (production)

| Property | Default | Purpose |
| --- | --- | --- |
| `FIBERY_HOST` | (existing) | Workspace host |
| `FIBERY_API_TOKEN` | (existing) | Must read **`Agreement Management`** and write **`AI Usage Data`** |
| `FIBERY_AI_USAGE_APP` | `AI Usage Data` | Database path prefix |
| `ANTHROPIC_ADMIN_API_KEY` | - | Admin API (`sk-ant-admin-...`); covers Console **and** claude.ai |
| `OPENAI_ADMIN_API_KEY` | - | Admin API with usage read (`sk-admin-...`) |
| `ANTHROPIC_ORG_ID` | optional | From `/v1/organizations/me` if needed |
| `OPENAI_ORG_ID` | optional | Organization scope |
| `AI_USAGE_SYNC_TIMEZONE` | `America/Chicago` | Usage date boundaries |
| `AI_USAGE_DAILY_LOOKBACK_DAYS` | `3` | Daily job re-pull window |
| `AI_USAGE_MAX_BACKFILL_DAYS` | `90` | On-demand guard |
| `AI_USAGE_LOG_SHEET_NAME` | `AI Usage Sync Runs` | Auth spreadsheet tab |
| `AI_USAGE_SYNC_ENABLED` | `true` | Kill switch |
| `AI_USAGE_INITIAL_LOOKBACK_DAYS` | `7` | Cold-start window when no log row and no Fibery usage dates (Phase G) |
| `AI_USAGE_CONTINUATION_*` | (mirror snapshot job) | Resume after timeout |

No separate `CLAUDE_AI_*` properties: claude.ai rows use the same Anthropic Admin key and endpoints.

---

## Recommended release strategy

| Release | Phases | Outcome | Suggested PRD bump |
| --- | --- | --- | --- |
| **R0 - Discovery** | 0 | Live samples or gap memo; Phase 0 sign-off | Docs only |
| **R1 - Fibery schema** | A.2 | **`Usage`** + supporting types; MCP smoke `create_entity` | **2.9.0** MINOR (schema + ops docs) |
| **R2 - Anthropic ingest** | B + C + basic E | `messages`, `cost_report`, `claude_code` (API + subscription); email match on ingest; daily job | **2.11.0** MINOR |
| **R3 - OpenAI ingest** | D | `/organization/costs` (+ usage complements); same **`Usage`** upsert path | **2.11.0** MINOR |
| **R4 - Matching hardening** | E (remainder) | Actor Mapping UI workflow; match stats; shared-key handling | **2.11.1** PATCH |
| **R5 - Allocation v1** | F | Default categories on rows | **2.15.0** MINOR |
| **R6 - Operator UI** | G | ADMIN Settings: incremental **Run sync**, last-run status | **2.14.0** MINOR |

**Rationale for merging B + C + basic E:** All three use `aiUsageAnthropicClient.js`, write the same **`Usage`** entity, and share idempotency keys. claude.ai is a **`Source Platform`** discriminator on `claude_code` rows, not a separate integration. Email matching on ingest should ship with first ingest so rows are usable immediately.

Adjust version numbers at kickoff; one PRD bump per merge-worthy release.

---

## Architecture (FOS Dashboard modules)

```text
src/aiUsageDiagnostics.js          Phase 0 editor probes (_diag_sampleAiUsage*)
src/aiUsageSyncJob.js           Triggers, orchestration, LockService, Sheet log, incremental range, getAiUsageSyncStatus, runAiUsageSyncIncremental
src/aiUsageAnthropicClient.js     Admin API: messages, cost_report, claude_code
src/aiUsageOpenAiClient.js        Admin API: organization/costs (+ usage complements)
src/aiUsageNormalize.js           Vendor row → normalized Usage fact + Source Record Id
src/aiUsageUserMatch.js           Clockify Users query + Actor Mapping; sets relation + Mapping Status
src/aiUsageFiberyWriter.js        Upsert AI Usage Data/Usage only (by Source Record Id)
src/fiberyClient.js               Extend if needed: upsert helper
src/adminSettingsRegistry.js      AI_USAGE_* + FIBERY_AI_USAGE_APP + AI_USAGE_INITIAL_LOOKBACK_DAYS (Phase G)
src/adminSettingsApi.js         getAiUsageSyncStatus / runAiUsageSyncIncremental client surface (or re-export from aiUsageSyncJob)
src/DashboardShell.html         Settings ai-usage-sync operator card
src/Code.js                       installDailyAiUsageSyncTrigger(), editor exports
src/userActivityLog.js            ai_usage_sync_* whitelist (Phase G)
```

**Reuse:** `fiberyClient.js`, `dashboardSnapshotJob.js` (lock, continuation, run log), `authUsersSheet.js` / `requireAuthForApi_()`.

**Normalize contract:** Output shape in feature spec [Normalized row shape](017-ai-platform-usage-fibery-sync.md#normalized-row-shape-sync-code-contract).

---

## Phase 0 - Discovery (R0)

**Gate:** No `src/` production modules until Phase 0 exit criteria are checked off. Fibery **schema** work (Phase A.2) may proceed in parallel once the unified field catalog is approved (it is documented in the feature spec).

### Tasks

| Step | Task | Owner / tool | Status |
| --- | --- | --- | --- |
| 0.1 | Store Admin keys: local `.env` for MCP (done); **Script Properties** before first deployed sync | Admin | Partial |
| 0.2 | Editor diagnostics: `_diag_sampleAiUsageAnthropic_(date)`, `_diag_sampleAiUsageOpenAi_(date)` | Dev | **Done** (`src/aiUsageDiagnostics.js`) |
| 0.3 | Pull 7-day samples: Anthropic `messages`, `cost_report`, `claude_code`; OpenAI `organization/costs` | MCP or `_diag_*` | Anthropic **done**; OpenAI **blocked** |
| 0.4 | Fibery MCP: `describe_database('Agreement Management/Clockify Users')` | Agent | **Done** (2026-05-28) |
| 0.5 | claude.ai spike: `get_claude_code_usage` where `customer_type=subscription` | MCP | **Done** - zero subscription rows in 7d (gap memo) |
| 0.6 | Unified **`Usage`** field catalog | Product + Dev | **Done** (feature spec) |
| 0.7 | Idempotency keys per dataset | Dev | **Done** (feature spec) |
| 0.8 | Gap memo | Dev | **Done** ([017-phase0-gap-memo.md](017-phase0-gap-memo.md)) |
| 0.9 | MCP discovery setup in FOSDashboard | Dev | **Done** |

### Phase 0 exit criteria

- [x] Sample JSON under [017-samples/](017-samples/) + [gap memo](017-phase0-gap-memo.md)
- [x] claude.ai subscription spike documented (zero rows in sample window)
- [x] Signed field catalog for **`AI Usage Data/Usage`** (+ supporting types)
- [ ] OpenAI live sample (add `OPENAI_ADMIN_KEY`)
- [ ] Product sign-off on gap memo
- [ ] Script Properties populated for Anthropic + OpenAI Admin keys (production)

---

## Phase A - Fibery schema (R1)

**Prerequisite for `src/` writes:** Phase A.2 smoke test passes. **Prerequisite for schema design:** unified model in feature spec (done).

### A.1 App provisioning

| Step | Action | Status |
| --- | --- | --- |
| A.1.1 | Create app **`AI Usage Data`** | **Done** |
| A.1.2 | Grant FOS token user create + update on all types in this app | Verify manually |
| A.1.3 | MCP `list_databases` shows `AI Usage Data/*` | **Done** |

### A.2 Create entities and fields

| Step | Task |
| --- | --- |
| A.2.0 | Decide fate of **`Database 1`**: rename to **`Usage`** and add fields, or create new types and archive **`Database 1`** |
| A.2.1 | Create **`AI Usage Data/Usage`** with all fields from [field catalog](017-ai-platform-usage-fibery-sync.md#field-catalog); set **`Source Record Id`** unique |
| A.2.2 | Create **`AI Usage Data/Actor Mapping`** and **`AI Usage Data/Sync Runs`** (supporting tables in feature spec) |
| A.2.3 | Add cross-app relation **`Clockify User`** on **`Usage`** (and **`Actor Mapping`**) |
| A.2.4 | Fibery MCP `describe_database('AI Usage Data/Usage')` - capture canonical API field names into a short schema appendix (optional `docs/features/017-fibery-schema.md`) |
| A.2.5 | MCP smoke: `create_entity` on **`Usage`** with `Source Record Id = test:smoke:001`; delete manually |
| A.2.6 | Add **`FIBERY_AI_USAGE_APP`** to `adminSettingsRegistry.js` when R1 code/doc merge ships |

### Docs / PRD (Phase A merge)

- Add **FR-111**, **AC-68** to `docs/FOS-Dashboard-PRD.md`
- Bump **`FOS_PRD_VERSION`** to **2.9.0** when R1 merges
- Update [000-overview.md](000-overview.md) Fibery state line

### Phase A test plan

| # | Steps | Expected |
| --- | --- | --- |
| T-A1 | `list_databases` | `AI Usage Data/Usage` present; **`Actor Mapping`**, **`Sync Runs`** optional for Phase B start |
| T-A2 | `describe_database` | **Pass** - see [017-fibery-schema-api.md](017-fibery-schema-api.md) |
| T-A3 | Cross-app relation | **Pass** - smoke row linked to Jordan Meyer / Clockify User |
| T-A4 | API create/update | **Pass** - `create_entity` + `update_entity` on **`Usage`** |

---

## Phase B - Anthropic ingest (R2, includes old Phase C)

**Prerequisite:** Phase 0 signed off + Phase A.2 smoke test passed.

| Step | Task | Notes |
| --- | --- | --- |
| B.1 | `aiUsageAnthropicClient.js`: paginated fetch for `messages`, `cost_report`, `claude_code` | One client; `UrlFetchApp`; Admin key header |
| B.2 | `aiUsageNormalize.js`: map all Anthropic paths → **`Usage`** facts; flatten `model_breakdown[]` | Set Source Platform from `customer_type` on claude_code rows |
| B.3 | `aiUsageFiberyWriter.js`: upsert by **`Source Record Id`** | Writes **`Usage`** only |
| B.4 | `aiUsageUserMatch.js` (basic): email → **`Clockify User Email`** on ingest | Actor Mapping lookup in R4 |
| B.5 | `aiUsageSyncJob.js`: `runAiUsageSyncForRange_(start, end, trigger)` | Anthropic platforms first |
| B.6 | Sheet log tab **`AI Usage Sync Runs`** + optional Fibery **`Sync Runs`** row | Mirror `dashboardSnapshotJob.js` |
| B.7 | `installDailyAiUsageSyncTrigger()` (default hour **3**, after snapshot job) | |
| B.8 | `_diag_runAiUsageSyncForDate('YYYY-MM-DD')` | Editor smoke |
| B.9 | Manual CSV spot-check vs claude.ai analytics (optional reconciliation) | Only if 0.5 finds API gaps |

### Phase B test plan

| # | Expected |
| --- | --- |
| T-B1 | One-day manual sync creates **`Usage`** rows; re-run does not duplicate |
| T-B2 | `claude_code` subscription rows have Source Platform = **Claude.ai** |
| T-B3 | Missing Anthropic key → fail fast before Fibery writes |
| T-B4 | Daily trigger fires; Sheet log row appended |

---

## Phase D - OpenAI ingest (R3)

**Prerequisite:** Phase B stable (or parallel after shared normalize/writer exist).

| Step | Task |
| --- | --- |
| D.1 | `aiUsageOpenAiClient.js`: `GET /organization/costs` with `group_by=user_id,project_id,line_item` |
| D.2 | Extend `aiUsageNormalize.js`: OpenAI paths → **`Usage`**; Source Platform = **OpenAI** |
| D.3 | Wire into `aiUsageSyncJob.js` (same range runner, next platform in sequence) |
| D.4 | Optional: Admin usage endpoints for token columns when cost rows lack them |

---

## Phase E - Matching hardening (R4)

| Step | Task |
| --- | --- |
| E.1 | Load **`Actor Mapping`** at sync start; apply before email match |
| E.2 | Shared API keys → **`Mapping Status = Shared key`** |
| E.3 | Run summary: `% matched`, top unmatched actors, warnings in Sheet + **`Sync Runs`** |

*(Basic email match ships in Phase B.4.)*

---

## Phase F - Allocation rules v1 (R5)

| Step | Task |
| --- | --- |
| F.1 | Default **`Allocation Category = Shared / unallocated`** on every new row |
| F.2 | Optional rules: Actor Mapping default category; internal email domain → Product development (later config) |
| F.3 | No silent customer/agreement assignment in v1 |

---

## Phase G - Operator UI (R6, v2.14.0)

**Prerequisite:** Phase B stable in production; `AI Usage Sync Runs` tab receiving daily rows.

**Product spec:** [Admin Settings - AI usage sync operator panel](017-ai-platform-usage-fibery-sync.md#admin-settings---ai-usage-sync-operator-panel-phase-g)

| Step | Task | Notes |
| --- | --- | --- |
| G.1 | `aiUsageSyncJob.js`: `resolveAiUsageIncrementalRange_()` | Log high-water + Fibery max **`Usage Date`** + `AI_USAGE_DAILY_LOOKBACK_DAYS` overlap; cold start via **`AI_USAGE_INITIAL_LOOKBACK_DAYS`** |
| G.2 | `aiUsageSyncJob.js`: `getAiUsageSyncStatus()` | ADMIN-only; read last Sheet log row; expose `syncEnabled`, `anthropicKeyConfigured` |
| G.3 | `aiUsageSyncJob.js`: `runAiUsageSyncIncremental()` | ADMIN-only; `requireAdminRole_`; calls resolver then `runAiUsageSyncForRange_(…, 'manual')` |
| G.4 | `aiUsageFiberyWriter.js` or small helper: `aiUsageQueryMaxUsageDate_()` | Single Fibery query: max **`Usage Date`** on **`AI Usage Data/Usage`** (fallback for cold start) |
| G.5 | `adminSettingsApi.js`: expose G.2/G.3 to client with admin gate | Mirror `getAdminSettings` / `saveAdminSettings` auth |
| G.6 | `DashboardShell.html`: operator card in `ai-usage-sync` group | Last sync summary + **Run sync now** + inline result; load on Settings open or group expand |
| G.7 | `adminSettingsRegistry.js`: register **`AI_USAGE_INITIAL_LOOKBACK_DAYS`** | Default 7; tooltip documents cold-start behavior |
| G.8 | `userActivityLog.js`: whitelist `ai_usage_sync_start`, `ai_usage_sync_done`, `ai_usage_sync_error` | Route `settings` |
| G.9 | Optional: point `runDailyAiUsageSync_()` at incremental resolver | Keeps scheduled + manual windows aligned |

### Phase G test plan

| # | Expected |
| --- | --- |
| T-G1 | ADMIN sees last sync row after a successful `runAiUsageSyncForRange_` |
| T-G2 | Second **Run sync now** within same day with no new vendor data returns "Already up to date" or only overlap days |
| T-G3 | Non-admin cannot call `runAiUsageSyncIncremental` (FORBIDDEN) |
| T-G4 | Missing Anthropic key: button disabled in UI; server fails fast if invoked |
| T-G5 | Concurrent run: second caller gets lock message |
| T-G6 | Activity log receives `ai_usage_sync_*` events on manual run |

### Docs / PRD (Phase G merge)

- Add **FR-117**, **AC-75** to `docs/FOS-Dashboard-PRD.md`
- Bump **`FOS_PRD_VERSION`** to **2.14.0** (MINOR)
- Update [000-overview.md](000-overview.md) shipped line
- Extend [011-admin-settings-environment-panel.md](011-admin-settings-environment-panel.md) operator subsection cross-ref

---

## Fibery write contract

Upsert target: **`AI Usage Data/Usage`** only.

1. Query by **`Source Record Id`** (limit 1).
2. If found → `fibery.entity/update` with changed fields only.
3. If not found → `fibery.entity/create`.
4. Batch where supported; chunk to stay under Apps Script time limits.
5. Regenerate **`Name`** title on each upsert.

Investigate during B.3 whether Fibery supports unique-field upsert in this workspace; fall back to query-then-create.

**Row grain reminders:**

| Source Dataset | One row |
| --- | --- |
| Anthropic Messages | One `results[]` entry per bucket |
| Anthropic Cost | One cost line per bucket |
| Anthropic Claude Code | One actor + day + model (`model_breakdown[]` flattened) |
| OpenAI Costs | One cost result for bucket `group_by` dimensions |

---

## Decisions log

| # | Question | Decision | Date |
| --- | --- | --- | --- |
| 1 | Separate Space vs App? | **App** inside harpin workspace | 2026-05 |
| 2 | Sync Runs: Fibery, Sheet, or both? | **Both** | 2026-05 |
| 3 | Claude Code flatten strategy? | **One row per model** per actor per day | 2026-06 |
| 4 | Single vs multiple usage entities? | **Single `Usage` fact table** for all platforms | 2026-06 |
| 5 | claude.ai separate MCP/integration? | **No** - same Anthropic Admin API + `claude_code` endpoint | 2026-06 |
| 6 | OpenAI `user_id` → email? | Actor Mapping when opaque; leave Actor Email blank | 2026-05 |
| 7 | Continuation triggers? | **`AI_USAGE_CONTINUATION_*`** mirroring snapshot job | 2026-05 |
| 8 | Fibery app created before Phase 0 complete? | **Yes** - shell exists; schema waits on unified model (now ready) | 2026-06 |
| 9 | Anthropic person matching in v1? | **Actor Mapping** for `api_key_id`; email match when vendor exposes email | 2026-06 |

---

## Immediate next actions (ordered)

1. **Phase G (v2.14.0)** - Implement operator panel + incremental sync per table above (inbox: Anthropic usage ingestion completion).
2. **OpenAI sample** - Add `OPENAI_ADMIN_KEY` when available; Phase D after G ships.
3. **Phase F** - Allocation defaults after operator UI is stable.

**Do not deploy OpenAI ingest in the same release as Phase G unless explicitly scoped; ship G as its own MINOR.**

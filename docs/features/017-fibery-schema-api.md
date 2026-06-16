# Fibery schema API reference - AI Usage Data/Usage

> **PRD version 2.15.9** - sync with `docs/FOS-Dashboard-PRD.md` when this file changes.

> Captured via Fibery MCP `describe_database` after operator setup. Use these **exact** field paths in `aiUsageFiberyWriter.js`.

**Database:** `AI Usage Data/Usage`  
**Validated:** 2026-06-15 (Fibery MCP `describe_database`; supersedes 2026-06-08 smoke test)

## Field paths (writer contract)

| Logical field | Fibery API path | Type |
| --- | --- | --- |
| Name (title) | `AI Usage Data/Name` | text |
| Source Record Id | `AI Usage Data/Source Record Id` | text (unique in UI) |
| Usage Date | `AI Usage Data/Usage Date` | date |
| Period Start | `AI Usage Data/Period Start` | date-time |
| Period End | `AI Usage Data/Period End` | date-time |
| Source Platform | `AI Usage Data/Source Platform` | enum |
| Source Dataset | `AI Usage Data/Source Dataset` | enum |
| Org External Id | `AI Usage Data/Org External Id` | text |
| Actor Type | `AI Usage Data/Actor Type` | enum |
| Actor Email | `AI Usage Data/Actor Email` | text |
| Actor External Id | `AI Usage Data/Actor External Id` | text |
| Actor Label | `AI Usage Data/Actor Label` | text |
| Customer Type | `AI Usage Data/Customer Type` | enum |
| Subscription Tier | `AI Usage Data/Subscription Tier` | enum |
| Model | `AI Usage Data/Model` | text |
| Workspace or Project | `AI Usage Data/Workspace or Project` | text |
| Service Tier | `AI Usage Data/Service Tier` | text |
| Line Item | `AI Usage Data/Line Item` | text |
| Cost Type | `AI Usage Data/Cost Type` | text |
| Token Type | `AI Usage Data/Token Type` | text |
| Context Description | `AI Usage Data/Context Description` | text |
| Terminal Type | `AI Usage Data/Terminal Type` | text |
| Input Tokens | `AI Usage Data/Input Tokens` | int |
| Output Tokens | `AI Usage Data/Output Tokens` | int |
| Cache Read Tokens | `AI Usage Data/Cache Read Tokens` | int |
| Cache Write Tokens | `AI Usage Data/Cache Write Tokens` | int |
| Request Count | `AI Usage Data/Request Count` | int |
| Quantity | `AI Usage Data/Quantity` | int |
| Cost USD | `AI Usage Data/Cost USD` | decimal |
| Currency | `AI Usage Data/Currency` | text |
| Actor Mapping | `AI Usage Data/Actor Mapping` | relation → `AI Usage Data/Actor Mapping` |
| Actor Mapping Clockify User | `AI Usage Data/Actor Mapping Clockify User` | relation → `Agreement Management/Clockify Users` |
| Mapping Status | `AI Usage Data/Mapping Status` | enum |
| Allocation Category | `AI Usage Data/Allocation Category` | enum |
| Sync Run Id | `AI Usage Data/Sync Run Id` | text |
| Ingested At | `AI Usage Data/Ingested At` | date-time |
| Raw Metrics JSON | `AI Usage Data/Raw Metrics JSON` | document |
| Vendor Payload JSON | `AI Usage Data/Vendor Payload JSON` | document |

**Retired on Usage (do not query or write):** `AI Usage Data/Clockify User`, `AI Usage Data/Clockify User Email`, `AI Usage Data/Clockify User ID`. The live workspace links Clockify Users via **`Actor Mapping Clockify User`** only.

**Note:** Fibery also has `AI Usage Data/Description` as a **document** field (default). Use **`Context Description`** for short Anthropic cost line text, or store long text in Vendor Payload JSON.

## Enum values (must match exactly)

### Source Platform
`Anthropic Console`, `Claude.ai`, `OpenAI`

### Source Dataset
`Anthropic Messages`, `Anthropic Cost`, `Anthropic Claude Code`, `OpenAI Costs`, `OpenAI Completions Usage`, `OpenAI Embeddings Usage`, `OpenAI Images Usage`, `OpenAI Audio Usage`, `OpenAI Moderations Usage`, `OpenAI Vector Stores Usage`, `OpenAI Code Interpreter Usage`

### Actor Type
`User`, `API key`, `Service account`, `Unknown`

### Customer Type
`N/A`, `API`, `Subscription`

### Subscription Tier
`N/A`, `Team`, `Enterprise`

### Mapping Status
`Matched`, `Unmatched`, `Service account`, `Shared key`

### Allocation Category
`Product development`, `Customer support`, `Internal ops`, `Shared / unallocated`

## Cross-app relation

- **Usage → Clockify User (live):** `AI Usage Data/Actor Mapping Clockify User` (set `{ "fibery/id": "<uuid>" }` on upsert; helper `aiUsageUsageClockifyUserField_()` in `aiUsageConstants.js`)
- **Usage → Actor Mapping:** `AI Usage Data/Actor Mapping` (optional; populated when mapping entity is linked)
- **Actor Mapping → Clockify User:** `AI Usage Data/Clockify User` (on **`AI Usage Data/Actor Mapping`** database only)

### Clockify Users (dashboard classification)

Feature **023** (as of **v2.15.8**) reads **`AI Usage Data/Claude API Costs`**. Classification still uses nested fields on **`AI Usage Data/Actor Mapping Clockify User`**; **Roles** filter uses **`User Role`** on the cost row.

| Field | API path (from Claude API Costs query) | Use |
| --- | --- | --- |
| Name | `['AI Usage Data/Actor Mapping Clockify User', 'Agreement Management/Name']` | Chart labels |
| AI Usage Tracker | `['AI Usage Data/Actor Mapping Clockify User', 'Agreement Management/AI Usage Tracker']` | **`true`** = product/program chart |
| User Role | `['AI Usage Data/User Role', 'Agreement Management/Name']` | **Roles** filter (preferred on cost rows) |
| User Department | `['AI Usage Data/User Department', 'enum/name']` | Optional slice / reporting |
| User Company | `['AI Usage Data/User Company', 'enum/name']` | Optional slice / reporting |
| Clockify User Email | `['AI Usage Data/Actor Mapping Clockify User', 'Agreement Management/Clockify User Email']` | Person filter fallback |

Blank **`Actor Mapping Clockify User`** on a cost row → **Unmatched** bucket.

**Legacy Usage query** (feature **017** sync only): nested **`Team Member Role`** on Clockify User was used before **v2.15.8**; dashboard no longer queries **`Usage`** for spend.

## Gaps vs plan

| Planned entity | Status |
| --- | --- |
| `AI Usage Data/Usage` | **Created** - smoke test passed |
| `AI Usage Data/Actor Mapping` | **Created** (2026-06-08) - populate rows with `External Actor Id` = Anthropic `api_key_id` |
| `AI Usage Data/Sync Runs` | **Created** (2026-06-08) - written by sync job after each run |
| `AI Usage Data/Database 1` | Retired (not in `list_databases`) |
| `AI Usage Data/Claude API Costs` | **Created** (2025-12+) - Anthropic `cost_report` ingest; dashboard read path **v2.15.8** |

---

## Claude API Costs field paths (dashboard read contract)

**Database:** `AI Usage Data/Claude API Costs`  
**Validated:** 2026-06-09 (Fibery MCP `describe_database`; operator schema adds **`User Company`**, **`User Department`**, **`User Role`**)

| Logical field | Fibery API path | Type |
| --- | --- | --- |
| Name (title) | `AI Usage Data/Name` | text (`YYYY-MM-DD - {api-key}`) |
| Usage date | `AI Usage Data/usagedateutc` | date |
| Cost USD | `AI Usage Data/costusd` | decimal |
| List price USD | `AI Usage Data/listpriceusd` | decimal |
| API key | `AI Usage Data/apikey` | enum |
| Model | `AI Usage Data/model` | enum |
| Token type | `AI Usage Data/tokentype` | enum |
| Cost type | `AI Usage Data/costtype` | enum (`token`, `web_search`) |
| Usage type | `AI Usage Data/usagetype` | enum (`message`, `batch`, …) |
| Workspace | `AI Usage Data/workspace` | enum |
| Context window | `AI Usage Data/contextwindow` | enum |
| Inference geo | `AI Usage Data/inferencegeo` | enum |
| Speed | `AI Usage Data/speed` | enum |
| Actor Mapping | `AI Usage Data/Actor Mapping` | relation |
| Actor Mapping Clockify User | `AI Usage Data/Actor Mapping Clockify User` | relation → Clockify Users |
| User Company | `AI Usage Data/User Company` | enum (from Clockify User company) |
| User Department | `AI Usage Data/User Department` | enum |
| User Role | `AI Usage Data/User Role` | relation → Team Member Roles |

**Grain:** one row per Anthropic cost line (date × api key × model × token type × …). No token counts on this table.

**Reader:** `src/aiUsageDashboard.js` (`aiUsageClaudeApiCostsDatabase_()` in `aiUsageConstants.js`).

**Not written by FOS sync (v2.15.8):** populated outside feature **017** `Usage` upsert path; feature **017** sync still writes **`Usage`** for messages / Claude Code / legacy cost merge.

---

## Actor Mapping field paths

**Database:** `AI Usage Data/Actor Mapping`

| Logical field | Fibery API path | Type |
| --- | --- | --- |
| Name | `AI Usage Data/Name` | text |
| Source Platform | `AI Usage Data/Source Platform` | enum (`Anthropic Console`, `Claude.ai`, `OpenAI`) |
| External Actor Id | `AI Usage Data/External Actor Id` | text |
| Actor Label | `AI Usage Data/Actor Label` | text |
| Clockify User | `AI Usage Data/Clockify User` | relation → `Agreement Management/Clockify Users` |
| Clockify User Email | `AI Usage Data/Clockify User Email` | text |
| Default Allocation Category | `AI Usage Data/Default Allocation Category` | enum (same values as Usage Allocation Category) |
| Notes | `AI Usage Data/Notes` | document |

**Lookup key in sync code:** `(Source Platform, External Actor Id)` → Clockify User.

---

## Sync Runs field paths

**Database:** `AI Usage Data/Sync Runs`

| Logical field | Fibery API path | Type |
| --- | --- | --- |
| Name | `AI Usage Data/Name` | text (sync run id) |
| Started At | `AI Usage Data/Started At` | date-time |
| Completed At | `AI Usage Data/Completed At` | date-time |
| Trigger | `AI Usage Data/Trigger` | enum: `scheduled`, `manual`, `backfill` |
| Status | `AI Usage Data/Status` | enum: `running`, `complete`, `partial`, `failed` |
| Range Start | `AI Usage Data/Range Start` | date |
| Range End | `AI Usage Data/Range End` | date |
| Rows Fetched | `AI Usage Data/Rows Fetched` | int |
| Rows Upserted | `AI Usage Data/Rows Upserted` | int |
| Rows Failed | `AI Usage Data/Rows Failed` | int |
| Warnings | `AI Usage Data/Warnings` | document |
| Error | `AI Usage Data/Error` | text |

# Fibery schema API reference - AI Usage Data/Usage

> Captured via Fibery MCP `describe_database` after operator setup. Use these **exact** field paths in `aiUsageFiberyWriter.js`.

**Database:** `AI Usage Data/Usage`  
**Validated:** 2026-06-08  
**Smoke test row:** [Usage/2](https://harpin-ai.fibery.io/AI_Usage_Data/Usage/2) (`test:smoke:001`) - delete manually when done.

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
| Clockify User | `AI Usage Data/Clockify User` | relation → `Agreement Management/Clockify Users` |
| Clockify User Email | `AI Usage Data/Clockify User Email` | text |
| Clockify User ID | `AI Usage Data/Clockify User ID` | text |
| Mapping Status | `AI Usage Data/Mapping Status` | enum |
| Allocation Category | `AI Usage Data/Allocation Category` | enum |
| Sync Run Id | `AI Usage Data/Sync Run Id` | text |
| Ingested At | `AI Usage Data/Ingested At` | date-time |
| Raw Metrics JSON | `AI Usage Data/Raw Metrics JSON` | document |
| Vendor Payload JSON | `AI Usage Data/Vendor Payload JSON` | document |

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

- **Usage → Clockify User:** `AI Usage Data/Clockify User` (set `{ "fibery/id": "<uuid>" }`)
- **Inverse on Clockify Users:** `Agreement Management/Usage Records` (auto-maintained)

## Gaps vs plan

| Planned entity | Status |
| --- | --- |
| `AI Usage Data/Usage` | **Created** - smoke test passed |
| `AI Usage Data/Actor Mapping` | **Created** (2026-06-08) - populate rows with `External Actor Id` = Anthropic `api_key_id` |
| `AI Usage Data/Sync Runs` | **Created** (2026-06-08) - written by sync job after each run |
| `AI Usage Data/Database 1` | Retired (not in `list_databases`) |

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

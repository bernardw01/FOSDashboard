# Fibery schema setup - AI Usage Data (Phase A.2)

> Operator checklist for Fibery UI. MCP cannot create types or fields.  
> Field catalog: [017-ai-platform-usage-fibery-sync.md](017-ai-platform-usage-fibery-sync.md#field-catalog)

**Prerequisite:** Phase 0 gap memo reviewed ([017-phase0-gap-memo.md](017-phase0-gap-memo.md)).

---

## 1. Retire placeholder `Database 1`

The app currently has only **`AI Usage Data/Database 1`** (Name + Description).

| Option | When to use |
| --- | --- |
| **A. Rename** `Database 1` → **`Usage`** and add fields | Prefer if Fibery allows rename without breaking links |
| **B. Create new `Usage` type** and archive/delete `Database 1` | Prefer if rename is awkward or test data exists |

Do not ingest production sync rows into `Database 1` without the full field set.

---

## 2. Create `AI Usage Data/Usage`

Create entity **`Usage`** (if not renamed from Database 1). Add fields in this order (grouped for UI setup):

### Identity

| Field name | Type | Notes |
| --- | --- | --- |
| Source Record Id | Text | **Mark unique** if Fibery supports unique constraints |
| Usage Date | Date | |
| Period Start | Date/time | Optional |
| Period End | Date/time | Optional |

### Source

| Field name | Type | Enum values |
| --- | --- | --- |
| Source Platform | Single-select enum | Anthropic Console, Claude.ai, OpenAI |
| Source Dataset | Single-select enum | Anthropic Messages, Anthropic Cost, Anthropic Claude Code, OpenAI Costs, OpenAI Completions Usage, OpenAI Embeddings Usage, OpenAI Images Usage, OpenAI Audio Usage, OpenAI Moderations Usage, OpenAI Vector Stores Usage, OpenAI Code Interpreter Usage |
| Org External Id | Text | Optional |

### Actor

| Field name | Type | Enum values |
| --- | --- | --- |
| Actor Type | Single-select enum | User, API key, Service account, Unknown |
| Actor Email | Text | |
| Actor External Id | Text | |
| Actor Label | Text | |
| Customer Type | Single-select enum | API, Subscription, N/A |
| Subscription Tier | Single-select enum | Team, Enterprise, N/A |

### Context

| Field name | Type |
| --- | --- |
| Model | Text |
| Workspace or Project | Text |
| Service Tier | Text |
| Line Item | Text |
| Cost Type | Text |
| Token Type | Text |
| Description | Text |
| Terminal Type | Text |

### Measures

| Field name | Type |
| --- | --- |
| Input Tokens | Number |
| Output Tokens | Number |
| Cache Read Tokens | Number |
| Cache Write Tokens | Number |
| Request Count | Number |
| Quantity | Number |
| Cost USD | Number (decimal) |
| Currency | Text (default USD in writer) |

### Clockify matching

| Field name | Type | Notes |
| --- | --- | --- |
| Clockify User | **Relation** | Cross-app → **`Agreement Management/Clockify Users`** |
| Clockify User Email | Text | Denormalized |
| Clockify User ID | Text | Denormalized |
| Mapping Status | Single-select enum | Matched, Unmatched, Shared key, Service account |

### Allocation

| Field name | Type | Enum values |
| --- | --- | --- |
| Allocation Category | Single-select enum | Product development, Customer support, Shared / unallocated, Internal ops |

### Audit

| Field name | Type |
| --- | --- |
| Sync Run Id | Text |
| Ingested At | Date/time |
| Raw Metrics JSON | Document or long text |
| Vendor Payload JSON | Document or long text |

**Title field:** Fibery `Name` (auto or formula). Writer will set: `{Usage Date} - {actor} - {Source Platform} - {Model}`.

---

## 3. Create `AI Usage Data/Actor Mapping`

| Field name | Type | Notes |
| --- | --- | --- |
| Source Platform | Single-select enum | Same as Usage Source Platform |
| External Actor Id | Text | `api_key_id`, OpenAI project id, etc. |
| Actor Label | Text | e.g. API key name from Admin API |
| Clockify User | Relation → Clockify Users | Cross-app |
| Clockify User Email | Text | Optional denormalized |
| Default Allocation Category | Single-select enum | Same as Usage Allocation Category |
| Notes | Document | |

Consider unique constraint on (`Source Platform`, `External Actor Id`) in Fibery if available.

---

## 4. Create `AI Usage Data/Sync Runs`

| Field name | Type | Enum / notes |
| --- | --- | --- |
| Started At | Date/time | |
| Completed At | Date/time | |
| Trigger | Single-select enum | scheduled, manual, backfill |
| Status | Single-select enum | running, complete, partial, failed |
| Range Start | Date | |
| Range End | Date | |
| Rows Fetched | Number | |
| Rows Upserted | Number | |
| Rows Failed | Number | |
| Warnings | Document | |
| Error | Text | |

---

## 5. Permissions

Ensure the FOS Dashboard service account (token behind `FIBERY_API_TOKEN`) can **create and update** all three types in **`AI Usage Data`**.

---

## 6. MCP verification (after UI setup)

Run in Cursor with Fibery MCP enabled:

1. `list_databases` - confirm `AI Usage Data/Usage`, `Actor Mapping`, `Sync Runs`.
2. `describe_database('AI Usage Data/Usage')` - compare API field names to this checklist.
3. `create_entity` smoke test:

```json
{
  "database": "AI Usage Data/Usage",
  "entity": {
    "AI Usage Data/Name": "2026-06-08 - smoke test",
    "AI Usage Data/Source Record Id": "test:smoke:001",
    "AI Usage Data/Usage Date": "2026-06-08",
    "AI Usage Data/Source Platform": "Anthropic Console",
    "AI Usage Data/Source Dataset": "Anthropic Messages",
    "AI Usage Data/Actor Type": "Unknown",
    "AI Usage Data/Mapping Status": "Unmatched",
    "AI Usage Data/Allocation Category": "Shared / unallocated"
  }
}
```

4. Delete or archive the smoke row in Fibery UI.
5. Link a test **`Usage`** row to a real **Clockify User** in UI (T-A3).

---

## 7. Unblock Phase B

Phase B (`src/` sync modules) **shipped in PRD 2.10.0**. Before first production run:

- [x] **`Usage`**, **`Actor Mapping`**, **`Sync Runs`** exist in Fibery
- [ ] **`ANTHROPIC_ADMIN_API_KEY`** in Script Properties (Admin Settings)
- [ ] **Actor Mapping rows** populated: `Source Platform` = `Anthropic Console`, `External Actor Id` = `api_key_id` from `_diag_aiUsageMatchContext()`, `Clockify User` relation set
- [ ] `clasp push`, then editor: `_diag_aiUsageMatchContext()` and `runAiUsageSyncOnDemand('YYYY-MM-DD','YYYY-MM-DD')`
- [ ] `installDailyAiUsageSyncTrigger()` when satisfied with on-demand results

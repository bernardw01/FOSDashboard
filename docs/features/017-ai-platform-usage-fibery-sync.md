# Feature: AI platform usage sync to Fibery

> **PRD version 2.11.0** - see `docs/FOS-Dashboard-PRD.md` (**FR-111**, **AC-68**).
>
> **Related:** [Clockify to Fibery sync](../PRD.md) (labor time system of record), [005 - Utilization Management Dashboard](005-utilization-management-dashboard.md) (reads `Labor Costs`), [009 - Dashboard historical snapshots](009-dashboard-historical-snapshots.md) (scheduled job pattern), [011 - Admin settings](011-admin-settings-environment-panel.md) (Script Property management).
>
> **Implementation plan:** [017-ai-platform-usage-fibery-sync-implementation-plan.md](017-ai-platform-usage-fibery-sync-implementation-plan.md) | **Phase 0:** [gap memo](017-phase0-gap-memo.md) | **Fibery setup:** [schema checklist](017-fibery-schema-setup.md)

## Executive summary

harpin uses **three AI surfaces** that incur measurable cost:

| # | Product surface | Typical billing | Primary users |
| --- | --- | --- | --- |
| 1 | **platform.claude.com** (Anthropic Console / API) | Pay-as-you-go API + Console Claude Code (API billing) | Engineers, automation, integrations |
| 2 | **claude.ai** (Claude for Teams / Enterprise) | Seat + usage on subscription plans | Staff using Claude chat and Claude Code via OAuth |
| 3 | **openai** (OpenAI Platform) | Organization API usage + projects | Engineers, tooling, customer-facing features |

Today those costs are visible only inside each vendor console. Finance and delivery leadership cannot reliably tie AI spend to **Clockify-identified people**, **customer accounts**, or **product-development vs customer-support** work.

This feature defines a **daily (scheduled) and on-demand** integration that:

1. Pulls usage and cost data from all three platforms via their **admin / usage APIs** (where available).
2. Normalizes rows into a **new Fibery app** **`AI Usage Data`** and links people to **`Agreement Management/Clockify Users`** (cross-app relation + denormalized email/id).
3. Preserves **idempotent upserts**, **run logging**, and **operator controls** consistent with the existing Clockify sync and FOS snapshot jobs.
4. Creates the foundation for later **cost allocation** rules (internal R&D, shared platform, customer-attributed support) and optional **FOS Dashboard** reporting.

**Status:** **In progress** - **Phase B (Anthropic ingest) shipped in v2.10.0** (`src/aiUsageSyncJob.js` et al.). OpenAI ingest, operator UI, and allocation rules remain planned.

**Architecture decision:** The sync pipeline lives as **modules inside the FOS Dashboard Apps Script project** (`src/`), alongside existing Fibery clients and scheduled jobs (`dashboardSnapshotJob.js`). It is **not** a separate clasp project.

**Fibery state:** **`AI Usage Data/Usage`**, **`Actor Mapping`**, and **`Sync Runs`** created (validated 2026-06-08). Cross-app link to **`Agreement Management/Clockify Users`** works. Populate **Actor Mapping** with `External Actor Id` = Anthropic `api_key_id` for Console attribution. API field paths: [017-fibery-schema-api.md](017-fibery-schema-api.md).

## Business goals

| Goal | Outcome |
| --- | --- |
| **Unified inventory** | One Fibery entity **`AI Usage Data/Usage`** holds all daily usage and cost facts from every platform. |
| **People alignment** | Every usage row resolves to a **Clockify User** (email / stable id) when possible. |
| **Cost visibility** | USD (or vendor-reported currency) stored per row and roll-up friendly by day / week / month. |
| **Allocation readiness** | Rows carry dimensions needed to split **product development** vs **active customer support** (see [Cost allocation](#cost-allocation-product-development-vs-customer-support)). |
| **Operational trust** | Admins can trigger a refresh, see last sync status, and diagnose API / mapping failures without reading Apps Script logs. |

## Non-goals (v1)

- Replacing vendor consoles for real-time debugging or rate-limit management.
- **Two-way sync** (writing config back to Anthropic / OpenAI).
- Automatic **invoice reconciliation** with QuickBooks or expense sheets (future integration).
- **FOS Dashboard read-only panels** for AI costs in v1 (Fibery ingest + sync only; dashboard UI is a follow-on).
- **Token-level attribution to individual Fibery Labor Cost rows** (v1 stores daily aggregates; row-level join is a later enhancement).
- Scraping **claude.ai** web dashboards or relying on undocumented browser session APIs.

## Phase 0 - Discovery (MCP + payload sampling)

Before creating Fibery fields or writing sync code, capture **real response shapes** from each platform and the **Clockify User** join targets in Fibery.

### Tools

| Platform | Discovery tool | Purpose |
| --- | --- | --- |
| **Fibery** | **Fibery MCP** (`list_databases`, `describe_database`, `create_entity`) | After **`AI Usage Data`** app exists: verify schema; smoke-test writes. Phase 0 uses MCP only on **`Agreement Management/Clockify Users`** |
| **platform.claude.com** | Anthropic Admin API (via MCP when configured, or `_diag_*` UrlFetchApp probes in Apps Script editor) | Sample `usage_report/messages`, `cost_report`, `usage_report/claude_code` |
| **claude.ai** | Same Anthropic Admin API where `customer_type=subscription`; Teams dashboard CSV as cross-check | Validate subscription / OAuth actor coverage |
| **openai** | OpenAI Admin API (via MCP when configured, or `_diag_*` probes) | Sample `GET /organization/costs` and complementary usage endpoints with `group_by=user_id` |

**Note:** Fibery MCP is available in the Cursor workspace today. Anthropic and OpenAI MCP servers should be enabled for planning so operators can pull live sample JSON without pasting secrets into chat. Production sync still uses Script Properties + `UrlFetchApp` (same endpoints).

### Fibery join target (verified)

**`Agreement Management/Clockify Users`** (existing):

| Fibery field | Type | Join use |
| --- | --- | --- |
| `Clockify User Email` | text | Primary match to vendor `email_address` / OpenAI-resolved user email |
| `Clockify User ID` | text | Secondary match when vendor exposes opaque user ids |
| `Name` | text | Display only; weak fallback match |
| `Labor Costs` | collection | Future allocation signal (where person logged time) |

### Deliverables from Phase 0

1. **Platform payload appendix** (below) validated against at least one live sample per endpoint.
2. **Unified data model** for app **`AI Usage Data`** (field list, enums, unique key, vendor mapping) ready for workspace creation.
3. **Idempotency key spec** per platform row type (documented before any `create_entity` calls).
4. **Gap memo** for claude.ai rows missing from Admin API (if any).

## Source platforms and API contract

### Platform 1 - platform.claude.com (Anthropic Console / API)

**Auth:** Admin API key (`sk-ant-admin-...`), org admin role. Stored in Script Properties (never exposed to browser clients).

**Base URL:** `https://api.anthropic.com`

| Dataset | Endpoint | Grain | Notes |
| --- | --- | --- | --- |
| API message usage (tokens) | `GET /v1/organizations/usage_report/messages` | Configurable bucket (`1d` default) | Group by `account_id`, `api_key_id`, `workspace_id`, `model`, etc. Cost may require separate cost report. |
| API cost (USD) | `GET /v1/organizations/cost_report` | Daily buckets | Preferred source for dollars when available. |
| Claude Code (Console/API billing) | `GET /v1/organizations/usage_report/claude_code` | Daily per actor | API-billed Claude Code users; includes productivity metrics (lines accepted, sessions). |

**Identity fields:** `account_id` (OAuth/console user when grouped), `api_key_id` (non-human keys must map to a service account or "Shared API key" bucket).

**Constraints:** Admin API unavailable on some AWS-hosted Claude deployments; max lookback ~13 months; paginate with `next_page`.

**Docs:** [Anthropic Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api), [Admin API](https://platform.claude.com/docs/en/manage-claude/admin-api).

### Platform 2 - claude.ai (Claude for Teams / Enterprise)

**Relationship to Platform 1:** Both surfaces roll up under the **same Anthropic organization** for many harpin accounts. The Admin API endpoint **`GET /v1/organizations/usage_report/claude_code`** returns rows for **`customer_type: subscription`** with **`subscription_type: team | enterprise`** (claude.ai seat plans), distinct from **`customer_type: api`** (Console PAYG).

**Auth:** Same **`ANTHROPIC_ADMIN_API_KEY`** as Platform 1 unless Anthropic issues separate org scopes.

**Primary endpoint:** `GET /v1/organizations/usage_report/claude_code?starting_at=YYYY-MM-DD` (one UTC day per request; paginate with `next_page`).

**Secondary:** Console chat usage may appear in **`usage_report/messages`** when grouped by **`account_id`** (OAuth console users).

**Fallback:** Teams analytics CSV export from `claude.ai/analytics/claude-code` for reconciliation only if API rows are incomplete.

**Open spike:** Confirm live harpin org returns subscription actors with email addresses matchable to **`Clockify User Email`**.

### Platform 3 - openai (OpenAI Platform)

**Auth:** **Admin API key** with `api.usage.read` (standard project API keys are insufficient).

**Base URL:** `https://api.openai.com/v1`

| Dataset | Endpoint | Grain | Notes |
| --- | --- | --- | --- |
| Organization costs | `GET /organization/costs` | `bucket_width=1d` (default) | USD amounts; optional `group_by` (`project_id`, `api_key_id`, `line_item`). |
| Token usage (complements) | Admin organization usage endpoints (embeddings, completions, etc.) | Minute / hour / day | Use when cost endpoint lacks dimension needed for attribution. |

**Identity fields:** `user_id` when grouping includes it; otherwise map `api_key_id` / `project_id` via harpin-maintained mapping table.

**Docs:** [OpenAI Admin APIs](https://developers.openai.com/api/docs/guides/admin-apis), [Usage API announcement](https://community.openai.com/t/introducing-the-usage-api-track-api-usage-and-costs-programmatically/1043058).

## Platform payload reference (design inputs for Fibery)

These structures map into the single fact entity **`AI Usage Data/Usage`**. See [Unified data model](#unified-data-model-ai-usage-datausage) for the canonical field list and vendor mapping matrix.

### Anthropic - `usage_report/messages` (Platform 1 API usage)

**Bucket:** `data[]` → `{ starting_at, ending_at, results[] }`

| Vendor field | Type | Maps to `Usage` field |
| --- | --- | --- |
| `starting_at` / `ending_at` | RFC3339 | Usage Date, Period Start, Period End |
| `account_id` | string \| null | Actor External Id (OAuth user) |
| `api_key_id` | string \| null | Actor External Id (API key path) |
| `workspace_id` | string \| null | Workspace or Project |
| `model` | string \| null | Model |
| `service_tier` | enum | Service Tier |
| `uncached_input_tokens` | number | Input Tokens (partial) |
| `cache_read_input_tokens` | number | Cache Read Tokens |
| `cache_creation.ephemeral_*` | number | Cache Write Tokens (sum) |
| `output_tokens` | number | Output Tokens |
| `server_tool_use.web_search_requests` | number | Raw Metrics JSON |
| `service_account_id` | string \| null | Actor External Id (service) |

**Suggested `group_by` for ingest:** `account_id`, `api_key_id`, `workspace_id`, `model` (balance cardinality vs attribution).

**Row settings:** Source Platform = `Anthropic Console`; Source Dataset = `Anthropic Messages`.

**Idempotency key (`Source Record Id`):** `anthropic:messages:{starting_at}:{account_id|api_key_id}:{workspace_id}:{model}:{service_tier}`

### Anthropic - `cost_report` (Platform 1 USD)

| Vendor field | Type | Maps to `Usage` field |
| --- | --- | --- |
| `amount` | decimal string (cents) | Cost USD |
| `currency` | string | Currency |
| `workspace_id` | string \| null | Workspace or Project |
| `model`, `cost_type`, `token_type`, `description` | strings | Model, Cost Type, Token Type, Description |
| `starting_at` / `ending_at` | RFC3339 | Usage Date, Period Start, Period End |

**Row settings:** Source Platform = `Anthropic Console`; Source Dataset = `Anthropic Cost`.

**Idempotency key (`Source Record Id`):** `anthropic:cost:{starting_at}:{workspace_id}:{description}:{token_type}:{model}`

### Anthropic - `usage_report/claude_code` (Platform 1 + 2)

Flatten **`model_breakdown[]`** to **one `Usage` row per actor per day per model** (not parent/child tables).

| Vendor field | Type | Maps to `Usage` field |
| --- | --- | --- |
| `date` | YYYY-MM-DD | Usage Date |
| `actor.email_address` | string | Actor Email |
| `actor.api_key_name` | string | Actor Label |
| `actor.type` | `user_actor` \| `api_actor` | Actor Type |
| `customer_type` | `api` \| `subscription` | Customer Type; drives Source Platform |
| `subscription_type` | `team` \| `enterprise` \| null | Subscription Tier |
| `organization_id` | string | Org External Id |
| `model_breakdown[].model` | string | Model |
| `model_breakdown[].tokens.*` | numbers | Input Tokens, Output Tokens, cache columns |
| `model_breakdown[].estimated_cost.amount` | number (minor units) | Cost USD |
| `core_metrics.*` | numbers | Raw Metrics JSON |
| `tool_actions` | map | Raw Metrics JSON |
| `terminal_type` | string | Terminal Type |

**Row settings:** Source Platform = `Claude.ai` when `customer_type=subscription`; `Anthropic Console` when `customer_type=api`. Source Dataset = `Anthropic Claude Code`.

**Idempotency key (`Source Record Id`, per model):** `anthropic:claude_code:{date}:{actor}:{model}`

### OpenAI - `GET /organization/costs` (Platform 3)

**Bucket:** `data[]` → `{ start_time, end_time, results[] }` (Unix timestamps)

| Vendor field | Type | Maps to `Usage` field |
| --- | --- | --- |
| `start_time` / `end_time` | unix | Usage Date, Period Start, Period End |
| `amount.value` | number | Cost USD |
| `amount.currency` | string | Currency |
| `user_id` | string \| null | Actor External Id |
| `api_key_id` | string \| null | Actor External Id |
| `project_id` | string \| null | Workspace or Project |
| `line_item` | string \| null | Line Item |
| `quantity` | number \| null | Quantity |

**Suggested `group_by`:** `user_id`, `project_id`, `line_item` (and optionally `api_key_id`).

**Complement:** Admin usage endpoints (`/organization/usage/completions`, etc.) when token counts are needed and not present on cost rows. Source Dataset = `OpenAI Completions Usage`, `OpenAI Embeddings Usage`, etc.

**Row settings:** Source Platform = `OpenAI`; Source Dataset = `OpenAI Costs` (or complement dataset name).

**Idempotency key (`Source Record Id`):** `openai:cost:{start_time}:{user_id|api_key_id}:{project_id}:{line_item}`

## Unified data model: `AI Usage Data/Usage`

All vendor usage and cost data lands in **one Fibery entity**. Supporting types (**Actor Mapping**, **Sync Runs**) are operational only; they do not store usage facts.

### Design principles

| Principle | Rule |
| --- | --- |
| **Single fact table** | Every ingest path writes **`AI Usage Data/Usage`** only. |
| **Stable identity** | **`Source Record Id`** is globally unique across platforms; upsert key for sync. |
| **Daily grain** | **`Usage Date`** is the reporting day (org timezone, default `America/Chicago`). Vendor buckets may be sub-daily; store **`Period Start`** / **`Period End`** when present. |
| **Flatten nested arrays** | Claude Code `model_breakdown[]` and similar structures become separate **`Usage`** rows, not child entities. |
| **Denormalize for reporting** | Store **`Clockify User Email`** and **`Clockify User ID`** on each row even when the cross-app relation is set. |
| **Vendor extras in JSON** | Productivity metrics, tool actions, and other sparse fields go in **`Raw Metrics JSON`**; full vendor row (truncated) in **`Vendor Payload JSON`**. |

### Entity relationship (conceptual)

```text
Agreement Management/Clockify Users
         ^
         |  Clockify User (relation, optional)
         |
AI Usage Data/Usage  <-----  all platform ingest (Anthropic Console, claude.ai, OpenAI)
         |
         +----- Sync Run Id (text correlation to job log)

AI Usage Data/Actor Mapping  ----->  Clockify Users (lookup for non-email actors)
AI Usage Data/Sync Runs      ----->  operational log (optional Fibery mirror of Sheet tab)
```

### Row grain

| Source Dataset | One `Usage` row represents |
| --- | --- |
| Anthropic Messages | One `results[]` entry in a daily (or configured) bucket |
| Anthropic Cost | One cost line in a daily bucket |
| Anthropic Claude Code | One actor + one calendar day + one model (from `model_breakdown[]`) |
| OpenAI Costs | One cost result for the bucket's `group_by` dimensions |
| OpenAI * Usage | One usage bucket result for the requested service type |

### Field catalog

Fibery field API paths use the prefix **`AI Usage Data/`** (for example `AI Usage Data/Usage Date`).

#### Identity and title

| Field | Fibery type | Required | Purpose |
| --- | --- | --- | --- |
| Name | text (title) | yes | `{Usage Date} - {Actor Email or Actor Label or Actor External Id} - {Source Platform} - {Model or Line Item}` |
| Source Record Id | text | yes | **Unique** idempotency key (see payload reference) |
| Usage Date | date | yes | Normalized calendar day for roll-ups |
| Period Start | date-time | no | Vendor bucket start (UTC stored; display in org TZ) |
| Period End | date-time | no | Vendor bucket end |

#### Source classification

| Field | Fibery type | Required | Purpose |
| --- | --- | --- | --- |
| Source Platform | enum | yes | Where the spend occurred (see enums) |
| Source Dataset | enum | yes | Which vendor API dataset produced the row |
| Org External Id | text | no | Anthropic `organization_id` or OpenAI org scope when present |

#### Actor

| Field | Fibery type | Required | Purpose |
| --- | --- | --- | --- |
| Actor Type | enum | yes | User, API key, Service account, Unknown |
| Actor Email | text | no | Primary match key to **`Clockify User Email`** |
| Actor External Id | text | no | `account_id`, `user_id`, `api_key_id`, etc. |
| Actor Label | text | no | Human-readable label (e.g. API key name) |
| Customer Type | enum | no | `API`, `Subscription`, or `N/A` (Anthropic Claude Code discriminator) |
| Subscription Tier | enum | no | `Team`, `Enterprise`, or `N/A` |

#### Work context

| Field | Fibery type | Required | Purpose |
| --- | --- | --- | --- |
| Model | text | no | Model id when vendor provides one |
| Workspace or Project | text | no | Anthropic workspace id/name or OpenAI project |
| Service Tier | text | no | Anthropic service tier when present |
| Line Item | text | no | OpenAI cost line item |
| Cost Type | text | no | Anthropic `cost_report` cost type |
| Token Type | text | no | Anthropic `cost_report` token type |
| Description | text | no | Anthropic cost description or free-text vendor label |
| Terminal Type | text | no | Claude Code terminal environment |

#### Measures

| Field | Fibery type | Required | Purpose |
| --- | --- | --- | --- |
| Input Tokens | number | no | Uncached + cached input where vendor splits are merged in normalize step |
| Output Tokens | number | no | |
| Cache Read Tokens | number | no | |
| Cache Write Tokens | number | no | Sum of ephemeral cache creation tokens |
| Request Count | number | no | When vendor exposes request counts |
| Quantity | number | no | OpenAI cost quantity |
| Cost USD | decimal | no | Vendor-reported cost in USD (convert minor units in normalize step) |
| Currency | text | no | Default `USD` |

#### Person matching (Clockify)

| Field | Fibery type | Required | Purpose |
| --- | --- | --- | --- |
| Clockify User | relation | no | Cross-app → **`Agreement Management/Clockify Users`** |
| Clockify User Email | text | no | Denormalized match key |
| Clockify User ID | text | no | Denormalized stable id |
| Mapping Status | enum | yes | Match outcome (see enums) |

#### Allocation (stored in v1; rules in Phase F)

| Field | Fibery type | Required | Purpose |
| --- | --- | --- | --- |
| Allocation Category | enum | yes | Default `Shared / unallocated` when no rule matches |
| Company | relation | no | Cross-app → **`Agreement Management/Companies`** when allocated |
| Agreement | relation | no | Cross-app → **`Agreement Management/Agreements`** when allocated |

#### Sync and audit

| Field | Fibery type | Required | Purpose |
| --- | --- | --- | --- |
| Sync Run Id | text | no | Correlates rows to a job run (Sheet tab or **`Sync Runs`**) |
| Ingested At | date-time | no | Set by writer on create/update |
| Raw Metrics JSON | document or long text | no | Sparse vendor metrics (sessions, lines accepted, tool_actions, ...) |
| Vendor Payload JSON | document or long text | no | Truncated raw vendor row for audit |

### Enum values (inline on `Usage` fields)

| Field | Allowed values |
| --- | --- |
| **Source Platform** | `Anthropic Console`, `Claude.ai`, `OpenAI` |
| **Source Dataset** | `Anthropic Messages`, `Anthropic Cost`, `Anthropic Claude Code`, `OpenAI Costs`, `OpenAI Completions Usage`, `OpenAI Embeddings Usage`, `OpenAI Images Usage`, `OpenAI Audio Usage`, `OpenAI Moderations Usage`, `OpenAI Vector Stores Usage`, `OpenAI Code Interpreter Usage` |
| **Actor Type** | `User`, `API key`, `Service account`, `Unknown` |
| **Customer Type** | `API`, `Subscription`, `N/A` |
| **Subscription Tier** | `Team`, `Enterprise`, `N/A` |
| **Mapping Status** | `Matched`, `Unmatched`, `Shared key`, `Service account` |
| **Allocation Category** | `Product development`, `Customer support`, `Shared / unallocated`, `Internal ops` |

Add new **Source Dataset** enum members only when a new vendor endpoint is onboarded; do not create separate Fibery entity types per platform.

### Source Platform assignment

| Ingest path | Source Platform | Source Dataset |
| --- | --- | --- |
| Anthropic `usage_report/messages` | Anthropic Console | Anthropic Messages |
| Anthropic `cost_report` | Anthropic Console | Anthropic Cost |
| Anthropic `usage_report/claude_code` where `customer_type=api` | Anthropic Console | Anthropic Claude Code |
| Anthropic `usage_report/claude_code` where `customer_type=subscription` | Claude.ai | Anthropic Claude Code |
| OpenAI `GET /organization/costs` | OpenAI | OpenAI Costs |
| OpenAI Admin usage endpoints | OpenAI | Matching `OpenAI * Usage` enum |

### Upsert and uniqueness

- **Unique constraint:** **`Source Record Id`** (Fibery unique field when available; otherwise query-before-create in writer).
- **Upsert algorithm:** Query `AI Usage Data/Usage` by **`Source Record Id`**; update if found, create if not.
- **Re-run safety:** Syncing the same calendar day twice MUST NOT duplicate rows.
- **Title:** Regenerated on each upsert from current field values.

### Normalized row shape (sync code contract)

The Apps Script normalize step produces this object before Fibery write (field names match the catalog above):

```text
{
  sourceRecordId: string,
  usageDate: 'YYYY-MM-DD',
  periodStart: ISO8601 | null,
  periodEnd: ISO8601 | null,
  sourcePlatform: 'Anthropic Console' | 'Claude.ai' | 'OpenAI',
  sourceDataset: string,
  orgExternalId: string | null,
  actorType: 'User' | 'API key' | 'Service account' | 'Unknown',
  actorEmail: string | null,
  actorExternalId: string | null,
  actorLabel: string | null,
  customerType: 'API' | 'Subscription' | 'N/A' | null,
  subscriptionTier: 'Team' | 'Enterprise' | 'N/A' | null,
  model: string | null,
  workspaceOrProject: string | null,
  serviceTier: string | null,
  lineItem: string | null,
  costType: string | null,
  tokenType: string | null,
  description: string | null,
  terminalType: string | null,
  inputTokens: number | null,
  outputTokens: number | null,
  cacheReadTokens: number | null,
  cacheWriteTokens: number | null,
  requestCount: number | null,
  quantity: number | null,
  costUsd: number | null,
  currency: 'USD' | string,
  clockifyUserId: string | null,
  clockifyUserEmail: string | null,
  mappingStatus: 'Matched' | 'Unmatched' | 'Shared key' | 'Service account',
  allocationCategory: 'Product development' | 'Customer support' | 'Shared / unallocated' | 'Internal ops',
  rawMetrics: object,
  vendorPayload: object
}
```

## Fibery app: `AI Usage Data` (supporting entities)

Greenfield **Fibery app / workspace: `AI Usage Data`**. All databases use the prefix **`AI Usage Data/`**. **`Usage`** is the only entity that stores usage facts.

**Creation sequence (see implementation plan Phase A):**

1. Complete **Phase 0** (vendor samples + signed field list for **`Usage`**).
2. **Create the `AI Usage Data` app** in Fibery UI (MCP cannot create workspaces).
3. Create **`Usage`** plus supporting types; verify with Fibery MCP **`describe_database`**.
4. Smoke-test **`create_entity`** on **`AI Usage Data/Usage`**.

**Cross-app links on `Usage`:** relation **`Clockify User`** → **`Agreement Management/Clockify Users`**; optional **`Company`** / **`Agreement`** when allocation assigns them.

### Supporting: `AI Usage Data/Actor Mapping`

Operator-maintained lookup for ids that are not emails (API keys, OpenAI projects, service accounts).

| Field | Purpose |
| --- | --- |
| Source Platform | enum |
| External Actor Id | api_key_id, project_id, service name |
| Clockify User | relation → **`Agreement Management/Clockify Users`** |
| Clockify User Email | text | optional denormalized |
| Default Allocation Category | optional override |
| Notes | e.g. "CI bot", "Customer X support key" |

### Supporting: `AI Usage Data/Sync Runs`

Append-only operational log in Fibery (mirrors Sheet tab **`AI Usage Sync Runs`**).

| Field | Purpose |
| --- | --- |
| Started At / Completed At | timestamps |
| Trigger | `scheduled` \| `manual` \| `backfill` |
| Status | `running` \| `complete` \| `partial` \| `failed` |
| Date Range | start / end processed |
| Rows fetched / upserted / skipped / failed | counters per platform |
| Warnings | text |
| Error | text |

### Link to Clockify Users

Existing Fibery entity: **`Agreement Management/Clockify Users`**

| Existing field | Use in this feature |
| --- | --- |
| `Agreement Management/Clockify User ID` | Stable join when vendor exposes opaque ids |
| `Agreement Management/Clockify User Email` | **Primary match:** lowercase email == Actor Email |
| `Agreement Management/Name` | Display; weak fallback only |
| `Labor Costs` collection | Future allocation signal |

Matching order (deterministic):

1. Explicit row in **AI Actor Mapping**.
2. Email match: `Actor Email` → **`Clockify User Email`** (case-insensitive).
3. Weak name match → `Mapping Status = Unmatched` unless admin confirms.
4. API keys / shared keys → `Shared key` until mapped.

## Cost allocation: product development vs customer support

v1 **stores** allocation dimensions; **rules engine** can start simple and evolve.

| Category | Typical signals (future rules) |
| --- | --- |
| **Product development** | Internal agreements (`Agreement Type = Internal`), internal Clockify companies (`UTILIZATION_INTERNAL_COMPANY_NAMES`), unassigned customer, R&D project tags, mapped "platform engineering" API keys |
| **Customer support** | Person's billable/customer labor hours in same period on active customer agreements; support-tagged OpenAI projects; explicit Agreement/Company on AI Actor Mapping |
| **Shared / unallocated** | Unmapped API keys, org-wide shared usage, multi-tenant automation |
| **Internal ops** | Finance, HR, admin staff with no customer labor |

**v1 default:** set `Allocation Category = Shared / unallocated` when no rule matches; never silently assign to a customer.

Optional later: weekly job compares AI usage week W to **`Labor Costs`** hours by `(personKey, customer)` and proposes allocation splits (document only in Phase D).

## Sync architecture (FOS Dashboard module)

### Runtime placement

New code lives under **`src/`** in the FOS Dashboard clasp project:

| Module (proposed) | Responsibility |
| --- | --- |
| `src/aiUsageSyncJob.js` | Daily trigger, on-demand entry points, `LockService`, continuation, run logging |
| `src/aiUsageAnthropicClient.js` | Admin API fetch + pagination (`messages`, `cost_report`, `claude_code`) |
| `src/aiUsageOpenAiClient.js` | Admin API fetch + pagination (`/organization/costs`, usage complements) |
| `src/aiUsageNormalize.js` | Vendor row → normalized fact + idempotency keys |
| `src/aiUsageFiberyWriter.js` | Upsert into **`AI Usage Data/*`** via `fiberyClient.js` |
| `src/aiUsageUserMatch.js` | Read **`Agreement Management/Clockify Users`**; write relations on **`AI Usage Data/Usage`** |
| `src/adminSettingsRegistry.js` | Script Property entries (extend existing registry) |

Public entry points (editor + future Settings UI):

- `runAiUsageSyncDaily_()` - scheduled
- `runAiUsageSyncOnDemand(startDate, endDate)` - manual
- `_diag_sampleAiUsageAnthropic_(date)` / `_diag_sampleAiUsageOpenAi_(date)` - Phase 0 / ops

Pattern mirrors proven jobs in this repo:

| Pattern source | Reuse |
| --- | --- |
| `docs/PRD.md` Clockify sync | Idempotent upsert, staging counters, activity log sheet |
| `src/dashboardSnapshotJob.js` | Daily trigger, `LockService`, continuation on timeout, run log tab |
| `src/fiberyClient.js` | Batched `/api/commands` create/update |

### Modes

| Mode | Trigger | Behavior |
| --- | --- | --- |
| **Daily incremental** | `installDailyAiUsageSyncTrigger()` (default 02:00 org timezone) | Pull recent days (`AI_USAGE_DAILY_LOOKBACK_DAYS`); upsert Fibery; log run |
| **On-demand** | `runAiUsageSyncOnDemand(start, end)` from editor or future ADMIN Settings | Same pipeline; respects `AI_USAGE_MAX_BACKFILL_DAYS` |
| **Backfill** | On-demand with wide range | Paginate + continuation trigger on timeout |

### Idempotency

- **Unique key:** **`Source Record Id`** on **`AI Usage Data/Usage`** (see [Upsert and uniqueness](#upsert-and-uniqueness)).
- Re-running the same day MUST NOT duplicate rows.

### Failure policy

| Failure | Policy |
| --- | --- |
| One platform API down | Mark run **partial**; continue other platforms; surface warning |
| Fibery write errors | Retry bounded; failed rows counted; do not delete existing Fibery rows |
| Unmapped users | Ingest row with `Mapping Status = Unmatched`; include in run summary |
| Missing Script Property | Fail fast with clear error (no partial secrets in logs) |

### Secrets (Script Properties)

| Property | Required | Purpose |
| --- | --- | --- |
| `FIBERY_HOST` | yes | Existing workspace host |
| `FIBERY_API_TOKEN` | yes | Existing; must access **`AI Usage Data`** + read **`Agreement Management`** |
| `FIBERY_AI_USAGE_APP` | default `AI Usage Data` | Database path prefix for ingest targets |
| `ANTHROPIC_ADMIN_API_KEY` | yes (Platform 1) | Admin API |
| `ANTHROPIC_ORG_ID` | optional | If not inferable from `/v1/organizations/me` |
| `OPENAI_ADMIN_API_KEY` | yes (Platform 3) | Admin API with usage read |
| `OPENAI_ORG_ID` | optional | Organization scope |
| `AI_USAGE_SYNC_TIMEZONE` | default `America/Chicago` | Usage date boundaries |
| `AI_USAGE_DAILY_LOOKBACK_DAYS` | default `3` | Re-pull recent days to capture late-arriving vendor data |
| `AI_USAGE_MAX_BACKFILL_DAYS` | default `90` | Guard on manual backfill |
| `AI_USAGE_LOG_SHEET_NAME` | default `AI Usage Sync Runs` | Tab in auth spreadsheet |

## User stories

- As **finance**, I want daily AI spend by person in Fibery so I can compare it to labor and software expense trends.
- As **delivery leadership**, I want to see which **customer-facing staff** drive AI cost during active engagements.
- As **engineering leadership**, I want **product-development** AI spend separated from customer support.
- As an **admin**, I want to **run a sync now** for the last 7 days after fixing a mapping table.
- As an **admin**, I want a **run log** that shows per-platform fetch counts and errors without opening Cloud logs.

## Phased delivery (for implementation planning)

| Phase | Scope | Deliverable |
| --- | --- | --- |
| **Phase 0 - Discovery** | MCP/API samples; payload appendix; Clockify User join verified | Signed field list for **`AI Usage Data`** |
| **Phase A - Fibery workspace** | Create app **`AI Usage Data`** + **`Usage`** entity (+ supporting Actor Mapping, Sync Runs) | MCP `describe_database` + smoke `create_entity` on **`Usage`** |
| **Phase B - Anthropic Console sync** | Platform 1: messages + cost_report | Module + daily job |
| **Phase C - Claude.ai / subscription sync** | Platform 2: `claude_code` subscription rows + validation | Same job pipeline |
| **Phase D - OpenAI sync** | Platform 3: organization costs (+ usage if needed) | Same job pipeline |
| **Phase E - User matching** | Email → **`Clockify User Email`** + Actor Mapping | Match rate report in sync run |
| **Phase F - Allocation rules v1** | Default categories; no silent customer assignment | Fibery views by category |
| **Phase G - Operator UI** | ADMIN Settings: Run sync, last run status, link to Fibery | On-demand without editor |

## Acceptance criteria (draft)

- **AC-01:** Given valid Admin API credentials for Anthropic Console and OpenAI, a manual sync for a single calendar day creates or updates Fibery **`AI Usage Data/Usage`** rows without duplicates when run twice.
- **AC-02:** Given a Clockify User with email `user@harpin.ai`, Anthropic usage grouped by that email links to the correct Fibery **Clockify User** relation.
- **AC-03:** Given an unmapped API key, rows are stored with `Mapping Status = Shared key` and appear in the sync run warning summary.
- **AC-04:** Given a scheduled daily trigger, the job pulls at least the prior calendar day for all configured platforms and appends one **Sync Runs** row with status `complete` or `partial`.
- **AC-05:** Given a platform API failure, other platforms still sync and the run status is `partial` with actionable error text (no secrets).
- **AC-06:** Given missing required Script Properties, the job aborts before any Fibery write and logs a single clear configuration error.
- **AC-07:** On-demand sync accepts `startDate` and `endDate` within configured max backfill and processes platforms sequentially within Apps Script time limits (continuation if needed).

## Risks and open decisions

| Item | Risk | Mitigation |
| --- | --- | --- |
| **claude.ai API gap** | Teams usage may lack Admin API coverage | Phase 0 spike; CSV fallback; engage Anthropic support |
| **Email mismatch** | Vendor email ≠ Clockify email | Mapping table; alias list on Clockify Users |
| **Shared API keys** | Cannot attribute to one person | Actor Mapping + "Shared" category |
| **Cost vs tokens** | Vendors report cost on different schedules | Store both; prefer vendor cost when present |
| **Apps Script limits** | Large orgs paginate heavily | Batching, continuation triggers, daily increments |
| **PII in logs** | Emails in run logs | Redact in sheet columns; full detail only in Fibery |
| **Fibery schema drift** | Manual Fibery edits break writer | Pin **`Usage`** field paths in code + `describe_database` check in diagnostics |
| **Cross-app relations** | `AI Usage Data` → Agreement Management links misconfigured | Validate in Phase A smoke test; keep denormalized email/id on usage rows |

## Future extensions (out of scope)

- FOS Dashboard panel: AI cost KPIs joined to Utilization filters.
- Include **`ai-usage.json`** in historical Drive snapshots.
- QuickBooks journal suggestions from allocated AI cost.
- Real-time budget alerts (Slack) when daily spend exceeds threshold.

## Next step

Follow **[017-ai-platform-usage-fibery-sync-implementation-plan.md](017-ai-platform-usage-fibery-sync-implementation-plan.md)** (reviewed 2026-06-08):

1. **Phase 0** - Anthropic samples + [gap memo](017-phase0-gap-memo.md) done; add OpenAI sample + product sign-off.
2. **Phase A.2** - [Fibery schema setup](017-fibery-schema-setup.md) (operator); MCP smoke test on **`Usage`**.
3. **Phase B** - `src/` sync modules after A.2 + Script Properties.

**Do not write production sync code or schedule triggers until Phase 0 is signed off and Phase A.2 smoke test passes.**

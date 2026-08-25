# Supabase data model (FinOps Performance Hub)

> **Feature:** [036 - Supabase dashboard data layer](features/036-supabase-dashboard-data-layer.md)  
> **Migrations:** [`supabase/migrations/`](../supabase/migrations/)  
> **Build script:** [`scripts/supabase_build_schema.py`](../scripts/supabase_build_schema.py)  
> **README section:** [Supabase database](../README.md#supabase-database)

Postgres in Supabase is the **Live dashboard query store** whenever credentials are configured (v3.0.11+: no Live Fibery fallback). Apps Script reads and writes with the **service role** key (server only). Historical snapshots remain on **Google Drive** (features 009 / 010).

## Build the schema on demand

From the repo root:

```bash
# 1) List migrations in apply order
python scripts/supabase_build_schema.py --list

# 2) Write combined SQL (default: supabase/build/schema_all.sql)
python scripts/supabase_build_schema.py

# 3a) Apply with psql (requires PostgreSQL client + DATABASE_URL)
#     Supabase Dashboard → Project Settings → Database → URI
set DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-....pooler.supabase.com:5432/postgres
python scripts/supabase_build_schema.py --apply

# 3b) Or paste supabase/build/schema_all.sql into Supabase SQL Editor → Run
```

Migrations are **idempotent** (`create table if not exists`, `create index if not exists`). Safe to re-run on an existing project.

| Migration | Purpose |
| --- | --- |
| `035_labor_costs.sql` | Clockify time-entry facts (`labor_costs`) + base indexes + RLS revoke for anon |
| `036_fos_dashboard_schema.sql` | Hub serving tables (`fos_*`): panel payloads, delivery P&L, sync control, dimensions |
| `037_labor_costs_date_range_indexes.sql` | Date-range indexes on `labor_costs.start_date_time` (+ user/project/status composites) |
| `038_fos_labor_costs_time_entries.sql` | Repurpose `fos_labor_costs` as Hub time-entry mirror of `labor_costs` + mirror trigger |
| `039_engagement_reviews.sql` | Engagement Review tables + `fos_agreements.owner_email` / `owner_name` |
| `040_engagement_reviews_grants.sql` | Grants for engagement tables |
| `041_agreement_management_mirror.sql` | Agreement Management typed mirror (enums, entities, junctions); adds (unused) `fos_am_labor_costs` table |
| `042_am_mirror_foreign_keys.sql` | Soft-to-hard FK constraints (`DEFERRABLE INITIALLY DEFERRED`, `NOT VALID`) across the AM mirror graph; does not touch `fos_am_labor_costs` |
| `043_am_mirror_grants.sql` | Grants for AM mirror tables |
| `044_fos_labor_costs_grants.sql` | Grants + RLS policies on `fos_labor_costs` / `labor_costs` |
| `045_engagement_updates_status_pack.sql` | Engagement Update status packs: notes table, snapshot/RAG/sort columns, AI synopsis columns, uniqueness |
| `046_fos_labor_costs_util_dims.sql` | View `fos_labor_costs_util_dims`: 1:1 customer and role joins for Utilization / RA |
| `043_am_mirror_grants.sql` | Grants AM mirror tables to `anon` / `authenticated` (same pattern as 040); fixes nightly `permission denied for table fos_am_enums` |
| `044_fos_labor_costs_grants.sql` | Grants + RLS policies on `fos_labor_costs` / `labor_costs`; fixes Live Utilization / Labor Hours and Pull `permission denied for table fos_labor_costs` |
| `047_drop_unused_indexes.sql` | Feature 047 workstream A: drops six indexes with zero scans over 40 days |
| `048_perf_diagnostic_runs.sql` | Table `fos_perf_runs`: parity and baseline harness results |
| `049_perf_runs_kind_constraint.sql` | Replaces the `fos_perf_runs.kind` allow-list with a lowercase-slug shape check |
| `050_fos_rpc_ra_week_grid.sql` | Function `fos_rpc_ra_week_grid(date, date)`: resource allocations overlapping a range with person / project / customer / role joins resolved in SQL. Called behind `PERF_USE_RA_RPC` |

After schema apply: set Script Properties (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), run ADMIN **Pull from Fibery** (also installs the nightly hydrate trigger as of v3.0.12), then smoke Live panels. See [cutover notes](sql/036/README.md).

## v3.4.0 cutover: panels build from typed tables, labor is Clockify-only

As of **v3.4.0**, panel hydrate (`supabaseSyncJob.js`) builds every Live panel payload by **reading the AM-mirrored typed tables** (`supabasePanelBuilders.js`) instead of re-aggregating live Fibery queries. The AM mirror (`am-mirror` dataset) still runs first in the nightly/Pull sequence so the typed tables are current before panel builders read them.

**Labor ownership is unchanged and exclusive:** labor facts come **only** from Clockify via `labor_costs` / `fos_labor_costs` (migration 038's trigger-mirrored table). Fibery `Agreement Management/Labor Costs` is **not** mirrored by `supabaseAmMirror.js` - the `am_labor_costs` entity step was removed, and `fos_pnl_labor_costs` junctions are no longer written (`amMirrorAfterPnlItems_` only writes revenue-item junctions now). `fos_am_labor_costs` (added by migration 041) is **deprecated**: the table remains for backward compatibility but is no longer written to and is not FK-constrained. It is a candidate for a future drop once confirmed unused.

| Panel | Live serve (unchanged) | Hydrate build source (v3.4.0) |
| --- | --- | --- |
| Agreement | `fos_panel_payloads` (`panel_key='agreement'`) | `fos_agreements`, `fos_companies`, `fos_company_segments`, `fos_revenue_items` |
| Utilization | `fos_panel_payloads` (Live already preferred `fos_labor_costs` pre-cutover); customer/role from `fos_agreements` + `fos_companies` and `fos_clockify_users` + `fos_team_member_roles` (v3.9.1); view `fos_labor_costs_util_dims` | `fos_labor_costs` (Clockify) plus agreement/user/role dimensions |
| Pipeline | `fos_panel_payloads` (`panel_key='pipeline'`) | `fos_hubspot_deals` (full-replace mirrored from Fibery `HubSpot/Deal` immediately before build; sheet side unchanged) |
| Resource assignments | Live API rebuilds from typed tables for requested From/To (**v3.7.4**); hydrate blob is default-range fallback | `fos_resource_allocations`, `fos_agreements`, `fos_clockify_users`, `fos_team_member_roles`, `fos_labor_costs` |
| AI Usage | `fos_panel_payloads` (`panel_key='ai-usage'`) | `fos_ai_usage_rows` (full-replace mirrored from Fibery `Claude API Costs` immediately before build) |
| Delivery P&L | `fos_delivery_pnl` | `fos_agreements`, `fos_revenue_items`, `fos_other_direct_costs`, `fos_labor_costs`, `fos_status_updates`, `fos_resource_allocations` |
| Portfolio P&L | `fos_panel_payloads` (`panel_key='portfolio-pnl'`) | Per-project Delivery P&L build (above) over the delivery project index |

`fos_hubspot_deals` and `fos_ai_usage_rows` have no dedicated AM-mirror step (they are not Agreement Management entities), so their panel hydrate functions (`hydrateSupabasePipeline_`, `hydrateSupabaseAiUsage_`) run a full-replace mirror from Fibery immediately before building the panel from the typed table. This keeps the **Live serve contract** identical (`fos_panel_payloads` / `fos_delivery_pnl`) while the **build source** moves from live Fibery aggregation to Supabase.

## Ownership

| Table | Writer | Reader |
| --- | --- | --- |
| `labor_costs` | Clockify → Supabase sync (outside Fibery hydrate) | External sync SoT; mirrored to `fos_labor_costs` |
| `fos_labor_costs` | Postgres trigger from `labor_costs` (migration 038) | Hub SQL builders / future Live facts |
| `fos_labor_costs_rates_legacy` | None (empty prior rate DDL, renamed aside) | Deferred; not used by Live |
| `fos_panel_payloads`, `fos_delivery_pnl`, `fos_dataset_as_of`, `fos_sync_*` | Feature 036 Fibery hydrate (nightly + ADMIN Pull) | Live panel serve |
| `fos_am_enums`, `fos_team_member_roles`, `fos_companies`, `fos_clockify_users`, `fos_contacts`, `fos_services_estimates`, `fos_agreements`, `fos_resource_allocations`, `fos_estimated_allocations`, `fos_other_direct_costs`, `fos_invoice_requests`, `fos_revenue_items`, `fos_agreement_pnl_items`, junction tables | Feature 036 AM mirror (`am-mirror` dataset; `supabaseAmMirror.js`) | **v3.4.0:** `supabasePanelBuilders.js` panel hydrate builders; Engagement Review joins |
| `fos_am_labor_costs` | **Deprecated (v3.4.0):** no longer written. Table remains from migration 041 for back-compat only. | None; not read by any builder |
| `fos_status_updates` | Hydrate AM mirror (`submitted_by`) + dual-write on Delivery status submit (`content`, `author_email`) | Delivery status history (`fetchStatusUpdatesForAgreementFromSupabase_` prefers `author_email`, falls back to `submitted_by`) |
| `fos_engagement_reviews` (+ agreements, participants, updates, recordings, notes) | Hub Engagement Review module (feature **037**) | Engagement Review UI; v3.5.0 status packs + AI synopsis |
| `fos_hubspot_deals` | **v3.4.0:** full-replace mirrored from Fibery `HubSpot/Deal` by `mirrorHubspotDealsToSupabase_()` immediately before the Pipeline panel hydrate | Pipeline panel build (`buildPipelineDashboardPayloadFromSupabase_`) |
| `fos_ai_usage_rows` | **v3.4.0:** full-replace mirrored from Fibery `Claude API Costs` by `mirrorAiUsageRowsFromFibery_()` immediately before the AI Usage panel hydrate | AI Usage panel build (`buildAiUsagePayloadFromSupabase_`) |

## Entity relationship (conceptual)

```mermaid
erDiagram
  fos_sync_runs ||--o{ fos_sync_watermarks : tracks
  fos_dataset_as_of ||--|| fos_panel_payloads : freshness
  fos_agreements ||--o{ fos_status_updates : has
  fos_agreements ||--o| fos_delivery_pnl : pnl_payload
  fos_companies ||--o{ fos_agreements : company
  labor_costs ||--|| fos_labor_costs : "mirror trigger"

  fos_panel_payloads {
    text panel_key PK
    timestamptz as_of
    jsonb payload
  }
  fos_delivery_pnl {
    text agreement_id PK
    jsonb payload
  }
  labor_costs {
    text clockify_time_log_id PK
    timestamptz start_date_time
    text user_id
    text project_id
  }
  fos_labor_costs {
    text clockify_time_log_id PK
    timestamptz start_date_time
    text user_id
    text project_id
  }
```

## Foreign keys (migration 042)

The AM mirror graph uses **soft FK columns** (plain `text` fibery ids) so hydrate pages can upsert facts before their dimension rows exist. Migration `042_am_mirror_foreign_keys.sql` adds the corresponding **hard FK constraints**, all `DEFERRABLE INITIALLY DEFERRED` and `NOT VALID` (accepted immediately for new/changed rows; historical dirty data is not retroactively validated). Dimension-referencing FKs use `ON DELETE SET NULL`; junction-table FKs use `ON DELETE CASCADE`. `fos_am_labor_costs` is intentionally excluded (deprecated, Clockify owns labor).

## Table catalog

### Sync / control plane

| Table | PK | Columns (summary) | Indexes |
| --- | --- | --- | --- |
| `fos_sync_runs` | `id` (uuid) | `run_id`, `trigger_kind`, `status`, `started_at`, `finished_at`, `duration_ms`, cursor/progress, `notes`, `summary` | `started_at desc`, `status` |
| `fos_sync_watermarks` | `dataset_key` | `cursor_json`, `updated_at` | PK |
| `fos_dataset_as_of` | `dataset_key` | `as_of`, `updated_at` | PK |

### Live payloads

| Table | PK | Columns (summary) | Indexes |
| --- | --- | --- | --- |
| `fos_panel_payloads` | `panel_key` | `as_of`, `synced_at`, `cache_schema_version`, `payload` (jsonb) | `synced_at desc` |
| `fos_delivery_pnl` | `agreement_id` | `agreement_name`, `as_of`, `synced_at`, `cache_schema_version`, `payload` | `synced_at desc`, `agreement_name` |

Typical `panel_key` values align with Hub routes (for example `agreement-dashboard`, `operations`, `pipeline`, `portfolio-pnl`, `ai-usage`). Exact keys are owned by `supabaseSyncJob.js` / dashboard modules.

### Status and dimensions

| Table | PK | Notes |
| --- | --- | --- |
| `fos_status_updates` | `fibery_id` | Index `(agreement_id, created_at desc)` |
| `fos_companies` | `fibery_id` | Index on `name` |
| `fos_agreements` | `fibery_id` | Indexes on `status`, `company_fibery_id`, `agreement_type` |
| `fos_hubspot_deals` | `fibery_id` | Unique partial on `hubspot_deal_id`; index on `stage` |
| `fos_ai_usage_rows` | `fibery_id` | Indexes on `usage_date`, `actor_email` |

### Labor

| Table | PK | Notes |
| --- | --- | --- |
| `labor_costs` | `clockify_time_log_id` | Clockify sync SoT (time entries). Indexes include `start_date_time` composites (037). RLS enabled; `anon`/`authenticated` revoked. |
| `fos_labor_costs` | `clockify_time_log_id` | Hub mirror of `labor_costs` (same columns). Backfilled + kept current by trigger (038). RLS enabled; `anon`/`authenticated` revoked. |

## Security notes

- Apps Script must use **`SUPABASE_SERVICE_ROLE_KEY`** only (never ship the anon key to `DashboardShell.html`).
- `labor_costs` has RLS enabled and privileges revoked from `anon` / `authenticated`.
- Most `fos_*` tables were created without RLS for service-role hydrate. If you enable the Supabase Data API for browsers, **enable RLS and add deny-all (or service-only) policies** before exposing the project. See [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Related

- Feature spec: [036-supabase-dashboard-data-layer.md](features/036-supabase-dashboard-data-layer.md)
- Implementation plan: [036-supabase-dashboard-data-layer-implementation-plan.md](features/036-supabase-dashboard-data-layer-implementation-plan.md)
- Operator cutover: [sql/036/README.md](sql/036/README.md)
- Migrations folder: [supabase/README.md](../supabase/README.md)

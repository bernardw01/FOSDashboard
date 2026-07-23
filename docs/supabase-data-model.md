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

After schema apply: set Script Properties (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), run ADMIN **Pull from Fibery** (also installs the nightly hydrate trigger as of v3.0.12), then smoke Live panels. See [cutover notes](sql/036/README.md).

## Ownership

| Table | Writer | Reader |
| --- | --- | --- |
| `labor_costs` | Clockify → Supabase sync (outside Fibery hydrate) | External sync SoT; mirrored to `fos_labor_costs` |
| `fos_labor_costs` | Postgres trigger from `labor_costs` (migration 038) | Hub SQL builders / future Live facts |
| `fos_labor_costs_rates_legacy` | None (empty prior rate DDL, renamed aside) | Deferred; not used by Live |
| `fos_panel_payloads`, `fos_delivery_pnl`, `fos_dataset_as_of`, `fos_sync_*` | Feature 036 Fibery hydrate (nightly + ADMIN Pull) | Live panel serve |
| `fos_status_updates` | Hydrate + dual-write on Delivery status submit | Delivery status history |
| `fos_companies`, `fos_agreements`, `fos_hubspot_deals`, `fos_ai_usage_rows` | Hydrate (dimension / row stubs) | Future SQL builders; payloads cover v1 Live |

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

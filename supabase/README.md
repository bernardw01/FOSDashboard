# Supabase schema (FinOps Performance Hub)

Postgres migrations for the Live dashboard data layer ([feature 036](../docs/features/036-supabase-dashboard-data-layer.md)).

## Quick start

```bash
# From repo root
python scripts/supabase_build_schema.py --list
python scripts/supabase_build_schema.py
# → writes supabase/build/schema_all.sql

# Apply (psql + DATABASE_URL) or paste schema_all.sql into Supabase SQL Editor
python scripts/supabase_build_schema.py --apply
```

Full data model, table catalog, and security notes: **[`docs/supabase-data-model.md`](../docs/supabase-data-model.md)**.  
Product README section: **[Supabase database](../README.md#supabase-database)**.

## Migrations (apply in filename order)

| File | Description |
| --- | --- |
| [`migrations/035_labor_costs.sql`](migrations/035_labor_costs.sql) | `labor_costs` time-entry facts (Clockify sync) |
| [`migrations/036_fos_dashboard_schema.sql`](migrations/036_fos_dashboard_schema.sql) | `fos_*` serving + sync + dimension tables |
| [`migrations/037_labor_costs_date_range_indexes.sql`](migrations/037_labor_costs_date_range_indexes.sql) | Date-range indexes on `labor_costs` |
| [`migrations/038_fos_labor_costs_time_entries.sql`](migrations/038_fos_labor_costs_time_entries.sql) | Hub `fos_labor_costs` mirror of `labor_costs` + trigger |

Do not edit applied migration history casually. Add a new numbered `0NN_*.sql` for forward changes, then re-run the build script.

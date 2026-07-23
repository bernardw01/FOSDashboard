# Feature 036 - Supabase cutover notes

Canonical **data model** and **schema build** instructions:

- [`docs/supabase-data-model.md`](../../supabase-data-model.md)
- [`supabase/README.md`](../../../supabase/README.md)
- Build script: `python scripts/supabase_build_schema.py`

## Apply schema

```bash
# From repo root - writes supabase/build/schema_all.sql
python scripts/supabase_build_schema.py

# Apply with psql (DATABASE_URL) or paste schema_all.sql into Supabase SQL Editor
python scripts/supabase_build_schema.py --apply
```

Individual files (applied in order by the build script):

1. [`supabase/migrations/035_labor_costs.sql`](../../../supabase/migrations/035_labor_costs.sql)
2. [`supabase/migrations/036_fos_dashboard_schema.sql`](../../../supabase/migrations/036_fos_dashboard_schema.sql)
3. [`supabase/migrations/037_labor_costs_date_range_indexes.sql`](../../../supabase/migrations/037_labor_costs_date_range_indexes.sql)
4. [`supabase/migrations/038_fos_labor_costs_time_entries.sql`](../../../supabase/migrations/038_fos_labor_costs_time_entries.sql)

## Script Properties

| Key | Purpose |
| --- | --- |
| `SUPABASE_URL` | `https://PROJECT.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role (server only) |
| `DASHBOARD_READ_SOURCE` | Legacy (ignored for Live as of v3.0.11) | Live panels always read Datastore when credentials are set |
| `SUPABASE_SYNC_ENABLED` | `true` / `false` |
| `SUPABASE_SYNC_BATCH_SIZE` | `1`–`3` |
| `SUPABASE_SYNC_TRIGGER_HOUR` | `0`–`23` (default `4`) |

## Operator steps

1. Apply schema (build script or SQL Editor), including migration **038** for `fos_labor_costs`.
2. Set URL + service role key in ADMIN Settings.
3. In Settings → **Data platform - Supabase**, click **Pull from Fibery** and wait for hydrate complete. Pull also installs the **nightly** hydrate trigger (v3.0.12+).
4. Confirm Settings status shows **Nightly trigger: installed**.
5. Live panels always read Datastore when credentials are set (v3.0.11+).
6. Smoke Live panels; Expenses and snapshot mode should be unchanged.

## Notes

- `labor_costs` is the Clockify sync write target. `fos_labor_costs` is the Hub time-entry mirror (same shape), backfilled and kept current by a Postgres trigger (038). Fibery hydrate does not write either labor table.
- Panel JSON in `fos_panel_payloads` only advances on ADMIN **Pull** or the nightly job; panel **Reload** re-reads Datastore only.
- Date-range indexes on `labor_costs.start_date_time` are in migration **037** (mirrored indexes on `fos_labor_costs` in **038**).
- Portfolio hydrate runs a full Fibery portfolio build in one dataset step (can be long); keep batch size at 1 if timeouts occur.

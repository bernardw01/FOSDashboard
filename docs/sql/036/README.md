# Feature 036 - Supabase cutover notes

## Apply schema

Run [`supabase/migrations/036_fos_dashboard_schema.sql`](../supabase/migrations/036_fos_dashboard_schema.sql) against the target Supabase Postgres database (SQL editor or `psql`).

## Script Properties

| Key | Purpose |
| --- | --- |
| `SUPABASE_URL` | `https://PROJECT.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role (server only) |
| `DASHBOARD_READ_SOURCE` | `fibery` (default) or `supabase` |
| `SUPABASE_SYNC_ENABLED` | `true` / `false` |
| `SUPABASE_SYNC_BATCH_SIZE` | `1`–`3` |
| `SUPABASE_SYNC_TRIGGER_HOUR` | `0`–`23` (default `4`) |

## Operator steps

1. Apply migration.
2. Set URL + service role key in ADMIN Settings.
3. Optionally run `installSupabaseSyncTrigger_()` once from the Apps Script editor.
4. In Settings → **Data platform - Supabase**, click **Pull from Fibery** and wait for hydrate complete.
5. Set `DASHBOARD_READ_SOURCE` to `supabase`.
6. Smoke Live panels; Expenses and snapshot mode should be unchanged.

## Notes

- `fos_labor_costs` is owned by the separate Clockify sync; Fibery hydrate skips it.
- Utilization / Resource assignments custom date ranges still fall back to Fibery until fact-table builders land.
- Portfolio hydrate runs a full Fibery portfolio build in one dataset step (can be long); keep batch size at 1 if timeouts occur.

# v3.16.0 - Dashboard performance Workstream C (hydrate)

## Problem
Nightly Fibery → Supabase hydrate re-scanned every Agreement Management entity (60 to 70 minutes), failed silently about 20% of the time, and restarted the mirror from step 0 after a transient error.

## Fix
- **C1:** Incremental AM mirror via `fos_sync_watermarks` and Fibery `modification-date`, with Sunday full reconcile. Kill switch `PERF_INCREMENTAL_AM_MIRROR` (ships off).
- **C2:** Larger upsert chunks and `UrlFetchApp.fetchAll` for parallel PostgREST upserts.
- **C3:** Failed hydrates email ADMIN and surface duration / status / error in Settings Datastore health.
- **C4:** Bounded Fibery fetch retry with backoff; next run resumes from the failed step instead of restarting the dataset.

## Benefit
Faster hydrates when little changed, visible failures, and recoverable retries without redoing completed mirror steps.

# Release v3.29.2 (2026-09-11)

Catch-up ship from PRD 3.26.0 through 3.29.2. Deployed via clasp push; `check_deployed_matches_git.py` verified.

## 3.27.0 - Supabase hydrate staleness guard (036 BUG-036-01)

- Abandon `running` sync state older than 4h instead of blocking forever
- Settings sync health + Admin force-clear stuck state
- `_diag_supabaseSyncHealth`, `test_supabaseSyncStaleRunningGuard_`

## 3.28.0 - AI usage hydrate resilience + B7 perf (036, 047)

- AI usage empty-window messaging; `ai-usage` soft-fail so portfolio-pnl/viz-warm continue
- B7 util RPC + agreement hydrate RPC pilot; per-dataset hydrate timings diagnostic

## 3.28.1 - Full diagnostics suite runner (047)

- `_diag_runFullDiagnosticsSuite()` master runner persisting to `fos_perf_runs`

## 3.28.2 - B7 RPC parity fixes (047)

- Migration 059: util aggregates billableHours coalesce, Clockify display names, agreement Closed-Lost nulls
- Migration 060: util role name whitespace parity

## 3.29.0 - Standing diagnostic suite (057)

- `scripts/run_diagnostics.py` + `scripts/check_clasp_run_setup.py`
- Expanded `FOS_DIAG_SUITE_STEPS_` (Lookback, Performance Review, panel health, sync/B7)
- `runFullDiagnosticsSuite()` Execution API entry

## 3.29.1 - AI Usage hydrate pause (036 CHANGE-036-03)

- `AI_USAGE_HYDRATE_ENABLED` kill switch: nav, hydrate skip, diagnostics pause, notification catalog
- Feature 017 Anthropic ingest unchanged
- `runDiagnosticSuiteManual_()` Apps Script editor fallback (057)

## 3.29.2 - Lookback Action Required filter UX (056 CHANGE-056-13)

- Status/Owner filters use shared `fos-util-multi` dropdown (same as PM Overview)
- Presentation-only; mobile filter sheet unchanged

## Supabase migrations (apply separately if not already live)

- 057_fos_rpc_util_aggregates.sql
- 058_fos_rpc_agreement_revenue_mapped.sql
- 059_fos_rpc_b7_parity_fixes.sql
- 060_fos_rpc_util_role_name_parity.sql

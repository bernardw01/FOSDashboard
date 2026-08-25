# v3.15.0 - Slim Resource Assignments personVariances (feature 047 B6)

## Summary

Resource Assignments `personVariances` travels as a self-describing positional codec when `PERF_SLIM_RA_PERSON_VARIANCES` is on: positional week/day tuples, string tables, and shared byDay dedup across assigned/actual/variance groups.

## Measured (live project jpcbugdpdvyutlusicxa, 2026-08-25)

- Panel JSON chars: 2,789,504
- personVariances (Postgres text): 2,316,942 (83%)
- Compact personVariances: 2,113,091 -> encoded 124,060 (94.1%)
- Unique byDay tables: 572 from 3,730 refs
- cacheSchemaVersion stays 3 (no re-hydrate)

## Operator steps

1. Run `_diag_verifyCodec_RaPersonVariances()` in the Apps Script editor; require `pass: true`, `diffCount: 0`.
2. Turn `PERF_SLIM_RA_PERSON_VARIANCES` on in ADMIN Settings.
3. Open Resource Assignments Live and confirm By person variances grid, filters, CSV, and day drill-down.

## Kill switch

`PERF_SLIM_RA_PERSON_VARIANCES` defaults false.

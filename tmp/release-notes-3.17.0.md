# v3.17.0 - Dashboard client responsiveness (Workstream D)

Feature **047** workstream D.

## What changed

- **Drive-hosted hero and logo** (~130 KB out of every HTML response); hero uses `decoding="async"` and `loading="lazy"`.
- **Lazy panel markup** behind `PERF_LAZY_PANEL_MARKUP` (ships **off**): non-Home panels load via `getDashboardDeferredPanelMarkup()` after first paint.
- **IndexedDB panel cache** for payloads over 2 MB so a new tab can reopen Utilization / Resource Assignments without a server refetch when `sessionStorage` quota fails.
- **Chunked renders**: Utilization heatmap and Resource Assignments person grid build in `requestAnimationFrame` batches.
- **Operations skeleton** while Live data is fetching (instead of a zeroed KPI layout).

## Kill switch

- `PERF_LAZY_PANEL_MARKUP` (default `false`) restores inline panel markup without a redeploy.

## Verify

1. `clasp push` then `python scripts/check_deployed_matches_git.py` exits 0.
2. Cold load: confirm hero/logo are HTTPS Drive URLs, not inline base64.
3. With lazy on: navigate from Home; panels inject and controls work.
4. Utilization → close tab → new tab: IndexedDB hydrate, no refetch when payload was over 2 MB.
5. DevTools: heatmap / RA grid tasks under 200 ms.
6. Mobile ~390px: skeleton and existing mobile chrome unchanged.

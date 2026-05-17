# Implementation plan — App Versions registry

> Companion to [013-app-versions-registry.md](013-app-versions-registry.md). **Delivered v2.4.0**.

## Summary

| Item | Choice |
|------|--------|
| **Version** | **2.4.0** |
| **PRD** | **FR-108**, **AC-64** |
| **Module** | `src/appVersionsCatalog.js` |
| **Tab** | `App Versions` (configurable) |

## Ops setup

1. In the auth spreadsheet, add tab **`App Versions`** with headers: `Released At`, `Description`, `PRD Version`, `URL`.
2. Optionally backfill rows for `2.3.0`, `2.2.0`, … with descriptions and deployment URLs.
3. Deploy v2.4.0; confirm a `2.4.0` row appears; paste the live `/exec` URL.

## Test plan

| Step | Expected |
|------|----------|
| User on latest URL | No banner |
| User on older deployment, sheet has higher semver + URL | Banner + sidebar link |
| New version deploy, first load | New sheet row, URL empty |
| ADMIN → Settings | Registry table visible |

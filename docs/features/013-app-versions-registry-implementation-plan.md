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

1. In the auth spreadsheet, add tab **`App Versions`** with headers: `Released At`, `Description`, `PRD Version`, `URL`, `Available`.
2. Optionally backfill rows for older versions; set **Available** to `TRUE` when that release should prompt users to upgrade.
3. Deploy; confirm a new row appears with **URL** filled and **Available** = `FALSE`; set **Available** to `TRUE` when ready to notify.

## Test plan

| Step | Expected |
|------|----------|
| User on latest URL | No banner |
| User on older deployment, sheet has higher semver + URL | Banner + sidebar link |
| New version deploy, first load | New sheet row, URL = deployment, Available = FALSE |
| Higher semver row with Available=FALSE | No update banner for users on older *available* latest |
| ADMIN → Settings | Registry table visible |

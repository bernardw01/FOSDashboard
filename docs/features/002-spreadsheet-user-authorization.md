# Feature: Spreadsheet user authorization (users tab)

> **PRD version 1.18.0** — keep in sync with `docs/FOS-Dashboard-PRD.md`.

## Goal

Authorize FOS Dashboard users by **looking up their Google account email** in a **Users** tab of a configured Google Spreadsheet. For each authorized user, return **`Role`** and **`Team`** for server-side use (navigation, future KPI entitlements). Users **not** on the list must see a dedicated **not authorized** page and must not receive the main dashboard shell or privileged payloads from server endpoints.

## User Stories

- As an **admin**, I want to **maintain allowed users, roles, and teams in one Sheet** so access stays easy to audit and change without code deploys.
- As an **authorized user**, I want the app to **know my role and team** so future dashboards can show the right content.
- As an **unauthorized user**, I want a **clear denial page** so I understand I need access added rather than seeing a broken or empty dashboard.

## Acceptance Criteria (testable)

- [ ] **Given** Script Properties define a valid **`AUTH_SPREADSHEET_ID`** and users tab name, **when** a signed-in user’s email **matches** a row (case-insensitive, trimmed), **then** `doGet` serves the **main dashboard** and server-side code has **`role`** and **`team`** from that row.
- [ ] **Given** the same conditions but the user’s email **does not** match any row, **when** they open the Web App, **then** they receive **only** the **not authorized** HTML page (no sidebar/nav from the main shell, no sensitive metrics).
- [ ] **Given** `getDashboardNavigation` (or any future privileged `google.script.run` handler) is invoked, **when** the caller is **not** on the users sheet, **then** the handler **does not** return the normal navigation model (throws or returns a safe error shape documented in code).
- [ ] **Given** required authorization properties are **missing**, **when** `doGet` runs, **then** the user sees a **fail-closed** outcome (not authorized or a generic configuration error page **without** exposing property keys or stack traces to the browser).
- [ ] **Given** the users tab has a **header row**, **when** columns are renamed via Script Properties (optional overrides), **then** the script still reads **Email**, **Role**, and **Team** (or configured equivalents) as documented.

## UI Notes

- **New file**: `src/NotAuthorized.html` — static or templated HtmlService page: short title, explanation (“You are signed in but not authorized…”), optional link to internal IT / request access channel (configurable copy only, no secrets).
- **Update**: `src/Code.js` — `doGet` branches on authorization result; extract sheet lookup into a dedicated function or `src/authUsersSheet.js` (or equivalent) for reuse by `doGet` and `google.script.run` handlers.
- **Update**: `src/DashboardShell.html` — optionally show **team** (and/or **role**) in the user chip area once passed from server (template evaluate or first `google.script.run` response); must not trust client-submitted role/team.

## Data Model

### Spreadsheet: users tab (v1 contract)

| Column (default name) | Required | Notes |
| --- | --- | --- |
| **Email** | Yes | Google account email; string; match is **trim + case-insensitive**. |
| **Role** | Yes | Free text or controlled vocabulary (documented by ops); drives future RBAC. |
| **Team** | Yes | Free text or controlled vocabulary. |
| **fibery_access** *(v1.15.0)* | Optional | Per-user gate for the Operations row-detail drawer **Open in Fibery →** anchor. Truthy values: `TRUE` / `True` / `true`, `yes` / `y`, `1`, or the Sheets / JS boolean `true`. Blank, `FALSE`, `0`, `no`, garbage, or a **missing column** all resolve to **`false`** — deny by default. Header name is overridable via Script Property `AUTH_COL_FIBERY_ACCESS`. Gated `false` users never receive the Fibery host or URL template in any server response. |

- **Optional later**: `Active` (Y/N), `StartDate`, `EndDate` — out of scope for v1 unless added in same feature.
- **Header row**: row 1; data from row 2 downward.
- **Uniqueness**: If multiple rows match the same email, behavior MUST be deterministic (e.g. **first match wins** after documented sort, or **last row wins**); document the chosen rule in code comments and here when implemented.

### Script Properties (documented names — final names chosen at implementation)

| Property | Purpose |
| --- | --- |
| `AUTH_SPREADSHEET_ID` | Spreadsheet ID containing the users tab. |
| `AUTH_USERS_SHEET_NAME` | Tab name (default `Users` if unset). |
| `AUTH_COL_EMAIL` | Optional; default `Email`. |
| `AUTH_COL_ROLE` | Optional; default `Role`. |
| `AUTH_COL_TEAM` | Optional; default `Team`. |
| `AUTH_COL_FIBERY_ACCESS` *(v1.15.0)* | Optional; default `fibery_access`. Header lookup for the per-user Fibery-access gate. When the header is absent, `getAuthorizationForActiveUser_()` MUST emit a one-time `console.warn` and treat every user as `fiberyAccess = false`. |

## Operations

- **Queries**: `SpreadsheetApp.openById` + `getSheetByName` + `getDataRange().getValues()` (or bounded range after header detection); **batch read once** per request; avoid per-row `getValue` loops.
- **Actions**: None in v1 (read-only authorization source).

## Edge Cases

- **Empty email** (anonymous / wrong execute-as mode): treat as **unauthorized**; log safely for admin.
- **Sheet missing / wrong ID / no access**: fail closed; admin sees execution error; user sees safe page per AC.
- **Header row mismatch** (column not found): fail closed or unauthorized; log column name expected.
- **Very large user lists**: document max rows or implement **CacheService** keyed by email with short TTL (e.g. 60–300s) to reduce quota — optional follow-up if performance requires it.
- **Concurrent edits**: next request picks up new rows; no real-time push required in v1.

## Verification Steps

1. Create a test spreadsheet with tab **`Users`**, headers `Email`, `Role`, `Team`, and one row for your test account.
2. Set **`AUTH_SPREADSHEET_ID`** (and tab override if not `Users`) in Script Properties; deploy Web App as **User accessing the web app**.
3. Open **`/exec`** as the listed user: expect **dashboard**; confirm **role** and **team** in server logs or UI if surfaced.
4. Remove your email row (or use a different browser account): expect **not authorized** page only.
5. Temporarily clear `AUTH_SPREADSHEET_ID`: expect **fail-closed** behavior per AC-11.
6. From browser console, attempt `google.script.run.getDashboardNavigation()` as unauthorized user: expect denial / safe error per AC-12.

## Implementation Checklist

- [x] Document final Script Property names in this file (`AUTH_SPREADSHEET_ID`, `AUTH_USERS_SHEET_NAME`, optional column overrides).
- [x] Implement `getAuthorizationForActiveUser_()` in `src/authUsersSheet.js` and `requireAuthForApi_()`.
- [x] Implement `NotAuthorized.html` + `doGet` branch in `src/Code.js`.
- [x] Wire `getDashboardNavigation` to **re-check** via `requireAuthForApi_()`.
- [x] Remove legacy **`filterNavItemsForUser_`** domain-only stub; authorized users receive the full nav catalog from `buildNavigationModel_`.
- [ ] Manual verification (steps above) on a deployed Web App + `clasp push`.

## Execution Plan

| Phase | What | Outcome |
| --- | --- | --- |
| **1. Contract freeze** | Confirm tab name, column headers, uniqueness rule, and Script Property keys with ops. | No ambiguous column mapping at cutover. |
| **2. Sheet reader module** | Add pure helper: open spreadsheet by ID, read users tab, build header → index map, find email, return role/team or null. | Unit-testable logic (manual runs in Apps Script editor). |
| **3. doGet gate** | Call helper first; unauthorized → `HtmlService.createHtmlOutputFromFile('NotAuthorized')` with same meta/title policy; authorized → existing `DashboardShell` flow; pass `role`/`team` into template if needed. | Single entry point enforced. |
| **4. Client API hardening** | Wrap `getDashboardNavigation` (and future handlers) with the same check; on failure throw `Script` error or return `{ error: '…' }` per project convention (prefer throw to avoid UI silently showing empty nav). | AC-12 satisfied. |
| **5. UX + ops** | Style `NotAuthorized.html` to match harpin dark theme; add one-line “contact your administrator” copy. | Coherent brand on denial path. |
| **6. Decommission stub** | Replace email-domain-only nav filtering with **role/team**-driven rules as follow-up tasks, or minimal “all listed users see same nav” until feature 003. | No conflicting RBAC sources. |

### Follow-up (separate features)

- **Nav and dashboards by role/team** (hide Agreement Dashboard for certain teams, etc.).
- **Caching** authorization results with invalidation strategy.
- **Admin audit tab** append-only log of denied access attempts (PII-safe).

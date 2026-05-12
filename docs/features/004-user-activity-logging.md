# Feature: User activity logging (User Activity tab)

> **PRD version 1.9.2** — see `docs/FOS-Dashboard-PRD.md` (`§3.8`, **FR-60–FR-66**, **NFR-08**, **AC-15–AC-17**).

## Goal

Log every authorized **page request** the FOS Dashboard handles — initial Web App load (`doGet`) plus in-app dashboard switches and refresh actions — to a new **`User Activity`** tab inside the **Users** spreadsheet (`AUTH_SPREADSHEET_ID`). The activity tab is the basis for later usage reporting (who is using the dashboard, which views, how often). Logging is **append-only**, **server-authoritative** (the client cannot forge email/role/team), and **graceful** (a logging failure must never break the user experience).

## User Stories

- As an **admin / ops owner**, I want a **single Sheet tab** that records every dashboard page request (timestamp, user, role, team, route) so I can later report on dashboard adoption per team and per view.
- As a **product owner**, I want the **same email/role/team** that authorization already resolves to be stored alongside each event so reports don't need to re-join against the Users tab.
- As an **authorized user**, I want navigation to feel instant — **logging must be fire-and-forget** and must never delay a panel switch or block on the spreadsheet.
- As an **unauthorized visitor**, I want **no activity row** written for me — the not-authorized page must not generate dashboard usage data.
- As an **admin**, I want a **kill-switch** Script Property so I can disable logging immediately (without a deploy) if quota or PII concerns require it.

## Acceptance Criteria (testable)

- [ ] **Given** `AUTH_SPREADSHEET_ID` is set, the `User Activity` tab exists with the documented headers, and `USER_ACTIVITY_LOGGING_ENABLED` is unset or `true`, **when** an authorized user opens the Web App, **then** a row appears in `User Activity` with `Event Type = page_load`, the user's **Email**, **Role**, **Team**, a server-set ISO **Timestamp**, and `Route = doGet`.
- [ ] **Given** the conditions above, **when** the user clicks **Home**, **Finance**, **Operations**, or **Delivery** in the sidebar, **then** a row is appended with `Event Type = nav_view` and `Route` equal to the nav id of the clicked entry (e.g. `finance`).
- [ ] **Given** the user is on the **Finance** panel and clicks the agreement-dashboard **Refresh** control, **when** the click completes, **then** a row is appended with `Event Type = refresh` and `Route = finance`.
- [ ] **Given** an **unauthorized** session, **when** the visitor lands on the Web App, **then** **no** row is written to the `User Activity` tab (the `NotAuthorized.html` path does not log).
- [ ] **Given** an unauthorized session, **when** the visitor invokes `google.script.run.logUserActivity({...})` directly from the browser console, **then** the handler throws / returns the same `NOT_AUTHORIZED` shape used elsewhere and **no row is written**.
- [ ] **Given** `USER_ACTIVITY_LOGGING_ENABLED` is set to `false`, **when** any of the above events occur, **then** no rows are written and the UI continues to function normally (no banners, no client errors).
- [ ] **Given** the `User Activity` tab is **missing** from the spreadsheet, **when** events occur, **then** the user sees no error, no row is written, and a single Apps Script `console.warn` (or `Logger.log`) line per process surface explains the missing tab.
- [ ] **Given** repeated nav clicks within `< 250ms` on the same `Route`, **when** the client throttles them, **then** only one `nav_view` row is appended for that burst (debounce contract documented below).
- [ ] **Given** a row is appended, **when** an admin inspects the sheet, **then** no row contains Fibery tokens, Script Property keys, or any field captured from form inputs (FR-66 / NFR-08 enforced by code review and the schema below).

## UI Notes

- **No new visible UI** for end users. Logging is purely a server-side side-effect of existing nav and refresh interactions.
- **Components to edit**:
  - `src/Code.js` — `doGet` calls `recordPageLoad_(auth)` after successful authorization (best-effort, swallowed errors); expose `logUserActivity(event)` re-export (or import) so the client can call it via `google.script.run`.
  - `src/DashboardShell.html` — generate a per-tab **Session ID** in `sessionStorage` (key `fos_session_id_v1`), forward `userAgent` and `sessionId` on every nav click and on the agreement-dashboard **Refresh** click, fire-and-forget via `google.script.run.logUserActivity(...)`. No UI loading state; no error banner on logging failure.
- **Components to create**:
  - `src/userActivityLog.js` — pure module: header constants, `logUserActivity(event)`, `recordPageLoad_(auth, requestMeta)`, `appendActivityRow_(values)`, `getUserActivitySheetOrNull_()`, `truncate_(s, max)`, `safeEventType_(s)`, `normalizeRoute_(s)`.
- **Settings panel**: out of scope (Settings is still the “Coming soon” placeholder per feature 001).

## Data Model

### Spreadsheet: `User Activity` tab (v1 contract)

| Column (default name) | Required | Source | Notes |
| --- | --- | --- | --- |
| **Timestamp** | Yes | Server (`new Date().toISOString()`) | ISO 8601 UTC; never client-supplied. |
| **Email** | Yes | Server (`Session.getActiveUser().getEmail()`) | Trimmed; case preserved as returned by Google. |
| **Role** | Yes | Server (Users-tab lookup snapshot) | Empty string if the row no longer matches (event still drops by FR-64). |
| **Team** | Yes | Server (Users-tab lookup snapshot) | Same as above. |
| **Event Type** | Yes | Server-validated enum | One of: `page_load`, `nav_view`, `refresh`, `server_call`. Unknown values → coerced to `server_call` and a warning logged. |
| **Route** | Yes (for nav/refresh) | Server-normalized | Lowercase token from a server-side allowlist (e.g. `home`, `finance`, `operations`, `delivery`, `doGet`); arbitrary client strings are sanitized to `[a-z0-9_\-]{1,40}`. |
| **Label** | No | Client | Short context (≤ 120 chars). Free text but bounded; do not include form input contents. |
| **Session ID** | No | Client (`sessionStorage`) | Random ID generated client-side (e.g. `crypto.randomUUID()` with fallback). Best-effort; empty allowed. |
| **User Agent** | No | Client | Truncated to ≤ 200 chars server-side. Empty for server-initiated `page_load`/`server_call`. |

- **Header row**: row 1; data appended from row 2 downward.
- **Header detection**: code resolves columns by **header name** (same case-insensitive helper as `authUsersSheet.js`), not by hard-coded column index. Adding columns later (or reordering) is backward compatible as long as the headers exist.
- **Tab creation**: out of scope for v1. The tab is created **by ops** in the same spreadsheet as the Users tab. The code reads but does not create the tab; if missing, see "Edge Cases."

### Script Properties (new)

| Property | Default | Purpose |
| --- | --- | --- |
| `AUTH_USER_ACTIVITY_SHEET_NAME` | `User Activity` | Tab name override. Trimmed; empty falls back to default. |
| `USER_ACTIVITY_LOGGING_ENABLED` | `true` | Kill switch. Values `false`, `no`, `0` (case-insensitive) disable all writes. Anything else (including unset) → enabled. |

The existing `AUTH_SPREADSHEET_ID` is reused; no new spreadsheet handle is introduced.

### Client event payload (over `google.script.run`)

```text
{
  eventType: 'nav_view' | 'refresh' | 'server_call',
  route: string,          // sanitized server-side, e.g. 'finance'
  label?: string,         // optional, ≤ 120 chars
  sessionId?: string,     // sessionStorage 'fos_session_id_v1'
  userAgent?: string      // navigator.userAgent (truncated server-side)
}
```

Constraints on this payload:

- The client **does not** send `email`, `role`, `team`, or `timestamp`. Those are filled server-side and are the source of truth (FR-64).
- The server ignores any client-supplied `email/role/team/timestamp` fields if present (defense-in-depth).

## Operations

### Queries

- **Open spreadsheet**: `SpreadsheetApp.openById(AUTH_SPREADSHEET_ID)` (already opened by `getAuthorizationForActiveUser_()` — consider memoizing within a single request if perf is an issue, but v1 may open twice for simplicity).
- **Resolve tab**: `ss.getSheetByName(AUTH_USER_ACTIVITY_SHEET_NAME || 'User Activity')`.
- **Resolve headers**: read `sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]`; map header → index using `findHeaderIndex_` from `authUsersSheet.js` (extract to a shared helper file if reused widely).

### Actions

- **Append row**: build a `Array` aligned to the resolved header order; call `sheet.appendRow(values)` inside a `LockService.getScriptLock()` `tryLock(2000)` block. Release the lock in `finally`. On lock-acquisition failure: `console.warn` and drop the event (FR-65). **Do not** use `LockService.getDocumentLock()` — the FOS Dashboard is a standalone Apps Script project (not bound to the Users spreadsheet), so `getDocumentLock()` returns `null` and any `tryLock` call on it throws a `TypeError` that surfaces as a spurious "lock timeout, dropping page_load/doGet" warning on the very first row.
- **No batching** in v1. If quota issues appear later, introduce an in-memory queue + `CacheService` buffer flushed by a time-driven trigger (deferred follow-up).

### `doGet` hook

- After `getAuthorizationForActiveUser_()` returns `{ ok: true, ... }`, but **before** rendering the dashboard, call `recordPageLoad_(auth)`.
  - `recordPageLoad_` wraps the append call in `try/catch`; **never** throws back to `doGet`.
  - `Route = 'doGet'`, `Event Type = 'page_load'`, `Label = ''`, `Session ID = ''`, `User Agent = ''` (the browser UA is not available server-side; if needed later, capture it on the very first client `nav_view` after page load).

### Client wiring

- `DashboardShell.html` script block:
  - On `init()`: read/create `sessionStorage.getItem('fos_session_id_v1')`, with `crypto.randomUUID()` (fallback: `Date.now()` + `Math.random()`).
  - Define `logActivity_(eventType, route, label)` helper that wraps `google.script.run.withFailureHandler(noop).withSuccessHandler(noop).logUserActivity({ ... })` with the cached `sessionId` + truncated `navigator.userAgent`.
  - Wire `logActivity_('nav_view', item.id)` into `onNavClick(item)` (after the route is decided, before/alongside showing the panel).
  - Wire `logActivity_('refresh', 'finance')` into the agreement-dashboard refresh-button click handler.
  - **Throttle**: in `logActivity_`, ignore a call if the same `(eventType, route)` was logged < 250 ms ago (in-memory `lastLogged` map). The throttle prevents accidental double-fires (e.g. fast double-clicks).

## Edge Cases

- **Empty active-user email**: `getAuthorizationForActiveUser_()` already returns `{ ok: false, reason: 'NO_EMAIL' }` → unauthorized branch → no row (consistent with AC).
- **`AUTH_SPREADSHEET_ID` missing**: same fail-closed path as feature 002 → unauthorized page → no row.
- **`User Activity` tab missing**: `getUserActivitySheetOrNull_()` returns `null`; logger emits one `console.warn` per execution; dashboard continues to render.
- **Header row missing / column not found**: log a warning and skip the write. Do not auto-repair the sheet in v1 — operators own the headers.
- **`LockService` timeout**: drop the event; warn-log. Acceptable because the activity log is an at-most-once analytics signal, not a transactional record.
- **Concurrent writes**: `appendRow` under a document lock is safe; ordering is best-effort by timestamp (multiple users in the same second may not be strictly ordered by lock-acquisition).
- **Anonymous nav clicks**: not possible — the SPA shell only renders for authorized sessions; the server handler re-checks auth on every call (FR-64).
- **Refresh-failure event** (server `getAgreementDashboardData` errors): not logged in v1; only the user-initiated **click** is logged. Server-side connector errors continue to flow through operational logs per FR-40.
- **Large free-text Label**: server-side truncate to 120 chars; reject (drop with warn) if it contains control characters that would corrupt the Sheet row.
- **Spreadsheet quota / 5xx**: the `try/catch` around the append swallows the error and warns; no user impact.

## Verification Steps

1. In the spreadsheet identified by `AUTH_SPREADSHEET_ID`, add a tab named **`User Activity`** with headers (exact spelling, row 1): `Timestamp`, `Email`, `Role`, `Team`, `Event Type`, `Route`, `Label`, `Session ID`, `User Agent`.
2. Ensure `USER_ACTIVITY_LOGGING_ENABLED` is **unset** (or `true`) in Script Properties.
3. `clasp push` and open the deployed Web App URL as an authorized user.
4. Confirm a new row appears in `User Activity` with `Event Type = page_load`, `Route = doGet`, your email, role, and team.
5. Click **Finance** in the sidebar; confirm a `nav_view` / `finance` row appears with a non-empty `Session ID` and your browser's `User Agent`.
6. Click **Refresh** on the agreement dashboard; confirm a `refresh` / `finance` row appears.
7. Click **Operations** and **Delivery**; confirm `nav_view` rows with the matching routes.
8. Open the Web App in a different browser as a user **not** on the Users tab; confirm the `NotAuthorized` page renders and **no** rows are appended.
9. From the unauthorized browser console, run `google.script.run.withFailureHandler(console.log).logUserActivity({eventType:'nav_view', route:'home'})` and confirm a `NOT_AUTHORIZED` error is returned and **no** rows are appended.
10. Set `USER_ACTIVITY_LOGGING_ENABLED = false` in Script Properties; reload the dashboard as an authorized user; confirm dashboard works normally and **no new rows** appear during a full nav exercise.
11. Set `USER_ACTIVITY_LOGGING_ENABLED` back to `true` (or delete it) before closing the verification session.

## Implementation Checklist

- [ ] Confirm with ops the exact header spellings and tab name; create the `User Activity` tab in the production / dev spreadsheets.
- [ ] Add Script Properties `AUTH_USER_ACTIVITY_SHEET_NAME` (optional override) and `USER_ACTIVITY_LOGGING_ENABLED` (optional override) to the deployment runbook.
- [x] ~~Extract `findHeaderIndex_` from `authUsersSheet.js` into a shared helper~~ — Apps Script globals: `userActivityLog.js` reuses the existing `findHeaderIndex_` directly (no extraction needed).
- [x] Create `src/userActivityLog.js` with `logUserActivity(event)`, `recordPageLoad_(auth)`, `writeActivityRow_(...)`, `getUserActivitySheetOrNull_()`, `isActivityLoggingEnabled_()`, `truncate_`, `safeEventType_`, `normalizeRoute_`, `activityWarn_`.
- [x] Update `src/Code.js`:
  - In `doGet`, after a successful `getAuthorizationForActiveUser_()`, call `recordPageLoad_(auth)` inside a `try/catch` (swallow + `console.warn`).
  - `logUserActivity` is a top-level function in `userActivityLog.js` and is therefore in the Apps Script global namespace; `google.script.run.logUserActivity(...)` resolves without further wiring.
- [x] Update `src/DashboardShell.html`:
  - Add `sessionStorage` session-ID generation (key `fos_session_id_v1`) via `getOrCreateSessionId()`.
  - Add `logActivity_(eventType, route, label)` helper with the 250 ms same-route throttle (`activityLastSent` map + `ACTIVITY_THROTTLE_MS`).
  - Called from `onNavClick(item)` (every nav click — Home/Finance/Operations/Delivery) and from the agreement-dashboard refresh button click handler.
  - Failures wired through `withFailureHandler(noop)` (no UI banner; outer `try/catch` swallows transport errors too).
- [x] `activityWarn_` in `userActivityLog.js` captures `(reason, error message)` to `console.warn` when the tab/headers are misconfigured or `appendRow` fails, so admins can self-diagnose without exposing details to end users.
- [ ] Manual verification per steps above on a deployed Web App.
- [ ] Commit message: `feat(activity): log page requests to User Activity tab (FR-60–FR-66)`.

## Execution Plan

| Phase | What | Outcome |
| --- | --- | --- |
| **1. Contract freeze** | Confirm tab name, header spellings, event vocabulary, and Script Property keys with ops; create the sheet tab in dev. | No ambiguous header mapping at cutover. |
| **2. Server helper** | Implement `src/userActivityLog.js` (open spreadsheet, resolve tab, header-indexed append under `LockService`, kill-switch + missing-tab guards). Unit-test via Apps Script editor. | Reusable, side-effect-only module. |
| **3. `doGet` hook** | Wire `recordPageLoad_` into `Code.js` after successful auth. Verify a single `page_load` row appears on Web App load. | Server-authoritative `page_load` events. |
| **4. Client wiring** | Add session-ID, `logActivity_` helper, and 250 ms throttle to `DashboardShell.html`; emit `nav_view` on every panel switch and `refresh` on the agreement-dashboard refresh button. | `nav_view` / `refresh` rows for in-app activity. |
| **5. Kill-switch + edge-case sweep** | Confirm `USER_ACTIVITY_LOGGING_ENABLED=false` short-circuits all writes; confirm missing-tab path warns but does not break; confirm unauthorized callers cannot log. | Safe to deploy with one Script Property toggle. |
| **6. Verify + document** | Run the verification steps end-to-end on a deployed Web App; tick the AC boxes in this file; cross-link the change row in `docs/FOS-Dashboard-PRD.md` (v1.6). | Stakeholders can run the first usage report off the `User Activity` tab. |

### Follow-up (separate features)

- **Reporting view**: A read-only Apps Script or Sheet view that summarizes activity per user / team / route over a date range. This feature only ships the **raw** log.
- **Retention / rotation**: Time-driven trigger to archive rows older than N days into a yearly tab (or Drive CSV). Document retention policy in the PRD when adopted.
- **Server-side `server_call` events**: Decide which privileged handlers (e.g. `getAgreementDashboardData`, future Fibery readers) should also write a `server_call` row. Out of scope for v1 to keep the row volume predictable.
- **Throttle policy**: If quota becomes a concern, swap the per-event append for a `CacheService`-buffered queue flushed every 1–5 minutes by a time-driven trigger.
- **`Active = Y/N` flag on the Users tab** (foreshadowed in feature 002): once added, snapshot it on each activity row so reports can distinguish historical-active vs. currently-active users.

# App Versions registry (auth spreadsheet)

> **PRD version 2.4.0** — see `docs/FOS-Dashboard-PRD.md` (**FR-108**, **AC-64**). Builds on [002 — Spreadsheet user authorization](002-spreadsheet-user-authorization.md).

## Goal

Track **PRD / deployment versions** in the same spreadsheet as user authorization (`AUTH_SPREADSHEET_ID`), so operators know which Web App URL is current and users see when they are on an **older deployment**.

## Status

**Delivered v2.4.0**

## User stories

- As an **ADMIN**, I want a central **App Versions** tab listing each release with date, description, version, and deployment URL, so I can point users to the correct `/exec` link.
- As an **ADMIN**, I want each new deployment to **register itself** automatically the first time it runs, so I only fill in the **URL** column afterward.
- As an **authorized user**, I want a clear **update available** notice when my deployment is behind the latest PRD version in the registry.
- As an **ADMIN**, I want to see the full registry read-only in **Settings**, so I can confirm what the app sees without opening the spreadsheet.

## Spreadsheet tab: `App Versions`

| Column | Required | Notes |
|--------|----------|--------|
| **Released At** | Yes | ISO timestamp; server sets on auto-register. |
| **Description** | Yes | Brief release note; from `FOS_RELEASE_DESCRIPTION` in `Code.js` on auto-register. |
| **PRD Version** | Yes | Semver `MAJOR.MINOR.PATCH` (e.g. `2.4.0`). |
| **URL** | No (initially empty) | Full Web App `/exec` URL for that deployment — **filled in by admin**. |

- **Tab name:** default **`App Versions`**; override with Script Property **`AUTH_APP_VERSIONS_SHEET_NAME`**.
- **Header row:** row 1 (names resolved case-insensitively like other auth tabs).
- **Latest version:** highest semver among rows with a **PRD Version** value.
- **Historical rows:** add manually for past releases (2.3.0, 2.2.0, …) with URLs; only the **running** version is auto-appended when missing.

## Server behavior

| API / hook | Behavior |
|------------|----------|
| `syncCurrentAppVersionToCatalog_()` | On authorized `doGet`, if `FOS_PRD_VERSION` is not in the sheet, **append** one row (URL blank). Uses `LockService`. |
| `getAppVersionStatus()` | Authorized `google.script.run`; syncs then returns compare result + full `releases[]`. |
| `getFosPrdVersion_()` / `getFosReleaseDescription_()` | From `Code.js` constants (update both on every release). |

### View-model (`getAppVersionStatus`)

```javascript
{
  ok: true,
  catalogAvailable: true,
  currentVersion: '2.3.0',
  currentDescription: '…',
  latestVersion: '2.4.0',
  isLatest: false,
  latestUrl: 'https://script.google.com/.../exec',
  latestDescription: '…',
  latestReleasedAt: '2026-05-16T…',
  releases: [ { releasedAt, description, prdVersion, url }, … ]
}
```

## Client behavior

| Surface | Behavior |
|---------|----------|
| **Top bar banner** | Shown when `!isLatest` and catalog available; link to `latestUrl` when set. |
| **Sidebar footer** | `PRD v{current}`; link or hint when newer version exists. |
| **Settings (ADMIN)** | Collapsible **App versions (registry)** table (read-only). |
| **Activity** | `app_version_update_click` when user follows upgrade link. |

## Release process (operators)

1. Bump `FOS_PRD_VERSION` and `FOS_RELEASE_DESCRIPTION` in `src/Code.js` (and PRD / headers per project rules).
2. Deploy Web App (`clasp push` + new deployment version in Apps Script).
3. Open the app once (or wait for first user) — row appears on **App Versions** with empty **URL**.
4. Paste the new deployment **`/exec` URL** into the **URL** column for that version.
5. Optionally add rows for older versions with their historical URLs.

## Acceptance criteria

- [x] **App Versions** tab with required headers; missing tab → graceful message, app still loads.
- [x] First `doGet` on a new `FOS_PRD_VERSION` appends one row if version absent.
- [x] User on older semver sees update banner; user on latest does not.
- [x] ADMIN Settings shows registry table.
- [x] `app_version_update_click` logged when upgrade link used.

## Files

| File | Role |
|------|------|
| `src/appVersionsCatalog.js` | Read/write catalog, `getAppVersionStatus` |
| `src/Code.js` | `FOS_PRD_VERSION`, `FOS_RELEASE_DESCRIPTION`, `doGet` sync |
| `src/DashboardShell.html` | Banner, sidebar, Settings table |
| `src/adminSettingsRegistry.js` | `AUTH_APP_VERSIONS_SHEET_NAME` setting |
| `src/userActivityLog.js` | Whitelist `app_version_update_click` |

## Related

- [Implementation plan](013-app-versions-registry-implementation-plan.md)

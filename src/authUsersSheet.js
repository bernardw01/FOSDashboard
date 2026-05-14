/**
 * PRD version 1.27.1 — sync with docs/FOS-Dashboard-PRD.md
 *
 * Spreadsheet-backed user authorization (Users tab).
 * Script Properties: AUTH_SPREADSHEET_ID (required), AUTH_USERS_SHEET_NAME (default Users),
 * AUTH_COL_EMAIL, AUTH_COL_ROLE, AUTH_COL_TEAM (defaults Email, Role, Team),
 * AUTH_COL_FIBERY_ACCESS (default `fibery_access`).
 *
 * The `fibery_access` column is OPTIONAL. When the header is missing the whole
 * deployment is treated as "no Fibery access for anyone" (deny by default).
 * Blank / unrecognized cells also resolve to `false`. Recognized truthy values:
 * `true`, `TRUE`, `yes`, `y`, `1`, and JavaScript / Sheets boolean `true`.
 */

/**
 * Resolves the active user against the configured Users sheet.
 * First matching data row wins (row index ascending).
 * @return {{ ok: true, email: string, role: string, team: string, fiberyAccess: boolean }|{ ok: false, reason: string, email?: string }}
 */
function getAuthorizationForActiveUser_() {
  var emailRaw = Session.getActiveUser().getEmail();
  var email = (emailRaw || '').trim();
  if (!email) {
    return { ok: false, reason: 'NO_EMAIL' };
  }

  var props = PropertiesService.getScriptProperties();
  var spreadsheetId = (props.getProperty('AUTH_SPREADSHEET_ID') || '').trim();
  if (!spreadsheetId) {
    return { ok: false, reason: 'MISSING_CONFIG', email: email };
  }

  var sheetName = (props.getProperty('AUTH_USERS_SHEET_NAME') || 'Users').trim() || 'Users';
  var colEmail = (props.getProperty('AUTH_COL_EMAIL') || 'Email').trim() || 'Email';
  var colRole = (props.getProperty('AUTH_COL_ROLE') || 'Role').trim() || 'Role';
  var colTeam = (props.getProperty('AUTH_COL_TEAM') || 'Team').trim() || 'Team';
  var colFiberyAccess = (props.getProperty('AUTH_COL_FIBERY_ACCESS') || 'fibery_access').trim() || 'fibery_access';

  try {
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return { ok: false, reason: 'SHEET_ERROR', email: email };
    }

    var values = sheet.getDataRange().getValues();
    if (!values || values.length < 2) {
      return { ok: false, reason: 'NOT_LISTED', email: email };
    }

    var headers = values[0];
    var idxEmail = findHeaderIndex_(headers, colEmail);
    var idxRole = findHeaderIndex_(headers, colRole);
    var idxTeam = findHeaderIndex_(headers, colTeam);
    if (idxEmail < 0 || idxRole < 0 || idxTeam < 0) {
      return { ok: false, reason: 'SHEET_ERROR', email: email };
    }
    var idxFiberyAccess = findHeaderIndex_(headers, colFiberyAccess);
    if (idxFiberyAccess < 0) {
      // Deny by default when the column is absent. Log so operators see why
      // every user is gated.
      try {
        console.warn(
          'authUsersSheet: optional column "' + colFiberyAccess +
          '" not found in headers — Fibery access defaults to FALSE for all users.');
      } catch (_) {
        /* ignore */
      }
    }

    var needle = normalizeEmail_(email);
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var cell = row[idxEmail];
      if (normalizeEmail_(cell === null || cell === undefined ? '' : String(cell)) === needle) {
        var role = row[idxRole] === null || row[idxRole] === undefined ? '' : String(row[idxRole]).trim();
        var team = row[idxTeam] === null || row[idxTeam] === undefined ? '' : String(row[idxTeam]).trim();
        var fiberyAccess = idxFiberyAccess < 0 ? false : parseFiberyAccessCell_(row[idxFiberyAccess]);
        return { ok: true, email: email, role: role, team: team, fiberyAccess: fiberyAccess };
      }
    }
    return { ok: false, reason: 'NOT_LISTED', email: email };
  } catch (e) {
    return { ok: false, reason: 'SHEET_ERROR', email: email };
  }
}

/**
 * Parses a `fibery_access` sheet cell into a strict boolean. Truthy values:
 * JS / Sheets `true`, or string in {true, yes, y, 1} (case-insensitive after
 * trim). Everything else (blank, `false`, `0`, `no`, garbage) resolves to
 * `false` so a missing or accidentally-empty cell never grants access.
 *
 * @param {*} cell Raw cell value from `Range.getValues()`.
 * @return {boolean}
 * @private
 */
function parseFiberyAccessCell_(cell) {
  if (cell === true) return true;
  if (cell === false || cell === null || cell === undefined) return false;
  var s = String(cell).trim().toLowerCase();
  if (s === 'true' || s === 'yes' || s === 'y' || s === '1') {
    return true;
  }
  return false;
}

/**
 * @param {string} s
 * @return {string}
 */
function normalizeEmail_(s) {
  return String(s || '')
    .trim()
    .toLowerCase();
}

/**
 * Locates a column by title. Matching is intentionally forgiving:
 *
 *   1. Exact case-insensitive match (after trim) — `Email` ↔ `email`.
 *   2. Loose match: lowercase + strip non-alphanumeric — `Fibery Access`,
 *      `Fibery_Access`, `fibery-access`, `fiberyAccess` all match
 *      `fibery_access`.
 *
 * The loose pass is a defensive fallback. Operators editing the Users sheet
 * by hand frequently retitle columns with different separators, and the
 * deny-by-default behavior of the `fibery_access` gate meant a typo there
 * silently broke the "Open in Fibery" link for everyone (FR-88, v1.18.0).
 *
 * @param {Array} headers First sheet row.
 * @param {string} name Expected column title.
 * @return {number} Zero-based column index or -1.
 */
function findHeaderIndex_(headers, name) {
  var raw = String(name || '');
  var target = raw.trim().toLowerCase();
  var targetLoose = target.replace(/[^a-z0-9]/g, '');
  var looseHit = -1;
  for (var c = 0; c < headers.length; c++) {
    var h = headers[c];
    var label = h === null || h === undefined ? '' : String(h).trim().toLowerCase();
    if (label === target) {
      return c;
    }
    if (looseHit < 0 && targetLoose && label.replace(/[^a-z0-9]/g, '') === targetLoose) {
      looseHit = c;
    }
  }
  return looseHit;
}

/**
 * @return {{ ok: true, email: string, role: string, team: string, fiberyAccess: boolean }}
 */
function requireAuthForApi_() {
  var auth = getAuthorizationForActiveUser_();
  if (!auth.ok) {
    throw new Error('NOT_AUTHORIZED');
  }
  return auth;
}

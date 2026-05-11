/**
 * PRD version 1.6 — sync with docs/FOS-Dashboard-PRD.md
 *
 * Spreadsheet-backed user authorization (Users tab).
 * Script Properties: AUTH_SPREADSHEET_ID (required), AUTH_USERS_SHEET_NAME (default Users),
 * AUTH_COL_EMAIL, AUTH_COL_ROLE, AUTH_COL_TEAM (defaults Email, Role, Team).
 */

/**
 * Resolves the active user against the configured Users sheet.
 * First matching data row wins (row index ascending).
 * @return {{ ok: true, email: string, role: string, team: string }|{ ok: false, reason: string, email?: string }}
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

    var needle = normalizeEmail_(email);
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var cell = row[idxEmail];
      if (normalizeEmail_(cell === null || cell === undefined ? '' : String(cell)) === needle) {
        var role = row[idxRole] === null || row[idxRole] === undefined ? '' : String(row[idxRole]).trim();
        var team = row[idxTeam] === null || row[idxTeam] === undefined ? '' : String(row[idxTeam]).trim();
        return { ok: true, email: email, role: role, team: team };
      }
    }
    return { ok: false, reason: 'NOT_LISTED', email: email };
  } catch (e) {
    return { ok: false, reason: 'SHEET_ERROR', email: email };
  }
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
 * @param {Array} headers First sheet row.
 * @param {string} name Expected column title (case-insensitive).
 * @return {number} Zero-based column index or -1.
 */
function findHeaderIndex_(headers, name) {
  var target = String(name || '')
    .trim()
    .toLowerCase();
  for (var c = 0; c < headers.length; c++) {
    var h = headers[c];
    var label = h === null || h === undefined ? '' : String(h).trim().toLowerCase();
    if (label === target) {
      return c;
    }
  }
  return -1;
}

/**
 * @return {{ ok: true, email: string, role: string, team: string }}
 */
function requireAuthForApi_() {
  var auth = getAuthorizationForActiveUser_();
  if (!auth.ok) {
    throw new Error('NOT_AUTHORIZED');
  }
  return auth;
}

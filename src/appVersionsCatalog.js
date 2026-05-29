/**
 * PRD version 2.6.6 — sync with docs/FOS-Dashboard-PRD.md
 *
 * App Versions tab in the auth spreadsheet — tracks PRD releases and deployment URLs.
 * Feature 013.
 *
 * Script Properties:
 *   AUTH_APP_VERSIONS_SHEET_NAME (default 'App Versions')
 *
 * Public API:
 *   getAppVersionStatus() — compare running FOS_PRD_VERSION to catalog latest.
 *
 * Internal:
 *   syncCurrentAppVersionToCatalog_() — append row when current version is new.
 */

/** @const {string} */
var APP_VERSIONS_DEFAULT_SHEET_NAME_ = 'App Versions';

/** @const {string[]} */
var APP_VERSIONS_COLUMNS_ = ['Released At', 'Description', 'PRD Version', 'URL'];

/** @const {number} */
var APP_VERSIONS_LOCK_WAIT_MS_ = 2000;

/**
 * @return {GoogleAppsScript.Spreadsheet.Sheet|null}
 * @private
 */
function getAppVersionsSheetOrNull_() {
  var props = PropertiesService.getScriptProperties();
  var spreadsheetId = (props.getProperty('AUTH_SPREADSHEET_ID') || '').trim();
  if (!spreadsheetId) {
    appVersionsWarn_('AUTH_SPREADSHEET_ID not set', null);
    return null;
  }
  var name = (props.getProperty('AUTH_APP_VERSIONS_SHEET_NAME') || '').trim();
  if (!name) {
    name = APP_VERSIONS_DEFAULT_SHEET_NAME_;
  }
  try {
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      appVersionsWarn_('App Versions tab not found: ' + name, null);
      return null;
    }
    return sheet;
  } catch (e) {
    appVersionsWarn_('open spreadsheet failed', e);
    return null;
  }
}

/**
 * @param {*} raw
 * @return {number[]|null}
 * @private
 */
function parseSemverParts_(raw) {
  var s = String(raw == null ? '' : raw).trim();
  var m = s.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) {
    return null;
  }
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

/**
 * @param {string} a
 * @param {string} b
 * @return {number} negative if a < b
 * @private
 */
function compareSemver_(a, b) {
  var pa = parseSemverParts_(a);
  var pb = parseSemverParts_(b);
  if (!pa && !pb) {
    return String(a).localeCompare(String(b));
  }
  if (!pa) {
    return -1;
  }
  if (!pb) {
    return 1;
  }
  for (var i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) {
      return pa[i] < pb[i] ? -1 : 1;
    }
  }
  return 0;
}

/**
 * @param {!Array<!Object>} rows
 * @return {?{ prdVersion: string, releasedAt: string, description: string, url: string }}
 * @private
 */
function pickLatestAppVersionRow_(rows) {
  var best = null;
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!row.prdVersion) {
      continue;
    }
    if (!best || compareSemver_(row.prdVersion, best.prdVersion) > 0) {
      best = row;
    }
  }
  return best;
}

/**
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @return {{ ok: boolean, rows?: !Array<!Object>, reason?: string, message?: string }}
 * @private
 */
function readAppVersionsCatalog_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) {
    return { ok: true, rows: [] };
  }

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var idx = {
    releasedAt: findHeaderIndex_(headers, 'Released At'),
    description: findHeaderIndex_(headers, 'Description'),
    prdVersion: findHeaderIndex_(headers, 'PRD Version'),
    url: findHeaderIndex_(headers, 'URL'),
  };

  if (idx.prdVersion < 0) {
    return {
      ok: false,
      reason: 'HEADERS',
      message: 'App Versions tab is missing a PRD Version column.',
    };
  }

  var values = sheet.getRange(2, 1, lastRow, lastCol).getValues();
  var rows = [];
  for (var r = 0; r < values.length; r++) {
    var line = values[r];
    var versionRaw =
      idx.prdVersion >= 0 && line[idx.prdVersion] != null ? String(line[idx.prdVersion]).trim() : '';
    if (!versionRaw) {
      continue;
    }
    var releasedAt = '';
    if (idx.releasedAt >= 0 && line[idx.releasedAt] != null) {
      var ra = line[idx.releasedAt];
      if (ra instanceof Date && !isNaN(ra.getTime())) {
        releasedAt = ra.toISOString();
      } else {
        releasedAt = String(ra).trim();
      }
    }
    rows.push({
      releasedAt: releasedAt,
      description:
        idx.description >= 0 && line[idx.description] != null
          ? String(line[idx.description]).trim()
          : '',
      prdVersion: versionRaw,
      url: idx.url >= 0 && line[idx.url] != null ? String(line[idx.url]).trim() : '',
    });
  }

  rows.sort(function (a, b) {
    return compareSemver_(b.prdVersion, a.prdVersion);
  });

  return { ok: true, rows: rows };
}

/**
 * @param {string} version
 * @param {!Array<!Object>} rows
 * @return {boolean}
 * @private
 */
function catalogHasVersion_(version, rows) {
  var needle = String(version || '').trim();
  if (!needle) {
    return false;
  }
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].prdVersion || '').trim() === needle) {
      return true;
    }
  }
  return false;
}

/**
 * Appends the running deployment version when it is not yet listed.
 * Admin fills in the deployment URL in the sheet afterward.
 * @return {{ ok: boolean, appended?: boolean, reason?: string }}
 */
function syncCurrentAppVersionToCatalog_() {
  var sheet = getAppVersionsSheetOrNull_();
  if (!sheet) {
    return { ok: false, reason: 'SHEET_MISSING' };
  }

  var read = readAppVersionsCatalog_(sheet);
  if (!read.ok) {
    return { ok: false, reason: read.reason || 'READ_FAILED' };
  }

  var currentVersion = getFosPrdVersion_();
  if (catalogHasVersion_(currentVersion, read.rows || [])) {
    return { ok: true, appended: false };
  }

  var description = getFosReleaseDescription_();
  var nowIso = new Date().toISOString();

  var lock = LockService.getScriptLock();
  if (!lock) {
    appVersionsWarn_('getScriptLock returned null', null);
    return { ok: false, reason: 'LOCK_UNAVAILABLE' };
  }
  var acquired = false;
  try {
    acquired = lock.tryLock(APP_VERSIONS_LOCK_WAIT_MS_);
  } catch (e) {
    appVersionsWarn_('tryLock threw', e);
    acquired = false;
  }
  if (!acquired) {
    appVersionsWarn_('lock timeout, skip version append', null);
    return { ok: false, reason: 'LOCK_TIMEOUT' };
  }

  try {
    var reread = readAppVersionsCatalog_(sheet);
    if (reread.ok && catalogHasVersion_(currentVersion, reread.rows || [])) {
      return { ok: true, appended: false };
    }

    var lastCol = Math.max(sheet.getLastColumn(), APP_VERSIONS_COLUMNS_.length);
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    if (findHeaderIndex_(headers, 'PRD Version') < 0) {
      appVersionsWarn_('headers missing before append', null);
      return { ok: false, reason: 'HEADERS' };
    }

    var byName = {
      'Released At': nowIso,
      Description: description,
      'PRD Version': currentVersion,
      URL: '',
    };
    var row = new Array(headers.length);
    for (var c = 0; c < headers.length; c++) {
      var name = headers[c] === null || headers[c] === undefined ? '' : String(headers[c]).trim();
      row[c] = Object.prototype.hasOwnProperty.call(byName, name) ? byName[name] : '';
    }
    sheet.appendRow(row);
    return { ok: true, appended: true };
  } catch (e) {
    appVersionsWarn_('appendRow failed', e);
    return { ok: false, reason: 'APPEND_FAILED' };
  } finally {
    try {
      lock.releaseLock();
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * @return {!Object}
 */
function getAppVersionStatus() {
  requireAuthForApi_();
  try {
    syncCurrentAppVersionToCatalog_();
  } catch (e) {
    appVersionsWarn_('syncCurrentAppVersionToCatalog_ threw', e);
  }
  return buildAppVersionStatusPayload_();
}

/**
 * @return {!Object}
 * @private
 */
function buildAppVersionStatusPayload_() {
  var currentVersion = getFosPrdVersion_();
  var currentDescription = getFosReleaseDescription_();
  var sheet = getAppVersionsSheetOrNull_();
  if (!sheet) {
    return {
      ok: true,
      currentVersion: currentVersion,
      currentDescription: currentDescription,
      latestVersion: currentVersion,
      isLatest: true,
      latestUrl: '',
      latestDescription: currentDescription,
      releases: [],
      catalogAvailable: false,
      message: 'App Versions tab is not configured.',
    };
  }

  var read = readAppVersionsCatalog_(sheet);
  if (!read.ok) {
    return {
      ok: false,
      message: read.message || 'Could not read App Versions tab.',
      reason: read.reason,
      currentVersion: currentVersion,
      currentDescription: currentDescription,
    };
  }

  var rows = read.rows || [];
  var latest = pickLatestAppVersionRow_(rows);
  var latestVersion = latest ? latest.prdVersion : currentVersion;
  var isLatest = compareSemver_(currentVersion, latestVersion) >= 0;

  return {
    ok: true,
    catalogAvailable: true,
    currentVersion: currentVersion,
    currentDescription: currentDescription,
    latestVersion: latestVersion,
    isLatest: isLatest,
    latestUrl: latest && latest.url ? latest.url : '',
    latestDescription: latest ? latest.description : '',
    latestReleasedAt: latest ? latest.releasedAt : '',
    releases: rows,
  };
}

/**
 * @return {string}
 */
function getFosReleaseDescription_() {
  if (typeof FOS_RELEASE_DESCRIPTION !== 'undefined' && FOS_RELEASE_DESCRIPTION) {
    return String(FOS_RELEASE_DESCRIPTION).trim();
  }
  return '';
}

/**
 * @param {string} msg
 * @param {*} err
 * @private
 */
function appVersionsWarn_(msg, err) {
  try {
    if (err && err.message) {
      console.warn('App Versions: ' + msg + ': ' + err.message);
    } else {
      console.warn('App Versions: ' + msg);
    }
  } catch (_) {
    /* ignore */
  }
}

/**
 * Editor diagnostic — read catalog + sync state.
 * @return {!Object}
 */
function _diag_appVersionsCatalog() {
  var sync = syncCurrentAppVersionToCatalog_();
  var status = buildAppVersionStatusPayload_();
  console.log('sync →', JSON.stringify(sync));
  console.log('status →', JSON.stringify(status));
  return { sync: sync, status: status };
}

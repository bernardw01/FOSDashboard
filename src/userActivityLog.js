/**
 * PRD version 1.27.0 — sync with docs/FOS-Dashboard-PRD.md
 *
 * User activity logging — append-only event rows to the "User Activity" tab
 * in the Users spreadsheet (AUTH_SPREADSHEET_ID). Implements §3.8 / FR-60–FR-66.
 *
 * Script Properties:
 *   AUTH_USER_ACTIVITY_SHEET_NAME (default 'User Activity')
 *   USER_ACTIVITY_LOGGING_ENABLED (default 'true'; 'false' | 'no' | '0' disable)
 *
 * Public API:
 *   logUserActivity(event) — invokable via google.script.run; re-checks auth.
 *
 * Server-internal:
 *   recordPageLoad_(auth) — called from doGet after successful authorization.
 */

/** @const {string} */
var ACTIVITY_DEFAULT_SHEET_NAME_ = 'User Activity';

/**
 * Canonical column order for v1. Headers are resolved by name (case-insensitive)
 * so reordering or adding columns in the sheet stays backward compatible.
 * The first six are required; the last three are optional client-supplied fields.
 * @const {string[]}
 */
var ACTIVITY_COLUMNS_ = [
  'Timestamp',
  'Email',
  'Role',
  'Team',
  'Event Type',
  'Route',
  'Label',
  'Session ID',
  'User Agent',
];

/** @const {number} Count of required headers from the start of ACTIVITY_COLUMNS_. */
var ACTIVITY_REQUIRED_COLUMNS_COUNT_ = 6;

/** @const {Object<string, boolean>} Allowed Event Type values (FR-63). */
var ACTIVITY_VALID_EVENT_TYPES_ = {
  page_load: true,
  nav_view: true,
  refresh: true,
  server_call: true,
  labor_hours_week_change: true,
  labor_hours_export: true,
  labor_hours_kpi_nav: true,
  labor_hours_sort: true,
  labor_hours_refresh: true,
  revenue_review_refresh: true,
  revenue_review_sort: true,
  revenue_review_export: true,
  revenue_review_expand: true,
  revenue_review_kpi_nav: true,
  revenue_review_print: true,
  revenue_review_drawer_open: true,
  revenue_review_drawer_fibery_click: true,
};

/** @const {number} */
var ACTIVITY_MAX_LABEL_ = 120;

/** @const {number} */
var ACTIVITY_MAX_UA_ = 200;

/** @const {number} */
var ACTIVITY_MAX_SESSION_ID_ = 64;

/** @const {number} Script-lock acquisition wait per FR-65. */
var ACTIVITY_LOCK_WAIT_MS_ = 2000;

/** @const {number} Route length cap; matches feature doc sanitization rule. */
var ACTIVITY_MAX_ROUTE_ = 40;

/**
 * Client-callable: append one activity row for the active user.
 * Throws NOT_AUTHORIZED if the caller is not on the Users tab (FR-64).
 * All other failure modes return {ok:false,reason} so the client's
 * fire-and-forget handler never surfaces an error to end users.
 *
 * @param {{
 *   eventType?: string,
 *   route?: string,
 *   label?: string,
 *   sessionId?: string,
 *   userAgent?: string
 * }} event
 * @return {{ ok: boolean, reason?: string }}
 */
function logUserActivity(event) {
  var auth = requireAuthForApi_();
  if (!isActivityLoggingEnabled_()) {
    return { ok: false, reason: 'DISABLED' };
  }
  var payload = event && typeof event === 'object' ? event : {};
  return writeActivityRow_({
    email: auth.email,
    role: auth.role,
    team: auth.team,
    eventType: safeEventType_(payload.eventType),
    route: normalizeRoute_(payload.route),
    label: truncate_(payload.label, ACTIVITY_MAX_LABEL_),
    sessionId: truncate_(payload.sessionId, ACTIVITY_MAX_SESSION_ID_),
    userAgent: truncate_(payload.userAgent, ACTIVITY_MAX_UA_),
  });
}

/**
 * Server-internal: log a 'page_load' row for an authorized session.
 * Wraps all errors — never throws back to doGet.
 * @param {{ email: string, role: string, team: string }} auth
 */
function recordPageLoad_(auth) {
  try {
    if (!auth || !auth.email) {
      return;
    }
    if (!isActivityLoggingEnabled_()) {
      return;
    }
    writeActivityRow_({
      email: auth.email,
      role: auth.role || '',
      team: auth.team || '',
      eventType: 'page_load',
      route: 'doGet',
      label: '',
      sessionId: '',
      userAgent: '',
    });
  } catch (e) {
    activityWarn_('recordPageLoad_ failed', e);
  }
}

/**
 * @param {{
 *   email: string,
 *   role: string,
 *   team: string,
 *   eventType: string,
 *   route: string,
 *   label: string,
 *   sessionId: string,
 *   userAgent: string
 * }} fields
 * @return {{ ok: boolean, reason?: string }}
 * @private
 */
function writeActivityRow_(fields) {
  var sheet = getUserActivitySheetOrNull_();
  if (!sheet) {
    return { ok: false, reason: 'SHEET_MISSING' };
  }

  var headers;
  try {
    var lastCol = sheet.getLastColumn();
    if (lastCol < 1) {
      activityWarn_('User Activity: header row is empty', null);
      return { ok: false, reason: 'HEADERS' };
    }
    headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  } catch (e) {
    activityWarn_('User Activity: header read failed', e);
    return { ok: false, reason: 'HEADERS' };
  }

  for (var i = 0; i < ACTIVITY_REQUIRED_COLUMNS_COUNT_; i++) {
    if (findHeaderIndex_(headers, ACTIVITY_COLUMNS_[i]) < 0) {
      activityWarn_('User Activity: required header missing: ' + ACTIVITY_COLUMNS_[i], null);
      return { ok: false, reason: 'HEADERS' };
    }
  }

  var byName = {
    Timestamp: new Date().toISOString(),
    Email: fields.email || '',
    Role: fields.role || '',
    Team: fields.team || '',
    'Event Type': fields.eventType || '',
    Route: fields.route || '',
    Label: fields.label || '',
    'Session ID': fields.sessionId || '',
    'User Agent': fields.userAgent || '',
  };

  var row = new Array(headers.length);
  for (var c = 0; c < headers.length; c++) {
    var name = headers[c] === null || headers[c] === undefined ? '' : String(headers[c]).trim();
    row[c] = Object.prototype.hasOwnProperty.call(byName, name) ? byName[name] : '';
  }

  // Standalone Web App: use getScriptLock(). getDocumentLock() returns null
  // for non–container-bound scripts, which previously surfaced as a spurious
  // "lock timeout" warning on the very first page_load row.
  var lock = LockService.getScriptLock();
  if (!lock) {
    activityWarn_('User Activity: getScriptLock returned null', null);
    return { ok: false, reason: 'LOCK_UNAVAILABLE' };
  }
  var acquired = false;
  try {
    acquired = lock.tryLock(ACTIVITY_LOCK_WAIT_MS_);
  } catch (e) {
    activityWarn_('User Activity: tryLock threw', e);
    acquired = false;
  }
  if (!acquired) {
    activityWarn_('User Activity: lock timeout, dropping ' + fields.eventType + '/' + fields.route, null);
    return { ok: false, reason: 'LOCK_TIMEOUT' };
  }

  try {
    sheet.appendRow(row);
    return { ok: true };
  } catch (e) {
    activityWarn_('User Activity: appendRow failed', e);
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
 * @return {GoogleAppsScript.Spreadsheet.Sheet|null}
 * @private
 */
function getUserActivitySheetOrNull_() {
  var props = PropertiesService.getScriptProperties();
  var spreadsheetId = (props.getProperty('AUTH_SPREADSHEET_ID') || '').trim();
  if (!spreadsheetId) {
    activityWarn_('User Activity: AUTH_SPREADSHEET_ID not set', null);
    return null;
  }
  var name = (props.getProperty('AUTH_USER_ACTIVITY_SHEET_NAME') || '').trim();
  if (!name) {
    name = ACTIVITY_DEFAULT_SHEET_NAME_;
  }
  try {
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      activityWarn_('User Activity: tab not found: ' + name, null);
      return null;
    }
    return sheet;
  } catch (e) {
    activityWarn_('User Activity: open failed', e);
    return null;
  }
}

/**
 * @return {boolean}
 * @private
 */
function isActivityLoggingEnabled_() {
  var raw = (PropertiesService.getScriptProperties().getProperty('USER_ACTIVITY_LOGGING_ENABLED') || '')
    .trim()
    .toLowerCase();
  if (raw === 'false' || raw === 'no' || raw === '0') {
    return false;
  }
  return true;
}

/**
 * @param {*} s
 * @return {string} Canonical event type; unknown values coerced to 'server_call'.
 * @private
 */
function safeEventType_(s) {
  var v = String(s == null ? '' : s)
    .trim()
    .toLowerCase();
  if (ACTIVITY_VALID_EVENT_TYPES_[v]) {
    return v;
  }
  activityWarn_('User Activity: unknown eventType "' + v + '", coercing to server_call', null);
  return 'server_call';
}

/**
 * @param {*} s
 * @return {string} Lowercase, [a-z0-9_-]{1,40}; '' on rejection.
 * @private
 */
function normalizeRoute_(s) {
  var raw = String(s == null ? '' : s)
    .trim()
    .toLowerCase();
  if (!raw) {
    return '';
  }
  var cleaned = raw.replace(/[^a-z0-9_\-]/g, '').slice(0, ACTIVITY_MAX_ROUTE_);
  return cleaned;
}

/**
 * Strips control chars (FR-66) and clamps to max length.
 * @param {*} s
 * @param {number} max
 * @return {string}
 * @private
 */
function truncate_(s, max) {
  if (s == null) {
    return '';
  }
  var str = String(s).replace(/[\u0000-\u001F\u007F]/g, ' ');
  if (str.length > max) {
    return str.slice(0, max);
  }
  return str;
}

/**
 * @param {string} msg
 * @param {*} err
 * @private
 */
function activityWarn_(msg, err) {
  try {
    if (err && err.message) {
      console.warn(msg + ': ' + err.message);
    } else {
      console.warn(msg);
    }
  } catch (_) {
    /* console may be absent in some runtimes; fall back silently */
  }
}

/**
 * PRD version 2.26.1 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Notification Log sheet for Feature 033: email audit + in-app tray.
 *
 * Script Properties:
 *   NOTIFICATIONS_LOG_SHEET_NAME (default Notification Log)
 */

/** @const {string} */
var NOTIFICATION_LOG_DEFAULT_SHEET_ = 'Notification Log';

/** @const {string[]} */
var NOTIFICATION_LOG_COLUMNS_ = [
  'Id',
  'Timestamp',
  'Email',
  'CatalogIds',
  'AlertIds',
  'Frequency',
  'DigestKey',
  'Subject',
  'Summary',
  'DeepLink',
  'Status',
  'Dismissed',
  'DismissedAt',
];

/** @const {number} */
var NOTIFICATION_LOG_LOCK_WAIT_MS_ = 3000;

/**
 * @return {GoogleAppsScript.Spreadsheet.Sheet|null}
 */
function getNotificationLogSheetOrNull_() {
  var props = PropertiesService.getScriptProperties();
  var spreadsheetId = (props.getProperty('AUTH_SPREADSHEET_ID') || '').trim();
  if (!spreadsheetId) {
    return null;
  }
  var name =
    (props.getProperty('NOTIFICATIONS_LOG_SHEET_NAME') || '').trim() ||
    NOTIFICATION_LOG_DEFAULT_SHEET_;
  try {
    var ss = SpreadsheetApp.openById(spreadsheetId);
    return ss.getSheetByName(name);
  } catch (e) {
    try {
      console.warn('notificationLogStore: open failed: ' + (e && e.message ? e.message : e));
    } catch (_) {
      /* ignore */
    }
    return null;
  }
}

/**
 * @return {{ ok: boolean, message: string }}
 */
function ensureNotificationLogSheet() {
  var props = PropertiesService.getScriptProperties();
  var spreadsheetId = (props.getProperty('AUTH_SPREADSHEET_ID') || '').trim();
  if (!spreadsheetId) {
    return { ok: false, message: 'AUTH_SPREADSHEET_ID missing.' };
  }
  var name =
    (props.getProperty('NOTIFICATIONS_LOG_SHEET_NAME') || '').trim() ||
    NOTIFICATION_LOG_DEFAULT_SHEET_;
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(NOTIFICATION_LOG_COLUMNS_.slice());
    return { ok: true, message: 'Created sheet "' + name + '".' };
  }
  return { ok: true, message: 'Sheet "' + name + '" already exists.' };
}

/**
 * @param {!{
 *   email: string,
 *   catalogIds: !Array<string>,
 *   alertIds: !Array<string>,
 *   frequency: string,
 *   digestKey: string,
 *   subject: string,
 *   summary: string,
 *   deepLink: string,
 *   status: string
 * }} fields
 * @return {{ ok: boolean, id?: string }}
 */
function appendNotificationLogRow_(fields) {
  var sheet = getNotificationLogSheetOrNull_();
  if (!sheet) {
    return { ok: false };
  }
  var values = sheet.getDataRange().getValues();
  if (!values || !values.length) {
    return { ok: false };
  }
  var headers = values[0];
  for (var h = 0; h < NOTIFICATION_LOG_COLUMNS_.length; h++) {
    if (findHeaderIndex_(headers, NOTIFICATION_LOG_COLUMNS_[h]) < 0) {
      try {
        console.warn('notificationLogStore: missing header ' + NOTIFICATION_LOG_COLUMNS_[h]);
      } catch (_) {
        /* ignore */
      }
      return { ok: false };
    }
  }

  var id = Utilities.getUuid();
  var byName = {
    Id: id,
    Timestamp: new Date().toISOString(),
    Email: fields.email || '',
    CatalogIds: (fields.catalogIds || []).join(','),
    AlertIds: (fields.alertIds || []).join(','),
    Frequency: fields.frequency || '',
    DigestKey: fields.digestKey || '',
    Subject: fields.subject || '',
    Summary: fields.summary || '',
    DeepLink: fields.deepLink || '',
    Status: fields.status || 'sent',
    Dismissed: false,
    DismissedAt: '',
  };

  var row = new Array(headers.length);
  for (var c = 0; c < headers.length; c++) {
    var name = headers[c] === null || headers[c] === undefined ? '' : String(headers[c]).trim();
    row[c] = Object.prototype.hasOwnProperty.call(byName, name) ? byName[name] : '';
  }

  var lock = LockService.getScriptLock();
  if (!lock || !lock.tryLock(NOTIFICATION_LOG_LOCK_WAIT_MS_)) {
    return { ok: false };
  }
  try {
    sheet.appendRow(row);
    return { ok: true, id: id };
  } catch (e) {
    try {
      console.warn('notificationLogStore: append failed: ' + (e && e.message ? e.message : e));
    } catch (_) {
      /* ignore */
    }
    return { ok: false };
  } finally {
    try {
      lock.releaseLock();
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * @param {string} email
 * @param {string} digestKey
 * @param {string} alertId
 * @return {boolean}
 */
function notificationAlreadySent_(email, digestKey, alertId) {
  var sheet = getNotificationLogSheetOrNull_();
  if (!sheet) {
    return false;
  }
  var values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) {
    return false;
  }
  var headers = values[0];
  var idxEmail = findHeaderIndex_(headers, 'Email');
  var idxDigest = findHeaderIndex_(headers, 'DigestKey');
  var idxAlerts = findHeaderIndex_(headers, 'AlertIds');
  var idxStatus = findHeaderIndex_(headers, 'Status');
  if (idxEmail < 0 || idxDigest < 0 || idxAlerts < 0) {
    return false;
  }
  var needle = normalizeEmail_(email);
  var dig = String(digestKey || '');
  var alertNeedle = String(alertId || '');
  for (var r = 1; r < values.length; r++) {
    if (normalizeEmail_(String(values[r][idxEmail] || '')) !== needle) {
      continue;
    }
    if (String(values[r][idxDigest] || '') !== dig) {
      continue;
    }
    if (idxStatus >= 0 && String(values[r][idxStatus] || '').toLowerCase() !== 'sent') {
      continue;
    }
    var alerts = String(values[r][idxAlerts] || '');
    if (!alertNeedle) {
      return true;
    }
    var parts = alerts.split(',');
    for (var p = 0; p < parts.length; p++) {
      if (String(parts[p] || '').trim() === alertNeedle) {
        return true;
      }
    }
  }
  return false;
}

/**
 * @param {string} email
 * @param {{ includeDismissed?: boolean, limit?: number }=} opts
 * @return {!Array<!Object>}
 */
function listNotificationsForEmail_(email, opts) {
  opts = opts || {};
  var includeDismissed = opts.includeDismissed === true;
  var limit = opts.limit > 0 ? Math.min(200, opts.limit) : 50;
  var sheet = getNotificationLogSheetOrNull_();
  if (!sheet) {
    return [];
  }
  var values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) {
    return [];
  }
  var headers = values[0];
  var idx = {};
  for (var h = 0; h < NOTIFICATION_LOG_COLUMNS_.length; h++) {
    idx[NOTIFICATION_LOG_COLUMNS_[h]] = findHeaderIndex_(headers, NOTIFICATION_LOG_COLUMNS_[h]);
  }
  if (idx.Email < 0 || idx.Id < 0) {
    return [];
  }
  var needle = normalizeEmail_(email);
  var rows = [];
  for (var r = values.length - 1; r >= 1; r--) {
    if (normalizeEmail_(String(values[r][idx.Email] || '')) !== needle) {
      continue;
    }
    var dismissed = false;
    if (idx.Dismissed >= 0) {
      var d = values[r][idx.Dismissed];
      dismissed = d === true || String(d).toLowerCase() === 'true' || String(d) === 'TRUE';
    }
    if (dismissed && !includeDismissed) {
      continue;
    }
    var status = idx.Status >= 0 ? String(values[r][idx.Status] || '') : '';
    if (status && status.toLowerCase() !== 'sent') {
      continue;
    }
    rows.push({
      id: String(values[r][idx.Id] || ''),
      timestamp: idx.Timestamp >= 0 ? String(values[r][idx.Timestamp] || '') : '',
      subject: idx.Subject >= 0 ? String(values[r][idx.Subject] || '') : '',
      summary: idx.Summary >= 0 ? String(values[r][idx.Summary] || '') : '',
      deepLink: idx.DeepLink >= 0 ? String(values[r][idx.DeepLink] || '') : '',
      frequency: idx.Frequency >= 0 ? String(values[r][idx.Frequency] || '') : '',
      dismissed: dismissed,
      rowIndex: r + 1,
    });
    if (rows.length >= limit) {
      break;
    }
  }
  return rows;
}

/**
 * @param {string} email
 * @param {string} notificationId
 * @return {{ ok: boolean, message?: string }}
 */
function dismissNotificationForEmail_(email, notificationId) {
  var id = String(notificationId || '').trim();
  if (!id) {
    return { ok: false, message: 'Missing notification id.' };
  }
  var sheet = getNotificationLogSheetOrNull_();
  if (!sheet) {
    return { ok: false, message: 'Notification Log sheet not found.' };
  }
  var values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) {
    return { ok: false, message: 'Notification not found.' };
  }
  var headers = values[0];
  var idxId = findHeaderIndex_(headers, 'Id');
  var idxEmail = findHeaderIndex_(headers, 'Email');
  var idxDismissed = findHeaderIndex_(headers, 'Dismissed');
  var idxDismissedAt = findHeaderIndex_(headers, 'DismissedAt');
  if (idxId < 0 || idxEmail < 0 || idxDismissed < 0) {
    return { ok: false, message: 'Notification Log headers incomplete.' };
  }
  var needle = normalizeEmail_(email);
  var lock = LockService.getScriptLock();
  if (!lock || !lock.tryLock(NOTIFICATION_LOG_LOCK_WAIT_MS_)) {
    return { ok: false, message: 'Could not dismiss (lock busy).' };
  }
  try {
    values = sheet.getDataRange().getValues();
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][idxId] || '') !== id) {
        continue;
      }
      if (normalizeEmail_(String(values[r][idxEmail] || '')) !== needle) {
        return { ok: false, message: 'NOT_AUTHORIZED' };
      }
      sheet.getRange(r + 1, idxDismissed + 1).setValue(true);
      if (idxDismissedAt >= 0) {
        sheet.getRange(r + 1, idxDismissedAt + 1).setValue(new Date().toISOString());
      }
      return { ok: true };
    }
    return { ok: false, message: 'Notification not found.' };
  } finally {
    try {
      lock.releaseLock();
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * Client API.
 * @param {{ includeDismissed?: boolean, limit?: number }=} opts
 * @return {{ ok: boolean, notifications: !Array, undismissedCount: number }}
 */
function getMyNotifications(opts) {
  var auth = requireAuthForApi_();
  var list = listNotificationsForEmail_(auth.email, opts || {});
  var undismissed = 0;
  for (var i = 0; i < list.length; i++) {
    if (!list[i].dismissed) {
      undismissed++;
    }
  }
  return {
    ok: true,
    notifications: list,
    undismissedCount: undismissed,
  };
}

/**
 * Client API.
 * @param {string} notificationId
 * @return {{ ok: boolean, message?: string }}
 */
function dismissMyNotification(notificationId) {
  var auth = requireAuthForApi_();
  return dismissNotificationForEmail_(auth.email, notificationId);
}

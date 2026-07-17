/**
 * PRD version 2.26.2 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Profile JSON lives on the same **Users** auth tab used for authorization
 * (Feature 033). Column header default: **Profile** (overridable).
 *
 * Script Properties:
 *   AUTH_USERS_SHEET_NAME (default Users) - shared with authUsersSheet.js
 *   AUTH_COL_EMAIL (default Email)
 *   AUTH_COL_PROFILE (default Profile)
 */

/** @const {number} */
var USER_PROFILE_SCHEMA_VERSION_ = 1;

/** @const {number} */
var USER_PROFILE_LOCK_WAIT_MS_ = 5000;

/**
 * @return {!Object}
 */
function defaultUserProfileDoc_() {
  return {
    schemaVersion: USER_PROFILE_SCHEMA_VERSION_,
    updatedAt: null,
    notifications: {
      emailEnabled: false,
      timezone: notificationDefaultTimezone_(),
      subscriptions: [],
    },
    preferences: {},
  };
}

/**
 * @return {string}
 */
function notificationDefaultTimezone_() {
  var props = PropertiesService.getScriptProperties();
  var tz = (props.getProperty('NOTIFICATIONS_DEFAULT_TIMEZONE') || '').trim();
  return tz || 'America/Chicago';
}

/**
 * @return {string}
 */
function profileColumnHeaderName_() {
  var props = PropertiesService.getScriptProperties();
  return (props.getProperty('AUTH_COL_PROFILE') || 'Profile').trim() || 'Profile';
}

/**
 * @return {GoogleAppsScript.Spreadsheet.Sheet|null}
 */
function getUsersAuthSheetOrNull_() {
  var props = PropertiesService.getScriptProperties();
  var spreadsheetId = (props.getProperty('AUTH_SPREADSHEET_ID') || '').trim();
  if (!spreadsheetId) {
    return null;
  }
  var name = (props.getProperty('AUTH_USERS_SHEET_NAME') || 'Users').trim() || 'Users';
  try {
    var ss = SpreadsheetApp.openById(spreadsheetId);
    return ss.getSheetByName(name);
  } catch (e) {
    try {
      console.warn('userProfileStore: open Users sheet failed: ' + (e && e.message ? e.message : e));
    } catch (_) {
      /* ignore */
    }
    return null;
  }
}

/**
 * Migrates one Profile JSON document to the current schema.
 * @param {?Object} doc
 * @return {!Object}
 */
function migrateUserProfileJson_(doc) {
  var base = defaultUserProfileDoc_();
  if (!doc || typeof doc !== 'object') {
    return base;
  }
  var out = defaultUserProfileDoc_();
  var n = doc.notifications && typeof doc.notifications === 'object' ? doc.notifications : {};
  out.notifications.emailEnabled = n.emailEnabled === true;
  var tz = String(n.timezone || '').trim();
  out.notifications.timezone = tz || notificationDefaultTimezone_();
  out.notifications.subscriptions = normalizeProfileSubscriptions_(n.subscriptions);
  out.preferences =
    doc.preferences && typeof doc.preferences === 'object' ? doc.preferences : {};
  out.updatedAt = doc.updatedAt ? String(doc.updatedAt) : null;
  out.schemaVersion = USER_PROFILE_SCHEMA_VERSION_;
  return out;
}

/**
 * @param {*} raw
 * @return {!Array<!{ catalogId: string, enabled: boolean, frequency: string }>}
 */
function normalizeProfileSubscriptions_(raw) {
  if (!raw || !raw.length) {
    return [];
  }
  var out = [];
  var seen = {};
  for (var i = 0; i < raw.length; i++) {
    var s = raw[i];
    if (!s || typeof s !== 'object') {
      continue;
    }
    var catalogId = String(s.catalogId || '').trim();
    if (!catalogId || seen[catalogId]) {
      continue;
    }
    if (!getNotificationCatalogEntry_(catalogId)) {
      continue;
    }
    var freq = String(s.frequency || 'daily').trim().toLowerCase();
    if (freq !== 'hourly' && freq !== 'daily' && freq !== 'weekly') {
      freq = 'daily';
    }
    seen[catalogId] = true;
    out.push({
      catalogId: catalogId,
      enabled: s.enabled === true,
      frequency: freq,
    });
  }
  return out;
}

/**
 * Rewrites every Users-tab Profile cell to the current schema.
 * Required whenever Profile JSON schema changes.
 * @return {{ ok: boolean, migrated: number, message?: string }}
 */
function migrateAllUserProfiles_() {
  var sheet = getUsersAuthSheetOrNull_();
  if (!sheet) {
    return { ok: false, migrated: 0, message: 'Users sheet not found.' };
  }
  var props = PropertiesService.getScriptProperties();
  var colEmail = (props.getProperty('AUTH_COL_EMAIL') || 'Email').trim() || 'Email';
  var colJson = profileColumnHeaderName_();
  var values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) {
    return { ok: true, migrated: 0 };
  }
  var headers = values[0];
  var idxEmail = findHeaderIndex_(headers, colEmail);
  var idxJson = findHeaderIndex_(headers, colJson);
  if (idxEmail < 0 || idxJson < 0) {
    return {
      ok: false,
      migrated: 0,
      message: 'Users sheet missing Email and/or Profile column.',
    };
  }

  var lock = LockService.getScriptLock();
  if (!lock || !lock.tryLock(USER_PROFILE_LOCK_WAIT_MS_)) {
    return { ok: false, migrated: 0, message: 'Could not acquire lock.' };
  }
  var migrated = 0;
  try {
    for (var r = 1; r < values.length; r++) {
      var emailCell = values[r][idxEmail];
      var emailStr =
        emailCell === null || emailCell === undefined ? '' : String(emailCell).trim();
      if (!emailStr) {
        continue;
      }
      var raw = values[r][idxJson];
      if (raw === null || raw === undefined || String(raw).trim() === '') {
        continue;
      }
      var parsed = parseProfileJsonCell_(raw);
      var migratedDoc = migrateUserProfileJson_(parsed);
      var json = JSON.stringify(migratedDoc);
      if (String(raw || '') !== json) {
        sheet.getRange(r + 1, idxJson + 1).setValue(json);
        migrated++;
      }
    }
  } finally {
    try {
      lock.releaseLock();
    } catch (_) {
      /* ignore */
    }
  }
  return { ok: true, migrated: migrated };
}

/**
 * @param {*} raw
 * @return {?Object}
 */
function parseProfileJsonCell_(raw) {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  try {
    return JSON.parse(String(raw));
  } catch (e) {
    try {
      console.warn('userProfileStore: corrupt Profile JSON');
    } catch (_) {
      /* ignore */
    }
    return null;
  }
}

/**
 * @param {string} email
 * @return {!Object}
 */
function getUserProfileDocForEmail_(email) {
  var needle = normalizeEmail_(email);
  var sheet = getUsersAuthSheetOrNull_();
  if (!sheet) {
    return migrateUserProfileJson_(null);
  }
  var props = PropertiesService.getScriptProperties();
  var colEmail = (props.getProperty('AUTH_COL_EMAIL') || 'Email').trim() || 'Email';
  var colJson = profileColumnHeaderName_();
  var values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) {
    return migrateUserProfileJson_(null);
  }
  var headers = values[0];
  var idxEmail = findHeaderIndex_(headers, colEmail);
  var idxJson = findHeaderIndex_(headers, colJson);
  if (idxEmail < 0) {
    return migrateUserProfileJson_(null);
  }
  if (idxJson < 0) {
    try {
      console.warn('userProfileStore: Profile column "' + colJson + '" not found on Users tab.');
    } catch (_) {
      /* ignore */
    }
    return migrateUserProfileJson_(null);
  }
  for (var r = 1; r < values.length; r++) {
    var cell = values[r][idxEmail];
    if (normalizeEmail_(cell === null || cell === undefined ? '' : String(cell)) === needle) {
      return migrateUserProfileJson_(parseProfileJsonCell_(values[r][idxJson]));
    }
  }
  return migrateUserProfileJson_(null);
}

/**
 * Updates Profile JSON on the existing Users-tab row for this email.
 * Does NOT create new Users rows (authorization list is ops-managed).
 * @param {string} email
 * @param {!Object} doc
 * @return {{ ok: boolean, profile?: !Object, message?: string }}
 */
function upsertUserProfileDoc_(email, doc) {
  var sheet = getUsersAuthSheetOrNull_();
  if (!sheet) {
    return { ok: false, message: 'Users sheet not found. Profile storage is not configured.' };
  }
  var props = PropertiesService.getScriptProperties();
  var colEmail = (props.getProperty('AUTH_COL_EMAIL') || 'Email').trim() || 'Email';
  var colJson = profileColumnHeaderName_();
  var values = sheet.getDataRange().getValues();
  if (!values || !values.length) {
    return { ok: false, message: 'Users sheet has no header row.' };
  }
  var headers = values[0];
  var idxEmail = findHeaderIndex_(headers, colEmail);
  var idxJson = findHeaderIndex_(headers, colJson);
  if (idxEmail < 0) {
    return { ok: false, message: 'Users sheet Email column is required.' };
  }
  if (idxJson < 0) {
    return {
      ok: false,
      message:
        'Users sheet is missing the Profile column (header "' +
        colJson +
        '"). Add it and retry.',
    };
  }

  var migrated = migrateUserProfileJson_(doc);
  migrated.updatedAt = new Date().toISOString();
  migrated.schemaVersion = USER_PROFILE_SCHEMA_VERSION_;
  var json = JSON.stringify(migrated);
  var needle = normalizeEmail_(email);

  var lock = LockService.getScriptLock();
  if (!lock || !lock.tryLock(USER_PROFILE_LOCK_WAIT_MS_)) {
    return { ok: false, message: 'Could not save profile (lock busy). Try again.' };
  }
  try {
    values = sheet.getDataRange().getValues();
    headers = values[0];
    idxEmail = findHeaderIndex_(headers, colEmail);
    idxJson = findHeaderIndex_(headers, colJson);
    for (var r = 1; r < values.length; r++) {
      var cell = values[r][idxEmail];
      if (normalizeEmail_(cell === null || cell === undefined ? '' : String(cell)) === needle) {
        sheet.getRange(r + 1, idxJson + 1).setValue(json);
        return { ok: true, profile: migrated };
      }
    }
    return {
      ok: false,
      message: 'Your email is not on the Users tab. Ask an administrator to add you.',
    };
  } catch (e) {
    return {
      ok: false,
      message: e && e.message ? String(e.message) : 'Profile save failed.',
    };
  } finally {
    try {
      lock.releaseLock();
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * @return {!Array<!{ email: string, profile: !Object }>}
 */
function listAllUserProfiles_() {
  var sheet = getUsersAuthSheetOrNull_();
  if (!sheet) {
    return [];
  }
  var props = PropertiesService.getScriptProperties();
  var colEmail = (props.getProperty('AUTH_COL_EMAIL') || 'Email').trim() || 'Email';
  var colJson = profileColumnHeaderName_();
  var values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) {
    return [];
  }
  var headers = values[0];
  var idxEmail = findHeaderIndex_(headers, colEmail);
  var idxJson = findHeaderIndex_(headers, colJson);
  if (idxEmail < 0 || idxJson < 0) {
    return [];
  }
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var email = values[r][idxEmail];
    var emailStr = email === null || email === undefined ? '' : String(email).trim();
    if (!emailStr) {
      continue;
    }
    out.push({
      email: emailStr,
      profile: migrateUserProfileJson_(parseProfileJsonCell_(values[r][idxJson])),
    });
  }
  return out;
}

/**
 * Client API: return profile + catalog for the signed-in user.
 * @return {{ ok: boolean, profile: !Object, catalog: !Array, message?: string }}
 */
function getMyUserProfile() {
  var auth = requireAuthForApi_();
  var profile = getUserProfileDocForEmail_(auth.email);
  return {
    ok: true,
    profile: profile,
    catalog: getNotificationCatalogForClient_(),
  };
}

/**
 * Client API: save notification preferences for self only.
 * @param {{ notifications?: Object }=} patch
 * @return {{ ok: boolean, profile?: !Object, message?: string }}
 */
function saveMyUserProfile(patch) {
  var auth = requireAuthForApi_();
  var current = getUserProfileDocForEmail_(auth.email);
  var next = migrateUserProfileJson_(current);
  if (patch && typeof patch === 'object' && patch.notifications && typeof patch.notifications === 'object') {
    var n = patch.notifications;
    if (Object.prototype.hasOwnProperty.call(n, 'emailEnabled')) {
      next.notifications.emailEnabled = n.emailEnabled === true;
    }
    if (n.timezone) {
      next.notifications.timezone = String(n.timezone).trim() || notificationDefaultTimezone_();
    }
    if (Object.prototype.hasOwnProperty.call(n, 'subscriptions')) {
      next.notifications.subscriptions = normalizeProfileSubscriptions_(n.subscriptions);
    }
  }
  next.preferences = {};
  return upsertUserProfileDoc_(auth.email, next);
}

/**
 * Ops helper: ensure the Users tab has a Profile column header.
 * Does not create Users rows.
 * @return {{ ok: boolean, message: string }}
 */
function ensureUserProfilesSheet() {
  var sheet = getUsersAuthSheetOrNull_();
  if (!sheet) {
    return { ok: false, message: 'Users sheet not found (AUTH_SPREADSHEET_ID / AUTH_USERS_SHEET_NAME).' };
  }
  var colJson = profileColumnHeaderName_();
  var lastCol = Math.max(1, sheet.getLastColumn());
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (findHeaderIndex_(headers, colJson) >= 0) {
    return { ok: true, message: 'Users tab already has column "' + colJson + '".' };
  }
  var newCol = lastCol + 1;
  sheet.getRange(1, newCol).setValue(colJson);
  return { ok: true, message: 'Added "' + colJson + '" column to Users tab.' };
}

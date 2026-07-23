/**
 * PRD version 3.0.12 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Hourly / Daily / Weekly alert email notification jobs (Feature 033).
 * Evaluates live Fibery via existing dashboard builders. No Immediate frequency.
 *
 * Script Properties:
 *   NOTIFICATIONS_ENABLED
 *   NOTIFICATIONS_DAILY_HOUR
 *   NOTIFICATIONS_WEEKLY_HOUR
 *   NOTIFICATIONS_FROM_NAME
 *   NOTIFICATIONS_DEFAULT_TIMEZONE
 */

/** @const {number} */
var NOTIFICATION_JOB_LOCK_WAIT_MS_ = 30000;

/**
 * @return {boolean}
 */
function notificationsEnabled_() {
  var raw = PropertiesService.getScriptProperties().getProperty('NOTIFICATIONS_ENABLED');
  if (raw === null || raw === undefined || raw === '') {
    return true;
  }
  var v = String(raw).trim().toLowerCase();
  return !(v === 'false' || v === 'no' || v === '0');
}

/**
 * @param {string} key
 * @param {number} fallback
 * @return {number}
 */
function notificationHourProp_(key, fallback) {
  var raw = PropertiesService.getScriptProperties().getProperty(key);
  var n = parseInt(String(raw || ''), 10);
  if (isNaN(n) || n < 0 || n > 23) {
    return fallback;
  }
  return n;
}

/**
 * Look up Users-tab authorization for an email (jobs have no Session user).
 * @param {string} email
 * @return {{ ok: boolean, email?: string, role?: string, team?: string, fiberyAccess?: boolean }}
 */
function getAuthorizationForEmail_(email) {
  var emailStr = String(email || '').trim();
  if (!emailStr) {
    return { ok: false };
  }
  var props = PropertiesService.getScriptProperties();
  var spreadsheetId = (props.getProperty('AUTH_SPREADSHEET_ID') || '').trim();
  if (!spreadsheetId) {
    return { ok: false };
  }
  var sheetName = (props.getProperty('AUTH_USERS_SHEET_NAME') || 'Users').trim() || 'Users';
  var colEmail = (props.getProperty('AUTH_COL_EMAIL') || 'Email').trim() || 'Email';
  var colRole = (props.getProperty('AUTH_COL_ROLE') || 'Role').trim() || 'Role';
  var colTeam = (props.getProperty('AUTH_COL_TEAM') || 'Team').trim() || 'Team';
  var colFiberyAccess =
    (props.getProperty('AUTH_COL_FIBERY_ACCESS') || 'fibery_access').trim() || 'fibery_access';
  try {
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return { ok: false };
    }
    var values = sheet.getDataRange().getValues();
    if (!values || values.length < 2) {
      return { ok: false };
    }
    var headers = values[0];
    var idxEmail = findHeaderIndex_(headers, colEmail);
    var idxRole = findHeaderIndex_(headers, colRole);
    var idxTeam = findHeaderIndex_(headers, colTeam);
    var idxFibery = findHeaderIndex_(headers, colFiberyAccess);
    if (idxEmail < 0 || idxRole < 0 || idxTeam < 0) {
      return { ok: false };
    }
    var needle = normalizeEmail_(emailStr);
    for (var r = 1; r < values.length; r++) {
      var cell = values[r][idxEmail];
      if (normalizeEmail_(cell === null || cell === undefined ? '' : String(cell)) === needle) {
        return {
          ok: true,
          email: emailStr,
          role: String(values[r][idxRole] || '').trim(),
          team: String(values[r][idxTeam] || '').trim(),
          fiberyAccess: idxFibery < 0 ? false : parseFiberyAccessCell_(values[r][idxFibery]),
        };
      }
    }
    return { ok: false };
  } catch (e) {
    return { ok: false };
  }
}

/**
 * @param {!Object} auth
 * @param {string} dashboardNavId
 * @return {boolean}
 */
function userCanAccessNotificationDashboard_(auth, dashboardNavId) {
  if (!auth || !auth.ok) {
    return false;
  }
  var id = String(dashboardNavId || '');
  if (id === 'agreement-dashboard' || id === 'operations' || id === 'labor-hours') {
    return true;
  }
  if (id === 'expenses' || id === 'portfolio-pnl' || id === 'ai-usage') {
    return canAccessExpensesDashboard_(auth);
  }
  if (id === 'pipeline') {
    return canAccessPipelineDashboard_(auth);
  }
  if (id === 'resource-assignments') {
    return canAccessResourceAssignmentsDashboard_(auth);
  }
  return true;
}

/**
 * @param {string} frequency
 * @param {string} timezone
 * @param {Date=} now
 * @return {string}
 */
function notificationDigestKey_(frequency, timezone, now) {
  now = now || new Date();
  var tz = timezone || notificationDefaultTimezone_();
  var parts;
  try {
    parts = Utilities.formatDate(now, tz, 'yyyy|MM|dd|HH|u').split('|');
  } catch (e) {
    parts = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy|MM|dd|HH|u').split('|');
  }
  var y = parts[0];
  var m = parts[1];
  var d = parts[2];
  var h = parts[3];
  var dow = parseInt(parts[4], 10); // 1=Mon ... 7=Sun in Utilities
  if (frequency === 'hourly') {
    return 'hourly:' + y + '-' + m + '-' + d + '-' + h;
  }
  if (frequency === 'weekly') {
    // ISO-ish week bucket using year + day-of-year week number approximation via date
    var weekLabel;
    try {
      weekLabel = Utilities.formatDate(now, tz, "yyyy-'W'w");
    } catch (e2) {
      weekLabel = y + '-W' + String(Math.ceil(parseInt(d, 10) / 7));
    }
    return 'weekly:' + weekLabel;
  }
  return 'daily:' + y + '-' + m + '-' + d;
}

/**
 * Evaluate live alerts once per job run.
 * @return {{ ok: boolean, agreementAlerts: !Array, utilizationAlerts: !Array, message?: string }}
 */
function evaluateLiveNotificationAlerts_() {
  var agreementAlerts = [];
  var utilizationAlerts = [];
  var agreementPayload = serveLivePanelFromSupabaseOrFail_(
    'agreement',
    typeof AGREEMENT_DASHBOARD_CACHE_SCHEMA_VERSION_ !== 'undefined'
      ? AGREEMENT_DASHBOARD_CACHE_SCHEMA_VERSION_
      : null
  );
  if (agreementPayload && agreementPayload.ok && agreementPayload.alerts) {
    agreementAlerts = agreementPayload.alerts;
  }
  var utilPayload = serveLivePanelFromSupabaseOrFail_(
    'utilization',
    typeof UTILIZATION_DASHBOARD_CACHE_SCHEMA_VERSION_ !== 'undefined'
      ? UTILIZATION_DASHBOARD_CACHE_SCHEMA_VERSION_
      : null
  );
  if (utilPayload && utilPayload.ok && utilPayload.alerts) {
    utilizationAlerts = utilPayload.alerts;
  }
  var ok =
    !!(agreementPayload && agreementPayload.ok) || !!(utilPayload && utilPayload.ok);
  return {
    ok: ok,
    agreementAlerts: agreementAlerts,
    utilizationAlerts: utilizationAlerts,
    message:
      !ok
        ? ((agreementPayload && agreementPayload.message) ||
            (utilPayload && utilPayload.message) ||
            'Alert evaluation failed.')
        : '',
  };
}

/**
 * @param {!Array<!Object>} alerts
 * @return {!Array<!{ catalogId: string, alert: !Object }>}
 */
function mapAlertsToCatalog_(alerts) {
  var out = [];
  for (var i = 0; i < (alerts || []).length; i++) {
    var a = alerts[i];
    var catalogId = catalogIdForAlert_(a);
    if (!catalogId) {
      continue;
    }
    out.push({ catalogId: catalogId, alert: a });
  }
  return out;
}

/**
 * @param {string} baseUrl
 * @param {string} navId
 * @return {string}
 */
function buildNotificationDeepLink_(baseUrl, navId) {
  var base = String(baseUrl || '').trim();
  if (!base) {
    return '';
  }
  var hash = '';
  if (navId === 'operations') {
    hash = '#panel=operations';
  } else if (navId === 'agreement-dashboard') {
    hash = '#panel=agreement-dashboard';
  }
  return base + hash;
}

/**
 * @param {!Array<!Object>} matched
 * @param {string} frequency
 * @param {string} deepLink
 * @return {{ subject: string, html: string, text: string, summary: string }}
 */
function composeNotificationEmail_(matched, frequency, deepLink) {
  var n = matched.length;
  var freqLabel = frequency.charAt(0).toUpperCase() + frequency.slice(1);
  var subject =
    n === 1
      ? 'FinOps alert: ' + String(matched[0].alert.title || 'Attention item')
      : 'FinOps: ' + n + ' ' + freqLabel.toLowerCase() + ' alerts';

  var lines = [];
  var summaryParts = [];
  for (var i = 0; i < matched.length; i++) {
    var a = matched[i].alert;
    var sev = String(a.severity || 'info');
    var title = String(a.title || 'Alert');
    var body = String(a.body || '');
    summaryParts.push(title);
    lines.push(
      '<li style="margin-bottom:12px;">' +
        '<div style="font-weight:600;color:#111;">' +
        escapeHtmlForEmail_(title) +
        '</div>' +
        '<div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.04em;">' +
        escapeHtmlForEmail_(sev) +
        '</div>' +
        (body
          ? '<div style="margin-top:4px;color:#333;font-size:14px;line-height:1.4;">' +
            escapeHtmlForEmail_(body) +
            '</div>'
          : '') +
        '</li>'
    );
  }

  var linkHtml = deepLink
    ? '<p style="margin:20px 0 0;"><a href="' +
      escapeHtmlForEmail_(deepLink) +
      '" style="display:inline-block;background:#007FA7;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600;">Open FinOps Performance Hub</a></p>' +
      '<p style="font-size:12px;color:#666;word-break:break-all;">' +
      escapeHtmlForEmail_(deepLink) +
      '</p>'
    : '<p style="color:#666;font-size:13px;">Open FinOps Performance Hub from your Workspace bookmarks to review alerts.</p>';

  var html =
    '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;color:#222;">' +
    '<h1 style="font-size:18px;margin:0 0 8px;">' +
    escapeHtmlForEmail_(freqLabel) +
    ' alert digest</h1>' +
    '<p style="margin:0 0 16px;color:#555;font-size:14px;">' +
    n +
    ' subscribed alert' +
    (n === 1 ? '' : 's') +
    ' matched.</p>' +
    '<ul style="padding-left:18px;margin:0;">' +
    lines.join('') +
    '</ul>' +
    linkHtml +
    '<p style="margin-top:24px;font-size:11px;color:#999;">You receive this because you opted in under Profile → Notifications in FinOps Performance Hub.</p>' +
    '</div>';

  var text =
    freqLabel +
    ' alert digest\n\n' +
    summaryParts.join('\n') +
    (deepLink ? '\n\nOpen: ' + deepLink : '') +
    '\n';

  return {
    subject: subject,
    html: html,
    text: text,
    summary: summaryParts.slice(0, 3).join(' · '),
  };
}

/**
 * @param {string} s
 * @return {string}
 */
function escapeHtmlForEmail_(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {string} frequency hourly|daily|weekly
 * @return {{ ok: boolean, sent: number, skipped: number, message?: string }}
 */
function processNotificationsForFrequency_(frequency) {
  if (!notificationsEnabled_()) {
    return { ok: true, sent: 0, skipped: 0, message: 'NOTIFICATIONS_ENABLED is false.' };
  }
  var lock = LockService.getScriptLock();
  if (!lock || !lock.tryLock(NOTIFICATION_JOB_LOCK_WAIT_MS_)) {
    return { ok: false, sent: 0, skipped: 0, message: 'Could not acquire job lock.' };
  }
  try {
    var evalResult = evaluateLiveNotificationAlerts_();
    var mapped = mapAlertsToCatalog_(
      (evalResult.agreementAlerts || []).concat(evalResult.utilizationAlerts || [])
    );
    var baseUrl = '';
    try {
      baseUrl = getWebAppDeploymentUrl_() || '';
    } catch (e) {
      baseUrl = '';
    }
    var fromName =
      (PropertiesService.getScriptProperties().getProperty('NOTIFICATIONS_FROM_NAME') || '').trim() ||
      'FinOps Performance Hub';

    var profiles = listAllUserProfiles_();
    var sent = 0;
    var skipped = 0;

    for (var p = 0; p < profiles.length; p++) {
      var email = profiles[p].email;
      var profile = profiles[p].profile;
      if (!profile || !profile.notifications || profile.notifications.emailEnabled !== true) {
        skipped++;
        continue;
      }
      var auth = getAuthorizationForEmail_(email);
      if (!auth.ok) {
        skipped++;
        continue;
      }

      var subById = {};
      var subs = profile.notifications.subscriptions || [];
      for (var s = 0; s < subs.length; s++) {
        if (subs[s].enabled && subs[s].frequency === frequency) {
          subById[subs[s].catalogId] = true;
        }
      }
      if (!Object.keys(subById).length) {
        skipped++;
        continue;
      }

      var tz = profile.notifications.timezone || notificationDefaultTimezone_();
      var digestKey = notificationDigestKey_(frequency, tz, new Date());
      var matched = [];
      var catalogIds = [];
      var alertIds = [];
      var primaryNav = '';

      for (var m = 0; m < mapped.length; m++) {
        var entry = mapped[m];
        if (!subById[entry.catalogId]) {
          continue;
        }
        var catalog = getNotificationCatalogEntry_(entry.catalogId);
        if (!catalog) {
          continue;
        }
        if (!userCanAccessNotificationDashboard_(auth, catalog.dashboardNavId)) {
          continue;
        }
        if (notificationAlreadySent_(email, digestKey, entry.alert.id)) {
          continue;
        }
        matched.push(entry);
        catalogIds.push(entry.catalogId);
        alertIds.push(String(entry.alert.id || ''));
        if (!primaryNav) {
          primaryNav = catalog.dashboardNavId;
        }
      }

      if (!matched.length) {
        skipped++;
        continue;
      }

      var deepLink = buildNotificationDeepLink_(baseUrl, primaryNav);
      var composed = composeNotificationEmail_(matched, frequency, deepLink);
      try {
        MailApp.sendEmail({
          to: email,
          subject: composed.subject,
          htmlBody: composed.html,
          body: composed.text,
          name: fromName,
        });
        appendNotificationLogRow_({
          email: email,
          catalogIds: catalogIds,
          alertIds: alertIds,
          frequency: frequency,
          digestKey: digestKey,
          subject: composed.subject,
          summary: composed.summary,
          deepLink: deepLink,
          status: 'sent',
        });
        sent++;
      } catch (sendErr) {
        try {
          console.warn(
            'notificationJobs: send failed for ' +
              email +
              ': ' +
              (sendErr && sendErr.message ? sendErr.message : sendErr)
          );
        } catch (_) {
          /* ignore */
        }
        appendNotificationLogRow_({
          email: email,
          catalogIds: catalogIds,
          alertIds: alertIds,
          frequency: frequency,
          digestKey: digestKey,
          subject: composed.subject,
          summary: composed.summary,
          deepLink: deepLink,
          status: 'error',
        });
        skipped++;
      }
    }

    return {
      ok: true,
      sent: sent,
      skipped: skipped,
      message: evalResult.ok ? '' : evalResult.message || '',
    };
  } finally {
    try {
      lock.releaseLock();
    } catch (_) {
      /* ignore */
    }
  }
}

/** @return {{ ok: boolean, sent: number, skipped: number, message?: string }} */
function processHourlyNotifications_() {
  return processNotificationsForFrequency_('hourly');
}

/** @return {{ ok: boolean, sent: number, skipped: number, message?: string }} */
function processDailyNotifications_() {
  return processNotificationsForFrequency_('daily');
}

/** @return {{ ok: boolean, sent: number, skipped: number, message?: string }} */
function processWeeklyNotifications_() {
  return processNotificationsForFrequency_('weekly');
}

/**
 * Install Hourly + Daily + Weekly (Tuesday) triggers.
 * @return {{ ok: boolean, message: string }}
 */
function installNotificationTriggers() {
  removeNotificationTriggers();
  var dailyHour = notificationHourProp_('NOTIFICATIONS_DAILY_HOUR', 8);
  var weeklyHour = notificationHourProp_('NOTIFICATIONS_WEEKLY_HOUR', 8);

  ScriptApp.newTrigger('processHourlyNotifications_').timeBased().everyHours(1).create();

  ScriptApp.newTrigger('processDailyNotifications_')
    .timeBased()
    .everyDays(1)
    .atHour(dailyHour)
    .create();

  ScriptApp.newTrigger('processWeeklyNotifications_')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.TUESDAY)
    .atHour(weeklyHour)
    .create();

  return {
    ok: true,
    message:
      'Installed hourly, daily (hour ' +
      dailyHour +
      '), and weekly Tuesday (hour ' +
      weeklyHour +
      ') notification triggers.',
  };
}

/**
 * @return {{ ok: boolean, deleted: number }}
 */
function removeNotificationTriggers() {
  var deleted = 0;
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (
      fn === 'processHourlyNotifications_' ||
      fn === 'processDailyNotifications_' ||
      fn === 'processWeeklyNotifications_'
    ) {
      ScriptApp.deleteTrigger(triggers[i]);
      deleted++;
    }
  }
  return { ok: true, deleted: deleted };
}

/**
 * ADMIN Settings: run the hourly notification digest on demand.
 * @return {{
 *   ok: boolean,
 *   sent?: number,
 *   skipped?: number,
 *   message?: string,
 *   notificationsEnabled?: boolean
 * }}
 */
function runHourlyNotificationsForSettings() {
  var auth = requireAuthForApi_();
  requireAdminRole_(auth);
  if (!notificationsEnabled_()) {
    return {
      ok: false,
      sent: 0,
      skipped: 0,
      notificationsEnabled: false,
      message: 'Notifications are disabled (NOTIFICATIONS_ENABLED is false).',
    };
  }
  var result = processHourlyNotifications_();
  result.notificationsEnabled = true;
  return result;
}

/**
 * ADMIN Settings: lightweight status for the notifications operator panel.
 * @return {{ ok: boolean, notificationsEnabled: boolean, message?: string }}
 */
function getNotificationJobStatusForSettings() {
  var auth = requireAuthForApi_();
  requireAdminRole_(auth);
  var enabled = notificationsEnabled_();
  return {
    ok: true,
    notificationsEnabled: enabled,
    message: enabled
      ? 'Hourly / Daily / Weekly triggers send when installed. Use Run hourly now to evaluate live Fibery and email opted-in users.'
      : 'NOTIFICATIONS_ENABLED is false. Enable it below before running on-demand or scheduled digests.',
  };
}

/** @return {!Object} */
function _diag_runHourlyNotifications_() {
  return processHourlyNotifications_();
}

/** @return {!Object} */
function _diag_runDailyNotifications_() {
  return processDailyNotifications_();
}

/** @return {!Object} */
function _diag_runWeeklyNotifications_() {
  return processWeeklyNotifications_();
}

/**
 * Create Profile + Notification Log sheets if missing.
 * @return {{ ok: boolean, profiles: !Object, log: !Object }}
 */
function ensureNotificationSheets() {
  return {
    ok: true,
    profiles: ensureUserProfilesSheet(),
    log: ensureNotificationLogSheet(),
  };
}

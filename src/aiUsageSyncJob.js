/**
 * PRD version 2.11.1 - sync with docs/FOS-Dashboard-PRD.md
 *
 * AI usage sync orchestration (Anthropic Phase B, feature 017).
 *
 * Public (editor / trigger):
 *   runDailyAiUsageSync_()
 *   runAiUsageSyncOnDemand(startYmd, endYmd)
 *   installDailyAiUsageSyncTrigger()
 *   removeDailyAiUsageSyncTriggers()
 */

/** @const {string[]} */
var AI_USAGE_LOG_COLUMNS_ = [
  'Timestamp',
  'Sync Run Id',
  'Trigger',
  'Date Start',
  'Date End',
  'Status',
  'Duration Ms',
  'Rows Fetched',
  'Rows Upserted',
  'Rows Failed',
  'Matched',
  'Unmatched',
  'Notes',
];

/**
 * Daily time-driven entry point.
 */
function runDailyAiUsageSync_() {
  if (!aiUsageSyncIsEnabled_()) {
    console.warn('runDailyAiUsageSync_: AI_USAGE_SYNC_ENABLED is false');
    return;
  }
  var lookback = aiUsageResolveLookbackDays_();
  var end = aiUsageTodayYmd_();
  var start = aiUsageAddDaysYmd_(end, -(lookback - 1));
  runAiUsageSyncForRange_(start, end, 'scheduled');
}

/**
 * @param {string} startYmd
 * @param {string} endYmd
 * @return {!{ ok: boolean, message: string, summary?: !Object }}
 */
function runAiUsageSyncOnDemand(startYmd, endYmd) {
  startYmd = String(startYmd || '').trim();
  endYmd = String(endYmd || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(endYmd)) {
    return { ok: false, message: 'startYmd and endYmd must be YYYY-MM-DD' };
  }
  if (startYmd > endYmd) {
    return { ok: false, message: 'startYmd must be on or before endYmd' };
  }
  var maxDays = aiUsageResolveMaxBackfillDays_();
  var span = aiUsageDaySpan_(startYmd, endYmd);
  if (span > maxDays) {
    return { ok: false, message: 'Date range exceeds AI_USAGE_MAX_BACKFILL_DAYS (' + maxDays + ')' };
  }
  if (!aiUsageSyncIsEnabled_()) {
    return { ok: false, message: 'AI usage sync is disabled (AI_USAGE_SYNC_ENABLED=false)' };
  }
  return runAiUsageSyncForRange_(startYmd, endYmd, 'manual');
}

/**
 * @param {string} startYmd
 * @param {string} endYmd
 * @param {string} triggerKind
 * @return {!{ ok: boolean, message: string, summary?: !Object }}
 */
function runAiUsageSyncForRange_(startYmd, endYmd, triggerKind) {
  var lock = LockService.getScriptLock();
  if (lock) {
    try {
      if (!lock.tryLock(AI_USAGE_LOCK_WAIT_MS_)) {
        return { ok: false, message: 'Another AI usage sync is already running' };
      }
    } catch (e) {
      /* proceed */
    }
  }

  var started = Date.now();
  var startedAtIso = new Date().toISOString();
  var syncRunId = 'ai-usage:' + startedAtIso + ':' + Utilities.getUuid().slice(0, 8);
  var summary = {
    syncRunId: syncRunId,
    trigger: triggerKind,
    startYmd: startYmd,
    endYmd: endYmd,
    startedAtIso: startedAtIso,
    rowsFetched: 0,
    rowsUpserted: 0,
    rowsFailed: 0,
    matched: 0,
    unmatched: 0,
    warnings: [],
    message: '',
  };

  try {
    if (!PropertiesService.getScriptProperties().getProperty(AI_USAGE_ANTHROPIC_ADMIN_KEY_PROP_)) {
      summary.message = 'ANTHROPIC_ADMIN_API_KEY is not set';
      logAiUsageSyncRun_(summary, 'failed', Date.now() - started);
      return { ok: false, message: summary.message, summary: summary };
    }

    var org = aiUsageFetchAnthropicOrg_();
    var apiKeyIndex = aiUsageFetchAnthropicApiKeyIndex_();
    var matchContext = aiUsageLoadMatchContext_();
    summary.warnings = summary.warnings.concat(matchContext.warnings || []);

    var allRows = [];
    var day = startYmd;
    while (day <= endYmd) {
      var dayRows = aiUsageNormalizeAnthropicDay_(day, org.id, apiKeyIndex);
      allRows = allRows.concat(dayRows);
      day = aiUsageAddDaysYmd_(day, 1);
    }
    summary.rowsFetched = allRows.length;

    var matched = aiUsageApplyUserMatching_(allRows, matchContext);
    summary.matched = matched.matched;
    summary.unmatched = matched.unmatched;

    var upsert = aiUsageUpsertRows_(matched.rows, syncRunId);
    summary.rowsUpserted = upsert.created + upsert.updated;
    summary.rowsFailed = upsert.failed;
    if (upsert.message) {
      summary.warnings.push(upsert.message);
    }

    var status = 'complete';
    if (!upsert.ok) {
      status = upsert.created + upsert.updated > 0 ? 'partial' : 'failed';
    }
    summary.message =
      'Anthropic sync ' +
      status +
      ': fetched ' +
      summary.rowsFetched +
      ', upserted ' +
      summary.rowsUpserted +
      ', matched ' +
      summary.matched;

    logAiUsageSyncRun_(summary, status, Date.now() - started);
    return { ok: status !== 'failed', message: summary.message, summary: summary };
  } catch (e) {
    summary.message = e && e.message ? e.message : String(e);
    logAiUsageSyncRun_(summary, 'failed', Date.now() - started);
    return { ok: false, message: summary.message, summary: summary };
  } finally {
    if (lock) {
      try {
        lock.releaseLock();
      } catch (_) {
        /* ignore */
      }
    }
  }
}

/**
 * @return {{ ok: boolean, message?: string }}
 */
function installDailyAiUsageSyncTrigger() {
  removeDailyAiUsageSyncTriggers();
  var hour = AI_USAGE_DEFAULT_TRIGGER_HOUR_;
  var raw = PropertiesService.getScriptProperties().getProperty(AI_USAGE_TRIGGER_HOUR_PROP_);
  var parsed = parseInt(raw, 10);
  if (isFinite(parsed) && parsed >= 0 && parsed <= 23) {
    hour = parsed;
  }
  ScriptApp.newTrigger('runDailyAiUsageSync_').timeBased().everyDays(1).atHour(hour).create();
  return { ok: true, message: 'Daily AI usage sync trigger installed at hour ' + hour };
}

/**
 * @return {{ ok: boolean, deleted: number }}
 */
function removeDailyAiUsageSyncTriggers() {
  var deleted = 0;
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'runDailyAiUsageSync_') {
      ScriptApp.deleteTrigger(triggers[i]);
      deleted++;
    }
  }
  return { ok: true, deleted: deleted };
}

/**
 * @param {!Object} summary
 * @param {string} status
 * @param {number} durationMs
 * @private
 */
function logAiUsageSyncRun_(summary, status, durationMs) {
  var notes = (summary.warnings || []).slice(0, 3).join('; ');
  if (summary.message) {
    notes = notes ? notes + '; ' + summary.message : summary.message;
  }
  try {
    var fiberyLog = aiUsageWriteFiberySyncRun_(
      summary,
      status,
      durationMs,
      summary.startedAtIso || new Date().toISOString()
    );
    if (!fiberyLog.ok) {
      console.warn('logAiUsageSyncRun_: Fibery Sync Runs write failed: ' + fiberyLog.message);
      notes = notes ? notes + '; Fibery log: ' + fiberyLog.message : 'Fibery log: ' + fiberyLog.message;
    }
  } catch (e) {
    console.warn('logAiUsageSyncRun_: Fibery Sync Runs threw: ' + (e && e.message ? e.message : e));
  }
  try {
    var sheet = getAiUsageSyncRunsSheetOrNull_();
    if (!sheet) {
      console.warn(
        'logAiUsageSyncRun_: no log sheet. status=' +
          status +
          ' run=' +
          summary.syncRunId +
          ' notes=' +
          notes
      );
      return;
    }
    sheet.appendRow([
      new Date().toISOString(),
      summary.syncRunId,
      summary.trigger || '',
      summary.startYmd || '',
      summary.endYmd || '',
      status,
      durationMs,
      summary.rowsFetched || 0,
      summary.rowsUpserted || 0,
      summary.rowsFailed || 0,
      summary.matched || 0,
      summary.unmatched || 0,
      aiUsageTruncateNotes_(notes),
    ]);
  } catch (e) {
    console.warn('logAiUsageSyncRun_ failed: ' + (e && e.message ? e.message : e));
  }
}

/**
 * @return {GoogleAppsScript.Spreadsheet.Sheet|null}
 * @private
 */
function getAiUsageSyncRunsSheetOrNull_() {
  var props = PropertiesService.getScriptProperties();
  var spreadsheetId = props.getProperty('AUTH_SPREADSHEET_ID');
  if (!spreadsheetId) {
    return null;
  }
  var sheetName = String(props.getProperty(AI_USAGE_LOG_SHEET_PROP_) || AI_USAGE_DEFAULT_LOG_SHEET_).trim();
  if (!sheetName) {
    sheetName = AI_USAGE_DEFAULT_LOG_SHEET_;
  }
  try {
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(AI_USAGE_LOG_COLUMNS_);
    } else if (sheet.getLastRow() < 1) {
      sheet.appendRow(AI_USAGE_LOG_COLUMNS_);
    }
    return sheet;
  } catch (e) {
    console.warn('getAiUsageSyncRunsSheetOrNull_: ' + (e && e.message ? e.message : e));
    return null;
  }
}

/**
 * @param {string} notes
 * @return {string}
 * @private
 */
function aiUsageTruncateNotes_(notes) {
  var s = String(notes || '');
  return s.length > 500 ? s.slice(0, 497) + '...' : s;
}

/**
 * @return {boolean}
 * @private
 */
function aiUsageSyncIsEnabled_() {
  var raw = PropertiesService.getScriptProperties().getProperty(AI_USAGE_SYNC_ENABLED_PROP_);
  if (raw === null || raw === undefined || raw === '') {
    return true;
  }
  var v = String(raw).trim().toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'no';
}

/**
 * @return {number}
 * @private
 */
function aiUsageResolveLookbackDays_() {
  var raw = PropertiesService.getScriptProperties().getProperty(AI_USAGE_LOOKBACK_PROP_);
  var n = parseInt(raw, 10);
  if (!isFinite(n) || n < 1) {
    return AI_USAGE_DEFAULT_LOOKBACK_DAYS_;
  }
  return Math.min(n, 14);
}

/**
 * @return {number}
 * @private
 */
function aiUsageResolveMaxBackfillDays_() {
  var raw = PropertiesService.getScriptProperties().getProperty(AI_USAGE_MAX_BACKFILL_PROP_);
  var n = parseInt(raw, 10);
  if (!isFinite(n) || n < 1) {
    return AI_USAGE_DEFAULT_MAX_BACKFILL_DAYS_;
  }
  return Math.min(n, 365);
}

/**
 * @return {string}
 * @private
 */
function aiUsageTodayYmd_() {
  var tz = aiUsageResolveTimezone_();
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}

/**
 * @return {string}
 * @private
 */
function aiUsageResolveTimezone_() {
  var tz = PropertiesService.getScriptProperties().getProperty(AI_USAGE_TIMEZONE_PROP_);
  tz = (tz || AI_USAGE_DEFAULT_TIMEZONE_).trim();
  return tz || AI_USAGE_DEFAULT_TIMEZONE_;
}

/**
 * @param {string} ymd
 * @param {number} deltaDays
 * @return {string}
 * @private
 */
function aiUsageAddDaysYmd_(ymd, deltaDays) {
  var parts = ymd.split('-');
  var d = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/**
 * @param {string} startYmd
 * @param {string} endYmd
 * @return {number}
 * @private
 */
function aiUsageDaySpan_(startYmd, endYmd) {
  var start = Date.parse(startYmd + 'T00:00:00Z');
  var end = Date.parse(endYmd + 'T00:00:00Z');
  return Math.floor((end - start) / 86400000) + 1;
}

/**
 * PRD version 2.15.12 - sync with docs/FOS-Dashboard-PRD.md
 *
 * AI usage sync orchestration (Anthropic Phase B, feature 017).
 *
 * Public (editor / trigger / ADMIN Settings):
 *   runDailyAiUsageSync_()
 *   runAiUsageSyncOnDemand(startYmd, endYmd)
 *   runAiUsageSyncIncremental()
 *   runAiUsageSyncForSettings(useCustomRange, startYmd, endYmd)
 *   getAiUsageSyncStatus()
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
  var range = resolveAiUsageIncrementalRange_();
  if (range.alreadyUpToDate) {
    console.warn('runDailyAiUsageSync_: already up to date');
    return;
  }
  runAiUsageSyncForRange_(range.startYmd, range.endYmd, 'scheduled');
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
 * ADMIN Settings: incremental sync from last log row / Fibery max Usage Date.
 *
 * @return {!{ ok: boolean, message: string, summary?: !Object }}
 */
function runAiUsageSyncIncremental() {
  var auth = requireAuthForApi_();
  requireAdminRole_(auth);
  return runAiUsageSyncIncrementalInternal_();
}

/**
 * ADMIN Settings: incremental or custom-range sync.
 *
 * @param {boolean} useCustomRange When true, use startYmd/endYmd instead of incremental resolver.
 * @param {string=} startYmd YYYY-MM-DD (required when useCustomRange).
 * @param {string=} endYmd YYYY-MM-DD (required when useCustomRange).
 * @return {!{ ok: boolean, message: string, summary?: !Object }}
 */
function runAiUsageSyncForSettings(useCustomRange, startYmd, endYmd) {
  var auth = requireAuthForApi_();
  requireAdminRole_(auth);

  if (!aiUsageSyncIsEnabled_()) {
    return { ok: false, message: 'AI usage sync is disabled (AI_USAGE_SYNC_ENABLED=false)' };
  }
  if (!PropertiesService.getScriptProperties().getProperty(AI_USAGE_ANTHROPIC_ADMIN_KEY_PROP_)) {
    return { ok: false, message: 'ANTHROPIC_ADMIN_API_KEY is not set' };
  }

  if (!useCustomRange) {
    return runAiUsageSyncIncrementalInternal_();
  }

  startYmd = String(startYmd || '').trim();
  endYmd = String(endYmd || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(endYmd)) {
    return { ok: false, message: 'Start and end dates are required (YYYY-MM-DD).' };
  }
  if (startYmd > endYmd) {
    return { ok: false, message: 'Start date must be on or before end date.' };
  }
  var maxDays = aiUsageResolveMaxBackfillDays_();
  var span = aiUsageDaySpan_(startYmd, endYmd);
  if (span > maxDays) {
    return { ok: false, message: 'Date range exceeds AI_USAGE_MAX_BACKFILL_DAYS (' + maxDays + ').' };
  }
  return runAiUsageSyncForRange_(startYmd, endYmd, 'manual');
}

/**
 * Incremental sync (no auth; callers must gate ADMIN).
 *
 * @return {!{ ok: boolean, message: string, summary?: !Object }}
 * @private
 */
function runAiUsageSyncIncrementalInternal_() {
  if (!aiUsageSyncIsEnabled_()) {
    return { ok: false, message: 'AI usage sync is disabled (AI_USAGE_SYNC_ENABLED=false)' };
  }
  if (!PropertiesService.getScriptProperties().getProperty(AI_USAGE_ANTHROPIC_ADMIN_KEY_PROP_)) {
    return { ok: false, message: 'ANTHROPIC_ADMIN_API_KEY is not set' };
  }

  var range = resolveAiUsageIncrementalRange_();
  if (range.alreadyUpToDate) {
    return {
      ok: true,
      message: 'Already up to date.',
      summary: {
        startYmd: range.startYmd,
        endYmd: range.endYmd,
        skipped: true,
        trigger: 'manual',
      },
    };
  }
  return runAiUsageSyncForRange_(range.startYmd, range.endYmd, 'manual');
}

/**
 * ADMIN Settings: last sync status + incremental window preview.
 *
 * @return {!Object}
 */
function getAiUsageSyncStatus() {
  try {
    var auth = requireAuthForApi_();
    requireAdminRole_(auth);
  } catch (e) {
    var msg = e && e.message ? e.message : String(e);
    if (msg === 'NOT_AUTHORIZED' || msg === 'FORBIDDEN') {
      return { ok: false, message: 'Administrator access required.' };
    }
    throw e;
  }

  var range = resolveAiUsageIncrementalRange_();
  return {
    ok: true,
    syncEnabled: aiUsageSyncIsEnabled_(),
    anthropicKeyConfigured: !!PropertiesService.getScriptProperties().getProperty(
      AI_USAGE_ANTHROPIC_ADMIN_KEY_PROP_
    ),
    incrementalRange: {
      startYmd: range.startYmd,
      endYmd: range.endYmd,
      alreadyUpToDate: range.alreadyUpToDate,
      maxDaysPerRun: range.maxDaysPerRun,
    },
    maxBackfillDays: aiUsageResolveMaxBackfillDays_(),
    lastRun: aiUsageDecorateLatestSyncRun_(readLatestAiUsageSyncRunFromSheet_()),
  };
}

/**
 * @param {string} startYmd
 * @param {string} endYmd
 * @param {string} triggerKind
 * @return {!{ ok: boolean, message: string, summary?: !Object }}
 */
function runAiUsageSyncForRange_(startYmd, endYmd, triggerKind) {
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
    logWritten: false,
  };

  var lock = LockService.getScriptLock();
  if (lock) {
    try {
      if (!lock.tryLock(AI_USAGE_LOCK_WAIT_MS_)) {
        summary.message = 'Another AI usage sync is already running';
        finishAiUsageSyncLog_(summary, 'failed', started);
        return { ok: false, message: summary.message, summary: summary };
      }
    } catch (e) {
      /* proceed */
    }
  }

  logAiUsageSyncRun_(summary, 'running', 0);

  var requestedEndYmd = endYmd;

  try {
    if (!PropertiesService.getScriptProperties().getProperty(AI_USAGE_ANTHROPIC_ADMIN_KEY_PROP_)) {
      summary.message = 'ANTHROPIC_ADMIN_API_KEY is not set';
      finishAiUsageSyncLog_(summary, 'failed', started);
      return { ok: false, message: summary.message, summary: summary };
    }

    var org = aiUsageFetchAnthropicOrg_();
    var apiKeyIndex = aiUsageFetchAnthropicApiKeyIndex_();
    var matchContext = aiUsageLoadMatchContext_();
    summary.warnings = summary.warnings.concat(matchContext.warnings || []);

    var deadlineMs = started + AI_USAGE_SYNC_TIME_BUDGET_MS_;
    var allRows = [];
    var day = startYmd;
    var lastFetchedDay = null;
    while (day <= endYmd) {
      if (Date.now() > deadlineMs) {
        summary.warnings.push(
          'Anthropic fetch stopped before ' +
            day +
            ' (Apps Script time budget). Run sync again to continue.'
        );
        break;
      }
      var dayRows = aiUsageNormalizeAnthropicDay_(day, org.id, apiKeyIndex);
      allRows = allRows.concat(dayRows);
      lastFetchedDay = day;
      day = aiUsageAddDaysYmd_(day, 1);
    }
    if (lastFetchedDay && lastFetchedDay !== requestedEndYmd) {
      summary.endYmd = lastFetchedDay;
    }
    summary.rowsFetched = allRows.length;

    var matched = aiUsageApplyUserMatching_(allRows, matchContext);
    summary.matched = matched.matched;
    summary.unmatched = matched.unmatched;

    aiUsageWarmUsageEnums_();
    var upsert = aiUsageUpsertRows_(matched.rows, syncRunId, deadlineMs);
    summary.rowsUpserted = upsert.created + upsert.updated;
    summary.rowsFailed = upsert.failed;
    if (upsert.message) {
      summary.warnings.push(upsert.message);
    }

    var status = 'complete';
    if (!upsert.ok || summary.endYmd !== requestedEndYmd || upsert.stoppedEarly) {
      status = upsert.created + upsert.updated > 0 || summary.rowsFetched > 0 ? 'partial' : 'failed';
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

    finishAiUsageSyncLog_(summary, status, started);
    return { ok: status !== 'failed', message: summary.message, summary: summary };
  } catch (e) {
    summary.message = e && e.message ? e.message : String(e);
    finishAiUsageSyncLog_(summary, 'failed', started);
    return { ok: false, message: summary.message, summary: summary };
  } finally {
    if (!summary.logWritten) {
      summary.message =
        summary.message ||
        'Sync interrupted before completion (execution time limit or server error). Check Apps Script Executions.';
      finishAiUsageSyncLog_(summary, 'failed', started);
    }
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
 * Writes the final sync log row once per run (sheet + best-effort Fibery).
 *
 * @param {!Object} summary
 * @param {string} status
 * @param {number} startedMs
 * @private
 */
function finishAiUsageSyncLog_(summary, status, startedMs) {
  if (summary.logWritten) {
    return;
  }
  summary.logWritten = true;
  logAiUsageSyncRun_(summary, status, Date.now() - startedMs);
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
function aiUsageResolveMaxDaysPerRun_() {
  var raw = PropertiesService.getScriptProperties().getProperty(AI_USAGE_MAX_DAYS_PER_RUN_PROP_);
  var n = parseInt(raw, 10);
  if (!isFinite(n) || n < 1) {
    return AI_USAGE_DEFAULT_MAX_DAYS_PER_RUN_;
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

/**
 * @return {number}
 * @private
 */
function aiUsageResolveInitialLookbackDays_() {
  var raw = PropertiesService.getScriptProperties().getProperty(AI_USAGE_INITIAL_LOOKBACK_PROP_);
  var n = parseInt(raw, 10);
  if (!isFinite(n) || n < 1) {
    return AI_USAGE_DEFAULT_INITIAL_LOOKBACK_DAYS_;
  }
  return Math.min(n, aiUsageResolveMaxBackfillDays_());
}

/**
 * Computes the next vendor fetch window for scheduled and manual incremental sync.
 *
 * @return {!{ startYmd: string, endYmd: string, alreadyUpToDate: boolean }}
 * @private
 */
function resolveAiUsageIncrementalRange_() {
  var endYmd = aiUsageTodayYmd_();
  var maxBackfill = aiUsageResolveMaxBackfillDays_();
  var overlap = aiUsageResolveLookbackDays_();
  var initialLookback = aiUsageResolveInitialLookbackDays_();
  var earliest = aiUsageAddDaysYmd_(endYmd, -(maxBackfill - 1));

  var lastSuccess = readLastSuccessfulAiUsageSyncRunFromSheet_();
  var lastEnd = lastSuccess && lastSuccess.endYmd ? lastSuccess.endYmd : null;
  var maxUsage = aiUsageQueryMaxUsageDateYmd_();
  var anchor = lastEnd || maxUsage || null;

  var startYmd;
  if (!anchor) {
    startYmd = aiUsageAddDaysYmd_(endYmd, -(initialLookback - 1));
  } else {
    var high = anchor;
    if (lastEnd && maxUsage && maxUsage > lastEnd) {
      high = maxUsage;
    }
    startYmd = aiUsageAddDaysYmd_(high, -(overlap - 1));
  }

  if (startYmd < earliest) {
    startYmd = earliest;
  }

  var maxPerRun = aiUsageResolveMaxDaysPerRun_();
  if (lastEnd) {
    startYmd = aiUsageAddDaysYmd_(lastEnd, -(overlap - 1));
    if (startYmd < earliest) {
      startYmd = earliest;
    }
    var chunkEnd = aiUsageAddDaysYmd_(lastEnd, maxPerRun);
    if (chunkEnd > endYmd) {
      chunkEnd = endYmd;
    }
    endYmd = chunkEnd;
  } else if (aiUsageDaySpan_(startYmd, endYmd) > maxPerRun) {
    endYmd = aiUsageAddDaysYmd_(startYmd, maxPerRun - 1);
  }

  return {
    startYmd: startYmd,
    endYmd: endYmd,
    alreadyUpToDate: startYmd > endYmd,
    maxDaysPerRun: maxPerRun,
  };
}

/**
 * @return {?Object}
 * @private
 */
function readLatestAiUsageSyncRunFromSheet_() {
  return readAiUsageSyncRunFromSheetAtRow_(null);
}

/**
 * Marks old "running" log rows as failed so the Settings UI is not stuck indefinitely.
 *
 * @param {?Object} row
 * @return {?Object}
 * @private
 */
function aiUsageDecorateLatestSyncRun_(row) {
  if (!row || String(row.status || '').toLowerCase() !== 'running') {
    return row;
  }
  var ts = Date.parse(row.completedAt);
  if (!isFinite(ts) || Date.now() - ts < AI_USAGE_STALE_RUNNING_MS_) {
    return row;
  }
  var notes = String(row.notes || '').trim();
  var staleNote =
    'Stale running entry (server likely hit the 6-minute Apps Script limit). Refresh Settings and run sync again.';
  return {
    completedAt: row.completedAt,
    syncRunId: row.syncRunId,
    trigger: row.trigger,
    startYmd: row.startYmd,
    endYmd: row.endYmd,
    status: 'failed',
    durationMs: row.durationMs,
    rowsFetched: row.rowsFetched,
    rowsUpserted: row.rowsUpserted,
    rowsFailed: row.rowsFailed,
    matched: row.matched,
    unmatched: row.unmatched,
    notes: notes ? notes + '; ' + staleNote : staleNote,
    staleRunning: true,
  };
}

/**
 * @return {?Object}
 * @private
 */
function readLastSuccessfulAiUsageSyncRunFromSheet_() {
  var sheet = getAiUsageSyncRunsSheetOrNull_();
  if (!sheet) {
    return null;
  }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return null;
  }
  var values = sheet.getRange(2, 1, lastRow - 1, AI_USAGE_LOG_COLUMNS_.length).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    var row = aiUsageParseSyncLogRow_(values[i]);
    if (!row) {
      continue;
    }
    var status = String(row.status || '').toLowerCase();
    if (status === 'running') {
      continue;
    }
    if (status === 'complete' || status === 'partial') {
      return row;
    }
  }
  return null;
}

/**
 * @param {?number} rowIndex1Based null = last data row
 * @return {?Object}
 * @private
 */
function readAiUsageSyncRunFromSheetAtRow_(rowIndex1Based) {
  var sheet = getAiUsageSyncRunsSheetOrNull_();
  if (!sheet) {
    return null;
  }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return null;
  }
  var rowNum = rowIndex1Based != null ? rowIndex1Based : lastRow;
  if (rowNum < 2) {
    return null;
  }
  var values = sheet.getRange(rowNum, 1, 1, AI_USAGE_LOG_COLUMNS_.length).getValues();
  return aiUsageParseSyncLogRow_(values[0]);
}

/**
 * @param {!Array<*>} cells
 * @return {?Object}
 * @private
 */
function aiUsageParseSyncLogRow_(cells) {
  if (!cells || !cells.length) {
    return null;
  }
  var ts = cells[0];
  var completedAt = '';
  if (ts instanceof Date) {
    completedAt = ts.toISOString();
  } else if (ts) {
    completedAt = String(ts);
  }
  return {
    completedAt: completedAt,
    syncRunId: String(cells[1] || ''),
    trigger: String(cells[2] || ''),
    startYmd: aiUsageCellToYmd_(cells[3]),
    endYmd: aiUsageCellToYmd_(cells[4]),
    status: String(cells[5] || ''),
    durationMs: Number(cells[6] || 0),
    rowsFetched: Number(cells[7] || 0),
    rowsUpserted: Number(cells[8] || 0),
    rowsFailed: Number(cells[9] || 0),
    matched: Number(cells[10] || 0),
    unmatched: Number(cells[11] || 0),
    notes: String(cells[12] || ''),
  };
}

/**
 * Normalizes a spreadsheet cell to YYYY-MM-DD (log Date Start / Date End columns).
 *
 * @param {*} cell
 * @return {string}
 */
function aiUsageCellToYmd_(cell) {
  if (cell === null || cell === undefined || cell === '') {
    return '';
  }
  if (cell instanceof Date) {
    return Utilities.formatDate(cell, 'GMT', 'yyyy-MM-dd');
  }
  var s = String(cell).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }
  var d = new Date(s);
  if (!isNaN(d.getTime())) {
    return Utilities.formatDate(d, 'GMT', 'yyyy-MM-dd');
  }
  return s;
}

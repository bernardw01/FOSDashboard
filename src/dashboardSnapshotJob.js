/**
 * PRD version 2.1.0 — sync with docs/FOS-Dashboard-PRD.md
 *
 * Daily historical dashboard snapshot job. Fetches live Fibery payloads,
 * writes JSON artifacts to Google Drive (`dashboardSnapshotStore.js`),
 * batches Delivery P&L per project via continuation triggers, and logs
 * runs to the Snapshot Runs sheet tab.
 *
 * Script Properties:
 *   FOS_SNAPSHOT_DRIVE_FOLDER_ID
 *   FOS_SNAPSHOT_TIMEZONE              — default America/Chicago
 *   SNAPSHOT_UTILIZATION_LOOKBACK_DAYS — default 90
 *   SNAPSHOT_PNL_BATCH_SIZE            — default 8
 *   SNAPSHOT_RETENTION_DAYS            — default 90
 *   SNAPSHOT_TRIGGER_HOUR              — default 2 (local script TZ)
 *   FOS_SNAPSHOT_LOG_SHEET_NAME        — default Snapshot Runs
 *   AUTH_SPREADSHEET_ID                — same spreadsheet as Users tab
 *
 * Public (editor / trigger):
 *   runDailyDashboardSnapshot_()
 *   processSnapshotPnlBatch_()
 *   installDailySnapshotTrigger()
 *   removeDailySnapshotTriggers()
 *   ensureSnapshotDriveFolder()
 */

/** @const {string} */
var SNAPSHOT_UTIL_LOOKBACK_PROP_ = 'SNAPSHOT_UTILIZATION_LOOKBACK_DAYS';

/** @const {string} */
var SNAPSHOT_PNL_BATCH_PROP_ = 'SNAPSHOT_PNL_BATCH_SIZE';

/** @const {string} */
var SNAPSHOT_TRIGGER_HOUR_PROP_ = 'SNAPSHOT_TRIGGER_HOUR';

/** @const {string} */
var SNAPSHOT_LOG_SHEET_PROP_ = 'FOS_SNAPSHOT_LOG_SHEET_NAME';

/** @const {string} */
var SNAPSHOT_QUEUE_DATE_PROP_ = 'SNAPSHOT_QUEUE_DATE';

/** @const {string} */
var SNAPSHOT_QUEUE_IDS_PROP_ = 'SNAPSHOT_QUEUE_IDS';

/** @const {string} */
var SNAPSHOT_QUEUE_INDEX_PROP_ = 'SNAPSHOT_QUEUE_INDEX';

/** @const {string} */
var SNAPSHOT_QUEUE_FAILED_PROP_ = 'SNAPSHOT_QUEUE_FAILED_IDS';

/** @const {number} */
var SNAPSHOT_DEFAULT_UTIL_LOOKBACK_ = 90;

/** @const {number} */
var SNAPSHOT_DEFAULT_PNL_BATCH_ = 8;

/** @const {number} */
var SNAPSHOT_DEFAULT_TRIGGER_HOUR_ = 2;

/** @const {number} */
var SNAPSHOT_LOCK_WAIT_MS_ = 30000;

/** @const {string} */
var SNAPSHOT_DEFAULT_LOG_SHEET_ = 'Snapshot Runs';

/** @const {string[]} */
var SNAPSHOT_LOG_COLUMNS_ = [
  'Timestamp',
  'Snapshot Date',
  'Status',
  'Duration Ms',
  'Datasets',
  'Pnl Total',
  'Pnl Ok',
  'Pnl Failed',
  'Notes',
];

/**
 * Time-driven entry point (daily).
 */
function runDailyDashboardSnapshot_() {
  var snapshotDate = resolveSnapshotDateKey_();
  runDashboardSnapshotForDate_(snapshotDate, false);
}

/**
 * Continuation trigger for Delivery P&L batches.
 */
function processSnapshotPnlBatch_() {
  var props = PropertiesService.getScriptProperties();
  var snapshotDate = props.getProperty(SNAPSHOT_QUEUE_DATE_PROP_);
  if (!snapshotDate) {
    console.warn('processSnapshotPnlBatch_: no queue date');
    return;
  }
  var lock = LockService.getScriptLock();
  if (lock) {
    try {
      if (!lock.tryLock(SNAPSHOT_LOCK_WAIT_MS_)) {
        scheduleSnapshotPnlContinuation_();
        return;
      }
    } catch (e) {
      /* proceed */
    }
  }
  try {
    runPnlBatchForDate_(snapshotDate, true);
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
 * Manual / diagnostic run for a specific date.
 * @param {string} snapshotDate `YYYY-MM-DD`
 * @return {!Object}
 */
function _diag_runSnapshotForDate(snapshotDate) {
  var date =
    snapshotDate !== undefined && snapshotDate !== null && String(snapshotDate).trim()
      ? requireSnapshotDate_(snapshotDate)
      : resolveSnapshotDateKey_();
  var result = runDashboardSnapshotForDate_(date, true);
  console.log('_diag_runSnapshotForDate →', JSON.stringify(result));
  return result;
}

/**
 * Editor diagnostic: checks Script Properties, Drive folder access, and log
 * sheet before a full snapshot run. Does not call Fibery.
 *
 * @return {!Object}
 */
function _diag_snapshotPreflight() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var out = {
    ok: true,
    fiberyHostSet: !!props.FIBERY_HOST,
    fiberyTokenSet: !!props.FIBERY_API_TOKEN,
    authSpreadsheetIdSet: !!props.AUTH_SPREADSHEET_ID,
    snapshotFolderIdSet: !!props.FOS_SNAPSHOT_DRIVE_FOLDER_ID,
    snapshotFolderAccessible: false,
    logSheetName: props.FOS_SNAPSHOT_LOG_SHEET_NAME || SNAPSHOT_DEFAULT_LOG_SHEET_,
    logSheetAccessible: false,
    timezone: resolveSnapshotTimezone_(),
    todaySnapshotDate: resolveSnapshotDateKey_(),
    notes: [],
  };

  if (!out.authSpreadsheetIdSet) {
    out.ok = false;
    out.notes.push('AUTH_SPREADSHEET_ID is missing — Snapshot Runs will not be written.');
  } else {
    var logSheet = getSnapshotRunsSheetOrNull_();
    out.logSheetAccessible = !!logSheet;
    if (!logSheet) {
      out.ok = false;
      out.notes.push(
        'Could not open or create the Snapshot Runs tab. Check spreadsheet ID and script access.'
      );
    }
  }

  if (!out.snapshotFolderIdSet) {
    out.notes.push('FOS_SNAPSHOT_DRIVE_FOLDER_ID is missing — run ensureSnapshotDriveFolder() first.');
  } else {
    try {
      DriveApp.getFolderById(props.FOS_SNAPSHOT_DRIVE_FOLDER_ID);
      out.snapshotFolderAccessible = true;
    } catch (e) {
      out.ok = false;
      out.notes.push('Drive folder id is set but not accessible: ' + (e.message || e));
    }
  }

  if (!out.fiberyHostSet || !out.fiberyTokenSet) {
    out.ok = false;
    out.notes.push('FIBERY_HOST and/or FIBERY_API_TOKEN missing — snapshot fetch will fail.');
  }

  console.log('_diag_snapshotPreflight →', JSON.stringify(out));
  return out;
}

/**
 * @param {string} snapshotDate
 * @param {boolean} force When true, skip overlap lock (editor diagnostics only).
 * @return {!Object}
 */
function runDashboardSnapshotForDate_(snapshotDate, force) {
  var dateKey;
  try {
    dateKey = requireSnapshotDate_(snapshotDate);
  } catch (dateErr) {
    dateKey = String(snapshotDate || '');
    var startedMsEarly = Date.now();
    var summaryEarly = {
      ok: false,
      snapshotDate: dateKey,
      status: 'failed',
      message: dateErr && dateErr.message ? dateErr.message : String(dateErr),
    };
    logSnapshotRun_(dateKey || 'invalid', 'failed', Date.now() - startedMsEarly, summaryEarly);
    return summaryEarly;
  }
  snapshotDate = dateKey;

  var startedMs = Date.now();
  var startedAtIso = new Date().toISOString();
  var summary = {
    ok: false,
    snapshotDate: snapshotDate,
    status: 'failed',
    message: '',
  };

  var lock = LockService.getScriptLock();
  if (!lock) {
    summary.message = 'Lock unavailable';
    logSnapshotRun_(snapshotDate, 'failed', Date.now() - startedMs, summary);
    return summary;
  }
  var acquired = false;
  if (!force) {
    try {
      acquired = lock.tryLock(SNAPSHOT_LOCK_WAIT_MS_);
    } catch (e) {
      acquired = false;
    }
    if (!acquired) {
      summary.status = 'skipped';
      summary.message = 'Another snapshot run is in progress';
      logSnapshotRun_(snapshotDate, 'skipped', Date.now() - startedMs, summary);
      return summary;
    }
  } else {
    try {
      lock.waitLock(SNAPSHOT_LOCK_WAIT_MS_);
      acquired = true;
    } catch (e2) {
      acquired = false;
    }
  }

  try {
    var folderCheck = ensureSnapshotDriveFolder();
    if (!folderCheck.ok) {
      summary.message = folderCheck.message || 'Snapshot folder not configured';
      logSnapshotRun_(snapshotDate, 'failed', Date.now() - startedMs, summary);
      return summary;
    }

    var manifest = createEmptySnapshotManifest_(snapshotDate, startedAtIso);
    writeSnapshotManifest_(snapshotDate, manifest);

    var agreement = buildAgreementDashboardPayload_(snapshotDate);
    if (!agreement.ok) {
      manifest.status = 'failed';
      manifest.completedAt = new Date().toISOString();
      manifest.warnings.push(agreement.message || 'Agreement fetch failed');
      writeSnapshotManifest_(snapshotDate, manifest);
      summary.message = agreement.message || 'Agreement fetch failed';
      logSnapshotRun_(snapshotDate, 'failed', Date.now() - startedMs, summary);
      return summary;
    }

    var agreementMeta = writeSnapshotArtifact_(snapshotDate, 'agreement.json', agreement);
    appendManifestDataset_(
      manifest,
      'agreement',
      'agreement.json',
      agreementMeta,
      agreement.cacheSchemaVersion,
      agreement.fetchedAt,
      null,
      !!agreement.partial
    );

    var lookback = resolveSnapshotUtilLookbackDays_();
    var utilRange = buildUtilizationRangeForSnapshot_(snapshotDate, lookback);
    var utilization = buildUtilizationDashboardPayload_(utilRange.rangeStart, utilRange.rangeEnd);
    if (!utilization.ok) {
      manifest.warnings.push(utilization.message || 'Utilization fetch failed');
    } else {
      var utilMeta = writeSnapshotArtifact_(snapshotDate, 'utilization.json', utilization);
      appendManifestDataset_(
        manifest,
        'utilization',
        'utilization.json',
        utilMeta,
        utilization.cacheSchemaVersion,
        utilization.fetchedAt,
        {
          rangeStart: utilRange.rangeStart,
          rangeEnd: utilRange.rangeEnd,
          lookbackDays: lookback,
        },
        !!utilization.partial
      );
    }

    var delivery = buildDeliveryDashboardPayloadFromAgreement_(agreement);
    var deliveryMeta = writeSnapshotArtifact_(snapshotDate, 'delivery-projects.json', delivery);
    appendManifestDataset_(
      manifest,
      'delivery-projects',
      'delivery-projects.json',
      deliveryMeta,
      delivery.cacheSchemaVersion,
      delivery.fetchedAt,
      delivery.filtersApplied || null,
      false
    );

    writeSnapshotManifest_(snapshotDate, manifest);

    var projectIds = collectSnapshotPnlAgreementIds_(delivery);
    enqueueSnapshotPnlQueue_(snapshotDate, projectIds);

    manifest.pnlProgress = {
      total: projectIds.length,
      completed: 0,
      failedIds: [],
    };
    writeSnapshotManifest_(snapshotDate, manifest);

    if (projectIds.length === 0) {
      finalizeSnapshotManifest_(snapshotDate, manifest);
      summary.ok = true;
      summary.status = manifest.status;
      pruneOldSnapshotFolders_();
      logSnapshotRun_(snapshotDate, manifest.status, Date.now() - startedMs, summary, manifest);
      return summary;
    }

    scheduleSnapshotPnlContinuation_();
    var batchResult = runPnlBatchForDate_(snapshotDate, false);
    summary.ok = batchResult.ok;
    summary.status = batchResult.status || 'running';
    summary.message = batchResult.message || '';
    summary.pnlProgress = batchResult.pnlProgress;

    if (batchResult.done) {
      summary.status = batchResult.status;
      summary.ok = batchResult.status === 'complete';
    } else {
      summary.message =
        (summary.message || '') +
        ' Core datasets written; P&L batch in progress (check Triggers or re-run after continuations).';
      console.warn(
        'Snapshot ' +
          snapshotDate +
          ': still running — ' +
          (batchResult.pnlProgress
            ? batchResult.pnlProgress.completed + '/' + batchResult.pnlProgress.total
            : '') +
          ' P&L projects'
      );
    }

    return summary;
  } catch (err) {
    summary.message = err && err.message ? err.message : String(err);
    logSnapshotRun_(snapshotDate, 'failed', Date.now() - startedMs, summary);
    return summary;
  } finally {
    if (acquired) {
      try {
        lock.releaseLock();
      } catch (_) {
        /* ignore */
      }
    }
  }
}

/**
 * @param {!Object} deliveryPayload
 * @return {!Array<string>}
 * @private
 */
function collectSnapshotPnlAgreementIds_(deliveryPayload) {
  var ids = [];
  var projects = (deliveryPayload && deliveryPayload.projects) || [];
  for (var i = 0; i < projects.length; i++) {
    if (projects[i] && projects[i].id) {
      ids.push(String(projects[i].id));
    }
  }
  return ids;
}

/**
 * @param {string} snapshotDate
 * @param {!Array<string>} ids
 * @private
 */
function enqueueSnapshotPnlQueue_(snapshotDate, ids) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty(SNAPSHOT_QUEUE_DATE_PROP_, snapshotDate);
  props.setProperty(SNAPSHOT_QUEUE_IDS_PROP_, JSON.stringify(ids));
  props.setProperty(SNAPSHOT_QUEUE_INDEX_PROP_, '0');
  props.setProperty(SNAPSHOT_QUEUE_FAILED_PROP_, '[]');
}

/**
 * @private
 */
function clearSnapshotPnlQueue_() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty(SNAPSHOT_QUEUE_DATE_PROP_);
  props.deleteProperty(SNAPSHOT_QUEUE_IDS_PROP_);
  props.deleteProperty(SNAPSHOT_QUEUE_INDEX_PROP_);
  props.deleteProperty(SNAPSHOT_QUEUE_FAILED_PROP_);
}

/**
 * @param {string} snapshotDate
 * @param {boolean} fromContinuation
 * @return {!Object}
 * @private
 */
function runPnlBatchForDate_(snapshotDate, fromContinuation) {
  var props = PropertiesService.getScriptProperties();
  var queueDate = props.getProperty(SNAPSHOT_QUEUE_DATE_PROP_);
  if (queueDate !== snapshotDate) {
    return { ok: false, done: true, status: 'failed', message: 'Queue date mismatch' };
  }

  var ids;
  try {
    ids = JSON.parse(props.getProperty(SNAPSHOT_QUEUE_IDS_PROP_) || '[]');
  } catch (e) {
    ids = [];
  }
  var index = parseInt(props.getProperty(SNAPSHOT_QUEUE_INDEX_PROP_) || '0', 10);
  if (!isFinite(index) || index < 0) {
    index = 0;
  }
  var failedIds;
  try {
    failedIds = JSON.parse(props.getProperty(SNAPSHOT_QUEUE_FAILED_PROP_) || '[]');
  } catch (e2) {
    failedIds = [];
  }

  var batchSize = resolveSnapshotPnlBatchSize_();
  var manifest = readSnapshotManifest_(snapshotDate) || createEmptySnapshotManifest_(snapshotDate, new Date().toISOString());
  var completed = 0;

  while (index < ids.length && completed < batchSize) {
    var agreementId = ids[index];
    index++;
    var pnl = buildDeliveryProjectMonthlyPnLInternal_(agreementId);
    var relPath = snapshotPnlRelativePath_(agreementId);
    if (pnl.ok) {
      var meta = writeSnapshotArtifact_(snapshotDate, relPath, pnl);
      appendManifestDataset_(
        manifest,
        'delivery-pnl-' + agreementId,
        relPath,
        meta,
        pnl.cacheSchemaVersion,
        pnl.fetchedAt,
        { agreementId: agreementId },
        !!pnl.partial
      );
    } else {
      failedIds.push(agreementId);
      manifest.warnings.push('PnL failed for ' + agreementId + ': ' + (pnl.message || 'unknown'));
    }
    completed++;
  }

  props.setProperty(SNAPSHOT_QUEUE_INDEX_PROP_, String(index));
  props.setProperty(SNAPSHOT_QUEUE_FAILED_PROP_, JSON.stringify(failedIds));

  manifest.pnlProgress = {
    total: ids.length,
    completed: index,
    failedIds: failedIds.slice(),
  };
  writeSnapshotManifest_(snapshotDate, manifest);

  if (index >= ids.length) {
    deleteSnapshotContinueTriggers_();
    clearSnapshotPnlQueue_();
    finalizeSnapshotManifest_(snapshotDate, manifest);
    pruneOldSnapshotFolders_();
    var durationMs = manifest.startedAt
      ? Date.now() - new Date(manifest.startedAt).getTime()
      : 0;
    logSnapshotRun_(snapshotDate, manifest.status, durationMs, {
      ok: manifest.status === 'complete',
      status: manifest.status,
      message: 'PnL continuation finished',
      pnlProgress: manifest.pnlProgress,
    }, manifest);
    return {
      ok: true,
      done: true,
      status: manifest.status,
      message: 'PnL batch complete',
      pnlProgress: manifest.pnlProgress,
    };
  }

  scheduleSnapshotPnlContinuation_();
  return {
    ok: true,
    done: false,
    status: 'running',
    message: 'PnL batch ' + index + '/' + ids.length,
    pnlProgress: manifest.pnlProgress,
  };
}

/**
 * @param {string} snapshotDate
 * @param {!Object} manifest
 * @private
 */
function finalizeSnapshotManifest_(snapshotDate, manifest) {
  var failed = (manifest.pnlProgress && manifest.pnlProgress.failedIds) || [];
  var coreFailed = false;
  for (var i = 0; i < (manifest.datasets || []).length; i++) {
    var ds = manifest.datasets[i];
    if (ds.id === 'agreement' && ds.error) {
      coreFailed = true;
    }
  }
  if (coreFailed) {
    manifest.status = 'failed';
  } else if (failed.length > 0) {
    manifest.status = 'partial';
  } else {
    manifest.status = 'complete';
  }
  manifest.completedAt = new Date().toISOString();
  writeSnapshotManifest_(snapshotDate, manifest);
}

/**
 * @private
 */
function scheduleSnapshotPnlContinuation_() {
  deleteSnapshotContinueTriggers_();
  ScriptApp.newTrigger('processSnapshotPnlBatch_')
    .timeBased()
    .after(60 * 1000)
    .create();
}

/**
 * @private
 */
function deleteSnapshotContinueTriggers_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processSnapshotPnlBatch_') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

/**
 * @return {number}
 * @private
 */
function resolveSnapshotUtilLookbackDays_() {
  var raw = PropertiesService.getScriptProperties().getProperty(SNAPSHOT_UTIL_LOOKBACK_PROP_);
  var n = parseInt(raw, 10);
  if (!isFinite(n) || n < 1) {
    return SNAPSHOT_DEFAULT_UTIL_LOOKBACK_;
  }
  return n;
}

/**
 * @return {number}
 * @private
 */
function resolveSnapshotPnlBatchSize_() {
  var raw = PropertiesService.getScriptProperties().getProperty(SNAPSHOT_PNL_BATCH_PROP_);
  var n = parseInt(raw, 10);
  if (!isFinite(n) || n < 1) {
    return SNAPSHOT_DEFAULT_PNL_BATCH_;
  }
  return Math.min(n, 25);
}

/**
 * @return {{ ok: boolean, message?: string }}
 */
function installDailySnapshotTrigger() {
  removeDailySnapshotTriggers();
  var hour = SNAPSHOT_DEFAULT_TRIGGER_HOUR_;
  var raw = PropertiesService.getScriptProperties().getProperty(SNAPSHOT_TRIGGER_HOUR_PROP_);
  var parsed = parseInt(raw, 10);
  if (isFinite(parsed) && parsed >= 0 && parsed <= 23) {
    hour = parsed;
  }
  ScriptApp.newTrigger('runDailyDashboardSnapshot_')
    .timeBased()
    .everyDays(1)
    .atHour(hour)
    .create();
  return { ok: true, message: 'Daily snapshot trigger installed at hour ' + hour };
}

/**
 * @return {{ ok: boolean, deleted: number }}
 */
function removeDailySnapshotTriggers() {
  var deleted = 0;
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === 'runDailyDashboardSnapshot_' || fn === 'processSnapshotPnlBatch_') {
      ScriptApp.deleteTrigger(triggers[i]);
      deleted++;
    }
  }
  return { ok: true, deleted: deleted };
}

/**
 * @param {string} snapshotDate
 * @param {string} status
 * @param {number} durationMs
 * @param {!Object} summary
 * @param {?Object=} manifest
 * @private
 */
function logSnapshotRun_(snapshotDate, status, durationMs, summary, manifest) {
  try {
    var sheet = getSnapshotRunsSheetOrNull_();
    if (!sheet) {
      console.warn(
        'logSnapshotRun_: no Snapshot Runs sheet (set AUTH_SPREADSHEET_ID; tab name ' +
          (PropertiesService.getScriptProperties().getProperty(SNAPSHOT_LOG_SHEET_PROP_) ||
            SNAPSHOT_DEFAULT_LOG_SHEET_) +
          '). status=' +
          status +
          ' date=' +
          snapshotDate +
          ' notes=' +
          (summary && summary.message ? summary.message : '')
      );
      return;
    }
    var pnl = (manifest && manifest.pnlProgress) || summary.pnlProgress || {};
    var failed = pnl.failedIds || [];
    var datasetCount = manifest && manifest.datasets ? manifest.datasets.length : 0;
    var notes = summary.message || '';
    if (manifest && manifest.warnings && manifest.warnings.length) {
      notes = (notes ? notes + '; ' : '') + manifest.warnings.slice(0, 3).join('; ');
    }
    sheet.appendRow([
      new Date().toISOString(),
      snapshotDate,
      status,
      durationMs,
      datasetCount,
      pnl.total || 0,
      Math.max(0, (pnl.completed || 0) - failed.length),
      failed.length,
      truncateSnapshotNotes_(notes),
    ]);
  } catch (e) {
    console.warn('logSnapshotRun_ failed: ' + (e && e.message ? e.message : e));
  }
}

/**
 * @param {string} s
 * @return {string}
 * @private
 */
function truncateSnapshotNotes_(s) {
  var t = String(s || '');
  return t.length > 500 ? t.slice(0, 497) + '...' : t;
}

/**
 * @return {GoogleAppsScript.Spreadsheet.Sheet|null}
 * @private
 */
function getSnapshotRunsSheetOrNull_() {
  var props = PropertiesService.getScriptProperties();
  var spreadsheetId = props.getProperty('AUTH_SPREADSHEET_ID');
  if (!spreadsheetId) {
    return null;
  }
  var sheetName = String(
    props.getProperty(SNAPSHOT_LOG_SHEET_PROP_) || SNAPSHOT_DEFAULT_LOG_SHEET_
  ).trim();
  if (!sheetName) {
    sheetName = SNAPSHOT_DEFAULT_LOG_SHEET_;
  }
  try {
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(SNAPSHOT_LOG_COLUMNS_);
    } else if (sheet.getLastRow() < 1) {
      sheet.appendRow(SNAPSHOT_LOG_COLUMNS_);
    }
    return sheet;
  } catch (e) {
    console.warn('getSnapshotRunsSheetOrNull_: ' + (e && e.message ? e.message : e));
    return null;
  }
}

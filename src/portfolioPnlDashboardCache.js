/**
 * PRD version 3.0.12 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Daily Drive cache for Portfolio P&L (feature 025). First Fibery build each
 * calendar day writes portfolio-pnl-cache/YYYY-MM-DD/ on Drive; later loads
 * read the bundle until Refresh (force rebuild).
 */

/** @const {string} */
var PORTFOLIO_PNL_DRIVE_CACHE_SUBFOLDER_ = 'portfolio-pnl-cache';

/** @const {string} */
var PORTFOLIO_PNL_DRIVE_CACHE_MANIFEST_FILE_ = 'manifest.json';

/** @const {string} */
var PORTFOLIO_PNL_DRIVE_CACHE_BUNDLE_FILE_ = 'bundle.json';

/** @const {string} */
var PORTFOLIO_PNL_LIVE_BUILD_STATE_FILE_ = 'build-state.json';

/** @const {number} */
var PORTFOLIO_PNL_DRIVE_CACHE_MANIFEST_VERSION_ = 1;

/** @const {number} */
var PORTFOLIO_PNL_BUNDLE_CACHE_SCHEMA_VERSION_ = 1;

/** @const {number} */
var PORTFOLIO_PNL_LIVE_BUILD_STATE_VERSION_ = 1;

/** @const {string} */
var PORTFOLIO_PNL_DRIVE_CACHE_ENABLED_PROP_ = 'PORTFOLIO_PNL_DRIVE_CACHE_ENABLED';

/** @const {string} */
var PORTFOLIO_PNL_LIVE_BUILD_BATCH_SIZE_PROP_ = 'PORTFOLIO_PNL_LIVE_BUILD_BATCH_SIZE';

/** @const {string} */
var PORTFOLIO_PNL_LIVE_QUEUE_DATE_PROP_ = 'PORTFOLIO_PNL_LIVE_QUEUE_DATE';

/** @const {string} */
var PORTFOLIO_PNL_LIVE_QUEUE_BUILD_ID_PROP_ = 'PORTFOLIO_PNL_LIVE_QUEUE_BUILD_ID';

/** @const {number} */
var PORTFOLIO_PNL_LIVE_BUILD_BATCH_SIZE_DEFAULT_ = 8;

/** @const {number} */
var PORTFOLIO_PNL_LIVE_BUILD_BATCH_SIZE_MAX_ = 25;

/** @const {number} */
var PORTFOLIO_PNL_LIVE_CONTINUATION_DELAY_MS_ = 1000;

/** @const {number} */
var PORTFOLIO_PNL_DRIVE_CACHE_LOCK_MS_ = 120000;

/** @const {number} */
var PORTFOLIO_PNL_DRIVE_CACHE_RETENTION_DAYS_ = 14;

/**
 * @return {boolean}
 */
function isPortfolioPnlDriveCacheEnabled_() {
  if (typeof shouldServeFromSupabase_ === 'function' && shouldServeFromSupabase_()) {
    return false;
  }
  if (!isPortfolioPnlDriveCacheConfigured_()) {
    return false;
  }
  var raw = PropertiesService.getScriptProperties().getProperty(PORTFOLIO_PNL_DRIVE_CACHE_ENABLED_PROP_);
  if (raw === null || raw === undefined || raw === '') {
    return true;
  }
  return String(raw).trim().toLowerCase() === 'true';
}

/**
 * @return {boolean}
 */
function isPortfolioPnlDriveCacheConfigured_() {
  var id = PropertiesService.getScriptProperties().getProperty(SNAPSHOT_DRIVE_FOLDER_PROP_);
  if (!id || !String(id).trim()) {
    return false;
  }
  try {
    DriveApp.getFolderById(String(id).trim());
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * @return {number}
 * @private
 */
function resolvePortfolioPnlLiveBuildBatchSize_() {
  var raw = PropertiesService.getScriptProperties().getProperty(
    PORTFOLIO_PNL_LIVE_BUILD_BATCH_SIZE_PROP_
  );
  var n = parseInt(raw, 10);
  if (!isFinite(n) || n < 1) {
    n = PORTFOLIO_PNL_LIVE_BUILD_BATCH_SIZE_DEFAULT_;
  }
  return Math.min(PORTFOLIO_PNL_LIVE_BUILD_BATCH_SIZE_MAX_, Math.max(1, Math.round(n)));
}

/**
 * @param {string} cacheDateKey
 * @return {GoogleAppsScript.Drive.Folder}
 * @private
 */
function getOrCreatePortfolioPnlDriveCacheDateFolder_(cacheDateKey) {
  var root = getSnapshotRootFolder_();
  var cacheRootIt = root.getFoldersByName(PORTFOLIO_PNL_DRIVE_CACHE_SUBFOLDER_);
  var cacheRoot = cacheRootIt.hasNext()
    ? cacheRootIt.next()
    : root.createFolder(PORTFOLIO_PNL_DRIVE_CACHE_SUBFOLDER_);
  var dateIt = cacheRoot.getFoldersByName(cacheDateKey);
  if (dateIt.hasNext()) {
    return dateIt.next();
  }
  return cacheRoot.createFolder(cacheDateKey);
}

/**
 * @param {GoogleAppsScript.Drive.Folder} folder
 * @param {string} fileName
 * @return {?Object}
 * @private
 */
function readPortfolioPnlJsonFromFolder_(folder, fileName) {
  var files = folder.getFilesByName(fileName);
  if (!files.hasNext()) {
    return null;
  }
  try {
    return JSON.parse(files.next().getBlob().getDataAsString());
  } catch (e) {
    console.warn('readPortfolioPnlJsonFromFolder_: ' + (e && e.message ? e.message : e));
    return null;
  }
}

/**
 * @param {GoogleAppsScript.Drive.Folder} folder
 * @param {string} fileName
 * @param {!Object} obj
 * @return {{ fileId: string, byteSize: number }}
 * @private
 */
function writePortfolioPnlJsonInFolder_(folder, fileName, obj) {
  var json = JSON.stringify(obj);
  var existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) {
    existing.next().setTrashed(true);
  }
  var file = folder.createFile(Utilities.newBlob(json, 'application/json', fileName));
  return { fileId: file.getId(), byteSize: json.length };
}

/**
 * @param {GoogleAppsScript.Drive.Folder} folder
 * @param {string} fileName
 * @private
 */
function trashPortfolioPnlFilesInFolder_(folder, fileName) {
  var files = folder.getFilesByName(fileName);
  while (files.hasNext()) {
    files.next().setTrashed(true);
  }
}

/**
 * @param {string} cacheDateKey
 * @return {?{ manifest: !Object, bundle: !Object }}
 */
function readPortfolioPnlDriveCache_(cacheDateKey) {
  try {
    var folder = getOrCreatePortfolioPnlDriveCacheDateFolder_(cacheDateKey);
    var manifest = readPortfolioPnlJsonFromFolder_(folder, PORTFOLIO_PNL_DRIVE_CACHE_MANIFEST_FILE_);
    var bundle = readPortfolioPnlJsonFromFolder_(folder, PORTFOLIO_PNL_DRIVE_CACHE_BUNDLE_FILE_);
    if (!manifest || !bundle) {
      return null;
    }
    if (
      String(manifest.cacheDateKey || '') !== cacheDateKey ||
      manifest.status === 'building'
    ) {
      return null;
    }
    if (bundle.cacheSchemaVersion !== PORTFOLIO_PNL_BUNDLE_CACHE_SCHEMA_VERSION_) {
      return null;
    }
    return { manifest: manifest, bundle: bundle };
  } catch (e) {
    console.warn('readPortfolioPnlDriveCache_: ' + (e && e.message ? e.message : e));
    return null;
  }
}

/**
 * @param {string} cacheDateKey
 * @return {?Object}
 * @private
 */
function readPortfolioPnlLiveBuildState_(cacheDateKey) {
  try {
    var folder = getOrCreatePortfolioPnlDriveCacheDateFolder_(cacheDateKey);
    var state = readPortfolioPnlJsonFromFolder_(folder, PORTFOLIO_PNL_LIVE_BUILD_STATE_FILE_);
    if (
      !state ||
      state.stateVersion !== PORTFOLIO_PNL_LIVE_BUILD_STATE_VERSION_ ||
      state.status !== 'building' ||
      String(state.cacheDateKey || '') !== cacheDateKey ||
      !state.buildId
    ) {
      return null;
    }
    return state;
  } catch (e) {
    console.warn('readPortfolioPnlLiveBuildState_: ' + (e && e.message ? e.message : e));
    return null;
  }
}

/**
 * @param {!Object} state
 * @return {!Object}
 * @private
 */
function portfolioPnlLiveBuildingResponse_(state) {
  var total = Math.max(0, Number(state.total) || (state.projects || []).length);
  var done = Math.min(total, Math.max(0, Number(state.cursor) || 0));
  return {
    ok: true,
    building: true,
    done: done,
    total: total,
    cacheDateKey: String(state.cacheDateKey || ''),
    source: 'fibery',
    loadSource: 'fibery',
    fromDrive: false,
    partial: (state.failedIds || []).length > 0,
    failedIds: (state.failedIds || []).slice(),
  };
}

/**
 * @param {string} cacheDateKey
 * @param {!Object} manifest
 * @param {!Object} bundle
 * @return {!Object}
 */
function writePortfolioPnlDriveCache_(cacheDateKey, manifest, bundle) {
  var folder = getOrCreatePortfolioPnlDriveCacheDateFolder_(cacheDateKey);
  var manifestWrite = writePortfolioPnlJsonInFolder_(folder, PORTFOLIO_PNL_DRIVE_CACHE_MANIFEST_FILE_, manifest);
  var bundleWrite = writePortfolioPnlJsonInFolder_(folder, PORTFOLIO_PNL_DRIVE_CACHE_BUNDLE_FILE_, bundle);
  pruneOldPortfolioPnlDriveCacheFolders_(cacheDateKey);
  return {
    ok: true,
    manifestFileId: manifestWrite.fileId,
    bundleFileId: bundleWrite.fileId,
    manifestBytes: manifestWrite.byteSize,
    bundleBytes: bundleWrite.byteSize,
  };
}

/**
 * @param {string} currentCacheDateKey
 * @private
 */
function pruneOldPortfolioPnlDriveCacheFolders_(currentCacheDateKey) {
  try {
    var root = getSnapshotRootFolder_();
    var cacheRootIt = root.getFoldersByName(PORTFOLIO_PNL_DRIVE_CACHE_SUBFOLDER_);
    if (!cacheRootIt.hasNext()) {
      return;
    }
    var cacheRoot = cacheRootIt.next();
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - PORTFOLIO_PNL_DRIVE_CACHE_RETENTION_DAYS_);
    var cutoffKey = Utilities.formatDate(cutoff, resolveSnapshotTimezone_(), 'yyyy-MM-dd');
    var folders = cacheRoot.getFolders();
    while (folders.hasNext()) {
      var folder = folders.next();
      var name = folder.getName();
      if (name === currentCacheDateKey) {
        continue;
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(name) && name < cutoffKey) {
        folder.setTrashed(true);
      }
    }
  } catch (e) {
    console.warn('pruneOldPortfolioPnlDriveCacheFolders_: ' + (e && e.message ? e.message : e));
  }
}

/**
 * @return {!Object}
 * @private
 */
function buildPortfolioPnlBundleFromFibery_() {
  var fetchedAt = new Date().toISOString();
  var index = getPortfolioProjectIndex();
  if (!index || !index.ok) {
    return {
      ok: false,
      source: 'fibery',
      fetchedAt: fetchedAt,
      message: (index && index.message) || 'Could not load portfolio project index.',
    };
  }
  var projects = index.projects || [];
  var pnlById = {};
  var failedIds = [];
  var failedDetails = [];
  for (var i = 0; i < projects.length; i++) {
    var id = projects[i].id;
    try {
      var pnl = buildPortfolioMonthlyPnLInternal_(id);
      if (pnl && pnl.ok === true) {
        pnlById[id] = pnl;
      } else {
        failedIds.push(id);
        failedDetails.push({
          id: id,
          name: projects[i].name || id,
          message: (pnl && pnl.message) || 'P&L build failed.',
        });
      }
    } catch (e) {
      failedIds.push(id);
      failedDetails.push({
        id: id,
        name: projects[i].name || id,
        message: e && e.message ? e.message : String(e),
      });
    }
  }
  return {
    ok: true,
    source: 'fibery',
    fetchedAt: fetchedAt,
    cacheSchemaVersion: PORTFOLIO_PNL_BUNDLE_CACHE_SCHEMA_VERSION_,
    calendarYear: index.calendarYear || new Date().getFullYear(),
    projects: projects,
    pnlById: pnlById,
    failedIds: failedIds,
    failedDetails: failedDetails,
    partial: failedIds.length > 0,
    projectCount: projects.length,
  };
}

/**
 * Best-effort live build advance when the client polls building progress.
 *
 * @param {string} cacheDateKey
 * @private
 */
function refreshPortfolioPnlLiveBuildProgressOnPoll_(cacheDateKey) {
  var props = PropertiesService.getScriptProperties();
  var queuedDate = props.getProperty(PORTFOLIO_PNL_LIVE_QUEUE_DATE_PROP_);
  var buildId = props.getProperty(PORTFOLIO_PNL_LIVE_QUEUE_BUILD_ID_PROP_);
  if (!queuedDate || queuedDate !== cacheDateKey || !buildId) {
    return;
  }
  var state = readPortfolioPnlLiveBuildState_(cacheDateKey);
  if (!state || state.buildId !== buildId) {
    return;
  }
  var lock = LockService.getScriptLock();
  var lockToken = null;
  try {
    if (!lock.tryLock(0)) {
      return;
    }
    lockToken = beginScriptLockNest_(lock, 0);
    state = readPortfolioPnlLiveBuildState_(cacheDateKey);
    if (!state || state.buildId !== buildId) {
      return;
    }
    runPortfolioPnlLiveBatch_(state);
  } catch (e) {
    console.warn('refreshPortfolioPnlLiveBuildProgressOnPoll_: ' + (e && e.message ? e.message : e));
  } finally {
    endScriptLockNest_(lockToken);
  }
}

/**
 * @param {string} cacheDateKey
 * @param {boolean} forceRefresh
 * @return {!Object}
 */
function loadOrBuildPortfolioPnlDriveCache_(cacheDateKey, forceRefresh) {
  if (!forceRefresh) {
    var cached = readPortfolioPnlDriveCache_(cacheDateKey);
    if (cached && cached.bundle) {
      return {
        ok: true,
        fromDrive: true,
        manifest: cached.manifest,
        bundle: cached.bundle,
      };
    }
    var activeState = readPortfolioPnlLiveBuildState_(cacheDateKey);
    if (activeState) {
      refreshPortfolioPnlLiveBuildProgressOnPoll_(cacheDateKey);
      cached = readPortfolioPnlDriveCache_(cacheDateKey);
      if (cached && cached.bundle) {
        return {
          ok: true,
          fromDrive: true,
          manifest: cached.manifest,
          bundle: cached.bundle,
        };
      }
      activeState = readPortfolioPnlLiveBuildState_(cacheDateKey);
      if (activeState) {
        return portfolioPnlLiveBuildingResponse_(activeState);
      }
    }
  }

  var index = getPortfolioProjectIndex();
  if (!index || !index.ok) {
    return {
      ok: false,
      source: 'fibery',
      fetchedAt: new Date().toISOString(),
      message: (index && index.message) || 'Could not load portfolio project index.',
    };
  }

  var lock = LockService.getScriptLock();
  var lockToken = null;
  try {
    try {
      lockToken = beginScriptLockNest_(lock, PORTFOLIO_PNL_DRIVE_CACHE_LOCK_MS_);
    } catch (lockErr) {
      if (!forceRefresh) {
        var lockWaitCached = readPortfolioPnlDriveCache_(cacheDateKey);
        if (lockWaitCached && lockWaitCached.bundle) {
          return {
            ok: true,
            fromDrive: true,
            manifest: lockWaitCached.manifest,
            bundle: lockWaitCached.bundle,
          };
        }
        var lockWaitState = readPortfolioPnlLiveBuildState_(cacheDateKey);
        if (lockWaitState) {
          return portfolioPnlLiveBuildingResponse_(lockWaitState);
        }
      }
      return {
        ok: false,
        reason: 'LOCK_TIMEOUT',
        message: 'Portfolio P&L Drive cache lock timed out. Try again shortly.',
      };
    }

    if (!forceRefresh) {
      var again = readPortfolioPnlDriveCache_(cacheDateKey);
      if (again && again.bundle) {
        return {
          ok: true,
          fromDrive: true,
          manifest: again.manifest,
          bundle: again.bundle,
        };
      }
      var activeAgain = readPortfolioPnlLiveBuildState_(cacheDateKey);
      if (activeAgain) {
        return portfolioPnlLiveBuildingResponse_(activeAgain);
      }
    }

    if (forceRefresh) {
      resetPortfolioPnlLiveBuild_(cacheDateKey);
    }

    var startedAt = new Date().toISOString();
    var projects = index.projects || [];
    var state = {
      stateVersion: PORTFOLIO_PNL_LIVE_BUILD_STATE_VERSION_,
      status: 'building',
      cacheDateKey: cacheDateKey,
      buildId: Utilities.getUuid(),
      startedAt: startedAt,
      updatedAt: startedAt,
      fetchedAt: index.fetchedAt || startedAt,
      calendarYear: index.calendarYear || new Date().getFullYear(),
      projects: projects,
      pnlById: {},
      failedIds: [],
      failedDetails: [],
      cursor: 0,
      total: projects.length,
    };
    writePortfolioPnlLiveBuildState_(state);
    enqueuePortfolioPnlLiveBuild_(state);

    var batch = runPortfolioPnlLiveBatch_(state);
    if (batch.complete) {
      return {
        ok: true,
        fromDrive: false,
        rebuilt: true,
        manifest: batch.manifest,
        bundle: batch.bundle,
      };
    }
    return portfolioPnlLiveBuildingResponse_(batch.state);
  } finally {
    endScriptLockNest_(lockToken);
  }
}

/**
 * Trigger entry point for the active live Portfolio P&L build.
 *
 * @return {!Object}
 */
function processPortfolioPnlLiveBatch_() {
  var props = PropertiesService.getScriptProperties();
  var cacheDateKey = props.getProperty(PORTFOLIO_PNL_LIVE_QUEUE_DATE_PROP_);
  var buildId = props.getProperty(PORTFOLIO_PNL_LIVE_QUEUE_BUILD_ID_PROP_);
  if (!cacheDateKey || !buildId) {
    deletePortfolioPnlLiveContinuationTriggers_();
    return { ok: true, done: true, message: 'No active live Portfolio P&L build.' };
  }

  var lock = LockService.getScriptLock();
  var lockToken = null;
  try {
    if (!lock.tryLock(PORTFOLIO_PNL_DRIVE_CACHE_LOCK_MS_)) {
      schedulePortfolioPnlLiveContinuation_();
      return { ok: true, done: false, message: 'Live Portfolio P&L build lock is busy; rescheduled.' };
    }
    lockToken = beginScriptLockNest_(lock, 0);

    cacheDateKey = props.getProperty(PORTFOLIO_PNL_LIVE_QUEUE_DATE_PROP_);
    buildId = props.getProperty(PORTFOLIO_PNL_LIVE_QUEUE_BUILD_ID_PROP_);
    var state = cacheDateKey ? readPortfolioPnlLiveBuildState_(cacheDateKey) : null;
    if (!state || state.buildId !== buildId) {
      clearPortfolioPnlLiveBuildQueue_(buildId);
      return { ok: false, done: true, message: 'Live Portfolio P&L build state is missing.' };
    }

    var result = runPortfolioPnlLiveBatch_(state);
    return result.complete
      ? { ok: true, done: true, total: state.total, cacheDateKey: cacheDateKey }
      : portfolioPnlLiveBuildingResponse_(result.state);
  } catch (e) {
    console.warn('processPortfolioPnlLiveBatch_: ' + (e && e.message ? e.message : e));
    schedulePortfolioPnlLiveContinuation_();
    return {
      ok: false,
      done: false,
      cacheDateKey: cacheDateKey,
      message: e && e.message ? e.message : String(e),
    };
  } finally {
    endScriptLockNest_(lockToken);
  }
}

/**
 * @param {!Object} state
 * @return {{ complete: boolean, state: !Object, manifest: (Object|undefined), bundle: (Object|undefined) }}
 * @private
 */
function runPortfolioPnlLiveBatch_(state) {
  var projects = state.projects || [];
  var total = Math.max(0, Number(state.total) || projects.length);
  var cursor = Math.max(0, Number(state.cursor) || 0);
  var processed = 0;
  var batchSize = resolvePortfolioPnlLiveBuildBatchSize_();
  state.pnlById = state.pnlById || {};
  state.failedIds = state.failedIds || [];
  state.failedDetails = state.failedDetails || [];

  while (cursor < total && processed < batchSize) {
    var project = projects[cursor] || {};
    var id = project.id;
    try {
      var pnl = buildPortfolioMonthlyPnLInternal_(id);
      if (pnl && pnl.ok === true) {
        state.pnlById[id] = pnl;
      } else {
        appendPortfolioPnlLiveFailure_(
          state,
          id,
          project.name || id,
          (pnl && pnl.message) || 'P&L build failed.'
        );
      }
    } catch (e) {
      appendPortfolioPnlLiveFailure_(
        state,
        id,
        project.name || id,
        e && e.message ? e.message : String(e)
      );
    }
    cursor++;
    processed++;
    state.cursor = cursor;
    state.total = total;
    state.updatedAt = new Date().toISOString();
    writePortfolioPnlLiveBuildState_(state);
  }

  if (cursor >= total) {
    return finalizePortfolioPnlLiveBuild_(state);
  }

  schedulePortfolioPnlLiveContinuation_();
  return { complete: false, state: state };
}

/**
 * @param {!Object} state
 * @param {string} id
 * @param {string} name
 * @param {string} message
 * @private
 */
function appendPortfolioPnlLiveFailure_(state, id, name, message) {
  state.failedIds.push(id);
  state.failedDetails.push({
    id: id,
    name: name || id,
    message: message || 'P&L build failed.',
  });
}

/**
 * @param {!Object} state
 * @private
 */
function writePortfolioPnlLiveBuildState_(state) {
  var folder = getOrCreatePortfolioPnlDriveCacheDateFolder_(state.cacheDateKey);
  trashPortfolioPnlFilesInFolder_(folder, PORTFOLIO_PNL_DRIVE_CACHE_BUNDLE_FILE_);
  writePortfolioPnlJsonInFolder_(folder, PORTFOLIO_PNL_LIVE_BUILD_STATE_FILE_, state);
  writePortfolioPnlJsonInFolder_(folder, PORTFOLIO_PNL_DRIVE_CACHE_MANIFEST_FILE_, {
    cacheManifestVersion: PORTFOLIO_PNL_DRIVE_CACHE_MANIFEST_VERSION_,
    cacheDateKey: state.cacheDateKey,
    cacheSchemaVersion: PORTFOLIO_PNL_BUNDLE_CACHE_SCHEMA_VERSION_,
    status: 'building',
    buildId: state.buildId,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    projectCount: state.total,
    completedCount: state.cursor,
    failedCount: (state.failedIds || []).length,
    source: 'fibery',
  });
}

/**
 * @param {!Object} state
 * @return {{ complete: boolean, state: !Object, manifest: !Object, bundle: !Object }}
 * @private
 */
function finalizePortfolioPnlLiveBuild_(state) {
  var bundle = {
    ok: true,
    source: 'fibery',
    fetchedAt: state.fetchedAt || state.startedAt || new Date().toISOString(),
    cacheSchemaVersion: PORTFOLIO_PNL_BUNDLE_CACHE_SCHEMA_VERSION_,
    calendarYear: state.calendarYear || new Date().getFullYear(),
    projects: state.projects || [],
    pnlById: state.pnlById || {},
    failedIds: state.failedIds || [],
    failedDetails: state.failedDetails || [],
    partial: (state.failedIds || []).length > 0,
    projectCount: (state.projects || []).length,
  };
  var manifest = {
    cacheManifestVersion: PORTFOLIO_PNL_DRIVE_CACHE_MANIFEST_VERSION_,
    cacheDateKey: state.cacheDateKey,
    cacheSchemaVersion: PORTFOLIO_PNL_BUNDLE_CACHE_SCHEMA_VERSION_,
    builtAt: bundle.fetchedAt,
    projectCount: bundle.projectCount,
    failedCount: bundle.failedIds.length,
    source: 'fibery',
  };

  writePortfolioPnlDriveCache_(state.cacheDateKey, manifest, bundle);
  var folder = getOrCreatePortfolioPnlDriveCacheDateFolder_(state.cacheDateKey);
  trashPortfolioPnlFilesInFolder_(folder, PORTFOLIO_PNL_LIVE_BUILD_STATE_FILE_);
  clearPortfolioPnlLiveBuildQueue_(state.buildId);
  deletePortfolioPnlLiveContinuationTriggers_();
  return { complete: true, state: state, manifest: manifest, bundle: bundle };
}

/**
 * @param {!Object} state
 * @private
 */
function enqueuePortfolioPnlLiveBuild_(state) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty(PORTFOLIO_PNL_LIVE_QUEUE_DATE_PROP_, state.cacheDateKey);
  props.setProperty(PORTFOLIO_PNL_LIVE_QUEUE_BUILD_ID_PROP_, state.buildId);
}

/**
 * @param {string=} expectedBuildId
 * @private
 */
function clearPortfolioPnlLiveBuildQueue_(expectedBuildId) {
  var props = PropertiesService.getScriptProperties();
  var currentBuildId = props.getProperty(PORTFOLIO_PNL_LIVE_QUEUE_BUILD_ID_PROP_);
  if (expectedBuildId && currentBuildId && currentBuildId !== expectedBuildId) {
    return;
  }
  props.deleteProperty(PORTFOLIO_PNL_LIVE_QUEUE_DATE_PROP_);
  props.deleteProperty(PORTFOLIO_PNL_LIVE_QUEUE_BUILD_ID_PROP_);
}

/**
 * @param {string} cacheDateKey
 * @private
 */
function resetPortfolioPnlLiveBuild_(cacheDateKey) {
  deletePortfolioPnlLiveContinuationTriggers_();
  clearPortfolioPnlLiveBuildQueue_();
  var folder = getOrCreatePortfolioPnlDriveCacheDateFolder_(cacheDateKey);
  trashPortfolioPnlFilesInFolder_(folder, PORTFOLIO_PNL_DRIVE_CACHE_MANIFEST_FILE_);
  trashPortfolioPnlFilesInFolder_(folder, PORTFOLIO_PNL_DRIVE_CACHE_BUNDLE_FILE_);
  trashPortfolioPnlFilesInFolder_(folder, PORTFOLIO_PNL_LIVE_BUILD_STATE_FILE_);
}

/**
 * @private
 */
function schedulePortfolioPnlLiveContinuation_() {
  deletePortfolioPnlLiveContinuationTriggers_();
  ScriptApp.newTrigger('processPortfolioPnlLiveBatch_')
    .timeBased()
    .after(PORTFOLIO_PNL_LIVE_CONTINUATION_DELAY_MS_)
    .create();
}

/**
 * @private
 */
function deletePortfolioPnlLiveContinuationTriggers_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processPortfolioPnlLiveBatch_') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

/**
 * @param {!Object} bundle
 * @param {boolean} fromDrive
 * @param {string} cacheDateKey
 * @return {!Object}
 */
function portfolioPnlDashboardPayloadFromBundle_(bundle, fromDrive, cacheDateKey) {
  return {
    ok: bundle.ok !== false,
    source: fromDrive ? 'drive-cache' : (bundle.source || 'fibery'),
    loadSource: fromDrive ? 'drive-cache' : 'fibery',
    cacheDateKey: fromDrive ? cacheDateKey : null,
    fromDrive: fromDrive,
    fetchedAt: bundle.fetchedAt || new Date().toISOString(),
    cacheSchemaVersion: PORTFOLIO_PNL_BUNDLE_CACHE_SCHEMA_VERSION_,
    calendarYear: bundle.calendarYear || new Date().getFullYear(),
    projects: bundle.projects || [],
    pnlById: bundle.pnlById || {},
    failedIds: bundle.failedIds || [],
    failedDetails: bundle.failedDetails || [],
    partial: !!bundle.partial,
    projectCount: bundle.projectCount || (bundle.projects || []).length,
  };
}

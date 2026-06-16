/**
 * PRD version 2.16.1 - sync with docs/FOS-Dashboard-PRD.md
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

/** @const {number} */
var PORTFOLIO_PNL_DRIVE_CACHE_MANIFEST_VERSION_ = 1;

/** @const {number} */
var PORTFOLIO_PNL_BUNDLE_CACHE_SCHEMA_VERSION_ = 1;

/** @const {string} */
var PORTFOLIO_PNL_DRIVE_CACHE_ENABLED_PROP_ = 'PORTFOLIO_PNL_DRIVE_CACHE_ENABLED';

/** @const {number} */
var PORTFOLIO_PNL_DRIVE_CACHE_LOCK_MS_ = 120000;

/** @const {number} */
var PORTFOLIO_PNL_DRIVE_CACHE_RETENTION_DAYS_ = 14;

/**
 * @return {boolean}
 */
function isPortfolioPnlDriveCacheEnabled_() {
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
    if (String(manifest.cacheDateKey || '') !== cacheDateKey) {
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
  }

  var lock = LockService.getScriptLock();
  var acquired = false;
  try {
    acquired = lock.tryLock(PORTFOLIO_PNL_DRIVE_CACHE_LOCK_MS_);
    if (!acquired) {
      lock.waitLock(PORTFOLIO_PNL_DRIVE_CACHE_LOCK_MS_);
      acquired = true;
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
    }

    var built = buildPortfolioPnlBundleFromFibery_();
    if (!built.ok) {
      return built;
    }

    var manifest = {
      cacheManifestVersion: PORTFOLIO_PNL_DRIVE_CACHE_MANIFEST_VERSION_,
      cacheDateKey: cacheDateKey,
      cacheSchemaVersion: PORTFOLIO_PNL_BUNDLE_CACHE_SCHEMA_VERSION_,
      builtAt: built.fetchedAt,
      projectCount: built.projectCount,
      failedCount: (built.failedIds || []).length,
      source: 'fibery',
    };
    writePortfolioPnlDriveCache_(cacheDateKey, manifest, built);

    return {
      ok: true,
      fromDrive: false,
      rebuilt: true,
      manifest: manifest,
      bundle: built,
    };
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

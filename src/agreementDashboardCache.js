/**
 * PRD version 3.0.5 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Daily Drive warm cache for Agreement Dashboard (feature 034 Phase A).
 * First Fibery build each calendar day writes agreement-cache/YYYY-MM-DD/
 * under the snapshot root; later Live loads read the bundle until Refresh
 * (forceRefresh) rebuilds from Fibery and rewrites today.
 *
 * Schema must match AGREEMENT_DASHBOARD_CACHE_SCHEMA_VERSION_ in
 * fiberyAgreementDashboard.js. Snapshot job still uses
 * buildAgreementDashboardPayload_ directly (uncached).
 */

/** @const {string} */
var AGREEMENT_DRIVE_CACHE_SUBFOLDER_ = 'agreement-cache';

/** @const {string} */
var AGREEMENT_DRIVE_CACHE_MANIFEST_FILE_ = 'manifest.json';

/** @const {string} */
var AGREEMENT_DRIVE_CACHE_BUNDLE_FILE_ = 'bundle.json';

/** @const {number} */
var AGREEMENT_DRIVE_CACHE_MANIFEST_VERSION_ = 1;

/** @const {string} */
var AGREEMENT_DRIVE_CACHE_ENABLED_PROP_ = 'AGREEMENT_DRIVE_CACHE_ENABLED';

/** @const {number} */
var AGREEMENT_DRIVE_CACHE_LOCK_MS_ = 120000;

/** @const {number} */
var AGREEMENT_DRIVE_CACHE_RETENTION_DAYS_ = 14;

/**
 * @return {boolean}
 */
function isAgreementDriveCacheEnabled_() {
  // Feature 036: Live Drive warm cache retired when serving from Supabase.
  if (typeof shouldServeFromSupabase_ === 'function' && shouldServeFromSupabase_()) {
    return false;
  }
  if (!isAgreementDriveCacheConfigured_()) {
    return false;
  }
  var raw = PropertiesService.getScriptProperties().getProperty(AGREEMENT_DRIVE_CACHE_ENABLED_PROP_);
  if (raw === null || raw === undefined || raw === '') {
    return true;
  }
  return String(raw).trim().toLowerCase() === 'true';
}

/**
 * @return {boolean}
 */
function isAgreementDriveCacheConfigured_() {
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
function getOrCreateAgreementDriveCacheDateFolder_(cacheDateKey) {
  var root = getSnapshotRootFolder_();
  var cacheRootIt = root.getFoldersByName(AGREEMENT_DRIVE_CACHE_SUBFOLDER_);
  var cacheRoot = cacheRootIt.hasNext()
    ? cacheRootIt.next()
    : root.createFolder(AGREEMENT_DRIVE_CACHE_SUBFOLDER_);
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
function readAgreementJsonFromFolder_(folder, fileName) {
  var files = folder.getFilesByName(fileName);
  if (!files.hasNext()) {
    return null;
  }
  try {
    return JSON.parse(files.next().getBlob().getDataAsString());
  } catch (e) {
    console.warn('readAgreementJsonFromFolder_: ' + (e && e.message ? e.message : e));
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
function writeAgreementJsonInFolder_(folder, fileName, obj) {
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
function readAgreementDriveCache_(cacheDateKey) {
  try {
    var folder = getOrCreateAgreementDriveCacheDateFolder_(cacheDateKey);
    var manifest = readAgreementJsonFromFolder_(folder, AGREEMENT_DRIVE_CACHE_MANIFEST_FILE_);
    var bundle = readAgreementJsonFromFolder_(folder, AGREEMENT_DRIVE_CACHE_BUNDLE_FILE_);
    if (!manifest || !bundle) {
      return null;
    }
    if (String(manifest.cacheDateKey || '') !== cacheDateKey) {
      return null;
    }
    if (bundle.cacheSchemaVersion !== AGREEMENT_DASHBOARD_CACHE_SCHEMA_VERSION_) {
      return null;
    }
    return { manifest: manifest, bundle: bundle };
  } catch (e) {
    console.warn('readAgreementDriveCache_: ' + (e && e.message ? e.message : e));
    return null;
  }
}

/**
 * @param {string} cacheDateKey
 * @param {!Object} manifest
 * @param {!Object} bundle
 * @return {!Object}
 */
function writeAgreementDriveCache_(cacheDateKey, manifest, bundle) {
  var folder = getOrCreateAgreementDriveCacheDateFolder_(cacheDateKey);
  var manifestWrite = writeAgreementJsonInFolder_(folder, AGREEMENT_DRIVE_CACHE_MANIFEST_FILE_, manifest);
  var bundleWrite = writeAgreementJsonInFolder_(folder, AGREEMENT_DRIVE_CACHE_BUNDLE_FILE_, bundle);
  pruneOldAgreementDriveCacheFolders_(cacheDateKey);
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
function pruneOldAgreementDriveCacheFolders_(currentCacheDateKey) {
  try {
    var root = getSnapshotRootFolder_();
    var cacheRootIt = root.getFoldersByName(AGREEMENT_DRIVE_CACHE_SUBFOLDER_);
    if (!cacheRootIt.hasNext()) {
      return;
    }
    var cacheRoot = cacheRootIt.next();
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - AGREEMENT_DRIVE_CACHE_RETENTION_DAYS_);
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
    console.warn('pruneOldAgreementDriveCacheFolders_: ' + (e && e.message ? e.message : e));
  }
}

/**
 * @param {string} cacheDateKey
 * @param {boolean} forceRefresh
 * @return {!Object}
 */
function loadOrBuildAgreementDriveCache_(cacheDateKey, forceRefresh) {
  if (!forceRefresh) {
    var cached = readAgreementDriveCache_(cacheDateKey);
    if (cached && cached.bundle && cached.bundle.ok !== false) {
      return {
        ok: true,
        fromDrive: true,
        manifest: cached.manifest,
        bundle: cached.bundle,
      };
    }
  }

  var lock = LockService.getScriptLock();
  var lockToken = null;
  try {
    try {
      lockToken = beginScriptLockNest_(lock, AGREEMENT_DRIVE_CACHE_LOCK_MS_);
    } catch (lockErr) {
      if (!forceRefresh) {
        var lockWaitCached = readAgreementDriveCache_(cacheDateKey);
        if (lockWaitCached && lockWaitCached.bundle && lockWaitCached.bundle.ok !== false) {
          return {
            ok: true,
            fromDrive: true,
            manifest: lockWaitCached.manifest,
            bundle: lockWaitCached.bundle,
          };
        }
      }
      return {
        ok: false,
        reason: 'LOCK_TIMEOUT',
        message: 'Agreement Drive cache lock timed out. Try again shortly.',
      };
    }

    if (!forceRefresh) {
      var again = readAgreementDriveCache_(cacheDateKey);
      if (again && again.bundle && again.bundle.ok !== false) {
        return {
          ok: true,
          fromDrive: true,
          manifest: again.manifest,
          bundle: again.bundle,
        };
      }
    }

    var built = buildAgreementDashboardPayload_(null);
    if (!built || built.ok === false) {
      return built || {
        ok: false,
        reason: 'BUILD_FAILED',
        message: 'Could not build Agreement dashboard payload.',
      };
    }

    var manifest = {
      cacheManifestVersion: AGREEMENT_DRIVE_CACHE_MANIFEST_VERSION_,
      cacheDateKey: cacheDateKey,
      cacheSchemaVersion: AGREEMENT_DASHBOARD_CACHE_SCHEMA_VERSION_,
      builtAt: built.fetchedAt,
      agreementCount: (built.agreements || []).length,
      companyCount: (built.companies || []).length,
      source: 'fibery',
    };
    var writeMeta = writeAgreementDriveCache_(cacheDateKey, manifest, built);
    manifest.drive = writeMeta;

    return {
      ok: true,
      fromDrive: false,
      rebuilt: true,
      manifest: manifest,
      bundle: built,
    };
  } finally {
    endScriptLockNest_(lockToken);
  }
}

/**
 * Tags a live Agreement payload for client load-source labels (FR-120).
 *
 * @param {!Object} bundle
 * @param {boolean} fromDrive
 * @param {?string} cacheDateKey
 * @return {!Object}
 */
function agreementDashboardPayloadFromDriveBundle_(bundle, fromDrive, cacheDateKey) {
  var payload = bundle || {};
  var ttlMinutes = resolveAgreementCacheTtlMinutes_();
  return {
    ok: payload.ok !== false,
    partial: !!payload.partial,
    source: fromDrive ? 'drive-cache' : (payload.source || 'fibery'),
    loadSource: fromDrive ? 'drive-cache' : 'fibery',
    cacheDateKey: fromDrive ? cacheDateKey : null,
    fromDrive: !!fromDrive,
    fetchedAt: payload.fetchedAt || new Date().toISOString(),
    cacheSchemaVersion: AGREEMENT_DASHBOARD_CACHE_SCHEMA_VERSION_,
    ttlMinutes: ttlMinutes,
    agreements: payload.agreements || [],
    companies: payload.companies || [],
    futureRevenueItems: payload.futureRevenueItems || [],
    historicalRevenueItems: payload.historicalRevenueItems || [],
    revenueItemsByAgreement: payload.revenueItemsByAgreement || {},
    kpis: payload.kpis || emptyKpis_(),
    alerts: payload.alerts || [],
    charts: payload.charts || emptyCharts_(),
    financialTable: payload.financialTable || emptyFinancialTable_(),
    customerCards: payload.customerCards || [],
    forwardPipeline: payload.forwardPipeline || emptyForwardPipeline_(),
    sankey: payload.sankey || emptySankey_(),
    message: payload.message,
    warnings: payload.warnings,
  };
}

/**
 * Editor diagnostic: read today's Agreement Drive cache (no Fibery).
 * @return {!Object}
 */
function _diag_readAgreementDriveCache() {
  var key = resolveSnapshotDateKey_();
  var enabled = isAgreementDriveCacheEnabled_();
  var configured = isAgreementDriveCacheConfigured_();
  var hit = configured ? readAgreementDriveCache_(key) : null;
  var summary = {
    ok: !!(hit && hit.bundle),
    cacheDateKey: key,
    configured: configured,
    enabled: enabled,
    hit: !!hit,
    manifest: hit ? hit.manifest : null,
    agreementCount: hit && hit.bundle ? (hit.bundle.agreements || []).length : 0,
    cacheSchemaVersion: hit && hit.bundle ? hit.bundle.cacheSchemaVersion : null,
    expectedSchemaVersion: AGREEMENT_DASHBOARD_CACHE_SCHEMA_VERSION_,
  };
  console.log('_diag_readAgreementDriveCache', JSON.stringify(summary).slice(0, 4000));
  return summary;
}

/**
 * Editor diagnostic: load or rebuild today's Agreement Drive cache.
 * @param {boolean=} forceRefresh
 * @return {!Object}
 */
function _diag_loadOrBuildAgreementDriveCache(forceRefresh) {
  if (!isAgreementDriveCacheConfigured_()) {
    var missing = {
      ok: false,
      reason: 'NOT_CONFIGURED',
      message: 'FOS_SNAPSHOT_DRIVE_FOLDER_ID is not set or unreachable.',
    };
    console.log('_diag_loadOrBuildAgreementDriveCache', JSON.stringify(missing));
    return missing;
  }
  var key = resolveSnapshotDateKey_();
  var result = loadOrBuildAgreementDriveCache_(key, forceRefresh === true);
  var summary = {
    ok: !!(result && result.ok),
    cacheDateKey: key,
    fromDrive: !!(result && result.fromDrive),
    rebuilt: !!(result && result.rebuilt),
    agreementCount:
      result && result.bundle ? (result.bundle.agreements || []).length : 0,
    message: result && result.message ? result.message : null,
  };
  console.log('_diag_loadOrBuildAgreementDriveCache', JSON.stringify(summary).slice(0, 4000));
  return summary;
}

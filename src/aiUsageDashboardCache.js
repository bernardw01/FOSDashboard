/**
 * PRD version 2.24.0 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Daily Drive cache for AI Usage dashboard (feature 023). First Fibery fetch
 * each calendar day writes JSON under the snapshot root; later reads slice
 * the bundle without calling Fibery until Refresh (force rebuild).
 */

/** @const {string} */
var AI_USAGE_DRIVE_CACHE_SUBFOLDER_ = 'ai-usage-cache';

/** @const {string} */
var AI_USAGE_DRIVE_CACHE_MANIFEST_FILE_ = 'manifest.json';

/** @const {string} */
var AI_USAGE_DRIVE_CACHE_BUNDLE_FILE_ = 'bundle.json';

/** @const {number} */
var AI_USAGE_DRIVE_CACHE_MANIFEST_VERSION_ = 1;

/** @const {string} */
var AI_USAGE_DRIVE_CACHE_ENABLED_PROP_ = 'AI_USAGE_DASHBOARD_DRIVE_CACHE_ENABLED';

/** @const {string} */
var AI_USAGE_DRIVE_CACHE_RANGE_PROP_ = 'AI_USAGE_DASHBOARD_CACHE_RANGE_DAYS';

/** @const {number} */
var AI_USAGE_DRIVE_CACHE_DEFAULT_RANGE_DAYS_ = 365;

/** @const {number} */
var AI_USAGE_DRIVE_CACHE_LOCK_MS_ = 120000;

/** @const {number} */
var AI_USAGE_DRIVE_CACHE_RETENTION_DAYS_ = 14;

/**
 * @return {boolean}
 */
function isAiUsageDriveCacheEnabled_() {
  if (!isAiUsageDriveCacheConfigured_()) {
    return false;
  }
  var raw = PropertiesService.getScriptProperties().getProperty(AI_USAGE_DRIVE_CACHE_ENABLED_PROP_);
  if (raw === null || raw === undefined || raw === '') {
    return true;
  }
  return String(raw).trim().toLowerCase() === 'true';
}

/**
 * @return {boolean}
 */
function isAiUsageDriveCacheConfigured_() {
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
 * @param {?Date=} when
 * @return {number}
 */
function resolveAiUsageDriveCacheRangeDays_() {
  var raw = PropertiesService.getScriptProperties().getProperty(AI_USAGE_DRIVE_CACHE_RANGE_PROP_);
  var n = parseInt(raw, 10);
  if (!isFinite(n)) {
    return AI_USAGE_DRIVE_CACHE_DEFAULT_RANGE_DAYS_;
  }
  if (n < 7) {
    return 7;
  }
  if (n > 365) {
    return 365;
  }
  return n;
}

/**
 * @param {?Date=} when
 * @return {!{ startYmd: string, endYmd: string }}
 */
function resolveAiUsageDriveCacheRange_(when) {
  var endYmd = resolveSnapshotDateKey_(when);
  var parts = parseSnapshotDateParts_(endYmd);
  if (!parts) {
    throw new Error('Invalid cache date key: ' + endYmd);
  }
  var days = resolveAiUsageDriveCacheRangeDays_();
  var endUtc = Date.UTC(parts.y, parts.m - 1, parts.d);
  var startUtc = endUtc - days * 86400000;
  return {
    startYmd: Utilities.formatDate(new Date(startUtc), resolveSnapshotTimezone_(), 'yyyy-MM-dd'),
    endYmd: endYmd,
  };
}

/**
 * @param {string} cacheDateKey `YYYY-MM-DD`
 * @return {GoogleAppsScript.Drive.Folder}
 * @private
 */
function getOrCreateAiUsageDriveCacheDateFolder_(cacheDateKey) {
  var root = getSnapshotRootFolder_();
  var cacheRootIt = root.getFoldersByName(AI_USAGE_DRIVE_CACHE_SUBFOLDER_);
  var cacheRoot = cacheRootIt.hasNext()
    ? cacheRootIt.next()
    : root.createFolder(AI_USAGE_DRIVE_CACHE_SUBFOLDER_);
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
function readAiUsageJsonFromFolder_(folder, fileName) {
  var files = folder.getFilesByName(fileName);
  if (!files.hasNext()) {
    return null;
  }
  try {
    return JSON.parse(files.next().getBlob().getDataAsString());
  } catch (e) {
    console.warn('readAiUsageJsonFromFolder_: ' + (e && e.message ? e.message : e));
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
function writeAiUsageJsonInFolder_(folder, fileName, obj) {
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
function readAiUsageDriveCache_(cacheDateKey) {
  try {
    var folder = getOrCreateAiUsageDriveCacheDateFolder_(cacheDateKey);
    var manifest = readAiUsageJsonFromFolder_(folder, AI_USAGE_DRIVE_CACHE_MANIFEST_FILE_);
    var bundle = readAiUsageJsonFromFolder_(folder, AI_USAGE_DRIVE_CACHE_BUNDLE_FILE_);
    if (!manifest || !bundle) {
      return null;
    }
    if (String(manifest.cacheDateKey || '') !== cacheDateKey) {
      return null;
    }
    return { manifest: manifest, bundle: bundle };
  } catch (e) {
    console.warn('readAiUsageDriveCache_: ' + (e && e.message ? e.message : e));
    return null;
  }
}

/**
 * @param {string} cacheDateKey
 * @param {!Object} manifest
 * @param {!Object} bundle
 * @return {!Object}
 */
function writeAiUsageDriveCache_(cacheDateKey, manifest, bundle) {
  var folder = getOrCreateAiUsageDriveCacheDateFolder_(cacheDateKey);
  var manifestWrite = writeAiUsageJsonInFolder_(folder, AI_USAGE_DRIVE_CACHE_MANIFEST_FILE_, manifest);
  var bundleWrite = writeAiUsageJsonInFolder_(folder, AI_USAGE_DRIVE_CACHE_BUNDLE_FILE_, bundle);
  pruneOldAiUsageDriveCacheFolders_(cacheDateKey);
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
function pruneOldAiUsageDriveCacheFolders_(currentCacheDateKey) {
  try {
    var root = getSnapshotRootFolder_();
    var cacheRootIt = root.getFoldersByName(AI_USAGE_DRIVE_CACHE_SUBFOLDER_);
    if (!cacheRootIt.hasNext()) {
      return;
    }
    var cacheRoot = cacheRootIt.next();
    var cutoffParts = parseSnapshotDateParts_(currentCacheDateKey);
    if (!cutoffParts) {
      return;
    }
    var cutoffUtc = Date.UTC(cutoffParts.y, cutoffParts.m - 1, cutoffParts.d);
    cutoffUtc -= AI_USAGE_DRIVE_CACHE_RETENTION_DAYS_ * 86400000;
    var folders = cacheRoot.getFolders();
    while (folders.hasNext()) {
      var f = folders.next();
      var name = f.getName();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) {
        continue;
      }
      var parts = parseSnapshotDateParts_(name);
      if (!parts) {
        continue;
      }
      var folderUtc = Date.UTC(parts.y, parts.m - 1, parts.d);
      if (folderUtc < cutoffUtc) {
        f.setTrashed(true);
      }
    }
  } catch (e) {
    console.warn('pruneOldAiUsageDriveCacheFolders_: ' + (e && e.message ? e.message : e));
  }
}

/**
 * @param {!Array<!Object>} rows
 * @param {string} startYmd
 * @param {string} endYmd
 * @return {!Array<!Object>}
 */
function filterAiUsageRowsByRange_(rows, startYmd, endYmd) {
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var d = rows[i].usageDate || '';
    if (d >= startYmd && d <= endYmd) {
      out.push(rows[i]);
    }
  }
  return out;
}

/**
 * @param {!Array<!Object>} rows
 * @param {number} topN
 * @return {!Object}
 */
function buildAiUsageRollups_(rows, topN) {
  var aggregates = buildAiUsageAggregates_(rows, topN);
  var byPerson = {};
  var byMonthPerson = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var cost = Number(r.costUsd) || 0;
    var person = r.personName || '';
    if (person) {
      byPerson[person] = (byPerson[person] || 0) + cost;
    }
    var month = r.usageDate ? r.usageDate.slice(0, 7) : '';
    if (month && person) {
      if (!byMonthPerson[month]) {
        byMonthPerson[month] = {};
      }
      byMonthPerson[month][person] = (byMonthPerson[month][person] || 0) + cost;
    }
  }
  return {
    filterOptions: buildAiUsageFilterOptions_(rows),
    kpis: aggregates.kpis,
    byDeveloper: aggregates.byDeveloper,
    byProduct: aggregates.byProduct,
    byMonth: aggregates.byMonth,
    byPerson: byPerson,
    byMonthPerson: byMonthPerson,
  };
}

/**
 * @param {!Object} props
 * @param {string} cacheDateKey
 * @return {!Object}
 */
function buildAiUsageDriveCacheBundleFromFibery_(props, cacheDateKey) {
  var cacheRange = resolveAiUsageDriveCacheRange_();
  var fetched = fetchAllAiUsageRowsChunked_(cacheRange.startYmd, cacheRange.endYmd, props.maxRows);
  if (!fetched.ok) {
    return {
      ok: false,
      reason: fetched.reason || 'QUERY_FAILED',
      message: fetched.message || 'Fibery query failed',
    };
  }
  var rows = normalizeAiUsageRows_(fetched.rows);
  var rollups = buildAiUsageRollups_(rows, props.topN);
  var warnings = [];
  if (fetched.truncated) {
    warnings.push(
      'Drive cache loaded ' + rows.length + ' rows but hit the row ceiling (' +
        props.maxRows + '). Some Claude API Cost rows may be missing. In Admin Settings, ' +
        'raise AI Usage max usage rows or narrow Drive cache window (days), then Refresh.'
    );
  }
  return {
    ok: true,
    bundle: {
      cacheSchemaVersion: AI_USAGE_DASHBOARD_CACHE_SCHEMA_VERSION_,
      cacheManifestVersion: AI_USAGE_DRIVE_CACHE_MANIFEST_VERSION_,
      cacheDateKey: cacheDateKey,
      builtAt: new Date().toISOString(),
      dataSource: 'claude-api-costs',
      cacheRange: cacheRange,
      rowCount: rows.length,
      rows: rows,
      rollups: rollups,
      warnings: warnings,
    },
    truncated: fetched.truncated,
  };
}

/**
 * @param {string} cacheDateKey
 * @param {boolean} forceRefresh
 * @param {!Object} props
 * @return {!Object}
 */
function loadOrBuildAiUsageDriveCache_(cacheDateKey, forceRefresh, props) {
  if (!forceRefresh) {
    var cached = readAiUsageDriveCache_(cacheDateKey);
    if (
      cached &&
      cached.bundle &&
      cached.bundle.cacheSchemaVersion === AI_USAGE_DASHBOARD_CACHE_SCHEMA_VERSION_
    ) {
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
    acquired = lock.tryLock(AI_USAGE_DRIVE_CACHE_LOCK_MS_);
    if (!acquired) {
      lock.waitLock(AI_USAGE_DRIVE_CACHE_LOCK_MS_);
      acquired = true;
    }

    if (!forceRefresh) {
      var again = readAiUsageDriveCache_(cacheDateKey);
      if (
        again &&
        again.bundle &&
        again.bundle.cacheSchemaVersion === AI_USAGE_DASHBOARD_CACHE_SCHEMA_VERSION_
      ) {
        return {
          ok: true,
          fromDrive: true,
          manifest: again.manifest,
          bundle: again.bundle,
        };
      }
    }

    var built = buildAiUsageDriveCacheBundleFromFibery_(props, cacheDateKey);
    if (!built.ok) {
      return built;
    }

    var manifest = {
      cacheManifestVersion: AI_USAGE_DRIVE_CACHE_MANIFEST_VERSION_,
      cacheDateKey: cacheDateKey,
      cacheSchemaVersion: AI_USAGE_DASHBOARD_CACHE_SCHEMA_VERSION_,
      builtAt: built.bundle.builtAt,
      rangeStartYmd: built.bundle.cacheRange.startYmd,
      rangeEndYmd: built.bundle.cacheRange.endYmd,
      rowCount: built.bundle.rowCount,
      dataSource: 'claude-api-costs',
      source: 'fibery',
    };
    var writeMeta = writeAiUsageDriveCache_(cacheDateKey, manifest, built.bundle);
    manifest.drive = writeMeta;

    return {
      ok: true,
      fromDrive: false,
      rebuilt: true,
      manifest: manifest,
      bundle: built.bundle,
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
 * @param {!Object} range
 * @param {!Object} props
 * @param {boolean} fromDrive
 * @param {string} fetchedAtIso
 * @param {?Object=} manifest
 * @return {!Object}
 */
function buildAiUsagePayloadFromDriveBundle_(
  bundle,
  range,
  props,
  fromDrive,
  fetchedAtIso,
  manifest
) {
  var allRows = bundle.rows || [];
  var filtered = filterAiUsageRowsByRange_(allRows, range.startYmd, range.endYmd);
  var aggregates = buildAiUsageAggregates_(filtered, props.topN);
  var warnings = (bundle.warnings || []).slice();
  if (range.startYmd < bundle.cacheRange.startYmd || range.endYmd > bundle.cacheRange.endYmd) {
    warnings.push(
      'Requested range extends outside the daily Drive cache window (' +
        bundle.cacheRange.startYmd +
        ' to ' +
        bundle.cacheRange.endYmd +
        '). Narrow the date range or use Refresh to rebuild.'
    );
  }

  var payload = {
    ok: true,
    source: fromDrive ? 'drive-cache' : 'drive-cache-rebuilt',
    dataSource: 'claude-api-costs',
    cacheLayer: 'drive',
    cacheDateKey: bundle.cacheDateKey,
    cacheBuiltAt: bundle.builtAt,
    driveCacheRange: bundle.cacheRange,
    fetchedAt: fetchedAtIso,
    cacheSchemaVersion: AI_USAGE_DASHBOARD_CACHE_SCHEMA_VERSION_,
    ttlMinutes: props.cacheTtlMinutes,
    topN: props.topN,
    range: range,
    rows: filtered,
    kpis: aggregates.kpis,
    byDeveloper: aggregates.byDeveloper,
    byProduct: aggregates.byProduct,
    byMonth: aggregates.byMonth,
    filterOptions: buildAiUsageFilterOptions_(filtered),
    rollups: {
      window: bundle.rollups || null,
      sliceRowCount: filtered.length,
      cacheRowCount: allRows.length,
    },
  };
  if (warnings.length) {
    payload.warnings = warnings;
    payload.partial = true;
  }
  if (manifest && manifest.drive) {
    payload.driveArtifact = {
      manifestBytes: manifest.drive.manifestBytes,
      bundleBytes: manifest.drive.bundleBytes,
    };
  }
  return payload;
}

/**
 * @return {!Object}
 */
function _diag_readAiUsageDriveCache() {
  var key = resolveSnapshotDateKey_();
  var hit = readAiUsageDriveCache_(key);
  console.log(
    '_diag_readAiUsageDriveCache',
    JSON.stringify({
      cacheDateKey: key,
      hit: !!hit,
      manifest: hit ? hit.manifest : null,
      rowCount: hit && hit.bundle ? hit.bundle.rowCount : 0,
      cacheRange: hit && hit.bundle ? hit.bundle.cacheRange : null,
    }).slice(0, 4000)
  );
  return hit || { ok: false, cacheDateKey: key };
}

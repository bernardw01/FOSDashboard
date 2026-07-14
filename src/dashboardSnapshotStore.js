/**
 * PRD version 2.24.0 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Historical dashboard snapshot storage (Option A): Google Drive folder
 * with per-date subfolders, JSON artifacts, and a manifest per day.
 *
 * Script Properties:
 *   FOS_SNAPSHOT_DRIVE_FOLDER_ID   - required root folder id
 *   FOS_SNAPSHOT_TIMEZONE          - default America/Chicago
 *   SNAPSHOT_RETENTION_DAYS        - default 90
 */

/** @const {number} */
var SNAPSHOT_MANIFEST_VERSION_ = 1;

/** @const {string} */
var SNAPSHOT_DRIVE_FOLDER_PROP_ = 'FOS_SNAPSHOT_DRIVE_FOLDER_ID';

/** @const {string} */
var SNAPSHOT_TIMEZONE_PROP_ = 'FOS_SNAPSHOT_TIMEZONE';

/** @const {string} */
var SNAPSHOT_RETENTION_DAYS_PROP_ = 'SNAPSHOT_RETENTION_DAYS';

/** @const {string} */
var SNAPSHOT_DEFAULT_TIMEZONE_ = 'America/Chicago';

/** @const {number} */
var SNAPSHOT_DEFAULT_RETENTION_DAYS_ = 90;

/** @const {string} */
var SNAPSHOT_MANIFEST_FILE_ = 'manifest.json';

/** @const {string} */
var SNAPSHOT_INDEX_FILE_ = 'index.json';

/**
 * Creates the snapshot root folder when missing and stores its id.
 * @return {{ ok: boolean, folderId?: string, created?: boolean, message?: string }}
 */
function ensureSnapshotDriveFolder() {
  var props = PropertiesService.getScriptProperties();
  var existing = props.getProperty(SNAPSHOT_DRIVE_FOLDER_PROP_);
  if (existing) {
    try {
      DriveApp.getFolderById(existing);
      return { ok: true, folderId: existing, created: false };
    } catch (e) {
      /* fall through - recreate */
    }
  }
  try {
    var folder = DriveApp.createFolder('FinOps Performance Hub Snapshots');
    props.setProperty(SNAPSHOT_DRIVE_FOLDER_PROP_, folder.getId());
    return { ok: true, folderId: folder.getId(), created: true };
  } catch (e2) {
    return {
      ok: false,
      message: 'Could not create snapshot folder: ' + (e2 && e2.message ? e2.message : e2),
    };
  }
}

/**
 * @return {string}
 */
function resolveSnapshotTimezone_() {
  var tz = PropertiesService.getScriptProperties().getProperty(SNAPSHOT_TIMEZONE_PROP_);
  return tz && String(tz).trim() ? String(tz).trim() : SNAPSHOT_DEFAULT_TIMEZONE_;
}

/**
 * @return {number}
 */
function resolveSnapshotRetentionDays_() {
  var raw = PropertiesService.getScriptProperties().getProperty(SNAPSHOT_RETENTION_DAYS_PROP_);
  var n = parseInt(raw, 10);
  if (!isFinite(n) || n < 1) {
    return SNAPSHOT_DEFAULT_RETENTION_DAYS_;
  }
  return n;
}

/**
 * Snapshot calendar date in the configured timezone (`YYYY-MM-DD`).
 * @param {?Date=} when
 * @return {string}
 */
function resolveSnapshotDateKey_(when) {
  var d = when || new Date();
  return Utilities.formatDate(d, resolveSnapshotTimezone_(), 'yyyy-MM-dd');
}

/**
 * @param {string} snapshotDate `YYYY-MM-DD`
 * @param {number} lookbackDays
 * @return {!{ rangeStart: string, rangeEnd: string }}
 */
function buildUtilizationRangeForSnapshot_(snapshotDate, lookbackDays) {
  var parts = parseSnapshotDateParts_(snapshotDate);
  if (!parts) {
    throw new Error('Invalid snapshot date: ' + snapshotDate);
  }
  var endUtc = Date.UTC(parts.y, parts.m - 1, parts.d + 1);
  var startUtc = Date.UTC(parts.y, parts.m - 1, parts.d - lookbackDays);
  return {
    rangeStart: new Date(startUtc).toISOString(),
    rangeEnd: new Date(endUtc).toISOString(),
  };
}

/**
 * @param {string} snapshotDate
 * @return {?{ y: number, m: number, d: number }}
 * @private
 */
function parseSnapshotDateParts_(snapshotDate) {
  var m = String(snapshotDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    return null;
  }
  return { y: parseInt(m[1], 10), m: parseInt(m[2], 10), d: parseInt(m[3], 10) };
}

/**
 * @return {GoogleAppsScript.Drive.Folder}
 * @private
 */
function getSnapshotRootFolder_() {
  var id = PropertiesService.getScriptProperties().getProperty(SNAPSHOT_DRIVE_FOLDER_PROP_);
  if (!id) {
    throw new Error('FOS_SNAPSHOT_DRIVE_FOLDER_ID is not set. Run ensureSnapshotDriveFolder().');
  }
  return DriveApp.getFolderById(id);
}

/**
 * @param {?string} snapshotDate
 * @return {string}
 */
function requireSnapshotDate_(snapshotDate) {
  var s = String(snapshotDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(
      'Invalid snapshot date "' +
        snapshotDate +
        '". Use YYYY-MM-DD (e.g. "2026-05-15"). ' +
        'If running from the editor without parameters, use _diag_runSnapshotForDate() with no args ' +
        'only after deploying the build that defaults the date.'
    );
  }
  return s;
}

/**
 * @param {string} snapshotDate
 * @return {GoogleAppsScript.Drive.Folder}
 */
function getOrCreateSnapshotDateFolder_(snapshotDate) {
  var dateKey = requireSnapshotDate_(snapshotDate);
  var root = getSnapshotRootFolder_();
  var it = root.getFoldersByName(dateKey);
  if (it.hasNext()) {
    return it.next();
  }
  return root.createFolder(dateKey);
}

/**
 * @param {GoogleAppsScript.Drive.Folder} parent
 * @param {string} relativePath e.g. `delivery-pnl/<id>.json`
 * @return {GoogleAppsScript.Drive.Folder}
 * @private
 */
function resolveSnapshotPathFolder_(parent, relativePath) {
  var segments = String(relativePath || '').split('/');
  var fileName = segments.pop();
  if (!fileName || !String(fileName).trim()) {
    throw new Error('Snapshot artifact path missing file name: "' + relativePath + '"');
  }
  fileName = String(fileName).trim();
  var folder = parent;
  for (var i = 0; i < segments.length; i++) {
    if (!segments[i]) continue;
    var seg = String(segments[i]).trim();
    if (!seg) continue;
    var sub = folder.getFoldersByName(seg);
    folder = sub.hasNext() ? sub.next() : folder.createFolder(seg);
  }
  return { folder: folder, fileName: fileName };
}

/**
 * @param {string} snapshotDate
 * @return {?Object}
 */
function readSnapshotManifest_(snapshotDate) {
  try {
    var folder = getOrCreateSnapshotDateFolder_(snapshotDate);
    var files = folder.getFilesByName(SNAPSHOT_MANIFEST_FILE_);
    if (!files.hasNext()) {
      return null;
    }
    var text = files.next().getBlob().getDataAsString();
    return JSON.parse(text);
  } catch (e) {
    console.warn('readSnapshotManifest_ failed: ' + (e && e.message ? e.message : e));
    return null;
  }
}

/**
 * @param {string} snapshotDate
 * @param {!Object} manifest
 */
function writeSnapshotManifest_(snapshotDate, manifest) {
  var folder = getOrCreateSnapshotDateFolder_(snapshotDate);
  writeSnapshotJsonInFolder_(folder, SNAPSHOT_MANIFEST_FILE_, manifest);
  upsertRollingSnapshotIndex_(manifest);
}

/**
 * @param {string} snapshotDate
 * @param {string} relativePath
 * @param {!Object} payload
 * @return {{ fileId: string, byteSize: number, fileName: string }}
 */
function writeSnapshotArtifact_(snapshotDate, relativePath, payload) {
  var dateFolder = getOrCreateSnapshotDateFolder_(snapshotDate);
  var resolved = resolveSnapshotPathFolder_(dateFolder, relativePath);
  return writeSnapshotJsonInFolder_(resolved.folder, resolved.fileName, payload);
}

/**
 * @param {GoogleAppsScript.Drive.Folder} folder
 * @param {string} fileName
 * @param {!Object} obj
 * @return {{ fileId: string, byteSize: number, fileName: string }}
 * @private
 */
function writeSnapshotJsonInFolder_(folder, fileName, obj) {
  var safeName = String(fileName || '').trim();
  if (!safeName) {
    throw new Error('writeSnapshotJsonInFolder_: file name cannot be empty');
  }
  var json = JSON.stringify(obj);
  var existing = folder.getFilesByName(safeName);
  while (existing.hasNext()) {
    existing.next().setTrashed(true);
  }
  var file = folder.createFile(Utilities.newBlob(json, 'application/json', safeName));
  return { fileId: file.getId(), byteSize: json.length, fileName: safeName };
}

/**
 * @param {string} agreementId
 * @return {string}
 */
function snapshotPnlRelativePath_(agreementId) {
  var id = String(agreementId || '').trim();
  if (!id) {
    throw new Error('snapshotPnlRelativePath_: missing agreementId');
  }
  return 'delivery-pnl/' + id.replace(/[/\\]/g, '_') + '.json';
}

/**
 * @param {!Object} manifest
 * @private
 */
function upsertRollingSnapshotIndex_(manifest) {
  try {
    var root = getSnapshotRootFolder_();
    var entry = {
      snapshotDate: manifest.snapshotDate,
      status: manifest.status,
      completedAt: manifest.completedAt || null,
      startedAt: manifest.startedAt || null,
    };
    var index = { snapshotManifestVersion: 1, entries: [] };
    var files = root.getFilesByName(SNAPSHOT_INDEX_FILE_);
    if (files.hasNext()) {
      try {
        index = JSON.parse(files.next().getBlob().getDataAsString());
      } catch (parseErr) {
        index = { snapshotManifestVersion: 1, entries: [] };
      }
    }
    if (!index.entries) {
      index.entries = [];
    }
    var found = false;
    for (var i = 0; i < index.entries.length; i++) {
      if (index.entries[i].snapshotDate === entry.snapshotDate) {
        index.entries[i] = entry;
        found = true;
        break;
      }
    }
    if (!found) {
      index.entries.push(entry);
    }
    index.entries.sort(function (a, b) {
      return String(b.snapshotDate).localeCompare(String(a.snapshotDate));
    });
    var maxEntries = resolveSnapshotRetentionDays_() + 7;
    if (index.entries.length > maxEntries) {
      index.entries = index.entries.slice(0, maxEntries);
    }
    writeSnapshotJsonInFolder_(root, SNAPSHOT_INDEX_FILE_, index);
  } catch (e) {
    console.warn('upsertRollingSnapshotIndex_ failed: ' + (e && e.message ? e.message : e));
  }
}

/**
 * @param {?number=} retentionDays
 * @return {{ deleted: number, errors: !Array<string> }}
 */
function pruneOldSnapshotFolders_(retentionDays) {
  var days = retentionDays != null ? retentionDays : resolveSnapshotRetentionDays_();
  var tz = resolveSnapshotTimezone_();
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  var cutoffKey = Utilities.formatDate(cutoff, tz, 'yyyy-MM-dd');

  var deleted = 0;
  var errors = [];
  try {
    var root = getSnapshotRootFolder_();
    var folders = root.getFolders();
    while (folders.hasNext()) {
      var f = folders.next();
      var name = f.getName();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) {
        continue;
      }
      if (name < cutoffKey) {
        try {
          f.setTrashed(true);
          deleted++;
        } catch (e) {
          errors.push(name + ': ' + (e && e.message ? e.message : e));
        }
      }
    }
  } catch (e2) {
    errors.push('root: ' + (e2 && e2.message ? e2.message : e2));
  }
  return { deleted: deleted, errors: errors };
}

/**
 * @param {string} snapshotDate
 * @param {string} startedAtIso
 * @return {!Object}
 */
function createEmptySnapshotManifest_(snapshotDate, startedAtIso) {
  return {
    snapshotManifestVersion: SNAPSHOT_MANIFEST_VERSION_,
    snapshotDate: snapshotDate,
    timezone: resolveSnapshotTimezone_(),
    startedAt: startedAtIso,
    completedAt: null,
    status: 'running',
    datasets: [],
    pnlProgress: { total: 0, completed: 0, failedIds: [] },
    warnings: [],
  };
}

/**
 * @param {!Object} manifest
 * @param {string} id
 * @param {string} fileName
 * @param {{ fileId: string, byteSize: number }} fileMeta
 * @param {number} cacheSchemaVersion
 * @param {string} fetchedAt
 * @param {?Object=} params
 * @param {boolean=} partial
 * @param {?string=} error
 */
function appendManifestDataset_(
  manifest,
  id,
  fileName,
  fileMeta,
  cacheSchemaVersion,
  fetchedAt,
  params,
  partial,
  error
) {
  manifest.datasets.push({
    id: id,
    fileName: fileName,
    driveFileId: fileMeta.fileId,
    cacheSchemaVersion: cacheSchemaVersion,
    byteSize: fileMeta.byteSize,
    fetchedAt: fetchedAt,
    params: params || null,
    partial: !!partial,
    error: error || null,
  });
}

/**
 * Editor diagnostic: list rolling index entries.
 * @return {!Object}
 */
function _diag_listSnapshots() {
  try {
    var root = getSnapshotRootFolder_();
    var files = root.getFilesByName(SNAPSHOT_INDEX_FILE_);
    if (!files.hasNext()) {
      return { ok: true, entries: [], message: 'No index.json yet.' };
    }
    var index = JSON.parse(files.next().getBlob().getDataAsString());
    return { ok: true, entries: index.entries || [] };
  } catch (e) {
    return { ok: false, message: e && e.message ? e.message : String(e) };
  }
}

/* ------------------------------------------------------------------------- */
/* Authorized read API (Web App - historical data source UI).                 */
/* ------------------------------------------------------------------------- */

/**
 * Expected `cacheSchemaVersion` per snapshot artifact. MUST stay aligned with the
 * live dashboard builder constants (same Apps Script globals) so schema bumps do
 * not drift between live UI, snapshot writers, and historical readers.
 * @return {!Object<string, number>}
 * @private
 */
function snapshotExpectedSchemaVersions_() {
  return {
    agreement: AGREEMENT_DASHBOARD_CACHE_SCHEMA_VERSION_,
    utilization: UTILIZATION_DASHBOARD_CACHE_SCHEMA_VERSION_,
    'delivery-projects': DELIVERY_DASHBOARD_CACHE_SCHEMA_VERSION_,
    'delivery-pnl': DELIVERY_PNL_CACHE_SCHEMA_VERSION_,
    'portfolio-pnl': PORTFOLIO_PNL_BUNDLE_CACHE_SCHEMA_VERSION_,
    expenses: EXPENSES_CACHE_SCHEMA_VERSION_,
    pipeline: PIPELINE_CACHE_SCHEMA_VERSION_,
    'resource-assignments': RESOURCE_ASSIGNMENTS_CACHE_SCHEMA_VERSION_,
  };
}

/** @const {!Object<string, string>} */
var SNAPSHOT_ARTIFACT_FILES_ = {
  agreement: 'agreement.json',
  utilization: 'utilization.json',
  'delivery-projects': 'delivery-projects.json',
  'portfolio-pnl': 'portfolio-pnl.json',
  expenses: 'expenses.json',
  pipeline: 'pipeline.json',
  'resource-assignments': 'resource-assignments.json',
};

/**
 * @param {string} snapshotDate
 * @return {GoogleAppsScript.Drive.Folder|null}
 * @private
 */
function readSnapshotDateFolderOrNull_(snapshotDate) {
  var dateKey = requireSnapshotDate_(snapshotDate);
  try {
    var root = getSnapshotRootFolder_();
    var it = root.getFoldersByName(dateKey);
    return it.hasNext() ? it.next() : null;
  } catch (e) {
    return null;
  }
}

/**
 * @param {GoogleAppsScript.Drive.Folder} dateFolder
 * @param {string} relativePath
 * @return {?Object}
 * @private
 */
function readSnapshotJsonFromDateFolder_(dateFolder, relativePath) {
  var segments = String(relativePath || '').split('/');
  var fileName = segments.pop();
  if (!fileName || !String(fileName).trim()) {
    return null;
  }
  fileName = String(fileName).trim();
  var folder = dateFolder;
  for (var i = 0; i < segments.length; i++) {
    if (!segments[i]) continue;
    var seg = String(segments[i]).trim();
    if (!seg) continue;
    var sub = folder.getFoldersByName(seg);
    if (!sub.hasNext()) {
      return null;
    }
    folder = sub.next();
  }
  var files = folder.getFilesByName(fileName);
  if (!files.hasNext()) {
    return null;
  }
  try {
    return JSON.parse(files.next().getBlob().getDataAsString());
  } catch (e) {
    return null;
  }
}

/**
 * @param {string} status
 * @return {boolean}
 * @private
 */
function isSnapshotCatalogStatus_(status) {
  return status === 'complete' || status === 'partial';
}

/**
 * @param {string} snapshotDate
 * @param {string} status
 * @return {string}
 * @private
 */
function formatSnapshotCatalogLabel_(snapshotDate, status) {
  var parts = parseSnapshotDateParts_(snapshotDate);
  var label = 'Snapshot - ' + snapshotDate;
  if (parts) {
    try {
      var d = new Date(parts.y, parts.m - 1, parts.d);
      label =
        'Snapshot - ' +
        Utilities.formatDate(d, resolveSnapshotTimezone_(), 'MMM d, yyyy');
    } catch (_) {
      /* keep ISO label */
    }
  }
  if (status === 'partial') {
    label += ' (partial)';
  }
  return label;
}

/**
 * @return {!Array<!Object>}
 * @private
 */
function listSnapshotCatalogEntries_() {
  var out = [];
  var seen = {};

  function addEntry(snapshotDate, status, completedAt) {
    if (!snapshotDate || seen[snapshotDate]) {
      return;
    }
    if (!isSnapshotCatalogStatus_(status)) {
      return;
    }
    seen[snapshotDate] = true;
    out.push({
      snapshotDate: snapshotDate,
      status: status,
      completedAt: completedAt || null,
      label: formatSnapshotCatalogLabel_(snapshotDate, status),
    });
  }

  try {
    var root = getSnapshotRootFolder_();
    var indexFiles = root.getFilesByName(SNAPSHOT_INDEX_FILE_);
    if (indexFiles.hasNext()) {
      try {
        var index = JSON.parse(indexFiles.next().getBlob().getDataAsString());
        var entries = index.entries || [];
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          if (e && e.snapshotDate) {
            addEntry(e.snapshotDate, e.status, e.completedAt);
          }
        }
      } catch (parseErr) {
        /* fall through to folder scan */
      }
    }

    var folders = root.getFolders();
    while (folders.hasNext()) {
      var f = folders.next();
      var name = f.getName();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) {
        continue;
      }
      if (seen[name]) {
        continue;
      }
      var manifest = readSnapshotManifestFromFolder_(f);
      if (manifest && manifest.snapshotDate) {
        addEntry(manifest.snapshotDate, manifest.status, manifest.completedAt);
      }
    }
  } catch (e2) {
    console.warn('listSnapshotCatalogEntries_: ' + (e2 && e2.message ? e2.message : e2));
  }

  out.sort(function (a, b) {
    return String(b.snapshotDate).localeCompare(String(a.snapshotDate));
  });
  return out;
}

/**
 * @param {GoogleAppsScript.Drive.Folder} dateFolder
 * @return {?Object}
 * @private
 */
function readSnapshotManifestFromFolder_(dateFolder) {
  var files = dateFolder.getFilesByName(SNAPSHOT_MANIFEST_FILE_);
  if (!files.hasNext()) {
    return null;
  }
  try {
    return JSON.parse(files.next().getBlob().getDataAsString());
  } catch (e) {
    return null;
  }
}

/**
 * @param {?Object} payload
 * @param {string} artifactKey
 * @param {!Array<string>} warnings
 * @return {boolean}
 * @private
 */
function validateSnapshotArtifactSchema_(payload, artifactKey, warnings) {
  if (!payload || typeof payload !== 'object') {
    warnings.push('Missing or invalid ' + artifactKey + ' payload.');
    return false;
  }
  var expected = snapshotExpectedSchemaVersions_()[artifactKey];
  if (expected == null) {
    return true;
  }
  if (payload.cacheSchemaVersion !== expected) {
    warnings.push(
      artifactKey +
        ' schema version ' +
        payload.cacheSchemaVersion +
        ' does not match expected ' +
        expected +
        '.'
    );
    return false;
  }
  return true;
}

/**
 * Client-callable: list snapshots available for the data-source selector.
 * @return {{
 *   ok: boolean,
 *   live: { id: string, label: string },
 *   snapshots: !Array<!Object>,
 *   message?: string
 * }}
 */
function getDashboardSnapshotCatalog() {
  requireAuthForApi_();
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty(SNAPSHOT_DRIVE_FOLDER_PROP_)) {
    return {
      ok: true,
      live: { id: 'live', label: 'Live data' },
      snapshots: [],
      message: 'Historical snapshots are not configured (no Drive folder).',
    };
  }
  try {
    return {
      ok: true,
      live: { id: 'live', label: 'Live data' },
      snapshots: listSnapshotCatalogEntries_(),
    };
  } catch (e) {
    return {
      ok: false,
      live: { id: 'live', label: 'Live data' },
      snapshots: [],
      message: 'Could not list snapshots.',
    };
  }
}

/**
 * Client-callable: load core dashboard artifacts for one snapshot date.
 * @param {string} snapshotDate `YYYY-MM-DD`
 * @return {{
 *   ok: boolean,
 *   snapshotDate: string,
 *   manifest: ?Object,
 *   agreement: ?Object,
 *   utilization: ?Object,
 *   deliveryProjects: ?Object,
 *   expenses: ?Object,
 *   pipeline: ?Object,
 *   resourceAssignments: ?Object,
 *   warnings?: !Array<string>,
 *   message?: string
 * }}
 */
function getDashboardSnapshotCoreBundle(snapshotDate) {
  var auth = requireAuthForApi_();
  var dateKey = requireSnapshotDate_(snapshotDate);
  var warnings = [];
  var empty = {
    ok: false,
    snapshotDate: dateKey,
    manifest: null,
    agreement: null,
    utilization: null,
    deliveryProjects: null,
    expenses: null,
    pipeline: null,
    resourceAssignments: null,
    warnings: warnings,
  };

  if (!PropertiesService.getScriptProperties().getProperty(SNAPSHOT_DRIVE_FOLDER_PROP_)) {
    empty.message = 'Historical snapshots are not configured.';
    return empty;
  }

  var dateFolder = readSnapshotDateFolderOrNull_(dateKey);
  if (!dateFolder) {
    empty.message = 'No snapshot folder for ' + dateKey + '.';
    return empty;
  }

  var manifest = readSnapshotManifestFromFolder_(dateFolder);
  if (!manifest) {
    empty.message = 'Snapshot manifest is missing for ' + dateKey + '.';
    return empty;
  }
  if (!isSnapshotCatalogStatus_(manifest.status)) {
    empty.message = 'Snapshot ' + dateKey + ' is not ready (status: ' + manifest.status + ').';
    return empty;
  }

  var agreement = readSnapshotJsonFromDateFolder_(dateFolder, SNAPSHOT_ARTIFACT_FILES_.agreement);
  var utilization = readSnapshotJsonFromDateFolder_(dateFolder, SNAPSHOT_ARTIFACT_FILES_.utilization);
  var deliveryProjects = readSnapshotJsonFromDateFolder_(
    dateFolder,
    SNAPSHOT_ARTIFACT_FILES_['delivery-projects']
  );
  var expenses = readOptionalSnapshotArtifact_(dateFolder, 'expenses', warnings);
  var pipeline = readOptionalSnapshotArtifact_(dateFolder, 'pipeline', warnings);
  var resourceAssignments = readOptionalSnapshotArtifact_(dateFolder, 'resource-assignments', warnings);

  var agreementOk = validateSnapshotArtifactSchema_(agreement, 'agreement', warnings);
  var utilOk = validateSnapshotArtifactSchema_(utilization, 'utilization', warnings);
  var deliveryOk = validateSnapshotArtifactSchema_(deliveryProjects, 'delivery-projects', warnings);

  if (!agreementOk || !utilOk || !deliveryOk) {
    empty.manifest = manifest;
    empty.message =
      'Snapshot data failed schema validation. ' +
      (warnings.length
        ? warnings.join(' ')
        : 'Re-run the snapshot job for this date so artifacts match the current cacheSchemaVersion.') +
      ' Tip: run _diag_runSnapshotForDate(\'' +
      dateKey +
      '\') in the Apps Script editor.';
    return empty;
  }

  if (!agreement || agreement.ok === false) {
    warnings.push((agreement && agreement.message) || 'Agreement snapshot unavailable.');
  }
  if (!utilization || utilization.ok === false) {
    warnings.push((utilization && utilization.message) || 'Utilization snapshot unavailable.');
  }
  if (!deliveryProjects || deliveryProjects.ok === false) {
    warnings.push((deliveryProjects && deliveryProjects.message) || 'Delivery snapshot unavailable.');
  }

  if (!agreement || agreement.ok === false || !utilization || utilization.ok === false) {
    empty.manifest = manifest;
    empty.message = 'One or more core snapshot files could not be loaded.';
    return empty;
  }

  tagSnapshotPayloadSource_(agreement);
  tagSnapshotPayloadSource_(utilization);
  tagSnapshotPayloadSource_(deliveryProjects);
  if (expenses) {
    tagSnapshotPayloadSource_(expenses);
  }
  if (pipeline) {
    tagSnapshotPayloadSource_(pipeline);
  }
  if (resourceAssignments) {
    tagSnapshotPayloadSource_(resourceAssignments);
  }

  if (!canAccessExpensesDashboard_(auth)) {
    expenses = null;
  }
  if (!canAccessPipelineDashboard_(auth)) {
    pipeline = null;
  }
  if (!canAccessResourceAssignmentsDashboard_(auth)) {
    resourceAssignments = null;
  }

  return {
    ok: true,
    snapshotDate: dateKey,
    manifest: manifest,
    agreement: agreement,
    utilization: utilization,
    deliveryProjects: deliveryProjects,
    expenses: expenses,
    pipeline: pipeline,
    resourceAssignments: resourceAssignments,
    warnings: warnings.length ? warnings : undefined,
  };
}

/**
 * @param {GoogleAppsScript.Drive.Folder} dateFolder
 * @param {string} artifactKey
 * @param {!Array<string>} warnings
 * @return {?Object}
 * @private
 */
function readOptionalSnapshotArtifact_(dateFolder, artifactKey, warnings) {
  var fileName = SNAPSHOT_ARTIFACT_FILES_[artifactKey];
  if (!fileName) {
    return null;
  }
  var payload = readSnapshotJsonFromDateFolder_(dateFolder, fileName);
  if (!payload) {
    warnings.push(
      artifactKey + ' not included in this snapshot (captured before Expenses/Pipeline were added).'
    );
    return null;
  }
  if (!validateSnapshotArtifactSchema_(payload, artifactKey, warnings)) {
    return null;
  }
  if (payload.ok === false) {
    warnings.push((payload.message) || artifactKey + ' snapshot unavailable.');
    return null;
  }
  return payload;
}

/**
 * @param {!Object} payload
 * @private
 */
function tagSnapshotPayloadSource_(payload) {
  if (payload && typeof payload === 'object') {
    payload.source = 'snapshot';
  }
}

/**
 * Client-callable: per-project Delivery P&L from a snapshot.
 * @param {string} snapshotDate
 * @param {string} agreementId
 * @return {!Object}
 */
function getDashboardSnapshotPnl(snapshotDate, agreementId) {
  requireAuthForApi_();
  var dateKey = requireSnapshotDate_(snapshotDate);
  var id = String(agreementId || '').trim();
  if (!id) {
    return {
      ok: false,
      source: 'snapshot',
      message: 'Missing agreementId.',
    };
  }

  if (!PropertiesService.getScriptProperties().getProperty(SNAPSHOT_DRIVE_FOLDER_PROP_)) {
    return {
      ok: false,
      source: 'snapshot',
      message: 'Historical snapshots are not configured.',
    };
  }

  var dateFolder = readSnapshotDateFolderOrNull_(dateKey);
  if (!dateFolder) {
    return {
      ok: false,
      source: 'snapshot',
      message: 'No snapshot folder for ' + dateKey + '.',
    };
  }

  var relPath = snapshotPnlRelativePath_(id);
  var payload = readSnapshotJsonFromDateFolder_(dateFolder, relPath);
  var warnings = [];
  if (!validateSnapshotArtifactSchema_(payload, 'delivery-pnl', warnings)) {
    return {
      ok: false,
      source: 'snapshot',
      message: warnings[0] || 'P&L snapshot schema mismatch.',
      warnings: warnings,
    };
  }
  if (!payload) {
    return {
      ok: false,
      source: 'snapshot',
      agreementId: id,
      message: 'Monthly P&L snapshot not found for this project on ' + dateKey + '.',
    };
  }
  tagSnapshotPayloadSource_(payload);
  return payload;
}

/**
 * Client-callable: bundled Portfolio P&L from a snapshot date.
 * @param {string} snapshotDate
 * @return {!Object}
 */
function getDashboardSnapshotPortfolioPnl(snapshotDate) {
  var auth = requireAuthForApi_();
  if (!canAccessExpensesDashboard_(auth)) {
    return {
      ok: false,
      source: 'snapshot',
      message: 'Portfolio P&L is available to the Finance team, Execs, and Admins.',
    };
  }
  var dateKey = requireSnapshotDate_(snapshotDate);
  var warnings = [];

  if (!PropertiesService.getScriptProperties().getProperty(SNAPSHOT_DRIVE_FOLDER_PROP_)) {
    return {
      ok: false,
      source: 'snapshot',
      message: 'Historical snapshots are not configured.',
    };
  }

  var dateFolder = readSnapshotDateFolderOrNull_(dateKey);
  if (!dateFolder) {
    return {
      ok: false,
      source: 'snapshot',
      message: 'No snapshot folder for ' + dateKey + '.',
    };
  }

  var payload = readSnapshotJsonFromDateFolder_(dateFolder, SNAPSHOT_ARTIFACT_FILES_['portfolio-pnl']);
  if (payload && validateSnapshotArtifactSchema_(payload, 'portfolio-pnl', warnings)) {
    tagSnapshotPayloadSource_(payload);
    payload.loadSource = 'snapshot';
    payload.snapshotDate = dateKey;
    return payload;
  }

  return {
    ok: false,
    source: 'snapshot',
    snapshotDate: dateKey,
    message: warnings[0] || 'Portfolio P&L snapshot not found for ' + dateKey + '.',
    warnings: warnings,
  };
}

/**
 * Compares one snapshot date's artifacts to current live schema constants.
 *
 * @param {string} snapshotDate
 * @return {{
 *   snapshotDate: string,
 *   found: boolean,
 *   status: string,
 *   stale: boolean,
 *   mismatches: !Array<!{ artifact: string, found: *, expected: number, reason: string }>
 * }}
 */
function inspectSnapshotDateSchema_(snapshotDate) {
  var dateKey = requireSnapshotDate_(snapshotDate);
  var expected = snapshotExpectedSchemaVersions_();
  var out = {
    snapshotDate: dateKey,
    found: false,
    status: '',
    stale: false,
    mismatches: [],
  };
  var dateFolder = readSnapshotDateFolderOrNull_(dateKey);
  if (!dateFolder) {
    return out;
  }
  out.found = true;
  var manifest = readSnapshotManifestFromFolder_(dateFolder);
  out.status = (manifest && manifest.status) || '';

  var versionByArtifact = {};
  if (manifest && manifest.datasets && manifest.datasets.length) {
    for (var d = 0; d < manifest.datasets.length; d++) {
      var ds = manifest.datasets[d];
      if (!ds || !ds.id) {
        continue;
      }
      var artId = String(ds.id);
      if (artId.indexOf('delivery-pnl') === 0 || String(ds.fileName || '').indexOf('delivery-pnl/') === 0) {
        artId = 'delivery-pnl';
      }
      if (versionByArtifact[artId] == null && ds.cacheSchemaVersion != null) {
        versionByArtifact[artId] = ds.cacheSchemaVersion;
      }
    }
  }

  var fileKeys = [
    'agreement',
    'utilization',
    'delivery-projects',
    'expenses',
    'pipeline',
    'resource-assignments',
    'portfolio-pnl',
  ];
  for (var i = 0; i < fileKeys.length; i++) {
    var key = fileKeys[i];
    var exp = expected[key];
    if (exp == null) {
      continue;
    }
    var foundVer = versionByArtifact[key];
    var required = key === 'agreement' || key === 'utilization' || key === 'delivery-projects';
    if (foundVer == null) {
      var payload = readSnapshotJsonFromDateFolder_(dateFolder, SNAPSHOT_ARTIFACT_FILES_[key]);
      if (payload && payload.cacheSchemaVersion != null) {
        foundVer = payload.cacheSchemaVersion;
      }
    }
    if (foundVer == null) {
      if (required) {
        out.mismatches.push({
          artifact: key,
          found: null,
          expected: exp,
          reason: 'missing',
        });
      }
      continue;
    }
    if (foundVer !== exp) {
      out.mismatches.push({
        artifact: key,
        found: foundVer,
        expected: exp,
        reason: 'version_mismatch',
      });
    }
  }

  var pnlExpected = expected['delivery-pnl'];
  if (pnlExpected != null) {
    var pnlFound = versionByArtifact['delivery-pnl'];
    if (pnlFound == null) {
      pnlFound = sampleDeliveryPnlSchemaVersion_(dateFolder);
    }
    if (pnlFound != null && pnlFound !== pnlExpected) {
      out.mismatches.push({
        artifact: 'delivery-pnl',
        found: pnlFound,
        expected: pnlExpected,
        reason: 'version_mismatch',
      });
    }
  }

  out.stale = out.mismatches.length > 0;
  return out;
}

/**
 * @param {GoogleAppsScript.Drive.Folder} dateFolder
 * @return {?number}
 * @private
 */
function sampleDeliveryPnlSchemaVersion_(dateFolder) {
  try {
    var folders = dateFolder.getFoldersByName('delivery-pnl');
    if (!folders.hasNext()) {
      return null;
    }
    var files = folders.next().getFiles();
    if (!files.hasNext()) {
      return null;
    }
    var parsed = JSON.parse(files.next().getBlob().getDataAsString());
    return parsed && parsed.cacheSchemaVersion != null ? parsed.cacheSchemaVersion : null;
  } catch (e) {
    return null;
  }
}

/**
 * Lists snapshot dates whose Drive artifacts are behind current cache schemas.
 *
 * @return {{
 *   ok: boolean,
 *   currentSchemas: !Object<string, number>,
 *   stale: !Array<!Object>,
 *   scanned: number,
 *   message?: string
 * }}
 */
function listStaleSnapshotDates_() {
  if (!PropertiesService.getScriptProperties().getProperty(SNAPSHOT_DRIVE_FOLDER_PROP_)) {
    return {
      ok: false,
      currentSchemas: snapshotExpectedSchemaVersions_(),
      stale: [],
      scanned: 0,
      message: 'FOS_SNAPSHOT_DRIVE_FOLDER_ID is not set.',
    };
  }
  var entries = listSnapshotCatalogEntries_();
  var stale = [];
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    if (!entry || !isSnapshotCatalogStatus_(entry.status)) {
      continue;
    }
    var insp = inspectSnapshotDateSchema_(entry.snapshotDate);
    if (insp.stale) {
      stale.push(insp);
    }
  }
  return {
    ok: true,
    currentSchemas: snapshotExpectedSchemaVersions_(),
    stale: stale,
    scanned: entries.length,
  };
}

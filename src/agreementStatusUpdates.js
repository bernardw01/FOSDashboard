/**
 * PRD version 2.15.7 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Agreement status updates on Delivery P&L (feature 018).
 * Reads and creates rows in Fibery `Agreement Management/Status Updates`.
 *
 * Public:
 *   createAgreementStatusUpdate(agreementId, statusKey, updateContent)
 *
 * Internal (used by deliveryDashboard.js):
 *   fetchStatusUpdatesForAgreement_(agreementId, limit)
 *   buildStatusUpdatesBlock_(agreementId, rows)
 *
 * Diagnostics:
 *   _diag_sampleStatusUpdates(agreementId)
 */

/** @const {string} */
var STATUS_UPDATES_DB_ = 'Agreement Management/Status Updates';

/** @const {string} Fibery enum type behind Agreement Status on Status Updates. */
var STATUS_ENUM_DB_ = 'Agreement Management/Agreement Status_Agreement Management/Status Updates';

/** @const {string} CacheService key for enum/name → fibery/id map. */
var STATUS_ENUM_IDS_CACHE_KEY_ = 'FOS_AGREEMENT_STATUS_ENUM_IDS';

/** @const {string} */
var STATUS_UPDATES_MAX_ROWS_PROP_ = 'DELIVERY_STATUS_UPDATES_MAX_ROWS';

/** @const {string} */
var STATUS_UPDATE_MAX_CHARS_PROP_ = 'DELIVERY_STATUS_UPDATE_MAX_CHARS';

/** @const {number} */
var STATUS_UPDATES_DEFAULT_MAX_ROWS_ = 20;

/** @const {number} */
var STATUS_UPDATE_DEFAULT_MAX_CHARS_ = 8000;

/** @const {!Object<string, string>} statusKey → Fibery enum/name */
var STATUS_KEY_TO_ENUM_NAME_ = {
  on_track: 'Agreement On Track',
  at_risk: 'Agreement At Risk',
  off_trajectory: 'Agreement Off Trajectory',
};

/** @const {!Object<string, string>} Fibery enum/name → traffic light */
var STATUS_ENUM_TO_TRAFFIC_LIGHT_ = {
  'Agreement On Track': 'green',
  'Agreement At Risk': 'yellow',
  'Agreement Off Trajectory': 'red',
  'Agreement of Trajectory': 'red',
};

/** @const {!Array<!Object>} Client-facing status options (stable order). */
var STATUS_UPDATE_OPTIONS_ = [
  { key: 'on_track', label: 'Green', enumName: 'Agreement On Track', trafficLight: 'green' },
  { key: 'at_risk', label: 'Yellow', enumName: 'Agreement At Risk', trafficLight: 'yellow' },
  { key: 'off_trajectory', label: 'Red', enumName: 'Agreement Off Trajectory', trafficLight: 'red' },
];

/**
 * Creates a status update row in Fibery for one agreement.
 *
 * @param {string} agreementId
 * @param {string} statusKey on_track | at_risk | off_trajectory
 * @param {string} updateContent Plain or simple HTML from the client modal.
 * @return {!{ ok: true, id: string }|!{ ok: false, message: string, reason?: string }}
 */
function createAgreementStatusUpdate(agreementId, statusKey, updateContent) {
  requireAuthForApi_();
  agreementId = stringOr_(agreementId, '').trim();
  statusKey = stringOr_(statusKey, '').trim();
  if (!agreementId) {
    return { ok: false, reason: 'MISSING_AGREEMENT', message: 'Select a project first.' };
  }
  var enumName = STATUS_KEY_TO_ENUM_NAME_[statusKey];
  if (!enumName) {
    return { ok: false, reason: 'INVALID_STATUS', message: 'Choose a valid status.' };
  }
  var plain = sanitizeStatusUpdateContent_(updateContent);
  if (!plain) {
    return { ok: false, reason: 'EMPTY_UPDATE', message: 'Enter an update before submitting.' };
  }
  var maxChars = resolveStatusUpdateMaxChars_();
  if (plain.length > maxChars) {
    return {
      ok: false,
      reason: 'TOO_LONG',
      message: 'Update is too long (max ' + maxChars + ' characters).',
    };
  }

  var email = '';
  try {
    email = Session.getActiveUser().getEmail() || '';
  } catch (e) {
    email = '';
  }
  if (!email) {
    return { ok: false, reason: 'NO_SESSION_EMAIL', message: 'Could not determine your signed-in email.' };
  }

  var enumId = statusEnumIdForKey_(statusKey);
  if (!enumId) {
    return {
      ok: false,
      reason: 'ENUM_LOOKUP_FAILED',
      message: 'Could not resolve the status value in Fibery.',
    };
  }

  var entity = {};
  entity['Agreement Management/Agreement'] = { 'fibery/id': agreementId };
  entity['Agreement Management/Agreement Status'] = { 'fibery/id': enumId };
  entity['Agreement Management/Submitted by'] = email;
  entity['Agreement Management/Name'] = statusUpdateDefaultName_(email);

  var batch = fiberyBatchCommands_([
    {
      command: 'fibery.entity/create',
      args: { type: STATUS_UPDATES_DB_, entity: entity },
    },
  ]);
  if (!batch.ok) {
    console.warn('createAgreementStatusUpdate failed: ' + batch.message);
    return { ok: false, reason: batch.reason || 'FIBERY_CREATE', message: batch.message || 'Could not save the status update.' };
  }

  var created = batch.results && batch.results[0];
  var id = '';
  if (created && created['fibery/id']) {
    id = String(created['fibery/id']);
  } else if (created && created.id) {
    id = String(created.id);
  }
  if (!id) {
    return { ok: false, reason: 'FIBERY_CREATE', message: 'Status update row was created but id was missing.' };
  }

  // Rich-text/document fields cannot be set inline on create; write via Document Storage.
  var docSecret = fiberyDocumentSecretForField_(STATUS_UPDATES_DB_, id, 'Agreement Management/Update');
  if (!docSecret.ok) {
    console.warn('createAgreementStatusUpdate document secret failed: ' + docSecret.message);
    return {
      ok: false,
      reason: docSecret.reason || 'DOCUMENT_SECRET_FAILED',
      message: docSecret.message || 'Could not save the update text.',
    };
  }
  var docWrite = fiberySetDocumentContent_(docSecret.secret, plain, 'plain-text');
  if (!docWrite.ok) {
    console.warn('createAgreementStatusUpdate document write failed: ' + docWrite.message);
    return {
      ok: false,
      reason: docWrite.reason || 'DOCUMENT_WRITE_FAILED',
      message: docWrite.message || 'Could not save the update text.',
    };
  }
  var createdRow = normalizeStatusUpdateRow_({
    id: id,
    createdAt: new Date().toISOString(),
    submittedBy: email,
    statusName: enumName,
    updatePlain: plain,
    agreementId: agreementId,
  }, agreementId);
  return {
    ok: true,
    id: id,
    statusUpdate: createdRow,
    statusUpdates: buildStatusUpdatesBlock_([createdRow], true),
  };
}

/**
 * Fetches recent status updates for one agreement, newest first.
 *
 * @param {string} agreementId
 * @param {number=} limit
 * @return {!{ ok: true, rows: !Array<!Object> }|
 *          !{ ok: false, reason: string, message: string }}
 */
function fetchStatusUpdatesForAgreement_(agreementId, limit) {
  if (!agreementId) {
    return { ok: false, reason: 'MISSING_AGREEMENT', message: 'Missing agreementId.' };
  }
  var cap = limit > 0 ? limit : resolveStatusUpdatesMaxRows_();
  var q = {
    query: {
      'q/from': STATUS_UPDATES_DB_,
      'q/select': {
        id: 'fibery/id',
        createdAt: 'fibery/creation-date',
        submittedBy: 'Agreement Management/Submitted by',
        statusName: ['Agreement Management/Agreement Status', 'enum/name'],
        statusColor: ['Agreement Management/Agreement Status', 'enum/color'],
        updateSecret: ['Agreement Management/Update', 'Collaboration~Documents/secret'],
        agreementId: ['Agreement Management/Agreement', 'fibery/id'],
      },
      'q/where': ['=', ['Agreement Management/Agreement', 'fibery/id'], '$agreementId'],
      'q/order-by': [[['fibery/creation-date'], 'q/desc']],
      'q/limit': cap,
    },
    params: { $agreementId: agreementId },
  };
  var r = fiberyQuery_(q);
  if (!r.ok) {
    return r;
  }
  var page = r.rows || [];
  var rows = [];
  for (var i = 0; i < page.length; i++) {
    rows.push(normalizeStatusUpdateRow_(page[i], agreementId));
  }
  hydrateStatusUpdateDocuments_(rows);
  return { ok: true, rows: rows };
}

/**
 * @param {!Array<!Object>} rows Normalized rows, newest first.
 * @param {boolean=} fetchOk False when the Fibery read failed (client may refetch).
 * @return {!{ latest: ?Object, history: !Array<!Object>, statusOptions: !Array<!Object>, fetchOk: boolean }}
 */
function buildStatusUpdatesBlock_(rows, fetchOk) {
  var history = rows || [];
  return {
    latest: history.length ? history[0] : null,
    history: history,
    statusOptions: STATUS_UPDATE_OPTIONS_.slice(),
    fetchOk: fetchOk !== false,
  };
}

/**
 * @param {*} raw Fibery query row.
 * @param {string} agreementId
 * @return {!Object}
 * @private
 */
function normalizeStatusUpdateRow_(raw, agreementId) {
  var statusName = fiberyEnumName_(raw && raw.statusName);
  var trafficLight = statusName ? (STATUS_ENUM_TO_TRAFFIC_LIGHT_[statusName] || 'neutral') : 'neutral';
  var updatePlain = stringOr_(raw && raw.updatePlain, '').trim();
  var docSecret = extractDocumentSecret_(raw && raw.updateSecret);
  return {
    id: stringOr_(raw && raw.id, ''),
    agreementId: stringOr_(raw && raw.agreementId, agreementId),
    agreementStatus: statusName,
    trafficLight: trafficLight,
    statusColor: fiberyEnumColor_(raw && raw.statusColor),
    submittedBy: stringOrNull_(raw && raw.submittedBy),
    createdAt: stringOrNull_(raw && raw.createdAt),
    updatePlain: updatePlain,
    updateSecret: docSecret,
  };
}

/**
 * Fills updatePlain from Document Storage when the entity query omits inline plain text.
 *
 * @param {!Array<!Object>} rows
 * @private
 */
function hydrateStatusUpdateDocuments_(rows) {
  if (!rows || !rows.length) return;
  var secrets = [];
  var needIdx = [];
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i].updatePlain && rows[i].updateSecret) {
      secrets.push(rows[i].updateSecret);
      needIdx.push(i);
    }
  }
  if (!secrets.length) return;
  var batch = fiberyGetDocumentContents_(secrets, 'plain-text');
  if (!batch.ok) {
    console.warn('hydrateStatusUpdateDocuments_ failed: ' + batch.message);
    return;
  }
  var map = batch.contents || {};
  for (var j = 0; j < needIdx.length; j++) {
    var row = rows[needIdx[j]];
    var text = map[row.updateSecret];
    if (text) {
      row.updatePlain = String(text).trim();
    }
  }
}

/**
 * @param {*} v
 * @return {?string}
 * @private
 */
function fiberyEnumName_(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    var s = v.trim();
    return s.length ? s : null;
  }
  if (typeof v === 'object' && v['enum/name']) {
    return stringOrNull_(v['enum/name']);
  }
  return null;
}

/**
 * @param {*} v
 * @return {?string}
 * @private
 */
function fiberyEnumColor_(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    var s = v.trim();
    return s.length ? s : null;
  }
  if (typeof v === 'object' && v['enum/color']) {
    return stringOrNull_(v['enum/color']);
  }
  return null;
}

/**
 * @param {*} v
 * @return {?string}
 * @private
 */
function extractDocumentSecret_(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    var s = v.trim();
    return s.length ? s : null;
  }
  if (typeof v === 'object' && v['Collaboration~Documents/secret']) {
    return stringOrNull_(v['Collaboration~Documents/secret']);
  }
  return null;
}

/**
 * Resolves fibery/id for a status key. Fibery create requires enum id, not enum/name.
 *
 * @param {string} statusKey
 * @return {?string}
 * @private
 */
function statusEnumIdForKey_(statusKey) {
  var enumName = STATUS_KEY_TO_ENUM_NAME_[statusKey];
  if (!enumName) return null;
  var map = resolveStatusEnumIds_();
  if (!map) return null;
  return map[enumName] || null;
}

/**
 * @return {?Object<string, string>} enum/name → fibery/id
 * @private
 */
function resolveStatusEnumIds_() {
  var cache = CacheService.getScriptCache();
  try {
    var cached = cache.get(STATUS_ENUM_IDS_CACHE_KEY_);
    if (cached) {
      var parsed = JSON.parse(cached);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
  } catch (e) { /* ignore */ }

  var q = {
    query: {
      'q/from': STATUS_ENUM_DB_,
      'q/select': { id: 'fibery/id', name: 'enum/name' },
      'q/limit': 20,
    },
  };
  var r = fiberyQuery_(q);
  if (!r.ok) {
    console.warn('resolveStatusEnumIds_ failed: ' + r.message);
    return null;
  }
  var map = {};
  var page = r.rows || [];
  for (var i = 0; i < page.length; i++) {
    var n = stringOrNull_(page[i].name);
    var id = stringOr_(page[i].id, '');
    if (n && id) {
      map[n] = id;
    }
  }
  if (map['Agreement Off Trajectory'] && !map['Agreement of Trajectory']) {
    map['Agreement of Trajectory'] = map['Agreement Off Trajectory'];
  }
  try {
    cache.put(STATUS_ENUM_IDS_CACHE_KEY_, JSON.stringify(map), 21600);
  } catch (e) { /* ignore */ }
  return map;
}

/**
 * @param {string} email
 * @return {string}
 * @private
 */
function statusUpdateDefaultName_(email) {
  var tz = 'UTC';
  try {
    tz = Session.getScriptTimeZone() || tz;
  } catch (e) { /* ignore */ }
  var stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  return stamp + ' ' + email;
}

/**
 * Strips unsafe markup; returns plain text suitable for Fibery document-content.
 *
 * @param {*} content
 * @return {string}
 * @private
 */
function sanitizeStatusUpdateContent_(content) {
  if (content === null || content === undefined) {
    return '';
  }
  var s = String(content);
  s = s.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  s = s.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  s = s.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/href\s*=\s*["']?\s*javascript:[^"'>\s]*/gi, 'href="#"');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** @return {number} @private */
function resolveStatusUpdatesMaxRows_() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(STATUS_UPDATES_MAX_ROWS_PROP_);
  if (raw === null || raw === undefined || raw === '') {
    return STATUS_UPDATES_DEFAULT_MAX_ROWS_;
  }
  var n = parseInt(raw, 10);
  if (!isFinite(n) || n < 1) {
    return STATUS_UPDATES_DEFAULT_MAX_ROWS_;
  }
  return Math.min(n, 100);
}

/** @return {number} @private */
function resolveStatusUpdateMaxChars_() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(STATUS_UPDATE_MAX_CHARS_PROP_);
  if (raw === null || raw === undefined || raw === '') {
    return STATUS_UPDATE_DEFAULT_MAX_CHARS_;
  }
  var n = parseInt(raw, 10);
  if (!isFinite(n) || n < 100) {
    return STATUS_UPDATE_DEFAULT_MAX_CHARS_;
  }
  return Math.min(n, 50000);
}

/**
 * @param {string} agreementId
 * @return {!Object}
 */
function _diag_sampleStatusUpdates(agreementId) {
  var fetch = fetchStatusUpdatesForAgreement_(agreementId);
  var summary = {
    ok: fetch.ok,
    rowCount: fetch.ok ? (fetch.rows || []).length : 0,
    message: fetch.ok ? undefined : fetch.message,
  };
  if (fetch.ok) {
    summary.block = buildStatusUpdatesBlock_(fetch.rows, true);
    if (summary.block.latest) {
      summary.latestStatus = summary.block.latest.agreementStatus;
      summary.latestTrafficLight = summary.block.latest.trafficLight;
    }
  }
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

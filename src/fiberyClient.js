/**
 * PRD version 1.11.0 — sync with docs/FOS-Dashboard-PRD.md
 *
 * Fibery REST API client (Apps Script UrlFetchApp).
 *
 * - Authenticates with a single bearer token stored in Script Property
 *   FIBERY_API_TOKEN (read-only on the server; never returned to the client).
 * - Targets the workspace identified by Script Property FIBERY_HOST
 *   (e.g. "harpinai.fibery.io"; no scheme, no trailing slash).
 * - Sends one or more {command, args} objects per POST to /api/commands —
 *   Fibery returns a same-length array of results.
 *
 * Public:
 *   fiberyQuery_(query)             — single fibery.entity/query command
 *   fiberyBatchQuery_(queries)      — N commands in one round-trip
 *   fiberyPing_()                   — fibery/version, for diagnostics
 *
 * No payloads or tokens are logged. Errors are mapped to a small {ok:false,reason}
 * shape so the caller can render a friendly message without leaking internals.
 */

/** @const {string} */
var FIBERY_HOST_PROP_ = 'FIBERY_HOST';

/** @const {string} */
var FIBERY_TOKEN_PROP_ = 'FIBERY_API_TOKEN';

/** @const {number} UrlFetchApp default is ~60s; keep us well under that. */
var FIBERY_HTTP_TIMEOUT_MS_ = 55000;

/**
 * Executes a single fibery.entity/query command. Convenience wrapper around
 * fiberyBatchQuery_ for the one-query case.
 *
 * @param {!Object} queryOrSpec Either a bare query body (`q/from`, `q/select`, …)
 *   or a `{ query, params }` object matching the args shape.
 * @return {!{ ok: true, rows: !Array }|!{ ok: false, reason: string, message: string }}
 */
function fiberyQuery_(queryOrSpec) {
  var batch = fiberyBatchQuery_([queryOrSpec]);
  if (!batch.ok) {
    return batch;
  }
  return { ok: true, rows: batch.results[0] };
}

/**
 * Executes N fibery.entity/query commands in one POST. Results are returned in
 * the same order as the input array. Either all succeed or the whole call fails
 * (any single command error short-circuits with reason='FIBERY_RESULT_ERROR').
 *
 * @param {!Array<!Object>} queries Each entry is either a bare query body or a
 *   `{ query, params }` object. Bare queries are wrapped automatically.
 * @return {!{ ok: true, results: !Array<!Array> }|!{ ok: false, reason: string, message: string }}
 */
function fiberyBatchQuery_(queries) {
  var cfg = readFiberyConfig_();
  if (!cfg.ok) {
    return cfg;
  }

  var commands = [];
  for (var i = 0; i < queries.length; i++) {
    var spec = queries[i];
    var args;
    if (spec && spec.query && (spec.params || spec.query['q/from'])) {
      // Caller passed { query, params }.
      args = { query: spec.query };
      if (spec.params) {
        args.params = spec.params;
      }
    } else {
      // Caller passed a bare query body.
      args = { query: spec };
    }
    commands.push({ command: 'fibery.entity/query', args: args });
  }

  var resp;
  try {
    resp = UrlFetchApp.fetch('https://' + cfg.host + '/api/commands', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Token ' + cfg.token },
      payload: JSON.stringify(commands),
      muteHttpExceptions: true,
      followRedirects: false,
    });
  } catch (e) {
    fiberyWarn_('fetch threw', e);
    return { ok: false, reason: 'FIBERY_NETWORK', message: 'Could not reach Fibery.' };
  }

  var code = resp.getResponseCode();
  if (code === 401 || code === 403) {
    fiberyWarn_('auth rejected by Fibery (' + code + ')', null);
    return { ok: false, reason: 'FIBERY_AUTH', message: 'Fibery rejected the API token.' };
  }
  if (code < 200 || code >= 300) {
    fiberyWarn_('non-2xx from Fibery (' + code + ')', null);
    return { ok: false, reason: 'FIBERY_HTTP', message: 'Fibery returned HTTP ' + code + '.' };
  }

  var body;
  try {
    body = JSON.parse(resp.getContentText());
  } catch (e) {
    fiberyWarn_('JSON parse failed', e);
    return { ok: false, reason: 'FIBERY_PARSE', message: 'Could not parse the Fibery response.' };
  }
  if (!Array.isArray(body)) {
    return { ok: false, reason: 'FIBERY_PARSE', message: 'Unexpected Fibery response shape.' };
  }

  var rows = new Array(body.length);
  for (var j = 0; j < body.length; j++) {
    var item = body[j];
    if (!item || item.success !== true) {
      var msg = (item && item.result && item.result.message) || 'Fibery command failed.';
      fiberyWarn_('command error: ' + msg, null);
      return { ok: false, reason: 'FIBERY_RESULT_ERROR', message: msg };
    }
    rows[j] = Array.isArray(item.result) ? item.result : [];
  }

  return { ok: true, results: rows };
}

/**
 * Diagnostic ping. Returns workspace + API version when credentials work.
 * @return {!{ ok: true, version: ?string }|!{ ok: false, reason: string, message: string }}
 */
function fiberyPing_() {
  var cfg = readFiberyConfig_();
  if (!cfg.ok) {
    return cfg;
  }
  var resp;
  try {
    resp = UrlFetchApp.fetch('https://' + cfg.host + '/api/commands', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Token ' + cfg.token },
      payload: JSON.stringify([{ command: 'fibery.app/version' }]),
      muteHttpExceptions: true,
      followRedirects: false,
    });
  } catch (e) {
    return { ok: false, reason: 'FIBERY_NETWORK', message: 'Could not reach Fibery.' };
  }
  var code = resp.getResponseCode();
  if (code === 401 || code === 403) {
    return { ok: false, reason: 'FIBERY_AUTH', message: 'Fibery rejected the API token.' };
  }
  if (code < 200 || code >= 300) {
    return { ok: false, reason: 'FIBERY_HTTP', message: 'Fibery returned HTTP ' + code + '.' };
  }
  var version = null;
  try {
    var body = JSON.parse(resp.getContentText());
    if (Array.isArray(body) && body[0] && body[0].success === true) {
      version = body[0].result || null;
    }
  } catch (_) {
    /* keep version null */
  }
  return { ok: true, version: version };
}

/**
 * @return {!{ ok: true, host: string, token: string }|!{ ok: false, reason: string, message: string }}
 * @private
 */
function readFiberyConfig_() {
  var props = PropertiesService.getScriptProperties();
  var host = (props.getProperty(FIBERY_HOST_PROP_) || '').trim();
  var token = (props.getProperty(FIBERY_TOKEN_PROP_) || '').trim();
  if (!host) {
    return { ok: false, reason: 'FIBERY_MISSING_HOST', message: 'FIBERY_HOST is not set in Script Properties.' };
  }
  if (!token) {
    return { ok: false, reason: 'FIBERY_MISSING_TOKEN', message: 'FIBERY_API_TOKEN is not set in Script Properties.' };
  }
  // Defensive: strip scheme/trailing slash if the operator pasted them.
  host = host.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return { ok: true, host: host, token: token };
}

/**
 * @param {string} msg
 * @param {*} err
 * @private
 */
function fiberyWarn_(msg, err) {
  try {
    if (err && err.message) {
      console.warn('Fibery: ' + msg + ': ' + err.message);
    } else {
      console.warn('Fibery: ' + msg);
    }
  } catch (_) {
    /* never throw from a logger */
  }
}

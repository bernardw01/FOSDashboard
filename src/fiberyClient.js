/**
 * PRD version 2.15.6 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Fibery REST API client (Apps Script UrlFetchApp).
 *
 * - Authenticates with a single bearer token stored in Script Property
 *   FIBERY_API_TOKEN (read-only on the server; never returned to the client).
 * - Targets the workspace identified by Script Property FIBERY_HOST
 *   (e.g. "harpin-ai.fibery.io"; no scheme, no trailing slash).
 * - Sends one or more {command, args} objects per POST to /api/commands  - 
 *   Fibery returns a same-length array of results.
 *
 * Public:
 *   fiberyQuery_(query)             - single fibery.entity/query command
 *   fiberyBatchQuery_(queries)      - N commands in one round-trip
 *   fiberyBatchCommands_(commands)  - arbitrary Fibery commands (create/update)
 *   fiberyDocumentSecretForField_(type, id, field) - rich-text document secret
 *   fiberySetDocumentContent_(secret, content, format) - write document body
 *   fiberyGetDocumentContents_(secrets, format) - batch read document bodies
 *   fiberyPing_()                   - fibery/version, for diagnostics
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
 * @param {!Object} queryOrSpec Either a bare query body (`q/from`, `q/select`, ...)
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
 * Executes arbitrary Fibery API commands in one POST. Each entry must be
 * `{ command: string, args: object }`. Results are returned in input order.
 *
 * @param {!Array<{ command: string, args: !Object }>} commands
 * @return {!{ ok: true, results: !Array<*> }|!{ ok: false, reason: string, message: string }}
 */
function fiberyBatchCommands_(commands) {
  var cfg = readFiberyConfig_();
  if (!cfg.ok) {
    return cfg;
  }
  if (!commands || !commands.length) {
    return { ok: true, results: [] };
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

  var results = new Array(body.length);
  for (var j = 0; j < body.length; j++) {
    var item = body[j];
    if (!item || item.success !== true) {
      var msg = (item && item.result && item.result.message) || 'Fibery command failed.';
      fiberyWarn_('command error: ' + msg, null);
      return { ok: false, reason: 'FIBERY_RESULT_ERROR', message: msg };
    }
    results[j] = item.result;
  }

  return { ok: true, results: results };
}

/**
 * Reads the collaborative-document secret for a rich-text field on an entity.
 *
 * @param {string} entityType
 * @param {string} entityId
 * @param {string} documentFieldName
 * @return {!{ ok: true, secret: string }|!{ ok: false, reason: string, message: string }}
 */
function fiberyDocumentSecretForField_(entityType, entityId, documentFieldName) {
  if (!entityType || !entityId || !documentFieldName) {
    return { ok: false, reason: 'INVALID_ARGS', message: 'Missing document lookup args.' };
  }
  var q = {
    query: {
      'q/from': entityType,
      'q/select': {
        id: 'fibery/id',
        docSecret: [documentFieldName, 'Collaboration~Documents/secret'],
      },
      'q/where': ['=', ['fibery/id'], '$id'],
      'q/limit': 1,
    },
    params: { $id: entityId },
  };
  var r = fiberyQuery_(q);
  if (!r.ok) {
    return r;
  }
  var row = r.rows && r.rows[0];
  if (!row) {
    return { ok: false, reason: 'DOCUMENT_SECRET_NOT_FOUND', message: 'Could not load document metadata.' };
  }
  var secret = row.docSecret;
  if (secret && typeof secret === 'object' && secret['Collaboration~Documents/secret']) {
    secret = secret['Collaboration~Documents/secret'];
  }
  secret = secret ? String(secret).trim() : '';
  if (!secret) {
    return { ok: false, reason: 'DOCUMENT_SECRET_EMPTY', message: 'Document secret was empty.' };
  }
  return { ok: true, secret: secret };
}

/**
 * Writes rich-text/document storage content for an existing collaborative document.
 *
 * @param {string} secret
 * @param {string} content
 * @param {string=} format md | plain-text | html (default md)
 * @return {!{ ok: true }|!{ ok: false, reason: string, message: string }}
 */
function fiberySetDocumentContent_(secret, content, format) {
  var cfg = readFiberyConfig_();
  if (!cfg.ok) {
    return cfg;
  }
  if (!secret) {
    return { ok: false, reason: 'DOCUMENT_SECRET_EMPTY', message: 'Missing document secret.' };
  }
  var fmt = format || 'md';
  var url = 'https://' + cfg.host + '/api/documents/commands?format=' + encodeURIComponent(fmt);
  var resp;
  try {
    resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Token ' + cfg.token },
      payload: JSON.stringify({
        command: 'create-or-update-documents',
        args: [{ secret: secret, content: String(content || '') }],
      }),
      muteHttpExceptions: true,
      followRedirects: false,
    });
  } catch (e) {
    fiberyWarn_('document fetch threw', e);
    return { ok: false, reason: 'FIBERY_NETWORK', message: 'Could not reach Fibery document storage.' };
  }
  var code = resp.getResponseCode();
  if (code === 401 || code === 403) {
    fiberyWarn_('document auth rejected (' + code + ')', null);
    return { ok: false, reason: 'FIBERY_AUTH', message: 'Fibery rejected the API token.' };
  }
  if (code < 200 || code >= 300) {
    fiberyWarn_('document non-2xx (' + code + ')', null);
    return { ok: false, reason: 'FIBERY_HTTP', message: 'Fibery document API returned HTTP ' + code + '.' };
  }
  return { ok: true };
}

/**
 * Batch-read collaborative document bodies by secret.
 *
 * @param {!Array<string>} secrets
 * @param {string=} format plain-text | md | html (default plain-text)
 * @return {!{ ok: true, contents: !Object<string, string> }|
 *          !{ ok: false, reason: string, message: string }}
 */
function fiberyGetDocumentContents_(secrets, format) {
  var cfg = readFiberyConfig_();
  if (!cfg.ok) {
    return cfg;
  }
  var contents = {};
  if (!secrets || !secrets.length) {
    return { ok: true, contents: contents };
  }
  var fmt = format || 'plain-text';
  var args = [];
  for (var i = 0; i < secrets.length; i++) {
    var s = secrets[i] ? String(secrets[i]).trim() : '';
    if (s) {
      args.push({ secret: s });
    }
  }
  if (!args.length) {
    return { ok: true, contents: contents };
  }
  var url = 'https://' + cfg.host + '/api/documents/commands?format=' + encodeURIComponent(fmt);
  var resp;
  try {
    resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Token ' + cfg.token },
      payload: JSON.stringify({
        command: 'get-documents',
        args: args,
      }),
      muteHttpExceptions: true,
      followRedirects: false,
    });
  } catch (e) {
    fiberyWarn_('document batch read threw', e);
    return { ok: false, reason: 'FIBERY_NETWORK', message: 'Could not reach Fibery document storage.' };
  }
  var code = resp.getResponseCode();
  if (code === 401 || code === 403) {
    return { ok: false, reason: 'FIBERY_AUTH', message: 'Fibery rejected the API token.' };
  }
  if (code < 200 || code >= 300) {
    return { ok: false, reason: 'FIBERY_HTTP', message: 'Fibery document API returned HTTP ' + code + '.' };
  }
  var body;
  try {
    body = JSON.parse(resp.getContentText());
  } catch (e) {
    return { ok: false, reason: 'FIBERY_PARSE', message: 'Could not parse document batch response.' };
  }
  if (!Array.isArray(body)) {
    return { ok: false, reason: 'FIBERY_PARSE', message: 'Unexpected document batch response shape.' };
  }
  for (var j = 0; j < body.length; j++) {
    var item = body[j];
    if (!item || !item.secret) continue;
    contents[String(item.secret)] = item.content != null ? String(item.content) : '';
  }
  return { ok: true, contents: contents };
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

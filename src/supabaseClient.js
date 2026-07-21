/**
 * PRD version 3.0.5 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Supabase (PostgREST) client for Feature 036.
 * Secrets stay in Script Properties; never returned to the client.
 */

/** @const {string} */
var SUPABASE_URL_PROP_ = 'SUPABASE_URL';

/** @const {string} */
var SUPABASE_KEY_PROP_ = 'SUPABASE_SERVICE_ROLE_KEY';

/** @const {number} */
var SUPABASE_HTTP_TIMEOUT_MS_ = 55000;

/** @const {number} */
var SUPABASE_DEFAULT_PAGE_SIZE_ = 1000;

/**
 * @return {!{
 *   ok: true,
 *   url: string,
 *   key: string
 * }|{
 *   ok: false,
 *   reason: string,
 *   message: string
 * }}
 */
function supabaseConfig_() {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty(SUPABASE_URL_PROP_) || '')
    .trim()
    .replace(/\/+$/, '');
  var key = String(props.getProperty(SUPABASE_KEY_PROP_) || '').trim();
  if (!url) {
    return {
      ok: false,
      reason: 'SUPABASE_URL_MISSING',
      message: 'SUPABASE_URL is not configured.',
    };
  }
  if (!key) {
    return {
      ok: false,
      reason: 'SUPABASE_KEY_MISSING',
      message: 'SUPABASE_SERVICE_ROLE_KEY is not configured.',
    };
  }
  return { ok: true, url: url, key: key };
}

/**
 * @return {boolean}
 */
function isSupabaseConfigured_() {
  var cfg = supabaseConfig_();
  return !!(cfg && cfg.ok);
}

/**
 * Live read source: supabase | fibery (default fibery until cutover).
 * @return {string}
 */
function dashboardReadSource_() {
  var raw = String(
    PropertiesService.getScriptProperties().getProperty('DASHBOARD_READ_SOURCE') ||
      'fibery'
  )
    .trim()
    .toLowerCase();
  if (raw === 'supabase') {
    return 'supabase';
  }
  return 'fibery';
}

/**
 * True when Live panels should prefer Supabase payloads.
 * @return {boolean}
 */
function shouldServeFromSupabase_() {
  return dashboardReadSource_() === 'supabase' && isSupabaseConfigured_();
}

/**
 * @param {string} method
 * @param {string} path Absolute path after host, e.g. /rest/v1/fos_panel_payloads
 * @param {?Object<string, string|number|boolean>} query
 * @param {*=} body
 * @param {?Object=} extraHeaders
 * @return {!{
 *   ok: true,
 *   code: number,
 *   json: *,
 *   text: string
 * }|{
 *   ok: false,
 *   reason: string,
 *   message: string,
 *   code?: number
 * }}
 */
function supabaseRest_(method, path, query, body, extraHeaders) {
  var cfg = supabaseConfig_();
  if (!cfg.ok) {
    return cfg;
  }
  var url = cfg.url + path;
  if (query) {
    var parts = [];
    for (var k in query) {
      if (!Object.prototype.hasOwnProperty.call(query, k)) continue;
      var v = query[k];
      if (v === null || v === undefined) continue;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
    }
    if (parts.length) {
      url += (url.indexOf('?') >= 0 ? '&' : '?') + parts.join('&');
    }
  }
  var headers = {
    apikey: cfg.key,
    Authorization: 'Bearer ' + cfg.key,
    Accept: 'application/json',
  };
  if (extraHeaders) {
    for (var hk in extraHeaders) {
      if (Object.prototype.hasOwnProperty.call(extraHeaders, hk)) {
        headers[hk] = extraHeaders[hk];
      }
    }
  }
  var opts = {
    method: String(method || 'get').toLowerCase(),
    headers: headers,
    muteHttpExceptions: true,
    followRedirects: true,
  };
  if (body !== undefined && body !== null && opts.method !== 'get' && opts.method !== 'head') {
    opts.contentType = 'application/json';
    opts.payload = typeof body === 'string' ? body : JSON.stringify(body);
  }
  var resp;
  try {
    resp = UrlFetchApp.fetch(url, opts);
  } catch (e) {
    supabaseWarn_('fetch threw', e);
    return {
      ok: false,
      reason: 'SUPABASE_NETWORK',
      message: 'Could not reach Supabase.',
    };
  }
  var code = resp.getResponseCode();
  var text = resp.getContentText() || '';
  var json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (_) {
      json = null;
    }
  }
  if (code < 200 || code >= 300) {
    supabaseWarn_('HTTP ' + code + ' ' + path, null);
    return supabaseOkError_({
      ok: false,
      reason: 'SUPABASE_HTTP_' + code,
      message: supabaseSafeErrorMessage_(code, json, text),
      code: code,
    });
  }
  return { ok: true, code: code, json: json, text: text };
}

/**
 * @param {string} fnName
 * @param {!Object=} args
 * @return {!Object}
 */
function supabaseRpc_(fnName, args) {
  return supabaseRest_('post', '/rest/v1/rpc/' + encodeURIComponent(fnName), null, args || {});
}

/**
 * Upsert rows via PostgREST Prefer: resolution=merge-duplicates.
 * @param {string} table
 * @param {!Array<!Object>|!Object} rows
 * @param {string=} onConflict comma-separated columns
 * @return {!Object}
 */
function supabaseUpsert_(table, rows, onConflict) {
  var headers = {
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };
  var query = null;
  if (onConflict) {
    query = { on_conflict: onConflict };
  }
  return supabaseRest_('post', '/rest/v1/' + encodeURIComponent(table), query, rows, headers);
}

/**
 * @param {string} table
 * @param {!Object<string, string>} query PostgREST filters (e.g. panel_key=eq.agreement)
 * @param {string=} select
 * @param {number=} limit
 * @return {!Object}
 */
function supabaseSelect_(table, query, select, limit) {
  var q = {};
  if (query) {
    for (var k in query) {
      if (Object.prototype.hasOwnProperty.call(query, k)) {
        q[k] = query[k];
      }
    }
  }
  q.select = select || '*';
  if (limit) {
    q.limit = String(limit);
  }
  return supabaseRest_('get', '/rest/v1/' + encodeURIComponent(table), q, null, {
    Prefer: 'count=exact',
  });
}

/**
 * ADMIN / diag: lightweight connectivity check.
 * @return {!{ ok: boolean, message: string, configured?: boolean }}
 */
function supabasePing_() {
  var cfg = supabaseConfig_();
  if (!cfg.ok) {
    return { ok: false, message: cfg.message, configured: false };
  }
  var res = supabaseSelect_('fos_dataset_as_of', { select: 'dataset_key' }, 'dataset_key', 1);
  if (!res.ok) {
    // Table may not exist yet; fall back to auth root.
    var root = supabaseRest_('get', '/rest/v1/', null, null);
    if (root.ok) {
      return {
        ok: true,
        message: 'Supabase reachable (schema tables may still need migrations).',
        configured: true,
      };
    }
    return { ok: false, message: res.message || 'Supabase ping failed.', configured: true };
  }
  return { ok: true, message: 'Supabase OK.', configured: true };
}

/**
 * @param {!Object} res
 * @return {!Object}
 */
function supabaseOkError_(res) {
  return res;
}

/**
 * @param {number} code
 * @param {*} json
 * @param {string} text
 * @return {string}
 */
function supabaseSafeErrorMessage_(code, json, text) {
  if (json && typeof json === 'object') {
    var msg = json.message || json.error || json.hint;
    if (msg) {
      return String(msg).slice(0, 240);
    }
  }
  if (code === 401 || code === 403) {
    return 'Supabase rejected credentials.';
  }
  if (code >= 500) {
    return 'Supabase server error (' + code + ').';
  }
  return 'Supabase request failed (' + code + ').';
}

/**
 * @param {string} label
 * @param {*} err
 */
function supabaseWarn_(label, err) {
  try {
    var detail = '';
    if (err && err.message) {
      detail = ' ' + String(err.message);
    }
    console.warn('supabaseClient: ' + label + detail);
  } catch (_) {
    /* ignore */
  }
}

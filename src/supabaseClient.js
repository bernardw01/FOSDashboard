/**
 * PRD version 3.15.1 - sync with docs/FOS-Dashboard-PRD.md
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
 * Feature 047 measurement counter. Null unless a `_diag_` harness is running,
 * so normal serve paths pay nothing beyond one null check per request.
 * @type {?{calls: number, bytes: number, ms: number, byPath: !Object<string, number>}}
 */
var SUPABASE_PERF_COUNTER_ = null;

/**
 * Begins counting PostgREST calls, response bytes, and elapsed HTTP time.
 * Feature 047 Step 0. Not for use on serve paths.
 */
function supabasePerfCounterStart_() {
  SUPABASE_PERF_COUNTER_ = { calls: 0, bytes: 0, ms: 0, byPath: {} };
}

/**
 * Stops counting and returns the totals collected since the last start.
 * @return {!{calls: number, bytes: number, ms: number, byPath: !Object<string, number>}}
 */
function supabasePerfCounterStop_() {
  var counter = SUPABASE_PERF_COUNTER_ || { calls: 0, bytes: 0, ms: 0, byPath: {} };
  SUPABASE_PERF_COUNTER_ = null;
  return counter;
}

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
 * Live read source label for UI hints.
 * Live panels always serve from Datastore (Supabase) when credentials exist.
 * `DASHBOARD_READ_SOURCE=fibery` is ignored (no Live Fibery fallback as of v3.0.11).
 * @return {string} `supabase` | `unconfigured`
 */
function dashboardReadSource_() {
  return isSupabaseConfigured_() ? 'supabase' : 'unconfigured';
}

/**
 * True when Live panels serve from Supabase (credentials configured).
 * @return {boolean}
 */
function shouldServeFromSupabase_() {
  return isSupabaseConfigured_();
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
    // Feature 047 A3: SUPABASE_HTTP_TIMEOUT_MS_ existed but was never applied,
    // so a hung request could consume the whole 6-minute execution budget.
    // UrlFetchApp defaults to 360s; a dashboard read that slow is already a
    // failed load.
    timeoutSeconds: Math.round(SUPABASE_HTTP_TIMEOUT_MS_ / 1000),
  };
  if (body !== undefined && body !== null && opts.method !== 'get' && opts.method !== 'head') {
    opts.contentType = 'application/json';
    opts.payload = typeof body === 'string' ? body : JSON.stringify(body);
  }
  var resp;
  var startedAt = SUPABASE_PERF_COUNTER_ ? Date.now() : 0;
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
  if (SUPABASE_PERF_COUNTER_) {
    SUPABASE_PERF_COUNTER_.calls += 1;
    SUPABASE_PERF_COUNTER_.bytes += text.length;
    SUPABASE_PERF_COUNTER_.ms += Date.now() - startedAt;
    SUPABASE_PERF_COUNTER_.byPath[path] =
      (SUPABASE_PERF_COUNTER_.byPath[path] || 0) + 1;
  }
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

/** @const {number} Safe upper bound on pages read by supabaseSelectAll_. */
var SUPABASE_SELECT_ALL_MAX_PAGES_ = 100;

/**
 * Pages through a full PostgREST table/view read using Range-style offset
 * paging (SUPABASE_DEFAULT_PAGE_SIZE_ rows per page), up to
 * SUPABASE_SELECT_ALL_MAX_PAGES_ pages. Mirrors the paging pattern used by
 * `fetchFosLaborCostsByRange_` in `fiberyUtilizationDashboard.js`.
 *
 * @param {string} table
 * @param {?Object<string, string>=} filters PostgREST filters (e.g.
 *   `{ agreement_id: 'eq.' + id }`); may include `or`, `and`, etc.
 * @param {string=} select Column list (default `*`).
 * @param {string=} order PostgREST `order` value (e.g. `created_at.asc`).
 * @return {!{ ok: true, rows: !Array<!Object>, truncated: boolean }|
 *          !{ ok: false, reason: string, message: string }}
 */
function supabaseSelectAll_(table, filters, select, order) {
  var pageSize = SUPABASE_DEFAULT_PAGE_SIZE_ || 1000;
  var all = [];
  for (var page = 0; page < SUPABASE_SELECT_ALL_MAX_PAGES_; page++) {
    var offset = page * pageSize;
    var query = {};
    if (filters) {
      for (var k in filters) {
        if (Object.prototype.hasOwnProperty.call(filters, k)) {
          query[k] = filters[k];
        }
      }
    }
    query.select = select || '*';
    query.limit = String(pageSize);
    query.offset = String(offset);
    if (order) {
      query.order = order;
    }
    var res = supabaseRest_('get', '/rest/v1/' + encodeURIComponent(table), query, null, null);
    if (!res.ok) {
      return {
        ok: false,
        reason: res.reason || 'SUPABASE_HTTP',
        message: res.message || (table + ' query failed.'),
      };
    }
    var chunk = res.json || [];
    for (var i = 0; i < chunk.length; i++) {
      all.push(chunk[i]);
    }
    if (chunk.length < pageSize) {
      return { ok: true, rows: all, truncated: false };
    }
  }
  return { ok: true, rows: all, truncated: true };
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

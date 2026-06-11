/**
 * PRD version 2.12.8 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Phase 0 diagnostics for AI usage Admin APIs (feature 017).
 * Editor-only helpers; logs redacted summaries (no secrets, no full payloads).
 *
 * Script Properties:
 *   ANTHROPIC_ADMIN_API_KEY
 *   OPENAI_ADMIN_API_KEY
 *
 * Public (Apps Script editor - names must NOT end with _ or Run dropdown hides them):
 *   _diag_sampleAiUsageAnthropic(dateYmd)
 *   _diag_sampleAiUsageOpenAi(dateYmd)
 *   _diag_aiUsageScriptPropertyCheck()
 *   _diag_aiUsageMatchContext()
 */

/** @const {string} */
var AI_USAGE_ANTHROPIC_ADMIN_KEY_PROP_ = 'ANTHROPIC_ADMIN_API_KEY';

/** @const {string} */
var AI_USAGE_OPENAI_ADMIN_KEY_PROP_ = 'OPENAI_ADMIN_API_KEY';

/** @const {string} */
var AI_USAGE_ANTHROPIC_API_BASE_ = 'https://api.anthropic.com';

/** @const {string} */
var AI_USAGE_OPENAI_API_BASE_ = 'https://api.openai.com/v1';

/** @const {string} */
var AI_USAGE_ANTHROPIC_VERSION_ = '2023-06-01';

/** @const {number} */
var AI_USAGE_DIAG_HTTP_TIMEOUT_MS_ = 55000;

/**
 * Logs which AI usage Script Properties are set (values never logged).
 */
function _diag_aiUsageScriptPropertyCheck() {
  var props = PropertiesService.getScriptProperties();
  var anthropic = props.getProperty(AI_USAGE_ANTHROPIC_ADMIN_KEY_PROP_);
  var openai = props.getProperty(AI_USAGE_OPENAI_ADMIN_KEY_PROP_);
  Logger.log(
    'AI usage Script Properties: ANTHROPIC_ADMIN_API_KEY=%s OPENAI_ADMIN_API_KEY=%s',
    anthropic ? 'set' : 'MISSING',
    openai ? 'set' : 'MISSING'
  );
}

/**
 * Validates Fibery match context: Clockify Users index, Actor Mapping rows, Anthropic API keys.
 */
function _diag_aiUsageMatchContext() {
  _diag_aiUsageScriptPropertyCheck();
  var ping = fiberyPing_();
  Logger.log('Fibery ping: ok=%s version=%s', ping.ok, ping.ok ? ping.version : ping.message);

  var ctx = aiUsageLoadMatchContext_();
  var clockifyCount = Object.keys(ctx.clockifyByEmail || {}).length;
  var mappingCount = Object.keys(ctx.actorMappings || {}).length;
  Logger.log('Clockify Users by email: %s', clockifyCount);
  Logger.log('Actor Mapping entries (usable): %s', mappingCount);
  (ctx.warnings || []).forEach(function (w) {
    Logger.log('Warning: %s', w);
  });

  if (!PropertiesService.getScriptProperties().getProperty(AI_USAGE_ANTHROPIC_ADMIN_KEY_PROP_)) {
    Logger.log('Skip Anthropic api_keys list: ANTHROPIC_ADMIN_API_KEY missing');
    return;
  }
  try {
    var keys = aiUsageFetchAnthropicApiKeyIndex_();
    var ids = Object.keys(keys);
    Logger.log('Anthropic API keys in org: %s', ids.length);
    ids.slice(0, 8).forEach(function (id) {
      Logger.log('  api_key_id=%s name=%s', id.slice(0, 12) + '...', keys[id].name || '');
    });
    if (mappingCount === 0 && ids.length > 0) {
      Logger.log(
        'Hint: create Actor Mapping rows with Source Platform=Anthropic Console and External Actor Id=<api_key_id>'
      );
    }
  } catch (e) {
    Logger.log('Anthropic api_keys failed: %s', e && e.message ? e.message : e);
  }
}

/**
 * @param {string} dateYmd YYYY-MM-DD (UTC day for claude_code; messages use midnight Z)
 */
function _diag_sampleAiUsageAnthropic(dateYmd) {
  dateYmd = String(dateYmd || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
    throw new Error('_diag_sampleAiUsageAnthropic: dateYmd must be YYYY-MM-DD');
  }
  var key = _aiUsageRequireAdminKey_(AI_USAGE_ANTHROPIC_ADMIN_KEY_PROP_, 'Anthropic');
  var org = _aiUsageAnthropicGetJson_('/v1/organizations/me', key, {});
  Logger.log('Anthropic org: id=%s name=%s', org.id || '', org.name || '');

  var startIso = dateYmd + 'T00:00:00Z';
  var endIso = dateYmd + 'T23:59:59Z';
  var messages = _aiUsageAnthropicGetJson_('/v1/organizations/usage_report/messages', key, {
    starting_at: startIso,
    ending_at: endIso,
    bucket_width: '1d',
    group_by: ['api_key_id', 'model'],
    limit: 31,
  });
  var msgStats = _aiUsageSummarizeAnthropicMessages_(messages);
  Logger.log('Anthropic messages %s: buckets=%s results=%s api_key_rows=%s',
    dateYmd, msgStats.buckets, msgStats.results, msgStats.withApiKey);

  var cost = _aiUsageAnthropicGetJson_('/v1/organizations/cost_report', key, {
    starting_at: startIso,
    ending_at: endIso,
    group_by: ['description', 'model'],
    limit: 31,
  });
  var costStats = _aiUsageSummarizeAnthropicCost_(cost);
  Logger.log('Anthropic cost %s: buckets=%s results=%s', dateYmd, costStats.buckets, costStats.results);

  var claudeCode = _aiUsageAnthropicGetJson_('/v1/organizations/usage_report/claude_code', key, {
    starting_at: dateYmd,
    limit: 100,
  });
  var ccStats = _aiUsageSummarizeAnthropicClaudeCode_(claudeCode);
  Logger.log(
    'Anthropic claude_code %s: rows=%s api_actors=%s subscription_rows=%s',
    dateYmd,
    ccStats.rows,
    ccStats.apiActors,
    ccStats.subscriptionRows
  );
}

/**
 * @param {string} dateYmd YYYY-MM-DD
 */
function _diag_sampleAiUsageOpenAi(dateYmd) {
  dateYmd = String(dateYmd || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
    throw new Error('_diag_sampleAiUsageOpenAi: dateYmd must be YYYY-MM-DD');
  }
  var key = _aiUsageRequireAdminKey_(AI_USAGE_OPENAI_ADMIN_KEY_PROP_, 'OpenAI');
  var startSec = Math.floor(Date.parse(dateYmd + 'T00:00:00Z') / 1000);
  var endSec = startSec + 86400 - 1;
  var costs = _aiUsageOpenAiGetJson_('/organization/costs', key, {
    start_time: startSec,
    end_time: endSec,
    bucket_width: '1d',
    group_by: ['project_id', 'line_item'],
    limit: 31,
  });
  var stats = _aiUsageSummarizeOpenAiCosts_(costs);
  Logger.log(
    'OpenAI costs %s: buckets=%s results=%s',
    dateYmd,
    stats.buckets,
    stats.results
  );
}

/**
 * @param {string} prop
 * @param {string} label
 * @return {string}
 */
function _aiUsageRequireAdminKey_(prop, label) {
  var key = PropertiesService.getScriptProperties().getProperty(prop);
  if (!key) {
    throw new Error(label + ' Admin API key missing: set Script Property ' + prop);
  }
  return key;
}

/**
 * @param {string} path
 * @param {string} adminKey
 * @param {!Object<string, *>} query
 * @return {!Object}
 */
function _aiUsageAnthropicGetJson_(path, adminKey, query) {
  var qs = _aiUsageBuildQuery_(query);
  var url = AI_USAGE_ANTHROPIC_API_BASE_ + path + (qs ? '?' + qs : '');
  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      'x-api-key': adminKey,
      'anthropic-version': AI_USAGE_ANTHROPIC_VERSION_,
    },
    timeout: AI_USAGE_DIAG_HTTP_TIMEOUT_MS_ / 1000,
  });
  return _aiUsageParseJsonResponse_(resp, 'Anthropic ' + path);
}

/**
 * @param {string} path
 * @param {string} adminKey
 * @param {!Object<string, *>} query
 * @return {!Object}
 */
function _aiUsageOpenAiGetJson_(path, adminKey, query) {
  var qs = _aiUsageBuildQuery_(query);
  var url = AI_USAGE_OPENAI_API_BASE_ + path + (qs ? '?' + qs : '');
  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + adminKey,
    },
    timeout: AI_USAGE_DIAG_HTTP_TIMEOUT_MS_ / 1000,
  });
  return _aiUsageParseJsonResponse_(resp, 'OpenAI ' + path);
}

/**
 * @param {!Object} body
 * @return {string}
 */
function _aiUsageBuildQuery_(body) {
  var parts = [];
  Object.keys(body).forEach(function (k) {
    var v = body[k];
    if (v === null || v === undefined || v === '') {
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(function (item) {
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(item)));
      });
      return;
    }
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  });
  return parts.join('&');
}

/**
 * @param {GoogleAppsScript.URL_Fetch.HTTPResponse} resp
 * @param {string} label
 * @return {!Object}
 */
function _aiUsageParseJsonResponse_(resp, label) {
  var code = resp.getResponseCode();
  var text = resp.getContentText() || '';
  if (code < 200 || code >= 300) {
    throw new Error(label + ' HTTP ' + code + ': ' + text.slice(0, 300));
  }
  return JSON.parse(text);
}

/**
 * @param {!Object} payload
 * @return {!{ buckets: number, results: number, withApiKey: number }}
 */
function _aiUsageSummarizeAnthropicMessages_(payload) {
  var buckets = (payload.data && payload.data.length) || 0;
  var results = 0;
  var withApiKey = 0;
  (payload.data || []).forEach(function (bucket) {
    (bucket.results || []).forEach(function (row) {
      results++;
      if (row.api_key_id) {
        withApiKey++;
      }
    });
  });
  return { buckets: buckets, results: results, withApiKey: withApiKey };
}

/**
 * @param {!Object} payload
 * @return {!{ buckets: number, results: number }}
 */
function _aiUsageSummarizeAnthropicCost_(payload) {
  var buckets = (payload.data && payload.data.length) || 0;
  var results = 0;
  (payload.data || []).forEach(function (bucket) {
    results += (bucket.results && bucket.results.length) || 0;
  });
  return { buckets: buckets, results: results };
}

/**
 * @param {!Object} payload
 * @return {!{ rows: number, apiActors: number, subscriptionRows: number }}
 */
function _aiUsageSummarizeAnthropicClaudeCode_(payload) {
  var rows = (payload.data && payload.data.length) || 0;
  var apiActors = 0;
  var subscriptionRows = 0;
  (payload.data || []).forEach(function (row) {
    if (row.customer_type === 'subscription') {
      subscriptionRows++;
    }
    if (row.customer_type === 'api') {
      apiActors++;
    }
  });
  return { rows: rows, apiActors: apiActors, subscriptionRows: subscriptionRows };
}

/**
 * @param {!Object} payload
 * @return {!{ buckets: number, results: number }}
 */
function _aiUsageSummarizeOpenAiCosts_(payload) {
  var buckets = (payload.data && payload.data.length) || 0;
  var results = 0;
  (payload.data || []).forEach(function (bucket) {
    results += (bucket.results && bucket.results.length) || 0;
  });
  return { buckets: buckets, results: results };
}

/**
 * PRD version 2.12.3 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Anthropic Admin API client for AI usage sync (messages, cost_report, claude_code).
 */

/** @const {number} */
var AI_USAGE_ANTHROPIC_PAGE_LIMIT_ = 31;

/**
 * @return {string}
 */
function aiUsageRequireAnthropicKey_() {
  return _aiUsageRequireAdminKey_(AI_USAGE_ANTHROPIC_ADMIN_KEY_PROP_, 'Anthropic');
}

/**
 * @return {!{ id: string, name: string }}
 */
function aiUsageFetchAnthropicOrg_() {
  var key = aiUsageRequireAnthropicKey_();
  var org = _aiUsageAnthropicGetJson_('/v1/organizations/me', key, {});
  return { id: String(org.id || ''), name: String(org.name || '') };
}

/**
 * @return {!Object<string, { name: string, createdByUserId: string|null }>}
 */
function aiUsageFetchAnthropicApiKeyIndex_() {
  var key = aiUsageRequireAnthropicKey_();
  var index = {};
  var page = null;
  var guard = 0;
  do {
    var query = { limit: 100 };
    if (page) {
      query.page = page;
    }
    var payload = _aiUsageAnthropicGetJson_('/v1/organizations/api_keys', key, query);
    (payload.data || []).forEach(function (row) {
      if (!row || !row.id) {
        return;
      }
      index[String(row.id)] = {
        name: String(row.name || row.id),
        createdByUserId: row.created_by && row.created_by.id ? String(row.created_by.id) : null,
      };
    });
    page = payload.has_more ? payload.next_page || null : null;
    guard++;
  } while (page && guard < 50);
  return index;
}

/**
 * @param {string} dateYmd
 * @return {!Array<!Object>}
 */
function aiUsageFetchAnthropicMessagesForDay_(dateYmd) {
  var key = aiUsageRequireAnthropicKey_();
  var startIso = dateYmd + 'T00:00:00Z';
  var endIso = dateYmd + 'T23:59:59Z';
  var rows = [];
  var page = null;
  var guard = 0;
  do {
    var query = {
      starting_at: startIso,
      ending_at: endIso,
      bucket_width: '1d',
      group_by: ['api_key_id', 'model'],
      limit: AI_USAGE_ANTHROPIC_PAGE_LIMIT_,
    };
    if (page) {
      query.page = page;
    }
    var payload = _aiUsageAnthropicGetJson_('/v1/organizations/usage_report/messages', key, query);
    (payload.data || []).forEach(function (bucket) {
      (bucket.results || []).forEach(function (result) {
        rows.push({
          bucket: {
            starting_at: bucket.starting_at,
            ending_at: bucket.ending_at,
          },
          result: result,
        });
      });
    });
    page = payload.has_more ? payload.next_page || null : null;
    guard++;
  } while (page && guard < 50);
  return rows;
}

/**
 * @param {string} dateYmd
 * @return {!Array<!Object>}
 */
function aiUsageFetchAnthropicCostForDay_(dateYmd) {
  var key = aiUsageRequireAnthropicKey_();
  var startIso = dateYmd + 'T00:00:00Z';
  var endIso = dateYmd + 'T23:59:59Z';
  var rows = [];
  var page = null;
  var guard = 0;
  do {
    var query = {
      starting_at: startIso,
      ending_at: endIso,
      group_by: ['workspace_id', 'description'],
      limit: AI_USAGE_ANTHROPIC_PAGE_LIMIT_,
    };
    if (page) {
      query.page = page;
    }
    var payload = _aiUsageAnthropicGetJson_('/v1/organizations/cost_report', key, query);
    (payload.data || []).forEach(function (bucket) {
      (bucket.results || []).forEach(function (result) {
        rows.push({
          bucket: {
            starting_at: bucket.starting_at,
            ending_at: bucket.ending_at,
          },
          result: result,
        });
      });
    });
    page = payload.has_more ? payload.next_page || null : null;
    guard++;
  } while (page && guard < 50);
  return rows;
}

/**
 * @param {string} dateYmd
 * @return {!Array<!Object>}
 */
function aiUsageFetchAnthropicClaudeCodeForDay_(dateYmd) {
  var key = aiUsageRequireAnthropicKey_();
  var rows = [];
  var page = null;
  var guard = 0;
  do {
    var query = {
      starting_at: dateYmd,
      limit: 100,
    };
    if (page) {
      query.page = page;
    }
    var payload = _aiUsageAnthropicGetJson_('/v1/organizations/usage_report/claude_code', key, query);
    (payload.data || []).forEach(function (row) {
      rows.push(row);
    });
    page = payload.has_more ? payload.next_page || null : null;
    guard++;
  } while (page && guard < 50);
  return rows;
}

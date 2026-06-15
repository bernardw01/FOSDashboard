/**
 * PRD version 2.15.6 - sync with docs/FOS-Dashboard-PRD.md
 *
 * AI Usage dashboard (feature 023). Reads Fibery AI Usage Data/Usage with
 * Clockify User join for developer vs product (AI Usage Tracker) classification.
 */

/** @const {number} */
var AI_USAGE_DASHBOARD_CACHE_SCHEMA_VERSION_ = 2;

/** @const {string} */
var AI_USAGE_DASHBOARD_CACHE_TTL_PROP_ = 'AI_USAGE_DASHBOARD_CACHE_TTL_MINUTES';

/** @const {string} */
var AI_USAGE_DASHBOARD_DEFAULT_RANGE_PROP_ = 'AI_USAGE_DASHBOARD_DEFAULT_RANGE_DAYS';

/** @const {string} */
var AI_USAGE_DASHBOARD_TOP_N_PROP_ = 'AI_USAGE_DASHBOARD_TOP_N';

/** @const {string} */
var AI_USAGE_DASHBOARD_MAX_ROWS_PROP_ = 'AI_USAGE_DASHBOARD_MAX_ROWS';

/** @const {number} */
var AI_USAGE_DASHBOARD_DEFAULT_RANGE_DAYS_ = 90;

/** @const {number} */
var AI_USAGE_DASHBOARD_DEFAULT_TTL_MINUTES_ = 10;

/** @const {number} */
var AI_USAGE_DASHBOARD_DEFAULT_TOP_N_ = 20;

/** @const {number} */
var AI_USAGE_DASHBOARD_DEFAULT_MAX_ROWS_ = 5000;

/** @const {number} */
var AI_USAGE_DASHBOARD_QUERY_PAGE_SIZE_ = 500;

/** @const {number} */
var AI_USAGE_DASHBOARD_QUERY_MAX_PAGES_ = 20;

/** @const {string} */
var AI_USAGE_UNMATCHED_LABEL_ = 'Unmatched';

/**
 * @return {number}
 */
function getAiUsageDashboardCacheTtlMinutes() {
  requireAuthForApi_();
  return getAiUsageDashboardProps_().cacheTtlMinutes;
}

/**
 * @param {?string=} rangeStart ISO datetime or YYYY-MM-DD (inclusive).
 * @param {?string=} rangeEnd ISO datetime or YYYY-MM-DD (inclusive end day).
 * @return {!Object}
 */
function getAiUsageDashboardData(rangeStart, rangeEnd) {
  requireAiUsageAccessForApi_();
  try {
    return buildAiUsageDashboardPayload_(rangeStart, rangeEnd);
  } catch (e) {
    var msg = e && e.message ? String(e.message) : 'Could not load AI usage data.';
    if (msg === 'NOT_AUTHORIZED') {
      msg = 'Your session is not authorized. Reload the page.';
    }
    if (msg === 'FORBIDDEN') {
      msg = 'AI Usage is available to the Finance team, Execs, and Admins.';
    }
    try {
      console.warn('getAiUsageDashboardData: ' + msg);
    } catch (_) {
      /* ignore */
    }
    return {
      ok: false,
      message: msg,
      fetchedAt: new Date().toISOString(),
      cacheSchemaVersion: AI_USAGE_DASHBOARD_CACHE_SCHEMA_VERSION_,
    };
  }
}

/**
 * @return {{ email: string, role: string, team: string, fiberyAccess: boolean }}
 * @throws {Error} NOT_AUTHORIZED | FORBIDDEN
 * @private
 */
function requireAiUsageAccessForApi_() {
  var auth = requireAuthForApi_();
  if (!canAccessAiUsageDashboard_(auth)) {
    throw new Error('FORBIDDEN');
  }
  return auth;
}

/**
 * @param {!Object} auth
 * @return {boolean}
 */
function canAccessAiUsageDashboard_(auth) {
  return canAccessExpensesDashboard_(auth);
}

/**
 * @return {!Object}
 * @private
 */
function getAiUsageDashboardProps_() {
  var p = PropertiesService.getScriptProperties();
  function num(key, def, min, max) {
    var raw = (p.getProperty(key) || '').trim();
    if (!raw) return def;
    var n = parseInt(raw, 10);
    if (!isFinite(n)) return def;
    if (min !== undefined && n < min) return min;
    if (max !== undefined && n > max) return max;
    return n;
  }
  return {
    defaultRangeDays: num(
      AI_USAGE_DASHBOARD_DEFAULT_RANGE_PROP_,
      AI_USAGE_DASHBOARD_DEFAULT_RANGE_DAYS_,
      7,
      365
    ),
    cacheTtlMinutes: num(
      AI_USAGE_DASHBOARD_CACHE_TTL_PROP_,
      AI_USAGE_DASHBOARD_DEFAULT_TTL_MINUTES_,
      1,
      1440
    ),
    topN: num(AI_USAGE_DASHBOARD_TOP_N_PROP_, AI_USAGE_DASHBOARD_DEFAULT_TOP_N_, 5, 100),
    maxRows: num(
      AI_USAGE_DASHBOARD_MAX_ROWS_PROP_,
      AI_USAGE_DASHBOARD_DEFAULT_MAX_ROWS_,
      100,
      20000
    ),
  };
}

/**
 * @param {?string=} rangeStart
 * @param {?string=} rangeEnd
 * @return {!Object}
 * @private
 */
function buildAiUsageDashboardPayload_(rangeStart, rangeEnd) {
  var props = getAiUsageDashboardProps_();
  var now = new Date();
  var fetchedAtIso = now.toISOString();
  var range = resolveAiUsageRange_(rangeStart, rangeEnd, now, props.defaultRangeDays);

  var fetched = fetchAllAiUsageRows_(range.startYmd, range.endYmd, props.maxRows);
  if (!fetched.ok) {
    return {
      ok: false,
      source: 'fibery',
      fetchedAt: fetchedAtIso,
      cacheSchemaVersion: AI_USAGE_DASHBOARD_CACHE_SCHEMA_VERSION_,
      ttlMinutes: props.cacheTtlMinutes,
      topN: props.topN,
      range: range,
      rows: [],
      kpis: emptyAiUsageKpis_(),
      filterOptions: { persons: [], roles: [] },
      message: fetched.message || 'Could not load AI usage data from Fibery.',
      warnings: ['Fibery error: ' + (fetched.reason || 'UNKNOWN')],
    };
  }

  var rows = normalizeAiUsageRows_(fetched.rows);
  var filterOptions = buildAiUsageFilterOptions_(rows);
  var aggregates = buildAiUsageAggregates_(rows, props.topN);
  var warnings = [];
  if (fetched.truncated) {
    warnings.push(
      'Result paginator hit the row ceiling (' + props.maxRows + '); ' +
        'narrow the date range to see all rows.'
    );
  }

  var payload = {
    ok: true,
    source: 'fibery',
    fetchedAt: fetchedAtIso,
    cacheSchemaVersion: AI_USAGE_DASHBOARD_CACHE_SCHEMA_VERSION_,
    ttlMinutes: props.cacheTtlMinutes,
    topN: props.topN,
    range: range,
    rows: rows,
    kpis: aggregates.kpis,
    byDeveloper: aggregates.byDeveloper,
    byProduct: aggregates.byProduct,
    byMonth: aggregates.byMonth,
    filterOptions: filterOptions,
  };
  if (warnings.length) {
    payload.warnings = warnings;
    payload.partial = true;
  }
  return payload;
}

/**
 * @param {?string} rangeStart
 * @param {?string} rangeEnd
 * @param {Date} now
 * @param {number} defaultRangeDays
 * @return {!Object}
 * @private
 */
function resolveAiUsageRange_(rangeStart, rangeEnd, now, defaultRangeDays) {
  var defaulted = false;
  var clamped = false;
  var endYmd = aiUsageCoerceYmd_(rangeEnd) || aiUsageYmdFromDate_(now);
  var startYmd = aiUsageCoerceYmd_(rangeStart);
  if (!startYmd) {
    var startDate = new Date(now.getTime() - defaultRangeDays * 86400000);
    startYmd = aiUsageYmdFromDate_(startDate);
    if (!rangeStart && !rangeEnd) {
      defaulted = true;
    }
  }
  if (startYmd > endYmd) {
    var tmp = startYmd;
    startYmd = endYmd;
    endYmd = tmp;
    clamped = true;
  }
  var startMs = aiUsageParseYmd_(startYmd).getTime();
  var endMs = aiUsageParseYmd_(endYmd).getTime();
  var maxMs = 365 * 86400000;
  if (endMs - startMs > maxMs) {
    startYmd = aiUsageYmdFromDate_(new Date(endMs - maxMs));
    clamped = true;
  }
  return {
    startYmd: startYmd,
    endYmd: endYmd,
    start: aiUsageParseYmd_(startYmd).toISOString(),
    end: aiUsageParseYmd_(endYmd).toISOString(),
    defaulted: defaulted,
    clamped: clamped,
  };
}

/**
 * @param {*} raw
 * @return {?string}
 * @private
 */
function aiUsageCoerceYmd_(raw) {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  var s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s;
  }
  try {
    var d = new Date(s);
    if (!isFinite(d.getTime())) {
      return null;
    }
    return aiUsageYmdFromDate_(d);
  } catch (e) {
    return null;
  }
}

/**
 * @param {Date} d
 * @return {string}
 * @private
 */
function aiUsageYmdFromDate_(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * @param {string} ymd
 * @return {Date}
 * @private
 */
function aiUsageParseYmd_(ymd) {
  return new Date(ymd + 'T12:00:00Z');
}

/**
 * @param {string} startYmd
 * @param {string} endYmd
 * @param {number} maxRows
 * @return {!Object}
 * @private
 */
function fetchAllAiUsageRows_(startYmd, endYmd, maxRows) {
  var all = [];
  var truncated = false;
  var usageDateField = aiUsageField_('Usage Date');
  var clockifyUserPath = aiUsageUsageClockifyUserField_();

  for (var page = 0; page < AI_USAGE_DASHBOARD_QUERY_MAX_PAGES_; page++) {
    if (all.length >= maxRows) {
      truncated = true;
      break;
    }
    var limit = Math.min(AI_USAGE_DASHBOARD_QUERY_PAGE_SIZE_, maxRows - all.length);
    var q = {
      query: {
        'q/from': aiUsageUsageDatabase_(),
        'q/select': {
          id: 'fibery/id',
          usageDate: usageDateField,
          costUsd: aiUsageField_('Cost USD'),
          sourcePlatform: [aiUsageField_('Source Platform'), 'enum/name'],
          sourceDataset: [aiUsageField_('Source Dataset'), 'enum/name'],
          customerType: [aiUsageField_('Customer Type'), 'enum/name'],
          model: aiUsageField_('Model'),
          actorEmail: aiUsageField_('Actor Email'),
          actorLabel: aiUsageField_('Actor Label'),
          mappingStatus: [aiUsageField_('Mapping Status'), 'enum/name'],
          allocationCategory: [aiUsageField_('Allocation Category'), 'enum/name'],
          clockifyUserId: [clockifyUserPath, 'fibery/id'],
          clockifyUserName: [clockifyUserPath, 'Agreement Management/Name'],
          aiUsageTracker: [clockifyUserPath, 'Agreement Management/AI Usage Tracker'],
          teamMemberRole: [
            clockifyUserPath,
            'Agreement Management/Team Member Role',
            'Agreement Management/Name',
          ],
          clockifyUserEmailJoin: [
            clockifyUserPath,
            'Agreement Management/Clockify User Email',
          ],
        },
        'q/where': [
          'q/and',
          ['>=', [usageDateField], '$startYmd'],
          ['<=', [usageDateField], '$endYmd'],
        ],
        'q/order-by': [[[usageDateField], 'q/desc']],
        'q/limit': limit,
        'q/offset': all.length,
      },
      params: { $startYmd: startYmd, $endYmd: endYmd },
    };
    var r = fiberyQuery_(q);
    if (!r.ok) {
      return {
        ok: false,
        reason: r.reason || 'QUERY_FAILED',
        message: r.message || 'Fibery query failed',
      };
    }
    var batch = r.rows || [];
    all = all.concat(batch);
    if (batch.length < limit) {
      break;
    }
    if (all.length >= maxRows) {
      truncated = true;
      break;
    }
  }
  if (page >= AI_USAGE_DASHBOARD_QUERY_MAX_PAGES_ - 1) {
    truncated = true;
  }
  return { ok: true, rows: all, truncated: truncated };
}

/**
 * @param {!Array<!Object>} rawRows
 * @return {!Array<!Object>}
 * @private
 */
function normalizeAiUsageRows_(rawRows) {
  var out = [];
  for (var i = 0; i < rawRows.length; i++) {
    var r = rawRows[i] || {};
    var rawCostUsd = numberOrNull_(r.costUsd);
    var sourceDataset = stringOrNull_(r.sourceDataset) || '';
    var customerType = stringOrNull_(r.customerType) || '';
    var costUsd = 0;
    if (rawCostUsd !== null && aiUsageRowIsBillableCost_(sourceDataset, customerType)) {
      costUsd = rawCostUsd;
    }
    var clockifyUserId = stringOrNull_(r.clockifyUserId);
    var personName = AI_USAGE_UNMATCHED_LABEL_;
    var bucket = 'unmatched';
    var isProduct = false;

    if (clockifyUserId) {
      personName =
        stringOrNull_(r.clockifyUserName) ||
        stringOrNull_(r.clockifyUserEmailJoin) ||
        stringOrNull_(r.actorEmail) ||
        stringOrNull_(r.actorLabel) ||
        '(Unknown user)';
      isProduct = r.aiUsageTracker === true;
      bucket = isProduct ? 'product' : 'developer';
    }

    var usageDate = aiUsageCoerceYmd_(r.usageDate) || '';
    var roleName = stringOrNull_(r.teamMemberRole) || '';

    out.push({
      id: stringOrNull_(r.id) || '',
      usageDate: usageDate,
      costUsd: costUsd,
      bucket: bucket,
      personName: personName,
      personKey: personName,
      roleName: roleName || '(No role)',
      clockifyUserId: clockifyUserId || '',
      sourcePlatform: stringOrNull_(r.sourcePlatform) || '',
      sourceDataset: sourceDataset,
      customerType: customerType,
      model: stringOrNull_(r.model) || '',
      actorEmail: stringOrNull_(r.actorEmail) || '',
      mappingStatus: stringOrNull_(r.mappingStatus) || '',
      allocationCategory: stringOrNull_(r.allocationCategory) || '',
    });
  }
  return out;
}

/**
 * @param {!Array<!Object>} rows
 * @return {!Object}
 * @private
 */
function buildAiUsageFilterOptions_(rows) {
  var personSet = {};
  var roleSet = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r.personName) {
      personSet[r.personName] = true;
    }
    if (r.roleName && r.bucket !== 'unmatched') {
      roleSet[r.roleName] = true;
    }
  }
  return {
    persons: Object.keys(personSet).sort(),
    roles: Object.keys(roleSet).sort(),
  };
}

/**
 * @param {!Array<!Object>} rows
 * @param {number} topN
 * @return {!Object}
 * @private
 */
function buildAiUsageAggregates_(rows, topN) {
  var kpis = {
    totalCostUsd: 0,
    developerCostUsd: 0,
    productCostUsd: 0,
    unmatchedCostUsd: 0,
    rowCount: rows.length,
    latestUsageDate: null,
  };
  var devMap = {};
  var prodMap = {};
  var monthMap = {};

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var cost = Number(r.costUsd) || 0;
    kpis.totalCostUsd += cost;
    if (r.bucket === 'developer') {
      kpis.developerCostUsd += cost;
      devMap[r.personName] = (devMap[r.personName] || 0) + cost;
    } else if (r.bucket === 'product') {
      kpis.productCostUsd += cost;
      prodMap[r.personName] = (prodMap[r.personName] || 0) + cost;
    } else {
      kpis.unmatchedCostUsd += cost;
    }
    if (r.usageDate && (!kpis.latestUsageDate || r.usageDate > kpis.latestUsageDate)) {
      kpis.latestUsageDate = r.usageDate;
    }
    var month = r.usageDate ? r.usageDate.slice(0, 7) : '';
    if (month) {
      if (!monthMap[month]) {
        monthMap[month] = {
          month: month,
          costUsd: 0,
          developerUsd: 0,
          productUsd: 0,
          unmatchedUsd: 0,
        };
      }
      monthMap[month].costUsd += cost;
      if (r.bucket === 'developer') {
        monthMap[month].developerUsd += cost;
      } else if (r.bucket === 'product') {
        monthMap[month].productUsd += cost;
      } else {
        monthMap[month].unmatchedUsd += cost;
      }
    }
  }

  return {
    kpis: kpis,
    byDeveloper: aiUsageTopBarSeries_(devMap, topN),
    byProduct: aiUsageTopBarSeries_(prodMap, topN),
    byMonth: aiUsageSortByMonth_(monthMap),
  };
}

/**
 * @param {!Object<string, number>} map
 * @param {number} topN
 * @return {!Array<!Object>}
 * @private
 */
function aiUsageTopBarSeries_(map, topN) {
  var arr = [];
  Object.keys(map).forEach(function (name) {
    arr.push({ name: name, costUsd: map[name] });
  });
  arr.sort(function (a, b) {
    return b.costUsd - a.costUsd;
  });
  if (arr.length <= topN) {
    return arr;
  }
  var head = arr.slice(0, topN);
  var other = 0;
  for (var i = topN; i < arr.length; i++) {
    other += arr[i].costUsd;
  }
  if (other > 0) {
    head.push({ name: 'Other', costUsd: other });
  }
  return head;
}

/**
 * @param {!Object} monthMap
 * @return {!Array<!Object>}
 * @private
 */
function aiUsageSortByMonth_(monthMap) {
  var arr = [];
  Object.keys(monthMap).forEach(function (k) {
    arr.push(monthMap[k]);
  });
  arr.sort(function (a, b) {
    return a.month < b.month ? -1 : a.month > b.month ? 1 : 0;
  });
  return arr;
}

/**
 * @return {!Object}
 * @private
 */
function emptyAiUsageKpis_() {
  return {
    totalCostUsd: 0,
    developerCostUsd: 0,
    productCostUsd: 0,
    unmatchedCostUsd: 0,
    rowCount: 0,
    latestUsageDate: null,
  };
}

/**
 * @return {!Object}
 */
function _diag_sampleAiUsageDashboardPayload() {
  var now = new Date();
  var endYmd = aiUsageYmdFromDate_(now);
  var start = new Date(now.getTime() - 30 * 86400000);
  var payload = buildAiUsageDashboardPayload_(aiUsageYmdFromDate_(start), endYmd);
  console.log(
    '_diag_sampleAiUsageDashboardPayload -> ',
    JSON.stringify({
      ok: payload.ok,
      rowCount: payload.rows ? payload.rows.length : 0,
      kpis: payload.kpis,
      byDeveloper: (payload.byDeveloper || []).slice(0, 5),
      byProduct: (payload.byProduct || []).slice(0, 5),
      byMonth: payload.byMonth,
    }).slice(0, 4000)
  );
  return payload;
}

/**
 * PRD version 2.26.1 - sync with docs/FOS-Dashboard-PRD.md
 *
 * AI Usage dashboard (feature 023). Reads Fibery Claude API Costs via daily Drive
 * cache (`aiUsageDashboardCache.js`) with Clockify User join for classification.
 */

/** @const {number} */
var AI_USAGE_DASHBOARD_CACHE_SCHEMA_VERSION_ = 4;

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
var AI_USAGE_DASHBOARD_DEFAULT_MAX_ROWS_ = 75000;

/** @const {number} */
var AI_USAGE_DASHBOARD_QUERY_PAGE_SIZE_ = 1000;

/** @const {number} */
var AI_USAGE_DASHBOARD_QUERY_MAX_PAGES_ = 160;

/** @const {string} */
var AI_USAGE_UNMATCHED_LABEL_ = 'Unmatched';

/** @const {string} */
var AI_USAGE_DASHBOARD_SOURCE_PLATFORM_LABEL_ = 'Anthropic';

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
 * @param {boolean=} forceRefresh When true, rebuild today's Drive cache from Fibery.
 * @return {!Object}
 */
function getAiUsageDashboardData(rangeStart, rangeEnd, forceRefresh) {
  requireAiUsageAccessForApi_();
  var refresh = forceRefresh === true;
  try {
    return buildAiUsageDashboardPayload_(rangeStart, rangeEnd, refresh);
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
      150000
    ),
  };
}

/**
 * @param {?string=} rangeStart
 * @param {?string=} rangeEnd
 * @param {boolean=} forceRefresh
 * @return {!Object}
 * @private
 */
function buildAiUsageDashboardPayload_(rangeStart, rangeEnd, forceRefresh) {
  var props = getAiUsageDashboardProps_();
  var now = new Date();
  var fetchedAtIso = now.toISOString();
  var range = resolveAiUsageRange_(rangeStart, rangeEnd, now, props.defaultRangeDays);
  var cacheDateKey = resolveSnapshotDateKey_(now);
  var warnings = [];

  if (isAiUsageDriveCacheEnabled_()) {
    var cacheResult = loadOrBuildAiUsageDriveCache_(cacheDateKey, forceRefresh === true, props);
    if (cacheResult.ok && cacheResult.bundle) {
      return buildAiUsagePayloadFromDriveBundle_(
        cacheResult.bundle,
        range,
        props,
        !!cacheResult.fromDrive,
        fetchedAtIso,
        cacheResult.manifest
      );
    }
    if (!cacheResult.ok) {
      warnings.push(
        'Drive cache unavailable (' + (cacheResult.reason || 'CACHE_MISS') + '); loading from Fibery.'
      );
    }
  } else if (!isAiUsageDriveCacheConfigured_()) {
    warnings.push('Drive cache not configured (set FOS_SNAPSHOT_DRIVE_FOLDER_ID); loading from Fibery.');
  }

  var fiberyPayload = buildAiUsagePayloadFromFibery_(range, props, fetchedAtIso);
  if (warnings.length) {
    fiberyPayload.warnings = (fiberyPayload.warnings || []).concat(warnings);
    fiberyPayload.partial = true;
  }
  return fiberyPayload;
}

/**
 * @param {!Object} range
 * @param {!Object} props
 * @param {string} fetchedAtIso
 * @return {!Object}
 * @private
 */
function buildAiUsagePayloadFromFibery_(range, props, fetchedAtIso) {
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
    dataSource: 'claude-api-costs',
    cacheLayer: 'none',
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
    rollups: {
      window: buildAiUsageRollups_(rows, props.topN),
      sliceRowCount: rows.length,
      cacheRowCount: rows.length,
    },
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
  var usageDateField = aiUsageField_('usagedateutc');
  var clockifyUserPath = aiUsageUsageClockifyUserField_();
  var maxPages = Math.min(
    AI_USAGE_DASHBOARD_QUERY_MAX_PAGES_,
    Math.max(1, Math.ceil(maxRows / AI_USAGE_DASHBOARD_QUERY_PAGE_SIZE_))
  );

  var lastBatchLen = 0;
  for (var page = 0; page < maxPages; page++) {
    if (all.length >= maxRows) {
      truncated = true;
      break;
    }
    var limit = Math.min(AI_USAGE_DASHBOARD_QUERY_PAGE_SIZE_, maxRows - all.length);
    var q = {
      query: {
        'q/from': aiUsageClaudeApiCostsDatabase_(),
        'q/select': {
          id: 'fibery/id',
          usageDate: usageDateField,
          costUsd: aiUsageField_('costusd'),
          model: [aiUsageField_('model'), 'enum/name'],
          apiKey: [aiUsageField_('apikey'), 'enum/name'],
          workspace: [aiUsageField_('workspace'), 'enum/name'],
          tokenType: [aiUsageField_('tokentype'), 'enum/name'],
          costType: [aiUsageField_('costtype'), 'enum/name'],
          usageType: [aiUsageField_('usagetype'), 'enum/name'],
          userCompany: [aiUsageField_('User Company'), 'enum/name'],
          userDepartment: [aiUsageField_('User Department'), 'enum/name'],
          userRole: [aiUsageField_('User Role'), 'Agreement Management/Name'],
          clockifyUserId: [clockifyUserPath, 'fibery/id'],
          clockifyUserName: [clockifyUserPath, 'Agreement Management/Name'],
          aiUsageTracker: [clockifyUserPath, 'Agreement Management/AI Usage Tracker'],
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
    lastBatchLen = batch.length;
    all = all.concat(batch);
    if (batch.length < limit) {
      break;
    }
    if (all.length >= maxRows) {
      truncated = true;
      break;
    }
  }
  if (!truncated && lastBatchLen >= AI_USAGE_DASHBOARD_QUERY_PAGE_SIZE_ && all.length >= maxRows) {
    truncated = true;
  }
  return { ok: true, rows: all, truncated: truncated };
}

/**
 * @param {number} y
 * @param {number} m 1-12
 * @param {number} d
 * @return {string}
 * @private
 */
function aiUsageFormatYmdParts_(y, m, d) {
  var ms = m < 10 ? '0' + m : String(m);
  var ds = d < 10 ? '0' + d : String(d);
  return y + '-' + ms + '-' + ds;
}

/**
 * Calendar month slices intersecting [startYmd, endYmd], ascending.
 *
 * @param {string} startYmd
 * @param {string} endYmd
 * @return {!Array<!{ startYmd: string, endYmd: string }>}
 * @private
 */
function enumerateAiUsageMonthRanges_(startYmd, endYmd) {
  var out = [];
  var sp = parseSnapshotDateParts_(startYmd);
  var ep = parseSnapshotDateParts_(endYmd);
  if (!sp || !ep) {
    return out;
  }
  var y = sp.y;
  var m = sp.m;
  while (true) {
    var monthStart = aiUsageFormatYmdParts_(y, m, 1);
    var lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    var monthEnd = aiUsageFormatYmdParts_(y, m, lastDay);
    var chunkStart = monthStart < startYmd ? startYmd : monthStart;
    var chunkEnd = monthEnd > endYmd ? endYmd : monthEnd;
    if (chunkStart <= chunkEnd) {
      out.push({ startYmd: chunkStart, endYmd: chunkEnd });
    }
    if (y === ep.y && m === ep.m) {
      break;
    }
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/**
 * Fetches Claude API Costs month-by-month (smaller Fibery offsets) for Drive cache.
 *
 * @param {string} startYmd
 * @param {string} endYmd
 * @param {number} maxRows
 * @return {!Object}
 * @private
 */
function fetchAllAiUsageRowsChunked_(startYmd, endYmd, maxRows) {
  var months = enumerateAiUsageMonthRanges_(startYmd, endYmd);
  if (!months.length) {
    return fetchAllAiUsageRows_(startYmd, endYmd, maxRows);
  }
  var all = [];
  var truncated = false;
  for (var i = months.length - 1; i >= 0; i--) {
    if (all.length >= maxRows) {
      truncated = true;
      break;
    }
    var mr = months[i];
    var remaining = maxRows - all.length;
    var part = fetchAllAiUsageRows_(mr.startYmd, mr.endYmd, remaining);
    if (!part.ok) {
      return part;
    }
    all = all.concat(part.rows);
    if (part.truncated) {
      truncated = true;
      break;
    }
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
    var costUsd = rawCostUsd === null ? 0 : rawCostUsd;
    var clockifyUserId = stringOrNull_(r.clockifyUserId);
    var personName = AI_USAGE_UNMATCHED_LABEL_;
    var bucket = 'unmatched';
    var isProduct = false;

    if (clockifyUserId) {
      personName =
        stringOrNull_(r.clockifyUserName) ||
        stringOrNull_(r.clockifyUserEmailJoin) ||
        stringOrNull_(r.apiKey) ||
        '(Unknown user)';
      isProduct = r.aiUsageTracker === true;
      bucket = isProduct ? 'product' : 'developer';
    }

    var usageDate = aiUsageCoerceYmd_(r.usageDate) || '';
    var roleName = stringOrNull_(r.userRole) || '';

    out.push({
      id: stringOrNull_(r.id) || '',
      usageDate: usageDate,
      costUsd: costUsd,
      bucket: bucket,
      personName: personName,
      personKey: personName,
      roleName: roleName || '(No role)',
      clockifyUserId: clockifyUserId || '',
      sourcePlatform: AI_USAGE_DASHBOARD_SOURCE_PLATFORM_LABEL_,
      sourceDataset: 'Claude API Costs',
      model: stringOrNull_(r.model) || '',
      apiKey: stringOrNull_(r.apiKey) || '',
      workspace: stringOrNull_(r.workspace) || '',
      tokenType: stringOrNull_(r.tokenType) || '',
      costType: stringOrNull_(r.costType) || '',
      usageType: stringOrNull_(r.usageType) || '',
      userCompany: stringOrNull_(r.userCompany) || '',
      userDepartment: stringOrNull_(r.userDepartment) || '',
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
  var payload = buildAiUsageDashboardPayload_(aiUsageYmdFromDate_(start), endYmd, false);
  console.log(
    '_diag_sampleAiUsageDashboardPayload -> ',
    JSON.stringify({
      ok: payload.ok,
      dataSource: payload.dataSource,
      rowCount: payload.rows ? payload.rows.length : 0,
      kpis: payload.kpis,
      byDeveloper: (payload.byDeveloper || []).slice(0, 5),
      byProduct: (payload.byProduct || []).slice(0, 5),
      byMonth: payload.byMonth,
    }).slice(0, 4000)
  );
  return payload;
}

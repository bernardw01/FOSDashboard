/**
 * PRD version 2.7.0 â€” sync with docs/FOS-Dashboard-PRD.md
 *
 * Admin usage analytics (feature 012).
 *
 * Aggregates the User Activity tab for the Settings panel usage section.
 * ADMIN-only via getAdminUsageStats().
 */

/** @const {number} */
var USAGE_STATS_WINDOW_DAYS_ = 30;

/** @const {number} */
var USAGE_STATS_MAX_ROWS_ = 25000;

/** @const {number} */
var USAGE_STATS_TOP_ROUTES_ = 8;

/** @const {Object<string, boolean>} */
var USAGE_STATS_EVENT_TYPES_ = {
  page_load: true,
  nav_view: true,
  refresh: true,
};

/** @const {Object<string, string>} */
var USAGE_STATS_ROUTE_LABELS_ = {
  doget: 'App load',
  home: 'Home',
  'agreement-dashboard': 'Agreement Dashboard',
  operations: 'Utilization',
  'labor-hours': 'Labor hours',
  delivery: 'Delivery â€” Projects & P&L',
  'revenue-review': 'Revenue review',
  settings: 'Settings',
  shell: 'Shell / data source',
  unknown: 'Unknown',
};

/**
 * @return {!Object}
 */
function getAdminUsageStats() {
  var auth = requireAuthForApi_();
  requireAdminRole_(auth);
  return buildAdminUsageStatsPayload_();
}

/**
 * @return {!Object}
 * @private
 */
function buildAdminUsageStatsPayload_() {
  var tz = Session.getScriptTimeZone() || 'UTC';
  var range = getUsageStatsDateRange_(USAGE_STATS_WINDOW_DAYS_, tz);
  var sheet = getUserActivitySheetOrNull_();
  if (!sheet) {
    return {
      ok: false,
      reason: 'SHEET_MISSING',
      message: 'User Activity tab is missing or AUTH_SPREADSHEET_ID is not set.',
    };
  }

  var readResult = readUsageActivityRows_(sheet, USAGE_STATS_MAX_ROWS_);
  if (!readResult.ok) {
    return {
      ok: false,
      reason: readResult.reason,
      message: readResult.message,
    };
  }

  var agg = aggregateUsageStats_(
    readResult.rows,
    readResult.colIndex,
    range.startDateStr,
    range.endDateStr,
    tz,
    USAGE_STATS_WINDOW_DAYS_
  );

  if (!agg.warnings) {
    agg.warnings = [];
  }
  if (readResult.truncated) {
    agg.warnings.push('TRUNCATED_ROWS');
  }

  agg.ok = true;
  agg.windowDays = USAGE_STATS_WINDOW_DAYS_;
  agg.timezone = tz;
  agg.rangeStart = range.startDateStr;
  agg.rangeEnd = range.endDateStr;
  agg.sheetName = readResult.sheetName;

  return agg;
}

/**
 * @param {number} windowDays
 * @param {string} tz
 * @return {{ startDateStr: string, endDateStr: string }}
 * @private
 */
function getUsageStatsDateRange_(windowDays, tz) {
  var now = new Date();
  var endDateStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var startMs = now.getTime() - (windowDays - 1) * 86400000;
  var startDateStr = Utilities.formatDate(new Date(startMs), tz, 'yyyy-MM-dd');
  return { startDateStr: startDateStr, endDateStr: endDateStr };
}

/**
 * @param {string} route
 * @return {string}
 * @private
 */
function usageStatsRouteLabel_(route) {
  var key = String(route || '').trim().toLowerCase();
  if (!key) {
    key = 'unknown';
  }
  if (USAGE_STATS_ROUTE_LABELS_[key]) {
    return USAGE_STATS_ROUTE_LABELS_[key];
  }
  return key
    .split(/[-_]+/)
    .map(function (part) {
      if (!part) return '';
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

/**
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} maxRows
 * @return {!Object}
 * @private
 */
function readUsageActivityRows_(sheet, maxRows) {
  var props = PropertiesService.getScriptProperties();
  var sheetName =
    (props.getProperty('AUTH_USER_ACTIVITY_SHEET_NAME') || '').trim() || 'User Activity';

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) {
    return {
      ok: true,
      rows: [],
      colIndex: {},
      truncated: false,
      skippedBadTimestamp: 0,
      sheetName: sheetName,
    };
  }

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var colIndex = {
    timestamp: findHeaderIndex_(headers, 'Timestamp'),
    email: findHeaderIndex_(headers, 'Email'),
    role: findHeaderIndex_(headers, 'Role'),
    team: findHeaderIndex_(headers, 'Team'),
    eventType: findHeaderIndex_(headers, 'Event Type'),
    route: findHeaderIndex_(headers, 'Route'),
  };

  if (
    colIndex.timestamp < 0 ||
    colIndex.email < 0 ||
    colIndex.eventType < 0 ||
    colIndex.route < 0
  ) {
    return {
      ok: false,
      reason: 'HEADERS',
      message: 'User Activity tab is missing required columns (Timestamp, Email, Event Type, Route).',
    };
  }

  var dataRowCount = lastRow - 1;
  var truncated = dataRowCount > maxRows;
  var startRow = truncated ? lastRow - maxRows + 1 : 2;
  var numRows = lastRow - startRow + 1;
  var values = sheet.getRange(startRow, 1, numRows, lastCol).getValues();

  var rows = [];
  for (var r = 0; r < values.length; r++) {
    rows.push({
      timestamp: values[r][colIndex.timestamp],
      email: values[r][colIndex.email],
      role: colIndex.role >= 0 ? values[r][colIndex.role] : '',
      team: colIndex.team >= 0 ? values[r][colIndex.team] : '',
      eventType: values[r][colIndex.eventType],
      route: values[r][colIndex.route],
    });
  }

  return {
    ok: true,
    rows: rows,
    colIndex: colIndex,
    truncated: truncated,
    skippedBadTimestamp: 0,
    sheetName: sheetName,
  };
}

/**
 * @param {!Array<!Object>} rows
 * @param {!Object} colIndex
 * @param {string} startDateStr
 * @param {string} endDateStr
 * @param {string} tz
 * @param {number} windowDays
 * @return {!Object}
 * @private
 */
function aggregateUsageStats_(rows, colIndex, startDateStr, endDateStr, tz, windowDays) {
  var byRouteMap = {};
  var byUserMap = {};
  var byDayMap = {};
  var totalEvents = 0;
  var globalUsers = {};
  var skippedBadTimestamp = 0;

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var eventType = String(row.eventType || '')
      .trim()
      .toLowerCase();
    if (!USAGE_STATS_EVENT_TYPES_[eventType]) {
      continue;
    }

    var ts = parseUsageTimestamp_(row.timestamp);
    if (!ts) {
      skippedBadTimestamp++;
      continue;
    }

    var dayStr = Utilities.formatDate(ts, tz, 'yyyy-MM-dd');
    if (dayStr < startDateStr || dayStr > endDateStr) {
      continue;
    }

    var route = normalizeRoute_(row.route);
    if (!route) {
      route = 'unknown';
    }

    var email = String(row.email || '').trim();
    if (email) {
      globalUsers[email] = true;
    }

    totalEvents++;

    if (!byRouteMap[route]) {
      byRouteMap[route] = { route: route, events: 0, users: {} };
    }
    byRouteMap[route].events++;
    if (email) {
      byRouteMap[route].users[email] = true;
    }

    if (email) {
      if (!byUserMap[email]) {
        byUserMap[email] = {
          email: email,
          role: String(row.role || '').trim(),
          team: String(row.team || '').trim(),
          events: 0,
        };
      }
      byUserMap[email].events++;
      if (row.role) {
        byUserMap[email].role = String(row.role).trim();
      }
      if (row.team) {
        byUserMap[email].team = String(row.team).trim();
      }
    }

    if (!byDayMap[dayStr]) {
      byDayMap[dayStr] = { date: dayStr, total: 0, byRoute: {} };
    }
    byDayMap[dayStr].total++;
    byDayMap[dayStr].byRoute[route] = (byDayMap[dayStr].byRoute[route] || 0) + 1;
  }

  var routeKeys = Object.keys(byRouteMap);
  routeKeys.sort(function (a, b) {
    return byRouteMap[b].events - byRouteMap[a].events;
  });

  var topRoutes = routeKeys.slice(0, USAGE_STATS_TOP_ROUTES_);
  var topRouteSet = {};
  for (var tr = 0; tr < topRoutes.length; tr++) {
    topRouteSet[topRoutes[tr]] = true;
  }

  var byRoute = [];
  for (var ri = 0; ri < routeKeys.length; ri++) {
    var rk = routeKeys[ri];
    var rec = byRouteMap[rk];
    byRoute.push({
      route: rk,
      label: usageStatsRouteLabel_(rk),
      events: rec.events,
      uniqueUsers: Object.keys(rec.users).length,
    });
  }

  var userKeys = Object.keys(byUserMap);
  userKeys.sort(function (a, b) {
    return byUserMap[b].events - byUserMap[a].events;
  });
  var byUser = [];
  for (var ui = 0; ui < userKeys.length; ui++) {
    var uk = userKeys[ui];
    byUser.push(byUserMap[uk]);
  }

  var byDay = buildUsageDaySeries_(startDateStr, endDateStr, tz, windowDays, byDayMap, topRouteSet);

  return {
    totalEvents: totalEvents,
    uniqueUsers: Object.keys(globalUsers).length,
    byRoute: byRoute,
    byUser: byUser,
    byDay: byDay,
    topRoutes: topRoutes,
    warnings: skippedBadTimestamp > 0 ? ['SKIPPED_BAD_TIMESTAMP'] : [],
  };
}

/**
 * @param {*} raw
 * @return {Date|null}
 * @private
 */
function parseUsageTimestamp_(raw) {
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return raw;
  }
  var s = String(raw == null ? '' : raw).trim();
  if (!s) {
    return null;
  }
  var d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d;
  }
  return null;
}

/**
 * @param {string} startDateStr
 * @param {string} endDateStr
 * @param {string} tz
 * @param {number} windowDays
 * @param {!Object} byDayMap
 * @param {!Object} topRouteSet
 * @return {!Array<!Object>}
 * @private
 */
function buildUsageDaySeries_(startDateStr, endDateStr, tz, windowDays, byDayMap, topRouteSet) {
  var out = [];
  var cursor = parseUsageDateStr_(startDateStr, tz);
  var end = parseUsageDateStr_(endDateStr, tz);
  if (!cursor || !end) {
    return out;
  }

  while (cursor.getTime() <= end.getTime() && out.length < windowDays + 5) {
    var dayStr = Utilities.formatDate(cursor, tz, 'yyyy-MM-dd');
    var src = byDayMap[dayStr];
    var byRoute = {};
    var other = 0;
    if (src && src.byRoute) {
      var keys = Object.keys(src.byRoute);
      for (var k = 0; k < keys.length; k++) {
        var routeKey = keys[k];
        var count = src.byRoute[routeKey];
        if (topRouteSet[routeKey]) {
          byRoute[routeKey] = count;
        } else {
          other += count;
        }
      }
    }
    if (other > 0) {
      byRoute.Other = other;
    }
    out.push({
      date: dayStr,
      total: src ? src.total : 0,
      byRoute: byRoute,
    });
    cursor = new Date(cursor.getTime() + 86400000);
    if (dayStr === endDateStr) {
      break;
    }
  }
  return out;
}

/**
 * @param {string} dateStr yyyy-MM-dd
 * @param {string} tz
 * @return {Date|null}
 * @private
 */
function parseUsageDateStr_(dateStr, tz) {
  try {
    var parts = dateStr.split('-');
    if (parts.length !== 3) {
      return null;
    }
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10) - 1;
    var d = parseInt(parts[2], 10);
    return new Date(y, m, d);
  } catch (e) {
    return null;
  }
}

/**
 * Editor diagnostic.
 * @return {!Object}
 */
function _diag_sampleUsageStats() {
  var r = buildAdminUsageStatsPayload_();
  console.log('usage stats â†’', JSON.stringify(r).slice(0, 4000));
  return r;
}

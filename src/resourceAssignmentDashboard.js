/**
 * PRD version 2.26.1 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Resource assignment dashboard (feature 027): portfolio-wide Fibery
 * Resource Allocations by ISO week with alerts.
 */

/** @const {number} */
var RESOURCE_ASSIGNMENTS_CACHE_SCHEMA_VERSION_ = 2;

/** @const {number} */
var RESOURCE_ASSIGNMENTS_QUERY_PAGE_LIMIT_ = 500;

/** @const {number} */
var RESOURCE_ASSIGNMENTS_QUERY_MAX_PAGES_ = 20;

/** @const {number} Default lookback days from today. */
var RESOURCE_ASSIGNMENTS_DEFAULT_LOOKBACK_DAYS_ = 30;

/** @const {number} Default lookahead days from today. */
var RESOURCE_ASSIGNMENTS_DEFAULT_LOOKAHEAD_DAYS_ = 90;

/** @const {number} Max ISO weeks in one view. */
var RESOURCE_ASSIGNMENTS_MAX_WEEKS_ = 52;

/** @const {number} Max over-allocation alerts emitted. */
var RESOURCE_ASSIGNMENTS_MAX_OVER_ALERTS_ = 50;

/** @const {number} Ending-soon horizon (calendar days). */
var RESOURCE_ASSIGNMENTS_ENDING_SOON_DAYS_ = 30;

/**
 * Resource assignments (Operations nav) - visible when ANY is true:
 * team = CLIENT-ENGAGEMENT, role = EXEC, or role = ADMIN.
 * @param {{ email?: string, role?: string, team?: string }} auth
 * @return {boolean}
 */
function canAccessResourceAssignmentsDashboard_(auth) {
  if (!auth || !auth.email) {
    return false;
  }
  var role = String(auth.role || '').trim().toUpperCase();
  if (role === 'ADMIN' || role === 'EXEC') {
    return true;
  }
  return String(auth.team || '').trim().toUpperCase() === 'CLIENT-ENGAGEMENT';
}

/**
 * @return {{ email: string, role: string, team: string, fiberyAccess: boolean }}
 * @throws {Error} NOT_AUTHORIZED | FORBIDDEN
 */
function requireResourceAssignmentsAccessForApi_() {
  var auth = requireAuthForApi_();
  if (!canAccessResourceAssignmentsDashboard_(auth)) {
    throw new Error('FORBIDDEN');
  }
  return auth;
}

/**
 * @return {!Object}
 */
function getResourceAssignmentDashboardData(rangeStart, rangeEnd) {
  try {
    requireResourceAssignmentsAccessForApi_();
  } catch (e) {
    var gateMsg = e && e.message ? String(e.message) : 'FORBIDDEN';
    if (gateMsg === 'NOT_AUTHORIZED') {
      gateMsg = 'Your session is not authorized. Reload the page.';
    }
    if (gateMsg === 'FORBIDDEN') {
      gateMsg =
        'Resource assignments are available to the Client Engagement team, Execs, and Admins.';
    }
    return {
      ok: false,
      message: gateMsg,
      cacheSchemaVersion: RESOURCE_ASSIGNMENTS_CACHE_SCHEMA_VERSION_,
    };
  }
  try {
    return buildResourceAssignmentDashboardPayload_(rangeStart, rangeEnd);
  } catch (e) {
    var msg = e && e.message ? String(e.message) : 'Could not load resource assignments.';
    if (msg === 'NOT_AUTHORIZED') {
      msg = 'Your session is not authorized. Reload the page.';
    }
    try {
      console.warn('getResourceAssignmentDashboardData: ' + msg);
    } catch (_) {
      /* ignore */
    }
    return {
      ok: false,
      message: msg,
      fetchedAt: new Date().toISOString(),
      cacheSchemaVersion: RESOURCE_ASSIGNMENTS_CACHE_SCHEMA_VERSION_,
    };
  }
}

/**
 * Shared builder for live API and snapshot job (no auth gate).
 *
 * @param {?string} rangeStartYmd
 * @param {?string} rangeEndYmd
 * @return {!Object}
 */
function buildResourceAssignmentDashboardPayload_(rangeStartYmd, rangeEndYmd) {
  var fetchedAt = new Date().toISOString();
  var warnings = [];
  var range = resolveResourceAssignmentRangeYmd_(rangeStartYmd, rangeEndYmd, warnings);
  var weeks = buildResourceAssignmentWeeks_(range.startYmd, range.endYmd, warnings);
  var weeklyCapacity = resolveResourceAssignmentWeeklyCapacity_();
  var fetched = fetchAllResourceAllocationsPortfolio_(resolveResourceAssignmentMaxRows_());
  if (!fetched.ok) {
    return {
      ok: false,
      message: fetched.message || 'Fibery resource allocation fetch failed.',
      fetchedAt: fetchedAt,
      cacheSchemaVersion: RESOURCE_ASSIGNMENTS_CACHE_SCHEMA_VERSION_,
    };
  }
  if (fetched.truncated) {
    warnings.push('Resource allocation fetch truncated at row cap.');
  }

  var rawRows = [];
  for (var i = 0; i < fetched.rows.length; i++) {
    var norm = normalizeResourceAllocationRow_(fetched.rows[i]);
    if (!norm) continue;
    if (!allocationOverlapsRangeYmd_(norm, range.startYmd, range.endYmd)) continue;
    rawRows.push(norm);
  }

  var built = buildResourceAssignmentPersons_(
    rawRows,
    weeks,
    weeklyCapacity,
    range.startYmd,
    range.endYmd,
    warnings
  );
  var laborAgg = aggregateResourceAssignmentLaborByProject_(
    range.startYmd,
    range.endYmd,
    weeks,
    warnings
  );
  var projects = buildResourceAssignmentProjects_(
    built.persons,
    laborAgg.byProject,
    laborAgg.personMeta,
    laborAgg.projectMeta,
    weeks
  );
  var dimensions = buildResourceAssignmentDimensions_(built.persons, projects);
  var alerts = buildResourceAssignmentAlerts_(built.persons, rawRows, weeks, warnings);
  var kpis = {
    personCount: built.persons.length,
    projectCount: dimensions.projects.length,
    assignmentCount: rawRows.length,
    overAllocatedWeeks: built.overAllocatedWeekCount,
    endingSoonCount: alerts.endingSoonCount,
  };

  return {
    ok: true,
    source: 'fibery',
    fetchedAt: fetchedAt,
    cacheSchemaVersion: RESOURCE_ASSIGNMENTS_CACHE_SCHEMA_VERSION_,
    rangeStart: range.startYmd,
    rangeEnd: range.endYmd,
    weeklyCapacityHours: weeklyCapacity,
    weeks: weeks,
    persons: built.persons,
    projects: projects,
    dimensions: dimensions,
    kpis: kpis,
    alerts: alerts.items,
    warnings: warnings,
    partial: !!fetched.truncated || !!laborAgg.truncated,
    laborMeta: {
      rowCount: laborAgg.rowCount,
      truncated: !!laborAgg.truncated,
      ok: laborAgg.ok !== false,
    },
  };
}

/**
 * @param {?string} rangeStartYmd
 * @param {?string} rangeEndYmd
 * @param {!Array<string>} warningsOut
 * @return {!{ startYmd: string, endYmd: string }}
 * @private
 */
function resolveResourceAssignmentRangeYmd_(rangeStartYmd, rangeEndYmd, warningsOut) {
  var tz = resolveSnapshotTimezone_();
  var todayYmd = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var startYmd = resourceAssignmentYmdOnly_(rangeStartYmd);
  var endYmd = resourceAssignmentYmdOnly_(rangeEndYmd);
  if (!startYmd) {
    startYmd = resourceAssignmentAddDaysYmd_(todayYmd, -RESOURCE_ASSIGNMENTS_DEFAULT_LOOKBACK_DAYS_, tz);
  }
  if (!endYmd) {
    endYmd = resourceAssignmentAddDaysYmd_(todayYmd, RESOURCE_ASSIGNMENTS_DEFAULT_LOOKAHEAD_DAYS_, tz);
  }
  if (startYmd > endYmd) {
    var swap = startYmd;
    startYmd = endYmd;
    endYmd = swap;
    warningsOut.push('Date range was reversed (start after end).');
  }
  return { startYmd: startYmd, endYmd: endYmd };
}

/**
 * @param {string} ymd
 * @param {number} deltaDays
 * @param {string} tz
 * @return {string}
 * @private
 */
function resourceAssignmentAddDaysYmd_(ymd, deltaDays, tz) {
  var d = parseIsoDateOnlyUtc_(ymd);
  if (!d) {
    return ymd;
  }
  var shifted = new Date(d.getTime() + deltaDays * 86400000);
  return Utilities.formatDate(shifted, tz, 'yyyy-MM-dd');
}

/**
 * @param {?string} iso
 * @return {string}
 * @private
 */
function resourceAssignmentYmdOnly_(iso) {
  if (!iso) return '';
  var s = String(iso).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

/**
 * @return {number}
 * @private
 */
function resolveResourceAssignmentWeeklyCapacity_() {
  var thresholds = getUtilizationThresholds_();
  return thresholds && thresholds.weeklyCapacityHours
    ? thresholds.weeklyCapacityHours
    : 40;
}

/**
 * @return {number}
 * @private
 */
function resolveResourceAssignmentMaxRows_() {
  var raw = (
    PropertiesService.getScriptProperties().getProperty('RESOURCE_ASSIGNMENTS_MAX_ROWS') || ''
  ).trim();
  var n = parseInt(raw, 10);
  if (isFinite(n) && n > 0) {
    return Math.min(n, 20000);
  }
  return 5000;
}

/**
 * @param {string} startYmd
 * @param {string} endYmd
 * @param {!Array<string>} warningsOut
 * @return {!Array<!Object>}
 * @private
 */
function buildResourceAssignmentWeeks_(startYmd, endYmd, warningsOut) {
  var rangeStart = parseIsoDateOnlyUtc_(startYmd);
  var rangeEnd = parseIsoDateOnlyUtc_(endYmd);
  if (!rangeStart || !rangeEnd) {
    return [];
  }
  var seen = {};
  var order = [];
  var cursor = new Date(rangeStart.getTime());
  while (cursor.getTime() <= rangeEnd.getTime()) {
    var ymd =
      cursor.getUTCFullYear() +
      '-' +
      resourceAssignmentPad2_(cursor.getUTCMonth() + 1) +
      '-' +
      resourceAssignmentPad2_(cursor.getUTCDate());
    var wk = extractIsoWeekKey_(ymd + 'T12:00:00.000Z');
    if (wk && !seen[wk]) {
      seen[wk] = true;
      order.push(wk);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  if (order.length > RESOURCE_ASSIGNMENTS_MAX_WEEKS_) {
    order = order.slice(0, RESOURCE_ASSIGNMENTS_MAX_WEEKS_);
    warningsOut.push('RANGE_CAPPED: showing first ' + RESOURCE_ASSIGNMENTS_MAX_WEEKS_ + ' ISO weeks.');
  }
  var out = [];
  for (var i = 0; i < order.length; i++) {
    var key = order[i];
    var bounds = resourceAssignmentWeekBoundsInclusiveUtc_(key);
    var partial =
      bounds.start.getTime() < rangeStart.getTime() ||
      bounds.end.getTime() > rangeEnd.getTime();
    out.push({
      key: key,
      label: resourceAssignmentWeekLabel_(bounds.start),
      partial: partial,
    });
  }
  return out;
}

/**
 * @param {number} n
 * @return {string}
 * @private
 */
function resourceAssignmentPad2_(n) {
  return n < 10 ? '0' + n : String(n);
}

/**
 * @param {string} weekKey
 * @return {!{ start: !Date, end: !Date }}
 * @private
 */
function resourceAssignmentWeekBoundsInclusiveUtc_(weekKey) {
  var r = isoWeekRange_(weekKey);
  var start = parseIsoDateOnlyUtc_(r.startIso.slice(0, 10));
  var end = new Date(start.getTime() + 6 * 86400000);
  return { start: start, end: end };
}

/**
 * @param {!Date} mondayUtc
 * @return {string}
 * @private
 */
function resourceAssignmentWeekLabel_(mondayUtc) {
  var names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var m = mondayUtc.getUTCMonth();
  return names[m] + ' ' + mondayUtc.getUTCDate();
}

/**
 * @param {number} limit
 * @param {number} offset
 * @return {!Object}
 * @private
 */
function buildResourceAllocationsPortfolioQuery_(limit, offset) {
  return {
    query: {
      'q/from': 'Agreement Management/Resource Allocations',
      'q/select': {
        id: 'fibery/id',
        allocatedHours: 'Agreement Management/Allocated Hours',
        duration: 'Agreement Management/Duration',
        allocationName: 'Agreement Management/Allocation Name',
        percentAllocated: 'Agreement Management/Percent Allocated',
        clockifyUserId: ['Agreement Management/Clockify User', 'fibery/id'],
        clockifyUserName: ['Agreement Management/Clockify User', 'Agreement Management/Name'],
        clockifyUserCompany: ['Agreement Management/Clockify User Company', 'enum/name'],
        roleName: [
          'Agreement Management/Clockify User Team Member Role',
          'Agreement Management/Name',
        ],
        agreementId: ['Agreement Management/Agreement', 'fibery/id'],
        agreementName: ['Agreement Management/Agreement', 'Agreement Management/Name'],
        customerName: [
          'Agreement Management/Agreement',
          'Agreement Management/Customer',
          'Agreement Management/Name',
        ],
        allocatedAndBillable: 'Agreement Management/Allocated & Billable',
      },
      'q/limit': limit,
      'q/offset': offset,
    },
  };
}

/**
 * @param {number} maxRows
 * @return {!{ ok: true, rows: !Array, truncated: boolean }|!{ ok: false, message: string }}
 * @private
 */
function fetchAllResourceAllocationsPortfolio_(maxRows) {
  var all = [];
  var truncated = false;
  for (var page = 0; page < RESOURCE_ASSIGNMENTS_QUERY_MAX_PAGES_; page++) {
    var offset = page * RESOURCE_ASSIGNMENTS_QUERY_PAGE_LIMIT_;
    if (all.length >= maxRows) {
      truncated = true;
      break;
    }
    var limit = Math.min(RESOURCE_ASSIGNMENTS_QUERY_PAGE_LIMIT_, maxRows - all.length);
    var r = fiberyQuery_(buildResourceAllocationsPortfolioQuery_(limit, offset));
    if (!r.ok) {
      return { ok: false, message: r.message || 'Fibery query failed.' };
    }
    var rows = r.rows || [];
    for (var i = 0; i < rows.length; i++) {
      all.push(rows[i]);
    }
    if (rows.length < limit) {
      break;
    }
    if (all.length >= maxRows) {
      truncated = true;
      break;
    }
  }
  return { ok: true, rows: all, truncated: truncated };
}

/**
 * @param {!Object} row
 * @return {?Object}
 * @private
 */
function normalizeResourceAllocationRow_(row) {
  if (!row) return null;
  var dur = row.duration && typeof row.duration === 'object' ? row.duration : null;
  var personId = row.clockifyUserId != null ? String(row.clockifyUserId).trim() : '';
  var personName =
    stringOrNull_(row.clockifyUserName) ||
    stringOrNull_(row.allocationName) ||
    '(Unnamed)';
  var personKey = personId ? 'person:' + personId : 'person:name:' + personName.toLowerCase();
  return {
    id: stringOr_(row.id, ''),
    personKey: personKey,
    personName: personName,
    personId: personId,
    company: stringOrNull_(row.clockifyUserCompany) || '',
    roleName: stringOrNull_(row.roleName) || '(No role)',
    agreementId: stringOr_(row.agreementId, ''),
    projectName: stringOrNull_(row.agreementName) || '(Unnamed project)',
    customerName: stringOrNull_(row.customerName) || '',
    durStart: dur ? stringOrNull_(dur.start) : null,
    durEnd: dur ? stringOrNull_(dur.end) : null,
    percentAllocated: normalizeResourceAssignmentPercent_(row.percentAllocated),
    allocatedHours: numberOr_(row.allocatedHours, 0),
    allocationName: stringOrNull_(row.allocationName),
    allocatedAndBillable:
      row.allocatedAndBillable === true
        ? true
        : row.allocatedAndBillable === false
          ? false
          : null,
  };
}

/**
 * Align Labor Costs person id/name with assignment personKey.
 *
 * @param {?string} personId
 * @param {?string} personName
 * @return {string}
 * @private
 */
function resourceAssignmentPersonKeyFromParts_(personId, personName) {
  var id = personId != null ? String(personId).trim() : '';
  if (id) {
    return 'person:' + id;
  }
  var name = personName ? String(personName).trim() : '(Unnamed)';
  return 'person:name:' + name.toLowerCase();
}

/**
 * Collapse punctuation/spaces for cross-source person matching (Clockify display
 * name vs time-entry login, e.g. "Abhilash Panda" and "abhilash.panda").
 *
 * @param {?string} name
 * @return {string}
 * @private
 */
function resourceAssignmentNormalizePersonAlias_(name) {
  if (!name) {
    return '';
  }
  var s = String(name).trim().toLowerCase();
  if (s.indexOf('@') >= 0) {
    s = s.split('@')[0];
  }
  return s.replace(/[\s._\-+]+/g, '');
}

/**
 * @param {?string} name
 * @return {!Array<string>}
 * @private
 */
function resourceAssignmentPersonAliases_(name) {
  var out = [];
  var seen = {};
  function add(a) {
    if (!a || seen[a]) {
      return;
    }
    seen[a] = true;
    out.push(a);
  }
  add(resourceAssignmentNormalizePersonAlias_(name));
  var raw = String(name || '').trim().toLowerCase();
  if (raw.indexOf('.') >= 0 && raw.indexOf('@') < 0) {
    add(raw.replace(/\./g, ''));
    add(raw.replace(/\./g, ' ').replace(/\s+/g, ''));
  }
  if (raw.indexOf(' ') >= 0) {
    add(raw.replace(/\s+/g, ''));
    add(raw.replace(/\s+/g, '.'));
  }
  return out;
}

/**
 * @param {string} personKey
 * @return {string}
 * @private
 */
function resourceAssignmentPersonIdFromKey_(personKey) {
  if (!personKey || personKey.indexOf('person:') !== 0) {
    return '';
  }
  if (personKey.indexOf('person:name:') === 0) {
    return '';
  }
  return personKey.slice(7);
}

/**
 * Maps labor time-entry identities onto assignment Clockify User keys.
 *
 * @param {!Array<!Object>} persons
 * @return {!Object}
 * @private
 */
function buildResourceAssignmentPersonResolver_(persons) {
  var byAlias = {};
  var byId = {};
  var canonicalMeta = {};

  function registerPerson(canonicalKey, name, personId, roleName, company) {
    if (!canonicalMeta[canonicalKey]) {
      canonicalMeta[canonicalKey] = {
        name: name || '(Unnamed)',
        personId: personId || '',
        roleName: roleName || '(No role)',
        company: company || '',
      };
    } else {
      if (name && canonicalMeta[canonicalKey].name === '(Unnamed)') {
        canonicalMeta[canonicalKey].name = name;
      }
      if (roleName && canonicalMeta[canonicalKey].roleName === '(No role)') {
        canonicalMeta[canonicalKey].roleName = roleName;
      }
      if (company && !canonicalMeta[canonicalKey].company) {
        canonicalMeta[canonicalKey].company = company;
      }
    }
    if (personId) {
      byId[personId] = canonicalKey;
    }
    var aliases = resourceAssignmentPersonAliases_(name);
    for (var i = 0; i < aliases.length; i++) {
      if (aliases[i] && !byAlias[aliases[i]]) {
        byAlias[aliases[i]] = canonicalKey;
      }
    }
  }

  for (var pi = 0; pi < persons.length; pi++) {
    var p = persons[pi];
    var pid = p.personId || resourceAssignmentPersonIdFromKey_(p.key);
    registerPerson(p.key, p.name, pid, p.roleName, p.company);
  }

  return {
    resolve: function (userId, userName) {
      var id = userId != null ? String(userId).trim() : '';
      if (id && byId[id]) {
        return { key: byId[id], meta: canonicalMeta[byId[id]] };
      }
      var aliases = resourceAssignmentPersonAliases_(userName);
      for (var ai = 0; ai < aliases.length; ai++) {
        if (aliases[ai] && byAlias[aliases[ai]]) {
          return { key: byAlias[aliases[ai]], meta: canonicalMeta[byAlias[aliases[ai]]] };
        }
      }
      var fallbackKey = resourceAssignmentPersonKeyFromParts_(userId, userName);
      if (!canonicalMeta[fallbackKey]) {
        canonicalMeta[fallbackKey] = {
          name: userName || '(Unknown user)',
          personId: id,
          roleName: '(No role)',
          company: '',
        };
      }
      return { key: fallbackKey, meta: canonicalMeta[fallbackKey] };
    },
    resolveLaborKey: function (laborKey, laborMeta) {
      var userId = '';
      if (laborKey.indexOf('person:') === 0 && laborKey.indexOf('person:name:') !== 0) {
        userId = laborKey.slice(7);
      } else if (laborMeta && laborMeta.personId) {
        userId = String(laborMeta.personId);
      }
      var userName = laborMeta && laborMeta.name ? laborMeta.name : '';
      if (laborKey.indexOf('person:name:') === 0) {
        userName = userName || laborKey.slice('person:name:'.length);
      }
      return this.resolve(userId, userName);
    },
  };
}

/**
 * @param {!Object} laborByProject
 * @param {!Object} laborPersonMeta
 * @param {!Object} resolver
 * @return {!{ byProject: !Object, personMeta: !Object }}
 * @private
 */
function remapResourceAssignmentLaborByProject_(laborByProject, laborPersonMeta, resolver) {
  var out = {};
  var metaOut = {};
  var aids = Object.keys(laborByProject || {});
  for (var ai = 0; ai < aids.length; ai++) {
    var aid = aids[ai];
    var laborPersons = laborByProject[aid];
    var rawKeys = Object.keys(laborPersons || {});
    out[aid] = out[aid] || {};
    for (var ri = 0; ri < rawKeys.length; ri++) {
      var rawKey = rawKeys[ri];
      var rawMeta = laborPersonMeta[rawKey] || {};
      var resolved = resolver.resolveLaborKey(rawKey, rawMeta);
      var cKey = resolved.key;
      if (!out[aid][cKey]) {
        out[aid][cKey] = {};
      }
      var weeks = laborPersons[rawKey];
      for (var wk in weeks) {
        if (!Object.prototype.hasOwnProperty.call(weeks, wk)) {
          continue;
        }
        out[aid][cKey][wk] = (out[aid][cKey][wk] || 0) + weeks[wk];
      }
      if (!metaOut[cKey]) {
        metaOut[cKey] = resolved.meta || rawMeta;
      }
    }
  }
  return { byProject: out, personMeta: metaOut };
}

/**
 * @param {string} startYmd
 * @param {string} endYmd
 * @return {!{ startIso: string, endIsoExclusive: string }}
 * @private
 */
function resourceAssignmentLaborRangeIso_(startYmd, endYmd) {
  var startIso = startYmd + 'T00:00:00.000Z';
  var endDate = parseIsoDateOnlyUtc_(endYmd);
  if (!endDate) {
    return { startIso: startIso, endIsoExclusive: startIso };
  }
  var endExclusive = new Date(endDate.getTime() + 86400000);
  var endIsoExclusive = endExclusive.toISOString();
  return { startIso: startIso, endIsoExclusive: endIsoExclusive };
}

/**
 * @param {string} startYmd
 * @param {string} endYmd
 * @param {!Array<!Object>} weeks
 * @param {!Array<string>} warningsOut
 * @return {!Object}
 * @private
 */
function aggregateResourceAssignmentLaborByProject_(
  startYmd, endYmd, weeks, warningsOut
) {
  var weekSet = {};
  for (var wi = 0; wi < weeks.length; wi++) {
    weekSet[weeks[wi].key] = true;
  }
  var rangeIso = resourceAssignmentLaborRangeIso_(startYmd, endYmd);
  var fetched = fetchAllLaborCosts_(rangeIso.startIso, rangeIso.endIsoExclusive);
  if (!fetched.ok) {
    warningsOut.push(
      'Labor costs fetch failed for plan vs actual: ' + (fetched.message || 'unknown error')
    );
    return {
      ok: false,
      byProject: {},
      personMeta: {},
      projectMeta: {},
      rowCount: 0,
      truncated: false,
    };
  }
  if (fetched.truncated) {
    warningsOut.push('Labor costs fetch truncated; actual hours may be incomplete.');
  }
  var thresholds = getUtilizationThresholds_();
  var rows = normalizeLaborRows_(fetched.rows || [], thresholds);
  var byProject = {};
  var personMeta = {};
  var projectMeta = {};

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var agreementId = r.agreementId ? String(r.agreementId).trim() : '';
    if (!agreementId) {
      continue;
    }
    var weekKey = r.week || extractIsoWeekKey_(r.startDateTime);
    if (!weekKey || !weekSet[weekKey]) {
      continue;
    }
    var personKey = resourceAssignmentPersonKeyFromParts_(r.userId, r.userName);
    if (!byProject[agreementId]) {
      byProject[agreementId] = {};
    }
    if (!byProject[agreementId][personKey]) {
      byProject[agreementId][personKey] = {};
    }
    byProject[agreementId][personKey][weekKey] =
      (byProject[agreementId][personKey][weekKey] || 0) + (r.hours || 0);

    if (!personMeta[personKey]) {
      personMeta[personKey] = {
        name: r.userName || '(Unknown user)',
        personId: r.userId ? String(r.userId).trim() : '',
        roleName: r.userRole || r.clockifyUserRole || '(No role)',
        company: r.clockifyUserCompany || '',
      };
    }
    if (!projectMeta[agreementId]) {
      projectMeta[agreementId] = {
        projectName: r.agreementName || '(Unnamed project)',
        customerName: r.customer || '',
      };
    }
  }

  return {
    ok: true,
    byProject: byProject,
    personMeta: personMeta,
    projectMeta: projectMeta,
    rowCount: rows.length,
    truncated: !!fetched.truncated,
  };
}

/**
 * @param {!Object} byWeek
 * @param {string} weekKey
 * @param {number} assigned
 * @param {number} actual
 * @param {boolean} partial
 * @private
 */
function resourceAssignmentSetPlanActualWeek_(
  byWeek, weekKey, assigned, actual, partial
) {
  var variance = Math.round((actual - assigned) * 10) / 10;
  byWeek[weekKey] = {
    assignedHours: Math.round(assigned * 10) / 10,
    actualHours: Math.round(actual * 10) / 10,
    varianceHours: variance,
    partial: !!partial,
  };
}

/**
 * @param {!Array<!Object>} persons
 * @param {!Object} laborByProject
 * @param {!Object} laborPersonMeta
 * @param {!Object} laborProjectMeta
 * @param {!Array<!Object>} weeks
 * @return {!Array<!Object>}
 * @private
 */
function buildResourceAssignmentProjects_(
  persons, laborByProject, laborPersonMeta, laborProjectMeta, weeks
) {
  var resolver = buildResourceAssignmentPersonResolver_(persons);
  var remapped = remapResourceAssignmentLaborByProject_(
    laborByProject,
    laborPersonMeta,
    resolver
  );
  laborByProject = remapped.byProject;
  laborPersonMeta = remapped.personMeta;

  var projectMap = {};

  function ensureProject_(agreementId, projectName, customerName) {
    var key = agreementId || 'project:' + projectName;
    if (!projectMap[key]) {
      projectMap[key] = {
        key: key,
        agreementId: agreementId || '',
        projectName: projectName || '(Unnamed project)',
        customerName: customerName || '',
        byWeekTotals: {},
        personsMap: {},
      };
    }
    return projectMap[key];
  }

  function ensurePerson_(proj, personKey, name, roleName, company) {
    if (!proj.personsMap[personKey]) {
      proj.personsMap[personKey] = {
        personKey: personKey,
        name: name || '(Unnamed)',
        roleName: roleName || '(No role)',
        company: company || '',
        hasAssignment: false,
        allocatedAndBillable: true,
        highlightOrange: false,
        byWeek: {},
      };
    }
    return proj.personsMap[personKey];
  }

  for (var pi = 0; pi < persons.length; pi++) {
    var person = persons[pi];
    var personProjects = person.projects || [];
    for (var pj = 0; pj < personProjects.length; pj++) {
      var pr = personProjects[pj];
      var agreementId = pr.agreementId || '';
      var proj = ensureProject_(
        agreementId,
        pr.projectName,
        pr.customerName
      );
      var billable = pr.allocatedAndBillable !== false;
      var pp = ensurePerson_(
        proj,
        person.key,
        person.name,
        person.roleName,
        person.company
      );
      pp.hasAssignment = true;
      if (!billable) {
        pp.allocatedAndBillable = false;
      }
      for (var wi = 0; wi < weeks.length; wi++) {
        var wk = weeks[wi].key;
        var hb = pr.byWeek && pr.byWeek[wk];
        var assigned = hb && hb.hours ? hb.hours : 0;
        var actual =
          laborByProject[agreementId] &&
          laborByProject[agreementId][person.key] &&
          laborByProject[agreementId][person.key][wk]
            ? laborByProject[agreementId][person.key][wk]
            : 0;
        var partial = !!(hb && hb.partial) || !!weeks[wi].partial;
        resourceAssignmentSetPlanActualWeek_(pp.byWeek, wk, assigned, actual, partial);
      }
    }
  }

  var laborProjects = Object.keys(laborByProject);
  for (var lp = 0; lp < laborProjects.length; lp++) {
    var aid = laborProjects[lp];
    var meta = laborProjectMeta[aid] || {};
    var proj2 = ensureProject_(aid, meta.projectName, meta.customerName);
    var laborPersons = laborByProject[aid];
    var pkKeys = Object.keys(laborPersons);
    for (var pk = 0; pk < pkKeys.length; pk++) {
      var pKey = pkKeys[pk];
      var pmeta = laborPersonMeta[pKey] || {};
      var resolved = resolver.resolveLaborKey(pKey, pmeta);
      var pp2 = ensurePerson_(
        proj2,
        resolved.key,
        resolved.meta.name || pmeta.name,
        resolved.meta.roleName || pmeta.roleName,
        resolved.meta.company || pmeta.company
      );
      if (pp2.hasAssignment) {
        continue;
      }
      if (!pp2.hasAssignment) {
        pp2.allocatedAndBillable = false;
      }
      for (var wj = 0; wj < weeks.length; wj++) {
        var wkey = weeks[wj].key;
        var actualOnly = laborPersons[pKey][wkey] || 0;
        if (!actualOnly && !pp2.byWeek[wkey]) {
          continue;
        }
        var assignedOnly =
          pp2.byWeek[wkey] && pp2.byWeek[wkey].assignedHours
            ? pp2.byWeek[wkey].assignedHours
            : 0;
        if (!pp2.byWeek[wkey] && !actualOnly) {
          continue;
        }
        resourceAssignmentSetPlanActualWeek_(
          pp2.byWeek,
          wkey,
          assignedOnly,
          actualOnly,
          !!weeks[wj].partial
        );
      }
    }
  }

  var projectsOut = [];
  var projectKeys = Object.keys(projectMap).sort(function (a, b) {
    var na = projectMap[a].projectName || '';
    var nb = projectMap[b].projectName || '';
    if (na !== nb) return na.localeCompare(nb);
    return a.localeCompare(b);
  });

  for (var xi = 0; xi < projectKeys.length; xi++) {
    var pkey = projectKeys[xi];
    var projOut = projectMap[pkey];
    var personsArr = [];
    var personKeys = Object.keys(projOut.personsMap).sort(function (a, b) {
      var na = projOut.personsMap[a].name || '';
      var nb = projOut.personsMap[b].name || '';
      if (na !== nb) return na.localeCompare(nb);
      return a.localeCompare(b);
    });
    for (var yi = 0; yi < personKeys.length; yi++) {
      var pers = projOut.personsMap[personKeys[yi]];
      pers.highlightOrange = !pers.hasAssignment || pers.allocatedAndBillable === false;
      personsArr.push({
        personKey: pers.personKey,
        name: pers.name,
        roleName: pers.roleName,
        company: pers.company,
        hasAssignment: pers.hasAssignment,
        allocatedAndBillable: pers.allocatedAndBillable,
        highlightOrange: pers.highlightOrange,
        byWeek: pers.byWeek,
      });
    }
    var totals = {};
    for (var ti = 0; ti < personsArr.length; ti++) {
      var byW = personsArr[ti].byWeek;
      for (var twk in byW) {
        if (!Object.prototype.hasOwnProperty.call(byW, twk)) continue;
        if (!totals[twk]) {
          totals[twk] = { assignedHours: 0, actualHours: 0, varianceHours: 0, partial: false };
        }
        totals[twk].assignedHours += byW[twk].assignedHours || 0;
        totals[twk].actualHours += byW[twk].actualHours || 0;
        totals[twk].varianceHours += byW[twk].varianceHours || 0;
        if (byW[twk].partial) {
          totals[twk].partial = true;
        }
      }
    }
    for (var twk2 in totals) {
      if (Object.prototype.hasOwnProperty.call(totals, twk2)) {
        totals[twk2].assignedHours = Math.round(totals[twk2].assignedHours * 10) / 10;
        totals[twk2].actualHours = Math.round(totals[twk2].actualHours * 10) / 10;
        totals[twk2].varianceHours = Math.round(totals[twk2].varianceHours * 10) / 10;
      }
    }
    projectsOut.push({
      key: projOut.key,
      agreementId: projOut.agreementId,
      projectName: projOut.projectName,
      customerName: projOut.customerName,
      byWeekTotals: totals,
      persons: personsArr,
    });
  }

  return projectsOut;
}

/**
 * @param {*} raw
 * @return {?number}
 * @private
 */
function normalizeResourceAssignmentPercent_(raw) {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  var n = Number(raw);
  if (!isFinite(n)) {
    return null;
  }
  if (n > 0 && n <= 1) {
    n = n * 100;
  }
  return n;
}

/**
 * @param {!Object} row
 * @param {string} rangeStartYmd
 * @param {string} rangeEndYmd
 * @return {boolean}
 * @private
 */
function allocationOverlapsRangeYmd_(row, rangeStartYmd, rangeEndYmd) {
  var rangeStart = parseIsoDateOnlyUtc_(rangeStartYmd);
  var rangeEnd = parseIsoDateOnlyUtc_(rangeEndYmd);
  if (!rangeStart || !rangeEnd) {
    return false;
  }
  var allocStart = parseIsoDateOnlyUtc_(row.durStart || row.durEnd);
  var allocEnd = parseIsoDateOnlyUtc_(row.durEnd || row.durStart);
  if (!allocStart && !allocEnd) {
    return true;
  }
  if (!allocStart) {
    allocStart = allocEnd;
  }
  if (!allocEnd) {
    allocEnd = allocStart;
  }
  if (allocEnd.getTime() < allocStart.getTime()) {
    var swap = allocStart;
    allocStart = allocEnd;
    allocEnd = swap;
  }
  return allocStart.getTime() <= rangeEnd.getTime() && allocEnd.getTime() >= rangeStart.getTime();
}

/**
 * @param {!Array<!Object>} rows
 * @param {!Array<!Object>} weeks
 * @param {number} weeklyCapacity
 * @param {string} rangeStartYmd
 * @param {string} rangeEndYmd
 * @param {!Array<string>} warningsOut
 * @return {!{ persons: !Array, overAllocatedWeekCount: number }}
 * @private
 */
function buildResourceAssignmentPersons_(
  rows, weeks, weeklyCapacity, rangeStartYmd, rangeEndYmd, warningsOut
) {
  var rangeStart = parseIsoDateOnlyUtc_(rangeStartYmd);
  var rangeEnd = parseIsoDateOnlyUtc_(rangeEndYmd);
  var personMap = {};
  var missingDuration = 0;
  var gapRows = 0;

  for (var ri = 0; ri < rows.length; ri++) {
    var row = rows[ri];
    if (!row.durStart && !row.durEnd) {
      missingDuration++;
    }
    var weekBuckets = computeResourceAssignmentWeekBuckets_(
      row,
      weeks,
      weeklyCapacity,
      rangeStart,
      rangeEnd,
      warningsOut
    );
    if (!weekBuckets.length) {
      if (!row.percentAllocated && !(row.allocatedHours > 0)) {
        gapRows++;
      }
      continue;
    }

    if (!personMap[row.personKey]) {
      personMap[row.personKey] = {
        key: row.personKey,
        name: row.personName,
        personId: row.personId || '',
        roleName: row.roleName,
        company: row.company,
        byWeekTotalPercent: {},
        projects: {},
      };
    }
    var person = personMap[row.personKey];
    if (row.personId && !person.personId) {
      person.personId = row.personId;
    }
    if (row.roleName && person.roleName === '(No role)') {
      person.roleName = row.roleName;
    }
    if (row.company && !person.company) {
      person.company = row.company;
    }

    var projKey = row.agreementId || 'project:' + row.projectName;
    if (!person.projects[projKey]) {
      person.projects[projKey] = {
        agreementId: row.agreementId,
        projectName: row.projectName,
        customerName: row.customerName,
        allocatedAndBillable: true,
        byWeek: {},
      };
    }
    var proj = person.projects[projKey];
    if (row.allocatedAndBillable === false) {
      proj.allocatedAndBillable = false;
    }

    for (var wi = 0; wi < weekBuckets.length; wi++) {
      var wb = weekBuckets[wi];
      if (!wb.percent && !wb.hours) continue;
      var wk = wb.weekKey;
      if (!proj.byWeek[wk]) {
        proj.byWeek[wk] = { percent: 0, hours: 0, partial: wb.partial };
      }
      proj.byWeek[wk].percent += wb.percent;
      proj.byWeek[wk].hours += wb.hours;
      if (wb.partial) {
        proj.byWeek[wk].partial = true;
      }
      person.byWeekTotalPercent[wk] = (person.byWeekTotalPercent[wk] || 0) + wb.percent;
    }
  }

  if (missingDuration > 0) {
    warningsOut.push(
      String(missingDuration) + ' allocation(s) missing Duration (RESOURCE_ALLOCATION_MISSING_DURATION).'
    );
  }
  if (gapRows > 0) {
    warningsOut.push(String(gapRows) + ' allocation(s) had no percent or hours in range.');
  }

  var persons = [];
  var keys = Object.keys(personMap).sort(function (a, b) {
    var na = personMap[a].name || '';
    var nb = personMap[b].name || '';
    if (na !== nb) return na.localeCompare(nb);
    return a.localeCompare(b);
  });

  var overAllocatedWeekCount = 0;
  for (var pi = 0; pi < keys.length; pi++) {
    var p = personMap[keys[pi]];
    var projectsArr = [];
    var pk = Object.keys(p.projects).sort(function (a, b) {
      var pa = p.projects[a].projectName || '';
      var pb = p.projects[b].projectName || '';
      return pa.localeCompare(pb);
    });
    for (var pj = 0; pj < pk.length; pj++) {
      var pr = p.projects[pk[pj]];
      projectsArr.push({
        agreementId: pr.agreementId,
        projectName: pr.projectName,
        customerName: pr.customerName,
        allocatedAndBillable: pr.allocatedAndBillable !== false,
        byWeek: pr.byWeek,
      });
    }
    p.projects = projectsArr;
    for (var wk2 in p.byWeekTotalPercent) {
      if (Object.prototype.hasOwnProperty.call(p.byWeekTotalPercent, wk2)) {
        p.byWeekTotalPercent[wk2] = Math.round(p.byWeekTotalPercent[wk2] * 10) / 10;
        if (p.byWeekTotalPercent[wk2] > 100) {
          overAllocatedWeekCount++;
        }
      }
    }
    for (var prj = 0; prj < p.projects.length; prj++) {
      var byW = p.projects[prj].byWeek;
      for (var wk3 in byW) {
        if (Object.prototype.hasOwnProperty.call(byW, wk3)) {
          byW[wk3].percent = Math.round(byW[wk3].percent * 10) / 10;
          byW[wk3].hours = Math.round(byW[wk3].hours * 10) / 10;
        }
      }
    }
    persons.push(p);
  }

  return { persons: persons, overAllocatedWeekCount: overAllocatedWeekCount };
}

/**
 * @param {!Object} row
 * @param {!Array<!Object>} weeks
 * @param {number} weeklyCapacity
 * @param {?Date} rangeStart
 * @param {?Date} rangeEnd
 * @return {!Array<!Object>}
 * @private
 */
function computeResourceAssignmentWeekBuckets_(
  row, weeks, weeklyCapacity, rangeStart, rangeEnd, warningsOut
) {
  var out = [];
  var allocStart = parseIsoDateOnlyUtc_(row.durStart || row.durEnd);
  var allocEnd = parseIsoDateOnlyUtc_(row.durEnd || row.durStart);
  if (!allocStart && !allocEnd) {
    if (weeks.length) {
      var pct = row.percentAllocated;
      var hrs =
        pct != null
          ? (pct / 100) * weeklyCapacity
          : row.allocatedHours > 0
            ? row.allocatedHours / Math.max(weeks.length, 1)
            : 0;
      out.push({
        weekKey: weeks[0].key,
        percent: pct || (weeklyCapacity > 0 ? (hrs / weeklyCapacity) * 100 : 0),
        hours: hrs,
        partial: !!weeks[0].partial,
      });
    }
    return out;
  }
  if (!allocStart) allocStart = allocEnd;
  if (!allocEnd) allocEnd = allocStart;
  if (allocEnd.getTime() < allocStart.getTime()) {
    var swap = allocStart;
    allocStart = allocEnd;
    allocEnd = swap;
  }
  var totalAllocDays = calendarDaysInclusiveUtc_(allocStart, allocEnd);
  if (totalAllocDays <= 0) {
    return out;
  }

  for (var wi = 0; wi < weeks.length; wi++) {
    var weekKey = weeks[wi].key;
    var wb = resourceAssignmentWeekBoundsInclusiveUtc_(weekKey);
    var intersect = intersectDateRangesInclusiveUtc_(
      allocStart,
      allocEnd,
      wb.start,
      wb.end
    );
    if (!intersect) continue;
    if (rangeStart && rangeEnd) {
      intersect = intersectDateRangesInclusiveUtc_(
        intersect.start,
        intersect.end,
        rangeStart,
        rangeEnd
      );
      if (!intersect) continue;
    }
    var overlapDays = calendarDaysInclusiveUtc_(intersect.start, intersect.end);
    if (overlapDays <= 0) continue;
    var fraction = overlapDays / 7;
    var hours = 0;
    var percent = 0;
    if (row.percentAllocated != null) {
      percent = row.percentAllocated * fraction;
      hours = (percent / 100) * weeklyCapacity;
    } else if (row.allocatedHours > 0) {
      hours = row.allocatedHours * (overlapDays / totalAllocDays);
      percent = weeklyCapacity > 0 ? (hours / weeklyCapacity) * 100 : 0;
    } else {
      continue;
    }
    out.push({
      weekKey: weekKey,
      percent: percent,
      hours: hours,
      partial: fraction < 0.999 || !!weeks[wi].partial,
    });
  }
  return out;
}

/**
 * @param {!Array<!Object>} persons
 * @param {!Array<!Object>=} projects
 * @return {!Object}
 * @private
 */
function buildResourceAssignmentDimensions_(persons, projects) {
  var personsOut = [];
  var personsSeen = {};
  var projectsMap = {};
  var customers = {};
  var companies = {};
  var roles = {};
  for (var i = 0; i < persons.length; i++) {
    var p = persons[i];
    if (!personsSeen[p.key]) {
      personsSeen[p.key] = true;
      personsOut.push({ key: p.key, name: p.name, roleName: p.roleName, company: p.company || '' });
    }
    if (p.company) companies[p.company] = true;
    if (p.roleName) roles[p.roleName] = true;
    for (var j = 0; j < (p.projects || []).length; j++) {
      var pr = p.projects[j];
      var pk = pr.agreementId || pr.projectName;
      if (!projectsMap[pk]) {
        projectsMap[pk] = {
          key: pk,
          agreementId: pr.agreementId,
          name: pr.projectName,
          customerName: pr.customerName || '',
          colorIndex: Object.keys(projectsMap).length % 12,
        };
      }
      if (pr.customerName) {
        customers[pr.customerName] = true;
      }
    }
  }
  var projList = projects || [];
  for (var pi = 0; pi < projList.length; pi++) {
    var proj = projList[pi];
    var pk2 = proj.agreementId || proj.key || proj.projectName;
    if (!projectsMap[pk2]) {
      projectsMap[pk2] = {
        key: pk2,
        agreementId: proj.agreementId,
        name: proj.projectName,
        customerName: proj.customerName || '',
        colorIndex: Object.keys(projectsMap).length % 12,
      };
    }
    if (proj.customerName) {
      customers[proj.customerName] = true;
    }
    var pPersons = proj.persons || [];
    for (var pp = 0; pp < pPersons.length; pp++) {
      var pers = pPersons[pp];
      if (!personsSeen[pers.personKey]) {
        personsSeen[pers.personKey] = true;
        personsOut.push({
          key: pers.personKey,
          name: pers.name,
          roleName: pers.roleName,
          company: pers.company || '',
        });
      }
      if (pers.company) companies[pers.company] = true;
      if (pers.roleName) roles[pers.roleName] = true;
    }
  }
  var projectsOut = [];
  var pkeys = Object.keys(projectsMap).sort(function (a, b) {
    return String(projectsMap[a].name).localeCompare(String(projectsMap[b].name));
  });
  for (var pi = 0; pi < pkeys.length; pi++) {
    projectsOut.push(projectsMap[pkeys[pi]]);
  }
  return {
    persons: personsOut,
    projects: projectsOut,
    customers: Object.keys(customers).sort(),
    companies: Object.keys(companies).sort(),
    roles: Object.keys(roles).sort(),
  };
}

/**
 * @param {!Array<!Object>} persons
 * @param {!Array<!Object>} rawRows
 * @param {!Array<!Object>} weeks
 * @param {!Array<string>} warningsOut
 * @return {!{ items: !Array, endingSoonCount: number }}
 * @private
 */
function buildResourceAssignmentAlerts_(persons, rawRows, weeks, warningsOut) {
  var items = [];
  var endingSoonCount = 0;
  var tz = resolveSnapshotTimezone_();
  var todayYmd = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var horizonYmd = resourceAssignmentAddDaysYmd_(
    todayYmd,
    RESOURCE_ASSIGNMENTS_ENDING_SOON_DAYS_,
    tz
  );

  for (var i = 0; i < rawRows.length; i++) {
    var row = rawRows[i];
    var endYmd = resourceAssignmentYmdOnly_(row.durEnd);
    if (!endYmd) continue;
    if (endYmd < todayYmd || endYmd > horizonYmd) continue;
    endingSoonCount++;
    items.push({
      id: 'ra-ending:' + row.id,
      severity: 'warning',
      kind: 'ending_soon',
      title: 'Assignment ending soon',
      detail:
        row.personName +
        ' on ' +
        row.projectName +
        ' ends ' +
        endYmd +
        '.',
      target: { personKey: row.personKey, allocationId: row.id },
    });
  }

  var overCount = 0;
  for (var pi = 0; pi < persons.length; pi++) {
    var person = persons[pi];
    var totals = person.byWeekTotalPercent || {};
    for (var wk in totals) {
      if (!Object.prototype.hasOwnProperty.call(totals, wk)) continue;
      if (totals[wk] <= 100) continue;
      overCount++;
      if (items.filter(function (x) {
        return x.kind === 'over_allocated';
      }).length >= RESOURCE_ASSIGNMENTS_MAX_OVER_ALERTS_) {
        continue;
      }
      items.push({
        id: 'ra-over:' + person.key + ':' + wk,
        severity: 'critical',
        kind: 'over_allocated',
        title: 'Over-allocated',
        detail:
          person.name +
          ' at ' +
          Math.round(totals[wk]) +
          '% in ' +
          wk +
          '.',
        target: { personKey: person.key, week: wk },
      });
    }
  }
  if (overCount > RESOURCE_ASSIGNMENTS_MAX_OVER_ALERTS_) {
    warningsOut.push(
      '+' +
        (overCount - RESOURCE_ASSIGNMENTS_MAX_OVER_ALERTS_) +
        ' more over-allocation alerts not shown.'
    );
  }

  items.sort(function (a, b) {
    var sev = { critical: 0, warning: 1, info: 2 };
    var sa = sev[a.severity] != null ? sev[a.severity] : 9;
    var sb = sev[b.severity] != null ? sev[b.severity] : 9;
    if (sa !== sb) return sa - sb;
    return String(a.title).localeCompare(String(b.title));
  });

  return { items: items, endingSoonCount: endingSoonCount };
}

/**
 * Snapshot job: default assignment range anchored on snapshot date.
 *
 * @param {string} snapshotDateYmd
 * @return {!{ startYmd: string, endYmd: string }}
 */
function buildResourceAssignmentRangeForSnapshot_(snapshotDateYmd) {
  var tz = resolveSnapshotTimezone_();
  var todayYmd = resourceAssignmentYmdOnly_(snapshotDateYmd);
  if (!todayYmd) {
    todayYmd = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  }
  return {
    startYmd: resourceAssignmentAddDaysYmd_(todayYmd, -RESOURCE_ASSIGNMENTS_DEFAULT_LOOKBACK_DAYS_, tz),
    endYmd: resourceAssignmentAddDaysYmd_(todayYmd, RESOURCE_ASSIGNMENTS_DEFAULT_LOOKAHEAD_DAYS_, tz),
  };
}

/**
 * @param {?string} rangeStartYmd
 * @param {?string} rangeEndYmd
 * @return {!Object}
 */
function _diag_resourceAssignmentsSample(rangeStartYmd, rangeEndYmd) {
  var payload = buildResourceAssignmentDashboardPayload_(rangeStartYmd, rangeEndYmd);
  if (!payload.ok) {
    return payload;
  }
  return {
    ok: true,
    rangeStart: payload.rangeStart,
    rangeEnd: payload.rangeEnd,
    personCount: (payload.persons || []).length,
    weekCount: (payload.weeks || []).length,
    alertCount: (payload.alerts || []).length,
    warnings: payload.warnings,
    kpis: payload.kpis,
    samplePerson: payload.persons && payload.persons.length ? payload.persons[0] : null,
    projectCount: (payload.projects || []).length,
    sampleProject: payload.projects && payload.projects.length ? payload.projects[0] : null,
  };
}

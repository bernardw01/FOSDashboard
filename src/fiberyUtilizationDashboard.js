/**
 * PRD version 1.18.0 — sync with docs/FOS-Dashboard-PRD.md
 *
 * Utilization Management Dashboard orchestrator (route id `operations`, panel
 * `#panel-operations`). Reads `Agreement Management/Labor Costs` from Fibery
 * through batched / paginated `fibery.entity/query` calls, normalizes rows,
 * computes KPIs + server-side aggregates, and returns the JSON view-model
 * the client renders for the Phase A surfaces in
 * docs/features/005-utilization-management-dashboard.md.
 *
 * No persistent server-side cache of payloads — Fibery is source of truth.
 * The browser owns presentation cache (`sessionStorage`) with a configurable
 * TTL surfaced through `getUtilizationCacheTtlMinutes()`.
 *
 * Public surface (client-callable via google.script.run):
 *   getUtilizationDashboardData(rangeStart?, rangeEnd?)
 *     — returns the full view-model payload for the date window.
 *   getUtilizationCacheTtlMinutes()
 *     — returns the configured default TTL minutes (Script Property
 *       UTILIZATION_CACHE_TTL_MINUTES, default 10).
 *
 * Internal diagnostics (run from the Apps Script editor):
 *   _diag_pingUtilization()           — verifies host + token reach Fibery.
 *   _diag_sampleUtilizationPayload()  — fetches a tiny window + dumps shapes.
 *   _diag_sampleUtilizationAlerts()   — fetches the configured default range
 *                                       + dumps the per-rule alert breakdown.
 *   _diag_sampleUtilizationPending()  — distribution of Approval +
 *                                       Time Entry Status values; introduced
 *                                       in v1.14.1 to verify the pending-
 *                                       detection fix against live data.
 */

/** @const {string} */
var UTILIZATION_CACHE_TTL_PROP_ = 'UTILIZATION_CACHE_TTL_MINUTES';

/**
 * Returns the configured default TTL (minutes) for the utilization dashboard
 * client cache. Floored at 1 minute; falsy / non-positive values fall back to
 * the default. The browser may override per-user via a localStorage preference
 * (FR-76b — analogous to the agreement dashboard's FR-56b).
 *
 * @return {number}
 */
function getUtilizationCacheTtlMinutes() {
  requireAuthForApi_();
  var t = getUtilizationThresholds_();
  return t.cacheTtlMinutes;
}

/**
 * Returns the normalized utilization-dashboard JSON for the Operations panel.
 * Re-checks spreadsheet authorization via requireAuthForApi_().
 *
 * @param {?string=} rangeStart ISO datetime (inclusive). Optional. When both
 *   range args are absent, defaults to `now - UTILIZATION_DEFAULT_RANGE_DAYS`.
 * @param {?string=} rangeEnd ISO datetime (exclusive upper bound). Optional.
 *   When both range args are absent, defaults to `now`.
 * @return {{
 *   ok: boolean,
 *   partial?: boolean,
 *   source: string,
 *   fetchedAt: string,
 *   cacheSchemaVersion: number,
 *   ttlMinutes: number,
 *   range: !{ start: string, end: string, defaulted: boolean, clamped: boolean },
 *   rows: !Array<!Object>,
 *   kpis: !Object,
 *   dimensions: !Object,
 *   aggregates: !Object,
 *   pendingApprovals: !Array<!Object>,
 *   alerts: !Array<!Object>,
 *   warnings?: !Array<string>,
 *   message?: string
 * }}
 */
function getUtilizationDashboardData(rangeStart, rangeEnd) {
  requireAuthForApi_();

  var now = new Date();
  var fetchedAtIso = now.toISOString();
  var thresholds = getUtilizationThresholds_();
  var ttlMinutes = thresholds.cacheTtlMinutes;
  var range = resolveRange_(rangeStart, rangeEnd, now, thresholds);

  var fetched = fetchAllLaborCosts_(range.start, range.end);
  if (!fetched.ok) {
    return {
      ok: false,
      source: 'fibery',
      fetchedAt: fetchedAtIso,
      cacheSchemaVersion: UTILIZATION_DASHBOARD_CACHE_SCHEMA_VERSION_,
      ttlMinutes: ttlMinutes,
      range: range,
      rows: [],
      kpis: emptyUtilizationKpis_(),
      dimensions: emptyUtilizationDimensions_(),
      aggregates: emptyUtilizationAggregates_(),
      pendingApprovals: [],
      alerts: [],
      message: fetched.message || 'Could not load utilization data from Fibery.',
      warnings: ['Fibery error: ' + (fetched.reason || 'UNKNOWN')],
    };
  }

  var rows = normalizeLaborRows_(fetched.rows, thresholds);
  var kpis = computeUtilizationKpis_(rows);
  var dimensions = buildUtilizationDimensions_(rows, thresholds);
  var aggregates = buildUtilizationAggregates_(rows, thresholds);
  // Phase C — per-person × per-week trajectory (capacity-scaled), feeds the
  // heatmap surface and the under/over-utilized alert rules.
  aggregates.byPersonWeek = buildByPersonWeek_(rows, range, thresholds);
  var pendingApprovals = collectPendingApprovals_(rows);
  // Phase C — rule-based attention items (mirrors §6 on the Agreement Dashboard).
  var alerts = buildUtilizationAlerts_(rows, aggregates.byPersonWeek, thresholds, range, now);

  var warnings = [];
  if (fetched.truncated) {
    warnings.push(
      'Result paginator hit the ' + UTILIZATION_QUERY_MAX_PAGES_ + '-page ceiling; ' +
        'data may be incomplete. Narrow the date range to refetch in full.'
    );
  }

  var payload = {
    ok: true,
    source: 'fibery',
    fetchedAt: fetchedAtIso,
    cacheSchemaVersion: UTILIZATION_DASHBOARD_CACHE_SCHEMA_VERSION_,
    ttlMinutes: ttlMinutes,
    range: range,
    rows: rows,
    kpis: kpis,
    dimensions: dimensions,
    aggregates: aggregates,
    pendingApprovals: pendingApprovals,
    alerts: alerts,
  };
  if (warnings.length) {
    payload.warnings = warnings;
    payload.partial = true;
  }
  return payload;
}

/* ------------------------------------------------------------------------- */
/* Diagnostics — run manually from the Apps Script editor.                    */
/* ------------------------------------------------------------------------- */

/**
 * Lightweight credential / connectivity check (re-uses the agreement-dashboard
 * fibery client). Logs the workspace version when `FIBERY_HOST` +
 * `FIBERY_API_TOKEN` are set correctly.
 * @return {!Object}
 */
function _diag_pingUtilization() {
  var r = fiberyPing_();
  console.log('fiberyPing_ (utilization) →', JSON.stringify(r));
  return r;
}

/**
 * One-page shape probe. Fetches the most recent ~25 labor rows for the last
 * 7 days, logs the first normalized row + KPI snapshot. Useful for verifying
 * field paths after a workspace schema change.
 * @return {!Object}
 */
function _diag_sampleUtilizationPayload() {
  var now = new Date();
  var endIso = now.toISOString();
  var start = new Date(now.getTime() - 7 * 86400000);
  var startIso = start.toISOString();
  var thresholds = getUtilizationThresholds_();
  var q = buildLaborCostsQuery_(startIso, endIso, 25, 0);
  var single = fiberyQuery_(q);
  if (!single.ok) {
    console.log('_diag_sampleUtilizationPayload (fetch failed) →', JSON.stringify(single));
    return single;
  }
  var rows = normalizeLaborRows_(single.rows || [], thresholds);
  var summary = {
    ok: true,
    range: { start: startIso, end: endIso, defaulted: false, clamped: false },
    rawCount: (single.rows || []).length,
    normalizedCount: rows.length,
    firstRaw: (single.rows && single.rows[0]) || null,
    firstNormalized: rows[0] || null,
    kpis: computeUtilizationKpis_(rows),
  };
  console.log('_diag_sampleUtilizationPayload →', JSON.stringify(summary).slice(0, 4000));
  return summary;
}

/**
 * Runs the full pipeline for the default range and prints the alert breakdown
 * (count per `kind`, top 5 by severity). Use after schema or threshold tweaks
 * to confirm the rules fire as expected against live data.
 *
 * @return {!Object}
 */
function _diag_sampleUtilizationAlerts() {
  var now = new Date();
  var thresholds = getUtilizationThresholds_();
  var range = resolveRange_(null, null, now, thresholds);
  var fetched = fetchAllLaborCosts_(range.start, range.end);
  if (!fetched.ok) {
    console.log('_diag_sampleUtilizationAlerts (fetch failed) →', JSON.stringify(fetched));
    return fetched;
  }
  var rows = normalizeLaborRows_(fetched.rows, thresholds);
  var byPersonWeek = buildByPersonWeek_(rows, range, thresholds);
  var alerts = buildUtilizationAlerts_(rows, byPersonWeek, thresholds, range, now);
  var counts = {};
  for (var i = 0; i < alerts.length; i++) {
    counts[alerts[i].kind] = (counts[alerts[i].kind] || 0) + 1;
  }
  var summary = {
    ok: true,
    range: range,
    rowCount: rows.length,
    byPersonWeekCount: byPersonWeek.length,
    alertCount: alerts.length,
    countsByKind: counts,
    top5: alerts.slice(0, 5).map(function (a) {
      return { severity: a.severity, kind: a.kind, title: a.title };
    }),
  };
  console.log('_diag_sampleUtilizationAlerts →', JSON.stringify(summary).slice(0, 4000));
  return summary;
}

/**
 * Distribution probe (v1.14.1) — counts Approval + Time-Entry-Status values
 * over the configured default range and reports how many rows the current
 * `isPendingApproval_` predicate flags as pending. Use after a sync or
 * approval workflow change to confirm the count matches expectation.
 *
 * @return {!Object}
 */
function _diag_sampleUtilizationPending() {
  var now = new Date();
  var thresholds = getUtilizationThresholds_();
  var range = resolveRange_(null, null, now, thresholds);
  var fetched = fetchAllLaborCosts_(range.start, range.end);
  if (!fetched.ok) {
    console.log('_diag_sampleUtilizationPending (fetch failed) →', JSON.stringify(fetched));
    return fetched;
  }
  var rows = normalizeLaborRows_(fetched.rows, thresholds);
  var approvalCounts = {};
  var statusCounts = {};
  var pendingCount = 0;
  var matrix = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var a = String(r.approval == null ? '(null)' : r.approval).trim() || '(empty)';
    var t = String(r.timeEntryStatus == null ? '(null)' : r.timeEntryStatus).trim() || '(empty)';
    approvalCounts[a] = (approvalCounts[a] || 0) + 1;
    statusCounts[t] = (statusCounts[t] || 0) + 1;
    var k = a + ' × ' + t;
    matrix[k] = (matrix[k] || 0) + 1;
    if (r.isPending) {
      pendingCount++;
    }
  }
  var summary = {
    ok: true,
    range: range,
    rowCount: rows.length,
    pendingCount: pendingCount,
    pendingPct: rows.length > 0 ? Math.round((pendingCount / rows.length) * 1000) / 10 : 0,
    approvalCounts: approvalCounts,
    timeEntryStatusCounts: statusCounts,
    pairCounts: matrix,
  };
  console.log('_diag_sampleUtilizationPending →', JSON.stringify(summary).slice(0, 4000));
  return summary;
}

/* ------------------------------------------------------------------------- */
/* Query builder + paginator                                                  */
/* ------------------------------------------------------------------------- */

/**
 * Builds one page of the `Agreement Management/Labor Costs` query. Field paths
 * match `docs/features/005-utilization-management-dashboard.md` §"Data source".
 *
 * @param {string} startIso ISO datetime (inclusive lower bound).
 * @param {string} endIso ISO datetime (exclusive upper bound).
 * @param {number} limit
 * @param {number} offset
 * @return {!Object}
 * @private
 */
function buildLaborCostsQuery_(startIso, endIso, limit, offset) {
  return {
    query: {
      'q/from': 'Agreement Management/Labor Costs',
      'q/select': {
        id: 'fibery/id',
        publicId: 'fibery/public-id',
        name: 'Agreement Management/Name',
        hours: 'Agreement Management/Hours',
        seconds: 'Agreement Management/Seconds',
        cost: 'Agreement Management/Cost',
        billable: 'Agreement Management/Billable',
        startDateTime: 'Agreement Management/Start Date Time',
        endDateTime: 'Agreement Management/End Date Time',
        dateOfCreation: 'Agreement Management/Date of creation',
        dateOfApproval: 'Agreement Management/Date of approval',
        approval: ['Agreement Management/Approval', 'enum/name'],
        timeEntryStatus: ['Agreement Management/Time Entry Status', 'enum/name'],
        agreementId: ['Agreement Management/Agreement', 'fibery/id'],
        agreementName: ['Agreement Management/Agreement', 'Agreement Management/Name'],
        agreementType: ['Agreement Management/Agreement', 'Agreement Management/Agreement Type', 'enum/name'],
        agreementState: ['Agreement Management/Agreement', 'workflow/state', 'enum/name'],
        customer: ['Agreement Management/Agreement', 'Agreement Management/Customer', 'Agreement Management/Name'],
        projectName: 'Agreement Management/Time Entry Project Name',
        projectId: 'Agreement Management/Project ID',
        task: 'Agreement Management/Task',
        userName: 'Agreement Management/Time Entry User Name',
        userId: 'Agreement Management/User ID',
        clockifyUserCompany: ['Agreement Management/Clockify User Company', 'enum/name'],
        clockifyUserRole: ['Agreement Management/Clockify User Role', 'enum/name'],
        userRole: ['Agreement Management/User Role', 'Agreement Management/Name'],
        userRoleBillRate: 'Agreement Management/User Role Bill Rate',
        userRoleCostRate: 'Agreement Management/User Role Cost Rate',
      },
      'q/where': [
        'q/and',
        ['>=', ['Agreement Management/Start Date Time'], '$startIso'],
        ['<', ['Agreement Management/Start Date Time'], '$endIso'],
      ],
      // q/order-by uses the wrapped-vector form documented in PRD v1.9.2 — the
      // field-path itself MUST be an array even when single-segment. Bare-string
      // keys raise `Unknown order by expression {"v":"…"}` on raw REST.
      'q/order-by': [[['Agreement Management/Start Date Time'], 'q/desc']],
      'q/limit': limit,
      'q/offset': offset,
    },
    params: { $startIso: startIso, $endIso: endIso },
  };
}

/**
 * Fetches every labor-cost row in the requested window by paging through
 * Fibery until a page returns fewer than `q/limit` rows or until the
 * per-call page ceiling is hit. Each page is a separate `/api/commands` POST.
 *
 * @param {string} startIso
 * @param {string} endIso
 * @return {!{ok: true, rows: !Array<!Object>, truncated: boolean}|
 *           !{ok: false, reason: string, message: string}}
 * @private
 */
function fetchAllLaborCosts_(startIso, endIso) {
  var all = [];
  var truncated = false;
  for (var page = 0; page < UTILIZATION_QUERY_MAX_PAGES_; page++) {
    var offset = page * UTILIZATION_QUERY_PAGE_LIMIT_;
    var q = buildLaborCostsQuery_(startIso, endIso, UTILIZATION_QUERY_PAGE_LIMIT_, offset);
    var r = fiberyQuery_(q);
    if (!r.ok) {
      return r;
    }
    var rows = r.rows || [];
    for (var i = 0; i < rows.length; i++) {
      all.push(rows[i]);
    }
    if (rows.length < UTILIZATION_QUERY_PAGE_LIMIT_) {
      return { ok: true, rows: all, truncated: false };
    }
  }
  truncated = true;
  return { ok: true, rows: all, truncated: truncated };
}

/* ------------------------------------------------------------------------- */
/* Normalization                                                              */
/* ------------------------------------------------------------------------- */

/**
 * Coerces raw Fibery labor rows into the canonical client-ready shape (see
 * §"Server contract" in 005-utilization-management-dashboard.md). Adds the
 * derived fields the rest of the pipeline relies on:
 *   - billable: boolean
 *   - hours: number (Fibery returns text)
 *   - day: 'YYYY-MM-DD'
 *   - week: 'YYYY-Www' (ISO Monday-anchored)
 *   - isPending: §U.7 derived
 *   - isInternal: §U.11 derived
 *   - revenueFromLabor: hours × billRate when both known, else null
 *
 * @param {!Array<!Object>} rawRows
 * @param {!Object} thresholds
 * @return {!Array<!Object>}
 * @private
 */
function normalizeLaborRows_(rawRows, thresholds) {
  var out = [];
  for (var i = 0; i < rawRows.length; i++) {
    var r = rawRows[i] || {};
    var hours = numberOr_(r.hours, 0);
    var billable = isBillableText_(r.billable);
    var billRate = numberOrNull_(r.userRoleBillRate);
    var costRate = numberOrNull_(r.userRoleCostRate);
    var startIso = stringOrNull_(r.startDateTime);
    var customerName = stringOr_(r.customer, '(Unassigned)');
    if (!customerName) {
      customerName = '(Unassigned)';
    }

    var row = {
      id: stringOr_(r.id, ''),
      publicId: stringOrNull_(r.publicId),
      name: stringOr_(r.name, ''),
      hours: hours,
      seconds: numberOr_(r.seconds, 0),
      cost: numberOr_(r.cost, 0),
      billable: billable,
      billableLabel: billable ? 'Yes' : 'No',
      startDateTime: startIso,
      endDateTime: stringOrNull_(r.endDateTime),
      dateOfCreation: stringOrNull_(r.dateOfCreation),
      dateOfApproval: stringOrNull_(r.dateOfApproval),
      day: extractDayKey_(startIso),
      week: extractIsoWeekKey_(startIso),
      agreementId: stringOrNull_(r.agreementId),
      agreementName: stringOrNull_(r.agreementName),
      agreementType: stringOrNull_(r.agreementType),
      agreementState: stringOrNull_(r.agreementState),
      customer: customerName,
      projectName: stringOr_(r.projectName, '(No Project)'),
      projectId: stringOrNull_(r.projectId),
      task: stringOrNull_(r.task),
      userName: stringOr_(r.userName, '(Unknown user)'),
      userId: stringOrNull_(r.userId),
      clockifyUserCompany: stringOrNull_(r.clockifyUserCompany),
      clockifyUserRole: stringOrNull_(r.clockifyUserRole),
      userRole: stringOrNull_(r.userRole),
      userRoleBillRate: billRate,
      userRoleCostRate: costRate,
      approval: stringOrNull_(r.approval),
      timeEntryStatus: stringOrNull_(r.timeEntryStatus),
      isPending: isPendingApproval_(r.approval, r.timeEntryStatus),
      revenueFromLabor: billRate !== null ? hours * billRate : null,
      marginPerHour: billRate !== null && costRate !== null ? billRate - costRate : null,
    };
    row.isInternal = isInternalLabor_(row, thresholds.internalCompanyNames);
    out.push(row);
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/* KPIs (§U.1–§U.7)                                                           */
/* ------------------------------------------------------------------------- */

/**
 * Computes the §U.1–§U.7 KPI bundle plus distinct-dimension counts. Numbers
 * stay full-precision; the client formats for display.
 *
 * @param {!Array<!Object>} rows
 * @return {!Object}
 * @private
 */
function computeUtilizationKpis_(rows) {
  var totalHours = 0;
  var billableHours = 0;
  var totalCost = 0;
  var billRateNumerator = 0;
  var billRateDenominator = 0;
  var pendingCount = 0;
  var personSet = {};
  var projectSet = {};
  var customerSet = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    totalHours += r.hours;
    totalCost += r.cost;
    if (r.billable) {
      billableHours += r.hours;
    }
    if (r.userRoleBillRate !== null) {
      billRateNumerator += r.hours * r.userRoleBillRate;
      billRateDenominator += r.hours;
    }
    if (r.isPending) {
      pendingCount++;
    }
    if (r.userId) {
      personSet[r.userId] = true;
    } else if (r.userName) {
      personSet[r.userName] = true;
    }
    if (r.projectId) {
      projectSet[r.projectId] = true;
    } else if (r.projectName) {
      projectSet[r.projectName] = true;
    }
    if (r.customer) {
      customerSet[r.customer] = true;
    }
  }
  var utilizationPct = totalHours > 0 ? (billableHours / totalHours) * 100 : 0;
  var effectiveCostRate = totalHours > 0 ? totalCost / totalHours : 0;
  var effectiveBillRate = billRateDenominator > 0 ? billRateNumerator / billRateDenominator : null;
  var billRateCoverage = totalHours > 0 ? billRateDenominator / totalHours : 0;
  return {
    totalHours: totalHours,
    billableHours: billableHours,
    nonBillableHours: Math.max(0, totalHours - billableHours),
    utilizationPct: utilizationPct,
    totalCost: totalCost,
    effectiveCostRate: effectiveCostRate,
    effectiveBillRate: effectiveBillRate,
    effectiveBillRateCoverage: billRateCoverage,
    pendingApprovalsCount: pendingCount,
    distinctPersons: Object.keys(personSet).length,
    distinctProjects: Object.keys(projectSet).length,
    distinctCustomers: Object.keys(customerSet).length,
    rowCount: rows.length,
  };
}

/* ------------------------------------------------------------------------- */
/* Dimensions + Aggregates                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Builds the §"dimensions" view-model — sorted lists of unique values per
 * facet, each carrying enough metadata for the client filter dropdowns and
 * chart palettes. Customer + Person + Role are sorted by hours desc so the
 * top entries surface first.
 *
 * @param {!Array<!Object>} rows
 * @param {!Object} thresholds
 * @return {!Object}
 * @private
 */
function buildUtilizationDimensions_(rows, thresholds) {
  var customerMap = {};
  var projectMap = {};
  var personMap = {};
  var roleMap = {};

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];

    var cKey = r.customer || '(Unassigned)';
    if (!customerMap[cKey]) {
      customerMap[cKey] = { name: cKey, hours: 0, billableHours: 0 };
    }
    customerMap[cKey].hours += r.hours;
    if (r.billable) {
      customerMap[cKey].billableHours += r.hours;
    }

    var pKey = r.projectId || ('name::' + r.projectName);
    if (!projectMap[pKey]) {
      projectMap[pKey] = {
        name: r.projectName,
        id: r.projectId || null,
        customer: r.customer,
        hours: 0,
        billableHours: 0,
      };
    }
    projectMap[pKey].hours += r.hours;
    if (r.billable) {
      projectMap[pKey].billableHours += r.hours;
    }

    var personKey = r.userId || r.userName || '(Unknown user)';
    if (!personMap[personKey]) {
      personMap[personKey] = {
        name: r.userName,
        id: r.userId || null,
        hours: 0,
        billableHours: 0,
      };
    }
    personMap[personKey].hours += r.hours;
    if (r.billable) {
      personMap[personKey].billableHours += r.hours;
    }

    var roleName = r.userRole || r.clockifyUserRole || '(No role)';
    if (!roleMap[roleName]) {
      roleMap[roleName] = { name: roleName, hours: 0, billableHours: 0 };
    }
    roleMap[roleName].hours += r.hours;
    if (r.billable) {
      roleMap[roleName].billableHours += r.hours;
    }
  }

  var customers = sortByHoursDesc_(mapToArray_(customerMap));
  var projects = sortByHoursDesc_(mapToArray_(projectMap));
  var persons = sortByHoursDesc_(mapToArray_(personMap));
  var roles = sortByHoursDesc_(mapToArray_(roleMap));

  // Stable customer colors: cycle the §8.5 palette by sorted-hours order.
  var customerNames = [];
  for (var ci = 0; ci < customers.length; ci++) {
    customerNames.push(customers[ci].name);
  }
  var customerColorMap = buildCustomerColorMap_(customerNames, thresholds.customerPalette);
  for (var c = 0; c < customers.length; c++) {
    customers[c].color = customerColorMap[customers[c].name] || thresholds.customerPalette[c % thresholds.customerPalette.length];
  }

  // Project rows inherit their customer's color so the §N.5 bar reads as a
  // grouped view of customer slices.
  for (var pj = 0; pj < projects.length; pj++) {
    var custColor = customerColorMap[projects[pj].customer || ''];
    projects[pj].color = custColor || thresholds.customerPalette[pj % thresholds.customerPalette.length];
  }

  // Person utilization% in the dimension list helps Phase B persons-bar render
  // without re-aggregating client-side.
  for (var pn = 0; pn < persons.length; pn++) {
    var p = persons[pn];
    p.utilizationPct = p.hours > 0 ? (p.billableHours / p.hours) * 100 : 0;
    p.color = thresholds.rolePalette[pn % thresholds.rolePalette.length];
  }

  // Role colors: deterministic palette cycling.
  var roleNames = [];
  for (var rn = 0; rn < roles.length; rn++) {
    roleNames.push(roles[rn].name);
  }
  var roleColorMap = buildRoleColorMap_(roleNames, thresholds.rolePalette);
  for (var r2 = 0; r2 < roles.length; r2++) {
    roles[r2].color = roleColorMap[roles[r2].name] || thresholds.rolePalette[r2 % thresholds.rolePalette.length];
  }

  return {
    customers: customers,
    projects: projects,
    persons: persons,
    roles: roles,
  };
}

/**
 * Builds the §"aggregates" view-model — server-precomputed slices for the
 * Phase A charts so the first paint doesn't depend on client aggregation.
 * Top-N caps apply to byCustomer / byProject / byPerson; byWeek + byRole are
 * uncapped (the chart axes handle natural counts).
 *
 * @param {!Array<!Object>} rows
 * @param {!Object} thresholds
 * @return {!Object}
 * @private
 */
function buildUtilizationAggregates_(rows, thresholds) {
  var byCustomerMap = {};
  var byProjectMap = {};
  var byPersonMap = {};
  var byRoleMap = {};
  var byWeekMap = {};

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];

    if (!byCustomerMap[r.customer]) {
      byCustomerMap[r.customer] = { name: r.customer, hours: 0, billableHours: 0, cost: 0 };
    }
    byCustomerMap[r.customer].hours += r.hours;
    byCustomerMap[r.customer].cost += r.cost;
    if (r.billable) {
      byCustomerMap[r.customer].billableHours += r.hours;
    }

    var pKey = r.projectId || ('name::' + r.projectName);
    if (!byProjectMap[pKey]) {
      byProjectMap[pKey] = {
        name: r.projectName,
        id: r.projectId || null,
        customer: r.customer,
        hours: 0,
        billableHours: 0,
        cost: 0,
      };
    }
    byProjectMap[pKey].hours += r.hours;
    byProjectMap[pKey].cost += r.cost;
    if (r.billable) {
      byProjectMap[pKey].billableHours += r.hours;
    }

    var personKey = r.userId || r.userName || '(Unknown user)';
    if (!byPersonMap[personKey]) {
      byPersonMap[personKey] = {
        name: r.userName,
        id: r.userId || null,
        hours: 0,
        billableHours: 0,
        cost: 0,
      };
    }
    byPersonMap[personKey].hours += r.hours;
    byPersonMap[personKey].cost += r.cost;
    if (r.billable) {
      byPersonMap[personKey].billableHours += r.hours;
    }

    var roleName = r.userRole || r.clockifyUserRole || '(No role)';
    if (!byRoleMap[roleName]) {
      byRoleMap[roleName] = { name: roleName, hours: 0, billableHours: 0 };
    }
    byRoleMap[roleName].hours += r.hours;
    if (r.billable) {
      byRoleMap[roleName].billableHours += r.hours;
    }

    if (r.week) {
      if (!byWeekMap[r.week]) {
        byWeekMap[r.week] = { week: r.week, hours: 0, billableHours: 0, nonBillableHours: 0 };
      }
      byWeekMap[r.week].hours += r.hours;
      if (r.billable) {
        byWeekMap[r.week].billableHours += r.hours;
      } else {
        byWeekMap[r.week].nonBillableHours += r.hours;
      }
    }
  }

  var byCustomer = sortByHoursDesc_(mapToArray_(byCustomerMap)).slice(0, thresholds.topNCustomers);
  var byProject = sortByHoursDesc_(mapToArray_(byProjectMap)).slice(0, thresholds.topNProjects);
  var byPerson = sortByHoursDesc_(mapToArray_(byPersonMap)).slice(0, thresholds.topNPersons);
  for (var pi = 0; pi < byPerson.length; pi++) {
    var bp = byPerson[pi];
    bp.utilizationPct = bp.hours > 0 ? (bp.billableHours / bp.hours) * 100 : 0;
  }
  var byRole = sortByHoursDesc_(mapToArray_(byRoleMap));
  var byWeek = mapToArray_(byWeekMap).sort(function (a, b) {
    return String(a.week).localeCompare(String(b.week));
  });
  var billableVsNonBillable = byWeek.map(function (w) {
    return {
      week: w.week,
      billable: w.billableHours,
      nonBillable: w.nonBillableHours,
    };
  });

  return {
    byCustomer: byCustomer,
    byProject: byProject,
    byPerson: byPerson,
    byRole: byRole,
    byWeek: byWeek,
    billableVsNonBillable: billableVsNonBillable,
  };
}

/**
 * Phase C — per-person × per-week aggregate that feeds the heatmap surface
 * and the under/over-utilized alert rules. Each entry carries the raw hours
 * (filterable downstream), the capacity-scaled utilization% for that week,
 * and a `partial` flag for weeks that overlap a range edge.
 *
 * Partial-week capacity is pro-rated by `(daysInRangeInWeek / 7)` so the
 * utilization% bucket stays honest (a 3-day week at 24 hrs reads as 100%,
 * not 60%). The alert rules ignore partial weeks entirely.
 *
 * Roles are recorded as a comma-joined string of distinct role names that
 * the person logged time under in that week — the client uses this to drive
 * the heatmap-local Role filter without re-aggregating from `rows`.
 *
 * @param {!Array<!Object>} rows
 * @param {!{start: string, end: string}} range
 * @param {!Object} thresholds
 * @return {!Array<!{
 *   personKey: string, personName: string, personId: ?string,
 *   week: string, weekStartIso: string, weekEndIso: string,
 *   hours: number, billableHours: number,
 *   capacityHours: number, utilizationPct: number,
 *   partial: boolean, partialFraction: number,
 *   isInternal: boolean,
 *   roles: !Array<string>,
 *   customers: !Array<string>
 * }>}
 * @private
 */
function buildByPersonWeek_(rows, range, thresholds) {
  var rangeStartMs = parseIsoMs_(range.start);
  var rangeEndMs = parseIsoMs_(range.end);
  var bucketMap = {};

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r.week) {
      continue;
    }
    var personKey = r.userId || r.userName || '(Unknown user)';
    var bucketKey = personKey + '|' + r.week;
    var b = bucketMap[bucketKey];
    if (!b) {
      var weekRange = isoWeekRange_(r.week);
      b = {
        personKey: personKey,
        personName: r.userName || personKey,
        personId: r.userId || null,
        week: r.week,
        weekStartIso: weekRange.startIso,
        weekEndIso: weekRange.endIso,
        hours: 0,
        billableHours: 0,
        capacityHours: thresholds.weeklyCapacityHours,
        utilizationPct: 0,
        partial: false,
        partialFraction: 1,
        // Flagged true if ANY contributing row was internal; the client
        // honors the global Internal-labor toggle by inspecting per-row
        // payloads, but we surface a hint here for tooltip use.
        isInternal: false,
        roleSet: {},
        customerSet: {},
      };
      if (rangeStartMs !== null && rangeEndMs !== null) {
        var ws = parseIsoMs_(weekRange.startIso);
        var we = parseIsoMs_(weekRange.endIso);
        if (ws !== null && we !== null) {
          var overlapStart = Math.max(ws, rangeStartMs);
          var overlapEnd = Math.min(we, rangeEndMs);
          var overlapMs = Math.max(0, overlapEnd - overlapStart);
          var weekMs = Math.max(1, we - ws);
          var fraction = overlapMs / weekMs;
          if (fraction < 0.999) {
            b.partial = true;
            b.partialFraction = fraction;
            b.capacityHours = thresholds.weeklyCapacityHours * fraction;
          }
        }
      }
      bucketMap[bucketKey] = b;
    }
    b.hours += Number(r.hours || 0);
    if (r.billable) {
      b.billableHours += Number(r.hours || 0);
    }
    if (r.isInternal) {
      b.isInternal = true;
    }
    var role = r.userRole || r.clockifyUserRole || '(No role)';
    if (role) {
      b.roleSet[role] = true;
    }
    if (r.customer) {
      b.customerSet[r.customer] = true;
    }
  }

  var out = [];
  for (var k in bucketMap) {
    if (!Object.prototype.hasOwnProperty.call(bucketMap, k)) {
      continue;
    }
    var e = bucketMap[k];
    e.utilizationPct = e.capacityHours > 0 ? (e.hours / e.capacityHours) * 100 : 0;
    e.roles = Object.keys(e.roleSet);
    e.customers = Object.keys(e.customerSet);
    delete e.roleSet;
    delete e.customerSet;
    out.push(e);
  }
  out.sort(function (a, b2) {
    if (a.personKey !== b2.personKey) {
      return String(a.personKey).localeCompare(String(b2.personKey));
    }
    return String(a.week).localeCompare(String(b2.week));
  });
  return out;
}

/** @private */
function parseIsoMs_(iso) {
  if (!iso) {
    return null;
  }
  try {
    var d = new Date(iso);
    var t = d.getTime();
    return isFinite(t) ? t : null;
  } catch (e) {
    return null;
  }
}

/**
 * Returns the inclusive Monday-anchored ISO range for an ISO week key
 * (e.g. '2026-W19' → start 2026-05-04T00:00:00Z, end 2026-05-11T00:00:00Z).
 *
 * @param {string} weekKey
 * @return {!{startIso: string, endIso: string}}
 * @private
 */
function isoWeekRange_(weekKey) {
  var m = /^(\d{4})-W(\d{2})$/.exec(String(weekKey));
  if (!m) {
    return { startIso: '', endIso: '' };
  }
  var year = parseInt(m[1], 10);
  var week = parseInt(m[2], 10);
  // ISO 8601: week 1 contains Jan 4. Find that, snap to the Monday.
  var jan4 = new Date(Date.UTC(year, 0, 4));
  var jan4Day = jan4.getUTCDay() || 7;
  var week1Monday = new Date(Date.UTC(year, 0, 4 - jan4Day + 1));
  var weekStart = new Date(week1Monday.getTime() + (week - 1) * 7 * 86400000);
  var weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
  return { startIso: weekStart.toISOString(), endIso: weekEnd.toISOString() };
}

/**
 * Collects rows where `isPending = true`, sorted by startDateTime desc.
 * Phase A only carries them in the payload for KPI math; Phase C surfaces
 * a dedicated widget. Caps at 500 entries to keep payload bounded.
 *
 * @param {!Array<!Object>} rows
 * @return {!Array<!Object>}
 * @private
 */
function collectPendingApprovals_(rows) {
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].isPending) {
      out.push(rows[i]);
    }
  }
  out.sort(function (a, b) {
    var aIso = a.startDateTime || '';
    var bIso = b.startDateTime || '';
    if (aIso === bIso) {
      return 0;
    }
    return aIso < bIso ? 1 : -1;
  });
  return out.slice(0, 500);
}

/* ------------------------------------------------------------------------- */
/* Date range resolution + helpers                                            */
/* ------------------------------------------------------------------------- */

/**
 * Resolves the request range against the configured default + max windows.
 * Both endpoints are emitted as full ISO datetimes so the Fibery `<` /  `>=`
 * predicates are unambiguous.
 *
 * @param {?string|undefined} rangeStart
 * @param {?string|undefined} rangeEnd
 * @param {!Date} now
 * @param {!Object} thresholds
 * @return {!{start: string, end: string, defaulted: boolean, clamped: boolean}}
 * @private
 */
function resolveRange_(rangeStart, rangeEnd, now, thresholds) {
  var defaulted = false;
  var clamped = false;
  var endDate = parseDateOrNull_(rangeEnd);
  if (!endDate) {
    endDate = now;
    if (!rangeStart) {
      defaulted = true;
    }
  }
  var startDate = parseDateOrNull_(rangeStart);
  if (!startDate) {
    startDate = new Date(endDate.getTime() - thresholds.defaultRangeDays * 86400000);
    if (!rangeEnd) {
      defaulted = true;
    }
  }
  if (startDate.getTime() > endDate.getTime()) {
    // Caller passed start > end — swap and flag as clamped so the client can
    // surface a non-fatal warning.
    var tmp = startDate;
    startDate = endDate;
    endDate = tmp;
    clamped = true;
  }
  var maxMs = thresholds.maxRangeDays * 86400000;
  if (endDate.getTime() - startDate.getTime() > maxMs) {
    startDate = new Date(endDate.getTime() - maxMs);
    clamped = true;
  }
  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    defaulted: defaulted,
    clamped: clamped,
  };
}

/** @private */
function parseDateOrNull_(iso) {
  if (!iso) {
    return null;
  }
  try {
    var d = new Date(iso);
    if (!isFinite(d.getTime())) {
      return null;
    }
    return d;
  } catch (e) {
    return null;
  }
}

/** @private */
function extractDayKey_(iso) {
  if (!iso) {
    return null;
  }
  var d = parseDateOrNull_(iso);
  if (!d) {
    return null;
  }
  var y = d.getUTCFullYear();
  var m = d.getUTCMonth() + 1;
  var dd = d.getUTCDate();
  return y + '-' + (m < 10 ? '0' + m : m) + '-' + (dd < 10 ? '0' + dd : dd);
}

/**
 * ISO-8601 Monday-anchored week key (e.g. `2026-W19`). Always computed in UTC
 * so the bucket is stable across server runs in different timezones.
 *
 * @param {?string} iso
 * @return {?string}
 * @private
 */
function extractIsoWeekKey_(iso) {
  if (!iso) {
    return null;
  }
  var d = parseDateOrNull_(iso);
  if (!d) {
    return null;
  }
  // Copy in UTC, snap to nearest Thursday (ISO week is the year containing
  // the Thursday of that week).
  var t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  var dayNum = t.getUTCDay() || 7; // Sun = 7
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  var yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  var weekNo = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return t.getUTCFullYear() + '-W' + (weekNo < 10 ? '0' + weekNo : weekNo);
}

/** @private */
function isBillableText_(v) {
  if (v === true) {
    return true;
  }
  if (v === false) {
    return false;
  }
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'yes' || s === 'y' || s === 'true' || s === '1';
}

/**
 * §U.7 pending-approval predicate.
 *
 * As of v1.14.1 the rule is:
 *   1. Explicit `approval = 'approved'`   → NEVER pending (regardless of
 *      `timeEntryStatus`). This was the v1.14.0 false-positive bug — many
 *      Clockify-synced rows are explicitly Approved but carry an empty
 *      `Time Entry Status`, which the previous logic interpreted as pending.
 *   2. Explicit `approval ∈ {unapproved, pending}` → pending.
 *   3. When approval is missing / unknown, only consider the row pending if
 *      `timeEntryStatus` *actively* says so (`not_submitted` or `pending`).
 *      A blank timeEntryStatus alone is NO LONGER pending.
 *
 * Net effect: a row with `approval = "Approved"` is treated as approved even
 * when the time-entry-status sync is incomplete; a row with no approval
 * metadata at all is treated as approved (safe default — false negatives
 * are visible in the Pending Approvals widget once Fibery flags them).
 *
 * @param {?string} approval
 * @param {?string} timeEntryStatus
 * @return {boolean}
 * @private
 */
function isPendingApproval_(approval, timeEntryStatus) {
  var a = String(approval == null ? '' : approval).trim().toLowerCase();
  var t = String(timeEntryStatus == null ? '' : timeEntryStatus).trim().toLowerCase();
  if (a === 'approved') {
    return false;
  }
  if (a === 'unapproved' || a === 'pending') {
    return true;
  }
  if (t === 'not_submitted' || t === 'pending') {
    return true;
  }
  return false;
}

/** @private */
function mapToArray_(o) {
  var out = [];
  for (var k in o) {
    if (Object.prototype.hasOwnProperty.call(o, k)) {
      out.push(o[k]);
    }
  }
  return out;
}

/** @private */
function sortByHoursDesc_(arr) {
  arr.sort(function (a, b) {
    return Number(b.hours || 0) - Number(a.hours || 0);
  });
  return arr;
}

/* ------------------------------------------------------------------------- */
/* Empty-state factories                                                      */
/* ------------------------------------------------------------------------- */

/** @private */
function emptyUtilizationKpis_() {
  return {
    totalHours: 0,
    billableHours: 0,
    nonBillableHours: 0,
    utilizationPct: 0,
    totalCost: 0,
    effectiveCostRate: 0,
    effectiveBillRate: null,
    effectiveBillRateCoverage: 0,
    pendingApprovalsCount: 0,
    distinctPersons: 0,
    distinctProjects: 0,
    distinctCustomers: 0,
    rowCount: 0,
  };
}

/** @private */
function emptyUtilizationDimensions_() {
  return { customers: [], projects: [], persons: [], roles: [] };
}

/** @private */
function emptyUtilizationAggregates_() {
  return {
    byCustomer: [],
    byProject: [],
    byPerson: [],
    byRole: [],
    byWeek: [],
    billableVsNonBillable: [],
    byPersonWeek: [],
  };
}

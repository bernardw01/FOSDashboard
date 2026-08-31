/**
 * PRD version 3.20.15 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 043: Services Summary (Delivery). Portfolio of active Services
 * agreements: customer filter, KPI cards, and plan-vs-actual table.
 */

/** @const {number} */
var SERVICES_SUMMARY_CACHE_SCHEMA_VERSION_ = 1;

/** @const {string} */
var SERVICES_SUMMARY_TYPE_NAME_ = 'services';

/**
 * @param {boolean=} forceRefresh
 * @return {!Object}
 */
function getServicesSummaryDashboardData(forceRefresh) {
  requireAuthForApi_();
  var agreementPayload = getAgreementDashboardDataInternal_(forceRefresh === true);
  var built = buildServicesSummaryPayloadFromAgreement_(agreementPayload);
  if (built.ok) {
    attachServicesSummaryHours_(built);
  }
  return built;
}

/**
 * Snapshot / Delivery hydrate: money KPIs from the Agreement payload only.
 *
 * @param {!Object} agreementPayload
 * @param {?string=} fetchedAtIso
 * @return {!Object}
 */
function buildServicesSummaryPayloadFromAgreement_(agreementPayload, fetchedAtIso) {
  var fetchedAt = fetchedAtIso || new Date().toISOString();
  var agrSource = (agreementPayload && agreementPayload.source) || 'fibery';
  var fromDrive = !!(agreementPayload && (agreementPayload.fromDrive || agrSource === 'drive-cache'));
  var cacheDateKey = (agreementPayload && agreementPayload.cacheDateKey) || null;
  var loadSource =
    (agreementPayload && agreementPayload.loadSource) ||
    (fromDrive ? 'drive-cache' : agrSource);

  if (!agreementPayload || agreementPayload.ok === false) {
    return {
      ok: false,
      source: agrSource,
      loadSource: loadSource,
      fromDrive: fromDrive,
      cacheDateKey: fromDrive ? cacheDateKey : null,
      fetchedAt: fetchedAt,
      cacheSchemaVersion: SERVICES_SUMMARY_CACHE_SCHEMA_VERSION_,
      ttlMinutes:
        (agreementPayload && agreementPayload.ttlMinutes) ||
        (typeof resolveAgreementCacheTtlMinutes_ === 'function'
          ? resolveAgreementCacheTtlMinutes_()
          : 10),
      rows: [],
      kpis: emptyServicesSummaryKpis_(),
      customers: [],
      message:
        (agreementPayload && agreementPayload.message) ||
        'Could not load Services Summary.',
      warnings: (agreementPayload && agreementPayload.warnings) || [],
    };
  }

  var thresholds =
    typeof getAgreementThresholds_ === 'function' ? getAgreementThresholds_() : { lowMargin: 35 };
  var filtersApplied =
    typeof resolveDeliveryFilters_ === 'function'
      ? resolveDeliveryFilters_()
      : { activeStates: [], excludeInternal: true };
  var now = new Date();
  var monthKey = ssCurrentMonthKey_(now);
  var todayIso = ssFormatDateOnlyIso_(now);

  var itemsByAgreement = agreementPayload.revenueItemsByAgreement || {};
  var agreements = agreementPayload.agreements || [];
  var rows = [];
  var customerSet = {};

  var kpis = emptyServicesSummaryKpis_();
  kpis.monthKey = monthKey;

  for (var i = 0; i < agreements.length; i++) {
    var a = agreements[i];
    if (!ssIsActiveServicesAgreement_(a, filtersApplied)) continue;
    var items = itemsByAgreement[a.id] || [];
    var plannedRevToDate = ssPlannedRevenueToDate_(a, items, todayIso);
    var actualRevToDate = Number(a.revRec || 0);
    var monthRoll = ssMonthRevenueRollup_(items, monthKey);
    kpis.scheduledThisMonth += monthRoll.scheduled;
    kpis.invoicedThisMonth += monthRoll.invoiced;
    if (ssIsLowMargin_(a, thresholds.lowMargin)) {
      kpis.lowMarginCount += 1;
    }
    var customer = a.customer && String(a.customer).trim() ? String(a.customer).trim() : '(Unknown)';
    customerSet[customer] = true;
    rows.push({
      id: a.id,
      name: a.name || '(Unnamed agreement)',
      customer: customer,
      assignedOwner:
        a.assignedOwner && String(a.assignedOwner).trim()
          ? String(a.assignedOwner).trim()
          : 'Unassigned',
      contractValue: Number(a.plannedRev || 0),
      plannedRevToDate: plannedRevToDate,
      actualRevToDate: actualRevToDate,
      plannedHoursToDate: null,
      actualHoursToDate: null,
      scheduledThisMonth: monthRoll.scheduled,
      invoicedThisMonth: monthRoll.invoiced,
      marginPct:
        a.margin === null || a.margin === undefined ? null : Number(a.margin),
      targetMarginPct:
        a.targetMargin === null || a.targetMargin === undefined
          ? null
          : Number(a.targetMargin),
      lowMargin: ssIsLowMargin_(a, thresholds.lowMargin),
      clockifyProjectId: null,
    });
  }

  kpis.activeEngagements = rows.length;
  rows.sort(function (x, y) {
    return Number(y.contractValue || 0) - Number(x.contractValue || 0);
  });
  var customers = Object.keys(customerSet);
  customers.sort(function (a, b) {
    return String(a).toLowerCase() < String(b).toLowerCase() ? -1 : 1;
  });

  return {
    ok: true,
    source: agrSource,
    loadSource: loadSource,
    fromDrive: fromDrive,
    cacheDateKey: cacheDateKey,
    fetchedAt: agreementPayload.fetchedAt || fetchedAt,
    cacheSchemaVersion: SERVICES_SUMMARY_CACHE_SCHEMA_VERSION_,
    ttlMinutes: agreementPayload.ttlMinutes || 10,
    asOf: todayIso,
    monthKey: monthKey,
    rows: rows,
    kpis: kpis,
    customers: customers,
    hoursSource: null,
    warnings: agreementPayload.warnings || [],
  };
}

/** @private */
function emptyServicesSummaryKpis_() {
  return {
    activeEngagements: 0,
    lowMarginCount: 0,
    scheduledThisMonth: 0,
    invoicedThisMonth: 0,
    monthKey: null,
  };
}

/**
 * @param {?Object} a
 * @param {!{ activeStates: !Array<string>, excludeInternal: boolean }} filters
 * @return {boolean}
 * @private
 */
function ssIsActiveServicesAgreement_(a, filters) {
  if (!a) return false;
  if (String(a.type || '').trim().toLowerCase() !== SERVICES_SUMMARY_TYPE_NAME_) {
    return false;
  }
  if (filters && filters.activeStates && filters.activeStates.length) {
    if (!a.state || filters.activeStates.indexOf(a.state) < 0) return false;
  } else if (a.state === 'Closed-Lost') {
    return false;
  }
  return true;
}

/**
 * Below Target Margin when present; otherwise below the portfolio low-margin
 * threshold (default 35%).
 * @param {!Object} a
 * @param {number} lowMarginFloor
 * @return {boolean}
 * @private
 */
function ssIsLowMargin_(a, lowMarginFloor) {
  var margin = a.margin === null || a.margin === undefined ? null : Number(a.margin);
  if (margin === null || !isFinite(margin)) return false;
  var target =
    a.targetMargin === null || a.targetMargin === undefined ? null : Number(a.targetMargin);
  if (target !== null && isFinite(target)) {
    return margin < target;
  }
  var floor = Number(lowMarginFloor);
  if (!isFinite(floor)) floor = 35;
  return margin < floor;
}

/**
 * Planned revenue through today: sum of milestone Target Amounts with
 * Target Date on or before today. If there are no dated milestones, use
 * elapsed duration * contract value.
 * @param {!Object} agreement
 * @param {!Array<!Object>} items
 * @param {string} todayIso
 * @return {number}
 * @private
 */
function ssPlannedRevenueToDate_(agreement, items, todayIso) {
  var sum = 0;
  var dated = 0;
  for (var i = 0; i < (items || []).length; i++) {
    var it = items[i];
    var td = it && it.targetDate ? String(it.targetDate).slice(0, 10) : '';
    if (!td) continue;
    dated += 1;
    if (td <= todayIso) {
      sum += Number(it.targetAmount || 0);
    }
  }
  if (dated > 0) return Math.round(sum * 100) / 100;
  var planned = Number(agreement.plannedRev || 0);
  var frac = ssElapsedDurationFraction_(agreement.durStart, agreement.durEnd, todayIso);
  if (frac == null) return planned;
  return Math.round(planned * frac * 100) / 100;
}

/**
 * @param {!Array<!Object>} items
 * @param {string} monthKey YYYY-MM
 * @return {{ scheduled: number, invoiced: number }}
 * @private
 */
function ssMonthRevenueRollup_(items, monthKey) {
  var scheduled = 0;
  var invoiced = 0;
  for (var i = 0; i < (items || []).length; i++) {
    var it = items[i];
    var targetKey = it && it.targetDate ? String(it.targetDate).slice(0, 7) : '';
    var actualKey = it && it.actualDate ? String(it.actualDate).slice(0, 7) : '';
    if (targetKey === monthKey) {
      scheduled += Number(it.targetAmount || 0);
    }
    if (it && it.recognized === true) {
      var invKey = actualKey || targetKey;
      if (invKey === monthKey) {
        var actual = Number(it.actualAmount || 0);
        invoiced += actual !== 0 ? actual : Number(it.targetAmount || 0);
      }
    }
  }
  return {
    scheduled: Math.round(scheduled * 100) / 100,
    invoiced: Math.round(invoiced * 100) / 100,
  };
}

/**
 * @param {?string} startIso
 * @param {?string} endIso
 * @param {string} todayIso
 * @return {?number} 0-1
 * @private
 */
function ssElapsedDurationFraction_(startIso, endIso, todayIso) {
  var s = startIso ? String(startIso).slice(0, 10) : '';
  var e = endIso ? String(endIso).slice(0, 10) : '';
  if (!s) return null;
  if (!e) e = todayIso;
  if (e < s) return null;
  if (todayIso <= s) return 0;
  if (todayIso >= e) return 1;
  var start = Date.parse(s + 'T00:00:00Z');
  var end = Date.parse(e + 'T00:00:00Z');
  var today = Date.parse(todayIso + 'T00:00:00Z');
  if (!isFinite(start) || !isFinite(end) || !isFinite(today) || end <= start) {
    return null;
  }
  return (today - start) / (end - start);
}

/** @private */
function ssCurrentMonthKey_(now) {
  return ssFormatDateOnlyIso_(now).slice(0, 7);
}

/** @private */
function ssFormatDateOnlyIso_(now) {
  var d = now || new Date();
  try {
    var tz = Session.getScriptTimeZone() || 'UTC';
    return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  } catch (e) {
    return String(d.toISOString()).slice(0, 10);
  }
}

/**
 * Attach planned / actual hours from Datastore allocations + labor mirror.
 * @param {!Object} payload
 * @private
 */
function attachServicesSummaryHours_(payload) {
  if (!payload || !payload.rows || !payload.rows.length) return;
  if (typeof isSupabaseConfigured_ !== 'function' || !isSupabaseConfigured_()) {
    payload.hoursSource = null;
    return;
  }
  var ids = [];
  var byId = {};
  for (var i = 0; i < payload.rows.length; i++) {
    ids.push(payload.rows[i].id);
    byId[payload.rows[i].id] = payload.rows[i];
  }
  var clockifyByAgreement = ssLoadClockifyProjectIds_(ids);
  var projectToAgreement = {};
  var projectIds = [];
  for (var a = 0; a < ids.length; a++) {
    var cid = clockifyByAgreement[ids[a]];
    if (!cid) continue;
    byId[ids[a]].clockifyProjectId = cid;
    projectToAgreement[cid] = ids[a];
    projectToAgreement[String(cid).toLowerCase()] = ids[a];
    projectIds.push(cid);
  }

  var plannedByAgreement = ssPlannedHoursToDateByAgreement_(ids);
  for (var p = 0; p < ids.length; p++) {
    if (plannedByAgreement[ids[p]] != null) {
      byId[ids[p]].plannedHoursToDate = Math.round(plannedByAgreement[ids[p]] * 10) / 10;
    }
  }

  var hoursRes = ssFetchActualHoursByClockifyProject_(projectIds, payload.asOf);
  payload.hoursSource = 'fos_labor_costs';
  if (!hoursRes.ok) {
    payload.warnings = (payload.warnings || []).concat([
      hoursRes.message || 'Could not read labor hours for Services Summary.',
    ]);
    return;
  }
  if (hoursRes.truncated) {
    payload.warnings = (payload.warnings || []).concat([
      'Labor hours page ceiling reached; actual hours may be incomplete.',
    ]);
    payload.partial = true;
  }
  var hoursByProject = hoursRes.byProject || {};
  for (var pk in hoursByProject) {
    if (!Object.prototype.hasOwnProperty.call(hoursByProject, pk)) continue;
    var aid = projectToAgreement[pk] || projectToAgreement[String(pk).toLowerCase()];
    if (aid && byId[aid]) {
      byId[aid].actualHoursToDate = Math.round(hoursByProject[pk] * 10) / 10;
    }
  }
}

/**
 * @param {!Array<string>} agreementIds
 * @return {!Object<string, string>}
 * @private
 */
function ssLoadClockifyProjectIds_(agreementIds) {
  var map = {};
  if (!agreementIds || !agreementIds.length) return map;
  var chunkSize = 40;
  for (var offset = 0; offset < agreementIds.length; offset += chunkSize) {
    var chunk = agreementIds.slice(offset, offset + chunkSize);
    var quoted = [];
    for (var q = 0; q < chunk.length; q++) {
      quoted.push('"' + String(chunk[q]).replace(/"/g, '') + '"');
    }
    var inList = '(' + quoted.join(',') + ')';
    var res = supabaseSelectAll_(
      'fos_agreements',
      { fibery_id: 'in.' + inList },
      'fibery_id,clockify_project_id'
    );
    if (!res.ok) continue;
    var rows = res.rows || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].fibery_id && rows[i].clockify_project_id) {
        map[rows[i].fibery_id] = String(rows[i].clockify_project_id);
      }
    }
  }
  return map;
}

/**
 * @param {!Array<string>} agreementIds
 * @return {!Object<string, number>}
 * @private
 */
function ssPlannedHoursToDateByAgreement_(agreementIds) {
  var map = {};
  if (!agreementIds || !agreementIds.length) return map;
  var todayIso = ssFormatDateOnlyIso_(new Date());
  var chunkSize = 20;
  for (var offset = 0; offset < agreementIds.length; offset += chunkSize) {
    var chunk = agreementIds.slice(offset, offset + chunkSize);
    var quoted = [];
    for (var q = 0; q < chunk.length; q++) {
      quoted.push('"' + String(chunk[q]).replace(/"/g, '') + '"');
    }
    var inList = '(' + quoted.join(',') + ')';
    var res = supabaseSelectAll_(
      'fos_resource_allocations',
      { agreement_id: 'in.' + inList },
      'agreement_id,allocated_hours,duration_start,duration_end'
    );
    if (!res.ok) continue;
    var rows = res.rows || [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var aid = r.agreement_id;
      if (!aid) continue;
      var hours = Number(r.allocated_hours || 0);
      if (!isFinite(hours) || hours <= 0) continue;
      var frac = ssElapsedDurationFraction_(r.duration_start, r.duration_end, todayIso);
      if (frac == null) frac = 1;
      map[aid] = (map[aid] || 0) + hours * frac;
    }
  }
  return map;
}

/**
 * @param {!Array<string>} projectIds
 * @param {string} asOfIso
 * @return {!{ ok: boolean, byProject?: !Object<string, number>, truncated?: boolean, message?: string }}
 * @private
 */
function ssFetchActualHoursByClockifyProject_(projectIds, asOfIso) {
  var byProject = {};
  if (!projectIds || !projectIds.length) {
    return { ok: true, byProject: byProject, truncated: false };
  }
  var endIso = String(asOfIso || ssFormatDateOnlyIso_(new Date())) + 'T23:59:59.999Z';
  var chunkSize = 25;
  var truncated = false;
  for (var offset = 0; offset < projectIds.length; offset += chunkSize) {
    var chunk = projectIds.slice(offset, offset + chunkSize);
    var quoted = [];
    for (var q = 0; q < chunk.length; q++) {
      quoted.push('"' + String(chunk[q]).replace(/"/g, '') + '"');
    }
    var res = supabaseSelectAll_(
      'fos_labor_costs',
      {
        project_id: 'in.(' + quoted.join(',') + ')',
        start_date_time: 'lte.' + endIso,
      },
      'project_id,clockify_hours,seconds,start_date_time'
    );
    if (!res.ok) {
      return {
        ok: false,
        message: res.message || 'fos_labor_costs query failed.',
      };
    }
    if (res.truncated) truncated = true;
    var rows = res.rows || [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var pid = row.project_id ? String(row.project_id) : '';
      if (!pid) continue;
      var h = Number(row.clockify_hours);
      if (!isFinite(h) && row.seconds != null) {
        h = Number(row.seconds) / 3600;
      }
      if (!isFinite(h)) h = 0;
      byProject[pid] = (byProject[pid] || 0) + h;
    }
  }
  return { ok: true, byProject: byProject, truncated: truncated };
}

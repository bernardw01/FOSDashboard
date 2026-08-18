/**
 * PRD version 3.7.5 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 037: Engagement Update quantitative snapshot builders. Supabase
 * only - no Fibery HTTP calls at read/render time (locked decision #7, #31).
 * Reuses the Delivery P&L Supabase builders in `supabasePanelBuilders.js`
 * (`buildDeliveryProjectMonthlyPnLFromSupabase_`,
 * `fetchAgreementContextForPnlFromSupabase_`,
 * `fetchResourceAllocationsForAgreementFromSupabase_`) for month-level
 * actuals and plan data, then layers on EAC, revenue, resource, and RAG
 * auto-suggest logic needed for the DEAP-aligned Engagement Update status
 * pack (see docs/features/037-engagement-review.md and the implementation
 * plan "Engagement Update metrics builder" section).
 *
 * Also lists Delivery In Progress agreements for the Engagement Update
 * project picker (Admin: all; else: owner_email match on `fos_agreements`).
 */

/** @const {number} Cost / Hours RAG green band, percent variance vs plan. */
var EU_VARIANCE_GREEN_PCT_ = 5;
/** @const {number} Cost / Hours RAG amber band, percent variance vs plan. */
var EU_VARIANCE_AMBER_PCT_ = 10;
/** @const {number} Margin RAG green band, percentage points vs plan. */
var EU_MARGIN_GREEN_PTS_ = 3;
/** @const {number} Margin RAG amber band, percentage points vs plan. */
var EU_MARGIN_AMBER_PTS_ = 6;

/* ------------------------------------------------------------------------- */
/* Small private helpers.                                                      */
/* ------------------------------------------------------------------------- */

/**
 * @param {?number} n
 * @param {number} decimals
 * @return {?number}
 * @private
 */
function euRound_(n, decimals) {
  if (n === null || n === undefined || n === '') return null;
  var num = Number(n);
  if (!isFinite(num)) return null;
  var factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
}

/** @private */
function euRound2_(n) {
  return euRound_(n, 2);
}

/** @private */
function euRound1_(n) {
  return euRound_(n, 1);
}

/**
 * @param {*} rows PostgREST JSON body (array, or non-array on error).
 * @return {!Array<!Object>}
 * @private
 */
function euRowsFromJson_(rows) {
  if (!rows) return [];
  if (Object.prototype.toString.call(rows) === '[object Array]') {
    return /** @type {!Array<!Object>} */ (rows);
  }
  return [];
}

/* ------------------------------------------------------------------------- */
/* Public helpers required by the Engagement Update spec.                     */
/* ------------------------------------------------------------------------- */

/**
 * Normalizes a reporting period into the first-of-month `YYYY-MM-01` form
 * the `fos_engagement_updates.reporting_period` column expects.
 *
 * @param {?string|!Date} period `YYYY-MM`, `YYYY-MM-DD`, or a `Date`.
 * @return {string} `YYYY-MM-01`, or `''` when `period` cannot be parsed.
 */
function euNormalizeReportingPeriod_(period) {
  if (!period) return '';
  if (Object.prototype.toString.call(period) === '[object Date]') {
    var d = /** @type {!Date} */ (period);
    if (isNaN(d.getTime())) return '';
    var y = d.getUTCFullYear();
    var m = d.getUTCMonth() + 1;
    return y + '-' + (m < 10 ? '0' + m : String(m)) + '-01';
  }
  var s = String(period).trim();
  var match = s.match(/^(\d{4})-(\d{2})/);
  if (!match) return '';
  return match[1] + '-' + match[2] + '-01';
}

/**
 * @param {?string} rag `green` | `amber` | `red` (case-insensitive).
 * @return {number} 0 (green) | 1 (amber) | 2 (red). Unknown values rank as green.
 */
function euRagRank_(rag) {
  var r = String(rag || '').trim().toLowerCase();
  if (r === 'red') return 2;
  if (r === 'amber' || r === 'yellow') return 1;
  return 0;
}

/**
 * Suggests a RAG + subtext from an actual-vs-planned variance. `opts.kind`
 * `'pct'` (default) compares percent-of-plan variance using the 5% / 10%
 * Cost-Hours bands; `'marginPts'` compares raw percentage-point variance
 * using the +/-3 / +/-6 margin bands.
 *
 * @param {?number} actual
 * @param {?number} planned
 * @param {{ kind?: string, label?: string }=} opts
 * @return {!{ rag: string, subtext: string }}
 */
function euSuggestRagFromVariance_(actual, planned, opts) {
  opts = opts || {};
  var kind = opts.kind === 'marginPts' ? 'marginPts' : 'pct';
  var label = opts.label || (kind === 'marginPts' ? 'Margin' : 'Variance');
  var a = actual === null || actual === undefined || actual === '' ? null : Number(actual);
  var p = planned === null || planned === undefined || planned === '' ? null : Number(planned);
  if (a === null || !isFinite(a) || p === null || !isFinite(p)) {
    return {
      rag: 'green',
      subtext: 'Not enough plan data for ' + label.toLowerCase() + ' variance.',
    };
  }
  var greenBand = kind === 'marginPts' ? EU_MARGIN_GREEN_PTS_ : EU_VARIANCE_GREEN_PCT_;
  var amberBand = kind === 'marginPts' ? EU_MARGIN_AMBER_PTS_ : EU_VARIANCE_AMBER_PCT_;
  var variance;
  var unit;
  if (kind === 'marginPts') {
    variance = a - p;
    unit = ' pts';
  } else if (p === 0) {
    variance = a === 0 ? 0 : 100;
    unit = '%';
  } else {
    variance = ((a - p) / Math.abs(p)) * 100;
    unit = '%';
  }
  var absVariance = Math.abs(variance);
  var rag = absVariance <= greenBand ? 'green' : absVariance <= amberBand ? 'amber' : 'red';
  var sign = variance >= 0 ? '+' : '';
  var subtext = label + ' ' + sign + euRound1_(variance) + unit + ' vs plan';
  return { rag: rag, subtext: subtext };
}

/**
 * Worst-of-dimension mapping: any dimension `red` -> `off_track`; any
 * (non-red) `amber` -> `at_risk`; otherwise `on_track`.
 *
 * @param {!Object<string, ?{ rag?: string }>} dims Keyed by dimension name.
 * @return {string} `on_track` | `at_risk` | `off_track`
 */
function euMapDimRagToOverall_(dims) {
  dims = dims || {};
  var worst = 0;
  var keys = Object.keys(dims);
  for (var i = 0; i < keys.length; i++) {
    var dim = dims[keys[i]];
    if (!dim) continue;
    var rank = euRagRank_(dim.rag);
    if (rank > worst) worst = rank;
  }
  if (worst >= 2) return 'off_track';
  if (worst >= 1) return 'at_risk';
  return 'on_track';
}

/* ------------------------------------------------------------------------- */
/* Quantitative snapshot builder.                                             */
/* ------------------------------------------------------------------------- */

/**
 * Sums logged hours from a P&L month's enriched `laborByPerson` rows
 * (`enrichMonthsLaborByPersonWithAllocations_` in `deliveryDashboard.js`).
 *
 * @param {?Object} month One entry of `buildDeliveryProjectMonthlyPnLFromSupabase_().months`.
 * @return {number}
 * @private
 */
function euActualHoursForMonth_(month) {
  if (!month || !month.laborByPerson) return 0;
  var total = 0;
  for (var i = 0; i < month.laborByPerson.length; i++) {
    total += Number(month.laborByPerson[i].hours || 0);
  }
  return total;
}

/**
 * Sums the calendar-day-prorated allocation hours already attached to a
 * P&L month's `laborByPerson` rows (`allocatedHours`).
 *
 * @param {?Object} month
 * @return {number}
 * @private
 */
function euPlannedHoursForMonth_(month) {
  if (!month || !month.laborByPerson) return 0;
  var total = 0;
  for (var i = 0; i < month.laborByPerson.length; i++) {
    total += Number(month.laborByPerson[i].allocatedHours || 0);
  }
  return total;
}

/**
 * @param {?Object} resourceAllocations `buildDeliveryProjectMonthlyPnLFromSupabase_().resourceAllocations`.
 * @param {string} monthKey `YYYY-MM`.
 * @return {?number} Prorated allocated cost for the month, or `null` when unavailable.
 * @private
 */
function euPlannedCostForMonth_(resourceAllocations, monthKey) {
  if (!resourceAllocations || !resourceAllocations.months) return null;
  var months = resourceAllocations.months;
  for (var i = 0; i < months.length; i++) {
    if (months[i] && months[i].key === monthKey) {
      return Number(months[i].allocatedCost || 0);
    }
  }
  return null;
}

/**
 * Scans a P&L month's `revenueItems` (attached by `buildMonthlyPnL_`) for
 * MTD invoiced/planned amounts, fiscal-year-to-date invoiced revenue, and
 * the next (or most overdue) un-recognized milestone.
 *
 * @param {!Array<!Object>} months
 * @param {string} periodMonthKey `YYYY-MM`.
 * @param {string} periodIso `YYYY-MM-01`.
 * @return {!Object}
 * @private
 */
function euBuildRevenueBlock_(months, periodMonthKey, periodIso) {
  var invoicedMtd = 0;
  var plannedMtd = 0;
  var invoicedFytd = 0;
  var fyPrefix = periodMonthKey.slice(0, 4);
  var nextMilestoneDate = null;
  var nextMilestoneAmount = null;
  var foundMonth = false;

  for (var i = 0; i < months.length; i++) {
    var m = months[i];
    var items = m.revenueItems || [];
    if (m.key === periodMonthKey) {
      foundMonth = true;
      for (var j = 0; j < items.length; j++) {
        var it = items[j];
        if (it.recognized === true) {
          invoicedMtd += Number(it.amount || 0);
        }
        plannedMtd += Number(it.targetAmount != null ? it.targetAmount : it.amount || 0);
      }
    }
    if (m.key.slice(0, 4) === fyPrefix && m.key <= periodMonthKey) {
      for (var k = 0; k < items.length; k++) {
        if (items[k].recognized === true) {
          invoicedFytd += Number(items[k].amount || 0);
        }
      }
    }
    for (var n = 0; n < items.length; n++) {
      var candidate = items[n];
      if (candidate.recognized === true) continue;
      var d = candidate.targetDate || candidate.actualDate;
      if (!d || d < periodIso) continue;
      if (nextMilestoneDate === null || d < nextMilestoneDate) {
        nextMilestoneDate = d;
        nextMilestoneAmount = Number(
          candidate.targetAmount != null ? candidate.targetAmount : candidate.amount || 0
        );
      }
    }
  }

  return {
    invoicedMtd: euRound2_(invoicedMtd),
    plannedMtd: foundMonth ? euRound2_(plannedMtd) : null,
    invoicedFytd: euRound2_(invoicedFytd),
    nextMilestoneDate: nextMilestoneDate,
    nextMilestoneAmount: nextMilestoneAmount !== null ? euRound2_(nextMilestoneAmount) : null,
  };
}

/**
 * Finds un-recognized revenue milestones with a target/actual date before
 * `periodIso` - a signal that a milestone should have landed by the
 * reporting period but has not (schedule RAG placeholder per the
 * implementation plan).
 *
 * @param {!Array<!Object>} months
 * @param {string} periodIso
 * @return {!{ count: number, earliestDate: ?string }}
 * @private
 */
function euFindOverdueMilestones_(months, periodIso) {
  var count = 0;
  var earliest = null;
  for (var i = 0; i < months.length; i++) {
    var items = months[i].revenueItems || [];
    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      if (it.recognized === true) continue;
      var d = it.targetDate || it.actualDate;
      if (!d || d >= periodIso) continue;
      count++;
      if (earliest === null || d < earliest) earliest = d;
    }
  }
  return { count: count, earliestDate: earliest };
}

/**
 * @param {!Array<!Object>} months
 * @param {string} periodIso
 * @return {!{ rag: string, subtext: string }}
 * @private
 */
function euSuggestScheduleRag_(months, periodIso) {
  var overdue = euFindOverdueMilestones_(months, periodIso);
  if (overdue.count > 0) {
    var rag = overdue.count > 1 ? 'red' : 'amber';
    return {
      rag: rag,
      subtext:
        overdue.count +
        ' milestone' +
        (overdue.count > 1 ? 's' : '') +
        ' overdue since ' +
        overdue.earliestDate +
        '.',
    };
  }
  return { rag: 'green', subtext: 'On plan' };
}

/**
 * Builds the read-only quantitative snapshot for one Engagement Update
 * (agreement + reporting period), frozen into `fos_engagement_updates`
 * at create and re-pulled on Refresh (locked decision #18). Supabase only.
 *
 * @param {string} agreementFiberyId `fos_agreements.fibery_id`.
 * @param {string|!Date} reportingPeriod `YYYY-MM`, `YYYY-MM-DD`, or `Date`.
 * @return {!{
 *   ok: boolean,
 *   message?: string,
 *   snapshot?: !Object,
 *   suggestedQualitative?: !Object,
 *   suggestedOverallRag?: string,
 *   agreement?: !Object,
 *   metricsPulledAt?: string
 * }}
 */
function buildEngagementUpdateQuantitativeSnapshot_(agreementFiberyId, reportingPeriod) {
  var agreementId = String(agreementFiberyId || '').trim();
  var metricsPulledAt = new Date().toISOString();
  if (!agreementId) {
    return { ok: false, message: 'Agreement id is required.' };
  }
  if (!isSupabaseConfigured_()) {
    return { ok: false, message: 'Datastore is not configured.' };
  }
  var period = euNormalizeReportingPeriod_(reportingPeriod);
  if (!period) {
    return { ok: false, message: 'Reporting period is required (YYYY-MM or YYYY-MM-DD).' };
  }
  var periodMonthKey = period.slice(0, 7);
  var warnings = [];

  var ctx = fetchAgreementContextForPnlFromSupabase_(agreementId);
  if (!ctx.ok) {
    return { ok: false, message: ctx.message || 'Could not load agreement from Supabase.' };
  }

  var pnl = buildDeliveryProjectMonthlyPnLFromSupabase_(agreementId, {});
  if (!pnl.ok) {
    return { ok: false, message: pnl.message || 'Could not build the Delivery P&L for this agreement.' };
  }
  if (pnl.warnings && pnl.warnings.length) {
    warnings = warnings.concat(pnl.warnings);
  }

  var metaRes = supabaseSelect_(
    'fos_agreements',
    { fibery_id: 'eq.' + agreementId },
    'fibery_id,name,customer_id,owner_email,owner_name,state_name,status',
    1
  );
  var meta = null;
  if (metaRes.ok) {
    meta = euRowsFromJson_(metaRes.json)[0] || null;
  } else {
    warnings.push('Could not load agreement owner/company details from Supabase.');
  }
  var companyName = null;
  if (meta && meta.customer_id) {
    var companiesMap = loadFosCompaniesMap_();
    var company = companiesMap[meta.customer_id];
    companyName = company ? stringOrNull_(company.name) : null;
  }

  var allocFetch = fetchResourceAllocationsForAgreementFromSupabase_(agreementId);
  var allocRows = allocFetch.ok ? allocFetch.rows || [] : [];
  var hasAllocationData = allocFetch.ok && allocRows.length > 0;
  if (!allocFetch.ok) {
    warnings.push('Could not load resource allocations: ' + (allocFetch.message || 'unknown error'));
  }

  var months = pnl.months || [];
  var monthByKey = {};
  for (var mi0 = 0; mi0 < months.length; mi0++) {
    if (months[mi0] && months[mi0].key) monthByKey[months[mi0].key] = months[mi0];
  }
  var currentMonth = monthByKey[periodMonthKey] || null;
  var plannedMarginPct = ctx.agreement.targetMargin;

  var hoursByMonth = [];
  var costByMonth = [];
  var marginByMonth = [];
  for (var mi = 0; mi < months.length; mi++) {
    var mm = months[mi];
    var actualH = euActualHoursForMonth_(mm);
    var plannedH = euPlannedHoursForMonth_(mm);
    hoursByMonth.push({
      month: mm.key,
      actual: euRound2_(actualH),
      planned: hasAllocationData ? euRound2_(plannedH) : null,
    });
    costByMonth.push({
      month: mm.key,
      actual: euRound2_(mm.labor),
      planned: euPlannedCostForMonth_(pnl.resourceAllocations, mm.key),
    });
    marginByMonth.push({
      month: mm.key,
      projectedPct: mm.marginPct === null || mm.marginPct === undefined ? null : euRound1_(mm.marginPct),
      plannedPct:
        plannedMarginPct === null || plannedMarginPct === undefined ? null : euRound1_(plannedMarginPct),
    });
  }

  var actualHoursMtd = euActualHoursForMonth_(currentMonth);
  var plannedHoursMtd = euPlannedHoursForMonth_(currentMonth);
  var actualCostMtd = currentMonth ? Number(currentMonth.labor || 0) : 0;
  var plannedCostMtd = euPlannedCostForMonth_(pnl.resourceAllocations, periodMonthKey);

  var hoursMtd = {
    actual: euRound2_(actualHoursMtd),
    planned: hasAllocationData ? euRound2_(plannedHoursMtd) : null,
    delta: hasAllocationData ? euRound2_(actualHoursMtd - plannedHoursMtd) : null,
  };
  var costMtd = {
    actual: euRound2_(actualCostMtd),
    planned: plannedCostMtd,
    delta: plannedCostMtd !== null ? euRound2_(actualCostMtd - plannedCostMtd) : null,
  };

  // Feature 040: shared EAC / projected margin (labor + expenses/ODC).
  var perf =
    typeof buildProjectPerformanceBlock_ === 'function'
      ? buildProjectPerformanceBlock_({
          months: months,
          resourceAllocations: pnl.resourceAllocations,
          targetMarginPct: plannedMarginPct,
          asOfMonthKey: periodMonthKey,
          assignments: (pnl.resourceAllocations && pnl.resourceAllocations.assignments) || [],
        })
      : null;
  var eacHours = perf
    ? perf.eacHours
    : { value: euRound2_(euActualHoursForMonth_(currentMonth)), budgeted: null };
  var eacDollars = perf
    ? perf.eacDollars
    : { value: null, budgeted: null, variancePct: null };

  var revenue = euBuildRevenueBlock_(months, periodMonthKey, period);

  var resources = [];
  if (currentMonth && currentMonth.laborByPerson) {
    for (var ri = 0; ri < currentMonth.laborByPerson.length; ri++) {
      var p = currentMonth.laborByPerson[ri];
      resources.push({
        name: p.name || '(Unknown user)',
        role: p.role || '(No role)',
        allocatedHrsMo: euRound2_(p.allocatedHours || 0),
        loggedHrsMo: euRound2_(p.hours || 0),
        pctAllocated: p.percentAllocated != null ? euRound1_(p.percentAllocated) : null,
        costMo: euRound2_(p.cost || 0),
        billable:
          p.allocatedAndBillable === true ? true : p.allocatedAndBillable === false ? false : null,
      });
    }
  }

  var snapshot = {
    reportingPeriod: period,
    metricsPulledAt: metricsPulledAt,
    hoursMtd: hoursMtd,
    costMtd: costMtd,
    eacHours: eacHours,
    eacDollars: eacDollars,
    hoursByMonth: hoursByMonth,
    costByMonth: costByMonth,
    marginByMonth: marginByMonth,
    revenue: revenue,
    resources: resources,
    warnings: warnings,
  };

  var costRag = euSuggestRagFromVariance_(costMtd.actual, costMtd.planned, { kind: 'pct', label: 'Cost' });
  var hoursRag = euSuggestRagFromVariance_(hoursMtd.actual, hoursMtd.planned, {
    kind: 'pct',
    label: 'Hours',
  });
  var costHoursRag = euRagRank_(costRag.rag) >= euRagRank_(hoursRag.rag) ? costRag : hoursRag;
  var costHoursSubtext;
  if (costMtd.planned !== null && hoursMtd.planned !== null) {
    costHoursSubtext = costRag.subtext + '; ' + hoursRag.subtext;
  } else if (costMtd.planned !== null) {
    costHoursSubtext = costRag.subtext;
  } else if (hoursMtd.planned !== null) {
    costHoursSubtext = hoursRag.subtext;
  } else {
    costHoursSubtext = 'Not enough plan data to compute cost/hours variance.';
  }

  var marginRag = euSuggestRagFromVariance_(
    currentMonth ? currentMonth.marginPct : null,
    plannedMarginPct,
    { kind: 'marginPts', label: 'Margin' }
  );

  var scheduleRag = euSuggestScheduleRag_(months, period);

  var suggestedQualitative = {
    schedule: { rag: scheduleRag.rag, subtext: scheduleRag.subtext, auto: true },
    cost_hours: { rag: costHoursRag.rag, subtext: costHoursSubtext, auto: true },
    margin: { rag: marginRag.rag, subtext: marginRag.subtext, auto: true },
    client_sentiment: { rag: 'green', subtext: 'Assumed strong', auto: true },
  };
  var suggestedOverallRag = euMapDimRagToOverall_(suggestedQualitative);

  var agreement = {
    fiberyId: agreementId,
    name: ctx.agreement.name,
    companyName: companyName,
    ownerEmail: meta ? stringOrNull_(meta.owner_email) : null,
    ownerName: meta ? stringOrNull_(meta.owner_name) : null,
    state: meta ? stringOrNull_(meta.state_name) || stringOrNull_(meta.status) : null,
  };

  return {
    ok: true,
    snapshot: snapshot,
    suggestedQualitative: suggestedQualitative,
    suggestedOverallRag: suggestedOverallRag,
    agreement: agreement,
    metricsPulledAt: metricsPulledAt,
  };
}

/* ------------------------------------------------------------------------- */
/* Engagement Update project picker.                                         */
/* ------------------------------------------------------------------------- */

/**
 * Lists agreements eligible for the Engagement Update project picker
 * (locked decisions #12 / #13): Admins see every `Delivery In Progress`
 * agreement; everyone else is limited to agreements where `owner_email`
 * matches their signed-in email. Supabase only.
 *
 * @param {{ email?: string, role?: string, team?: string }} auth
 * @return {!{ ok: boolean, message?: string, projects?: !Array<!Object> }}
 */
function listDeliveryInProgressProjectsForEngagementUpdate_(auth) {
  if (!isSupabaseConfigured_()) {
    return { ok: false, message: 'Datastore is not configured.' };
  }
  var isAdmin = isAdminUser_(auth);
  var filters = {
    or: '(state_name.eq."Delivery In Progress",status.eq."Delivery In Progress")',
  };
  if (!isAdmin) {
    var email =
      typeof normalizeEmail_ === 'function'
        ? normalizeEmail_((auth && auth.email) || '')
        : String((auth && auth.email) || '').trim().toLowerCase();
    if (!email) {
      return { ok: true, projects: [] };
    }
    filters.owner_email = 'eq.' + email;
  }
  var res = supabaseSelectAll_(
    'fos_agreements',
    filters,
    'fibery_id,name,customer_id,owner_email,owner_name,state_name,status',
    'name.asc'
  );
  if (!res.ok) {
    return { ok: false, message: res.message || 'Could not load Delivery In Progress agreements.' };
  }
  var companiesMap = loadFosCompaniesMap_();
  var rows = res.rows || [];
  var projects = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r || !r.fibery_id) continue;
    var company = r.customer_id ? companiesMap[r.customer_id] : null;
    projects.push({
      fiberyId: stringOr_(r.fibery_id, ''),
      name: stringOr_(r.name, '(Unnamed project)'),
      companyName: company ? stringOrNull_(company.name) : null,
      ownerEmail: stringOrNull_(r.owner_email),
      ownerName: stringOrNull_(r.owner_name),
      state: stringOrNull_(r.state_name) || stringOrNull_(r.status),
    });
  }
  return { ok: true, projects: projects };
}

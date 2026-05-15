/**
 * PRD version 1.27.3 — sync with docs/FOS-Dashboard-PRD.md
 *
 * Delivery Dashboard orchestrator (route id `delivery`, panel
 * `#panel-delivery`). Two public endpoints, both authorized via
 * `requireAuthForApi_()`:
 *
 *   getDeliveryDashboardData()
 *     Returns the active-projects list. Reuses the existing Agreement
 *     Dashboard payload (`getAgreementDashboardData()`) — no extra Fibery
 *     queries — and re-projects each agreement into a Delivery row with
 *     completion %, margin variance, and lifetime cost rollups precomputed.
 *
 *   getDeliveryProjectMonthlyPnL(agreementId)
 *     Returns a per-project monthly P&L time-series. Issues THREE small
 *     Fibery queries scoped to the single agreement (no date filter, full
 *     project lifetime):
 *       1. Labor Costs       — Cost + Start Date Time
 *       2. Other Direct Costs — Amount + Date + Status (Actual + Projected)
 *       3. Revenue Item       — Actual/Target Amount + Actual/Target Date
 *                               + Revenue Recognized + Name + workflow
 *                               state (recognized AND unrecognized;
 *                               Phase B FR-94 drives projected-month
 *                               support)
 *     Aggregates client-ready monthly rows {revenue, labor, expenses,
 *     totalCost, grossProfit, marginPct, marginBucket, outOfRange,
 *     hasActivity, projected, revenueItems[]}, plus a §M.9
 *     discrepancyCheck block comparing the summed totals to the
 *     agreement's lifetime fields.
 *
 *     Each month carries:
 *       - `projected: bool` — true when the month key is later than the
 *         current UTC month. Drives the "Projected" pill on the client
 *         and a distinct fill in the stacked-area chart view (FR-94).
 *       - `revenueItems: !Array<!Object>` — the milestone rows that
 *         contributed to the month's revenue, ready for the FR-95
 *         drill-down modal. Schema:
 *           { id, name, amount, recognized, targetDate, actualDate, state }
 *
 * Diagnostics (run from the Apps Script editor):
 *   _diag_sampleDeliveryPayload()
 *   _diag_sampleMonthlyPnL(agreementId)
 *
 * Required Script Properties (all optional; safe defaults baked in):
 *   DELIVERY_CACHE_TTL_MINUTES            default 10
 *   DELIVERY_ACTIVE_STATES                comma-separated whitelist; empty
 *                                         = use the default rule
 *                                         (state ≠ Closed-Lost)
 *   DELIVERY_EXCLUDE_INTERNAL             boolean (default true) — drop
 *                                         Agreement Type = Internal rows
 *   DELIVERY_PNL_INCLUDE_PROJECTED_ODC    boolean (default true in
 *                                         Phase B; opt out by setting
 *                                         to false to restrict ODC to
 *                                         Status = "Actual")
 *   DELIVERY_PNL_MAX_LABOR_ROWS           hard cap per project (default
 *                                         10000; set 0 for unlimited)
 */

/** @const {number} Bumped when the client cache shape changes. */
var DELIVERY_DASHBOARD_CACHE_SCHEMA_VERSION_ = 1;

/**
 * Per-project monthly P&L cache shape version.
 *   v1 — Phase A: { months, lifetime, discrepancyCheck, partial, capCounts }
 *   v2 — Phase B: above + monthly `projected` flag + per-month
 *        `revenueItems[]` for drill-down (FR-94 / FR-95).
 * @const {number}
 */
var DELIVERY_PNL_CACHE_SCHEMA_VERSION_ = 2;

/** @const {number} Default TTL (minutes) for the client-side cache. */
var DELIVERY_DEFAULT_CACHE_TTL_MIN_ = 10;

/** @const {string} */
var DELIVERY_CACHE_TTL_PROP_ = 'DELIVERY_CACHE_TTL_MINUTES';

/** @const {string} */
var DELIVERY_ACTIVE_STATES_PROP_ = 'DELIVERY_ACTIVE_STATES';

/** @const {string} */
var DELIVERY_EXCLUDE_INTERNAL_PROP_ = 'DELIVERY_EXCLUDE_INTERNAL';

/** @const {string} */
var DELIVERY_PNL_INCLUDE_PROJECTED_ODC_PROP_ = 'DELIVERY_PNL_INCLUDE_PROJECTED_ODC';

/** @const {string} */
var DELIVERY_PNL_MAX_LABOR_ROWS_PROP_ = 'DELIVERY_PNL_MAX_LABOR_ROWS';

/** @const {number} */
var DELIVERY_PNL_DEFAULT_MAX_LABOR_ROWS_ = 10000;

/** @const {number} Fibery /api/commands result cap per query. */
var DELIVERY_QUERY_LIMIT_ = 1000;

/**
 * Returns the configured default TTL (minutes) for the Delivery dashboard
 * client cache. Floored at 1 minute; falsy / non-positive values fall back
 * to the 10-minute default. The browser may override per-user via a
 * `localStorage` preference; this value is the seed.
 *
 * @return {number}
 */
function getDeliveryCacheTtlMinutes() {
  requireAuthForApi_();
  return resolveDeliveryCacheTtlMinutes_();
}

/**
 * Returns the Delivery Dashboard view model.
 * Re-checks spreadsheet authorization via `requireAuthForApi_()`.
 *
 * @return {{
 *   ok: boolean,
 *   source: string,
 *   fetchedAt: string,
 *   cacheSchemaVersion: number,
 *   ttlMinutes: number,
 *   projects: !Array<!Object>,
 *   filtersApplied: !Object,
 *   message?: string,
 *   warnings?: !Array<string>
 * }}
 */
function getDeliveryDashboardData() {
  requireAuthForApi_();

  var fetchedAtIso = new Date().toISOString();
  var ttlMinutes = resolveDeliveryCacheTtlMinutes_();

  // Reuse the Agreement Dashboard's already-normalized agreements list. The
  // existing function is idempotent and stateless server-side; it
  // re-fetches Fibery, which is the contract this codebase has consciously
  // chosen instead of a server-side cache.
  var raw;
  try {
    raw = getAgreementDashboardData();
  } catch (e) {
    return {
      ok: false,
      source: 'fibery',
      fetchedAt: fetchedAtIso,
      cacheSchemaVersion: DELIVERY_DASHBOARD_CACHE_SCHEMA_VERSION_,
      ttlMinutes: ttlMinutes,
      projects: [],
      filtersApplied: {},
      message: 'Could not load delivery data: ' + (e && e.message ? e.message : e),
      warnings: ['EXCEPTION'],
    };
  }
  if (!raw || raw.ok === false) {
    return {
      ok: false,
      source: 'fibery',
      fetchedAt: fetchedAtIso,
      cacheSchemaVersion: DELIVERY_DASHBOARD_CACHE_SCHEMA_VERSION_,
      ttlMinutes: ttlMinutes,
      projects: [],
      filtersApplied: {},
      message: (raw && raw.message) || 'Could not load delivery data from Fibery.',
      warnings: (raw && raw.warnings) || [],
    };
  }

  var thresholds = getAgreementThresholds_();
  var filtersApplied = resolveDeliveryFilters_();
  var projects = buildActiveProjects_(raw.agreements || [], thresholds, filtersApplied);

  return {
    ok: true,
    source: 'fibery',
    fetchedAt: raw.fetchedAt || fetchedAtIso,
    cacheSchemaVersion: DELIVERY_DASHBOARD_CACHE_SCHEMA_VERSION_,
    ttlMinutes: ttlMinutes,
    projects: projects,
    filtersApplied: filtersApplied,
  };
}

/**
 * Returns a per-project monthly P&L time-series.
 *
 * @param {string} agreementId Fibery UUID of the Agreement.
 * @return {{
 *   ok: boolean,
 *   source: string,
 *   fetchedAt: string,
 *   cacheSchemaVersion: number,
 *   agreementId: string,
 *   agreementName: ?string,
 *   currency: string,
 *   months: !Array<!Object>,
 *   lifetime: !Object,
 *   discrepancyCheck: !Object,
 *   partial: boolean,
 *   capCounts: !Object,
 *   message?: string,
 *   warnings?: !Array<string>
 * }}
 */
function getDeliveryProjectMonthlyPnL(agreementId) {
  requireAuthForApi_();
  var fetchedAtIso = new Date().toISOString();
  var emptyShell = {
    ok: false,
    source: 'fibery',
    fetchedAt: fetchedAtIso,
    cacheSchemaVersion: DELIVERY_PNL_CACHE_SCHEMA_VERSION_,
    agreementId: agreementId || '',
    agreementName: null,
    currency: 'USD',
    months: [],
    lifetime: emptyLifetime_(),
    discrepancyCheck: emptyDiscrepancy_(),
    partial: false,
    capCounts: { laborRowsRead: 0, laborRowCap: 0 },
  };
  if (!agreementId) {
    emptyShell.message = 'Missing agreementId.';
    return emptyShell;
  }

  // Fetch the agreement's contextual fields (target margin, duration,
  // lifetime totals) — used for §M.7 margin coloring and §M.9
  // reconciliation. A failure here is non-fatal; we render the grid
  // anyway with neutral coloring.
  var ctx = fetchAgreementContextForPnl_(agreementId);
  if (!ctx.ok) {
    emptyShell.message = ctx.message || 'Could not load agreement context.';
    emptyShell.warnings = [ctx.reason || 'AGREEMENT_CONTEXT_FAILED'];
    return emptyShell;
  }

  var maxLaborRows = resolveMaxLaborRows_();
  var laborFetch = fetchLaborCostsForAgreement_(agreementId, maxLaborRows);
  if (!laborFetch.ok) {
    emptyShell.agreementName = ctx.agreement.name;
    emptyShell.message = laborFetch.message || 'Could not load Labor Costs.';
    emptyShell.warnings = [laborFetch.reason || 'LABOR_FETCH_FAILED'];
    return emptyShell;
  }

  var odcFetch = fetchOtherDirectCostsForAgreement_(agreementId, resolveIncludeProjectedOdc_());
  if (!odcFetch.ok) {
    emptyShell.agreementName = ctx.agreement.name;
    emptyShell.message = odcFetch.message || 'Could not load Other Direct Costs.';
    emptyShell.warnings = [odcFetch.reason || 'ODC_FETCH_FAILED'];
    return emptyShell;
  }

  var revFetch = fetchRevenueItemsForAgreement_(agreementId);
  if (!revFetch.ok) {
    emptyShell.agreementName = ctx.agreement.name;
    emptyShell.message = revFetch.message || 'Could not load Revenue Items.';
    emptyShell.warnings = [revFetch.reason || 'REVENUE_FETCH_FAILED'];
    return emptyShell;
  }

  var thresholds = getAgreementThresholds_();
  var built = buildMonthlyPnL_({
    laborRows: laborFetch.rows,
    odcRows: odcFetch.rows,
    revenueRows: revFetch.rows,
    durStart: ctx.agreement.durStart,
    durEnd: ctx.agreement.durEnd,
    targetMarginPct: ctx.agreement.targetMargin,
    lifetimeLabor: ctx.agreement.laborCosts,
    lifetimeExpenses: ctx.agreement.materialsOdc,
    lifetimeMarginPct: ctx.agreement.margin,
    thresholds: thresholds,
  });

  return {
    ok: true,
    source: 'fibery',
    fetchedAt: fetchedAtIso,
    cacheSchemaVersion: DELIVERY_PNL_CACHE_SCHEMA_VERSION_,
    agreementId: agreementId,
    agreementName: ctx.agreement.name,
    currency: 'USD',
    months: built.months,
    lifetime: built.lifetime,
    discrepancyCheck: built.discrepancyCheck,
    partial: laborFetch.partial,
    capCounts: {
      laborRowsRead: laborFetch.rows.length,
      laborRowCap: maxLaborRows,
    },
  };
}

/* ------------------------------------------------------------------------- */
/* Diagnostics — run manually from the Apps Script editor.                    */
/* ------------------------------------------------------------------------- */

/**
 * Logs a 1-project sample of the Delivery payload. Helpful when a future
 * Fibery schema change (renamed `Total Labor Costs`, etc.) silently zeros
 * out the rollup numbers.
 * @return {!Object}
 */
function _diag_sampleDeliveryPayload() {
  var payload = getDeliveryDashboardData();
  var summary = {
    ok: payload.ok,
    projectCount: (payload.projects || []).length,
    filtersApplied: payload.filtersApplied,
    sample: (payload.projects || [])[0] || null,
    message: payload.message || null,
  };
  console.log('_diag_sampleDeliveryPayload →', JSON.stringify(summary).slice(0, 4000));
  return summary;
}

/**
 * Logs a 1-month summary of the monthly P&L for a given agreement id.
 * Useful for confirming Labor Costs / Other Direct Costs / Revenue Items
 * actually populate after a workspace edit.
 *
 * @param {string} agreementId
 * @return {!Object}
 */
function _diag_sampleMonthlyPnL(agreementId) {
  var p = getDeliveryProjectMonthlyPnL(agreementId);
  var months = p.months || [];
  var firstMonth = months.length ? months[0] : null;
  var lastMonth = months.length ? months[months.length - 1] : null;
  var summary = {
    ok: p.ok,
    agreementId: p.agreementId,
    agreementName: p.agreementName,
    monthCount: months.length,
    firstMonth: firstMonth,
    lastMonth: lastMonth,
    lifetime: p.lifetime,
    discrepancyCheck: p.discrepancyCheck,
    partial: p.partial,
    capCounts: p.capCounts,
    message: p.message || null,
  };
  console.log('_diag_sampleMonthlyPnL →', JSON.stringify(summary).slice(0, 4000));
  return summary;
}

/* ------------------------------------------------------------------------- */
/* Active Projects builder.                                                   */
/* ------------------------------------------------------------------------- */

/**
 * Re-projects the agreement list into Delivery rows.
 *
 * @param {!Array<!Object>} agreements Already normalized by `fiberyAgreementDashboard.js`.
 * @param {!Object} thresholds
 * @param {!{ activeStates: !Array<string>, excludeInternal: boolean }} filters
 * @return {!Array<!Object>}
 * @private
 */
function buildActiveProjects_(agreements, thresholds, filters) {
  var out = [];
  for (var i = 0; i < agreements.length; i++) {
    var a = agreements[i];
    if (!a) continue;
    if (filters.excludeInternal && a.type === 'Internal') continue;
    if (filters.activeStates.length) {
      if (!a.state || filters.activeStates.indexOf(a.state) < 0) continue;
    } else {
      // Default rule: anything that isn't `Closed-Lost` counts as active.
      // `getAgreementDashboardData` already filters Closed-Lost server-side,
      // so this is a defense-in-depth check.
      if (a.state === 'Closed-Lost') continue;
    }

    var planned = Number(a.plannedRev || 0);
    var revRec = Number(a.revRec || 0);
    var labor = Number(a.laborCosts || 0);
    var odc = Number(a.materialsOdc || 0);
    var completionPct = planned > 0 ? (revRec / planned) * 100 : null;
    var marginPct = a.margin === null || a.margin === undefined ? null : Number(a.margin);
    var targetMarginPct = a.targetMargin === null || a.targetMargin === undefined
      ? null : Number(a.targetMargin);
    var marginVariance = marginPct !== null && targetMarginPct !== null
      ? marginPct - targetMarginPct : null;

    var bucket = completionBucket_(completionPct, thresholds.completion);
    var varBucket = marginVarianceBucket_(marginPct, targetMarginPct, thresholds.marginVariance);

    out.push({
      id: a.id,
      name: a.name || '(Unnamed project)',
      customer: a.customer || '—',
      type: a.type || '—',
      state: a.state || '—',
      contractValue: planned,
      revenueRecognized: revRec,
      revenueOutstanding: Math.max(0, planned - revRec),
      completionPct: completionPct,
      completionBucket: bucket,
      completionColor: bucket === 'neutral'
        ? thresholds.workflowStateColorFallback
        : thresholds.completion.color[bucket] || thresholds.workflowStateColorFallback,
      laborCosts: labor,
      materialsOdc: odc,
      totalCost: labor + odc,
      marginPct: marginPct,
      targetMarginPct: targetMarginPct,
      marginVariance: marginVariance,
      marginVarianceBucket: varBucket,
      marginVarianceColor: thresholds.marginVariance.color[varBucket]
        || thresholds.marginVariance.color.neutral,
      durStart: a.durStart || null,
      durEnd: a.durEnd || null,
      executionDate: a.executionDate || null,
      stateColor: thresholds.workflowStateColor[a.state] || thresholds.workflowStateColorFallback,
      typeColor: thresholds.agreementTypeColor[a.type] || thresholds.agreementTypeColorFallback,
    });
  }
  // Default sort = Contract Value desc; client may resort.
  out.sort(function (x, y) {
    return Number(y.contractValue || 0) - Number(x.contractValue || 0);
  });
  return out;
}

/* ------------------------------------------------------------------------- */
/* Monthly P&L builder.                                                       */
/* ------------------------------------------------------------------------- */

/**
 * Aggregates raw lifetime Labor Costs + Other Direct Costs + Revenue Items
 * into a monthly time-series for one project.
 *
 * @param {!{
 *   laborRows: !Array<!Object>,
 *   odcRows: !Array<!Object>,
 *   revenueRows: !Array<!Object>,
 *   durStart: ?string,
 *   durEnd: ?string,
 *   targetMarginPct: ?number,
 *   lifetimeLabor: number,
 *   lifetimeExpenses: number,
 *   lifetimeMarginPct: ?number,
 *   thresholds: !Object
 * }} args
 * @return {!{ months: !Array<!Object>, lifetime: !Object, discrepancyCheck: !Object }}
 * @private
 */
function buildMonthlyPnL_(args) {
  var laborByMonth = {};
  var odcByMonth = {};
  var revenueByMonth = {};
  // Phase B (FR-94 / FR-95) — capture the contributing milestone rows
  // per month so the client can render the drill-down modal without a
  // second Fibery fetch.
  var revenueItemsByMonth = {};
  var activityMonths = {};

  // Labor cost: month-of-Start Date Time, sum Cost.
  var summedLabor = 0;
  var laborSkipped = 0;
  for (var i = 0; i < args.laborRows.length; i++) {
    var l = args.laborRows[i];
    var key = monthKeyFromIso_(l.startDateTime);
    if (!key) { laborSkipped++; continue; }
    var cost = Number(l.cost || 0);
    if (!isFinite(cost)) { laborSkipped++; continue; }
    laborByMonth[key] = (laborByMonth[key] || 0) + cost;
    activityMonths[key] = true;
    summedLabor += cost;
  }

  // Other Direct Costs (Materials & ODC): month-of-Date, sum Amount.
  // `fetchOtherDirectCostsForAgreement_` already filtered to the right
  // Status (Actual + Projected by default in Phase B).
  var summedExpenses = 0;
  for (var j = 0; j < args.odcRows.length; j++) {
    var o = args.odcRows[j];
    var keyO = monthKeyFromIso_(o.date);
    if (!keyO) continue;
    var amt = Number(o.amount || 0);
    if (!isFinite(amt)) continue;
    odcByMonth[keyO] = (odcByMonth[keyO] || 0) + amt;
    activityMonths[keyO] = true;
    summedExpenses += amt;
  }

  // Revenue Items: month-of-Actual Date (fallback Target Date), sum
  // Actual Amount (fallback Target Amount). Phase B (FR-94) lifted the
  // recognized-only filter so future-dated unrecognized milestones land
  // in projected months. The lifetime total now reflects both
  // recognized actuals and projected forward-revenue.
  var summedRevenue = 0;
  for (var k = 0; k < args.revenueRows.length; k++) {
    var r = args.revenueRows[k];
    var keyR = monthKeyFromIso_(r.actualDate || r.targetDate);
    if (!keyR) continue;
    var amount = (r.actualAmount !== null && r.actualAmount !== undefined && r.actualAmount !== '')
      ? Number(r.actualAmount)
      : Number(r.targetAmount || 0);
    if (!isFinite(amount)) continue;
    revenueByMonth[keyR] = (revenueByMonth[keyR] || 0) + amount;
    if (!revenueItemsByMonth[keyR]) revenueItemsByMonth[keyR] = [];
    revenueItemsByMonth[keyR].push({
      id: r.id,
      name: r.name,
      amount: amount,
      recognized: r.recognized === true,
      targetDate: r.targetDate,
      actualDate: r.actualDate,
      state: r.state,
    });
    activityMonths[keyR] = true;
    summedRevenue += amount;
  }

  // Resolve the month window: max(durStart-month, earliest-activity-month)
  // through min(today-month, durEnd-month). Activity outside that window
  // is still emitted with an `outOfRange: true` marker (§M.10).
  var allKeys = Object.keys(activityMonths);
  var minActivity = allKeys.length ? allKeys.slice().sort()[0] : null;
  var maxActivity = allKeys.length ? allKeys.slice().sort()[allKeys.length - 1] : null;
  var durStartMonth = monthKeyFromIso_(args.durStart);
  var durEndMonth = monthKeyFromIso_(args.durEnd);
  var todayMonth = monthKeyFromIso_(new Date().toISOString());

  var rangeStart = durStartMonth || minActivity || todayMonth;
  var rangeEndCandidates = [];
  if (durEndMonth) rangeEndCandidates.push(durEndMonth);
  if (todayMonth) rangeEndCandidates.push(todayMonth);
  if (maxActivity) rangeEndCandidates.push(maxActivity);
  var rangeEnd = rangeEndCandidates.length
    ? rangeEndCandidates.sort()[rangeEndCandidates.length - 1]
    : null;
  // Inclusive month iteration through whichever is smaller of today / durEnd
  // for the "primary" range. Months OUTSIDE [durStartMonth, durEndMonth]
  // with stray activity get OOR markers.
  var primaryEnd;
  if (durEndMonth && todayMonth) {
    primaryEnd = durEndMonth < todayMonth ? durEndMonth : todayMonth;
  } else if (durEndMonth) {
    primaryEnd = durEndMonth;
  } else if (todayMonth) {
    primaryEnd = todayMonth;
  } else {
    primaryEnd = maxActivity;
  }

  // Combine primary window with any activity months outside the window.
  var inRangeKeys = enumerateMonthKeys_(rangeStart, primaryEnd);
  var inRangeSet = {};
  for (var p = 0; p < inRangeKeys.length; p++) inRangeSet[inRangeKeys[p]] = true;
  var allMonthKeys = inRangeKeys.slice();
  for (var q = 0; q < allKeys.length; q++) {
    if (!inRangeSet[allKeys[q]]) allMonthKeys.push(allKeys[q]);
  }
  allMonthKeys.sort();

  // Emit one row per month. Phase B (FR-94) tags `projected` for months
  // later than the current UTC month so the client can pill them and
  // render the projected segments of the stacked-area chart with the
  // muted fill.
  var months = [];
  var lifetimeRevenue = 0;
  var lifetimeLabor = 0;
  var lifetimeExpenses = 0;
  for (var m = 0; m < allMonthKeys.length; m++) {
    var mk = allMonthKeys[m];
    var rev = Number(revenueByMonth[mk] || 0);
    var lab = Number(laborByMonth[mk] || 0);
    var exp = Number(odcByMonth[mk] || 0);
    var totalCost = lab + exp;
    var grossProfit = rev - totalCost;
    var marginPct = rev > 0 ? (grossProfit / rev) * 100 : null;
    var marginBucket = marginPct === null
      ? 'neutral'
      : marginVarianceBucket_(marginPct, args.targetMarginPct, args.thresholds.marginVariance);
    var oor = !inRangeSet[mk];
    var hasActivity = rev > 0 || lab > 0 || exp > 0;
    var monthItems = (revenueItemsByMonth[mk] || []).slice();
    months.push({
      key: mk,
      label: monthLabel_(mk),
      revenue: rev,
      labor: lab,
      expenses: exp,
      totalCost: totalCost,
      grossProfit: grossProfit,
      marginPct: marginPct,
      marginBucket: marginBucket,
      marginColor: args.thresholds.marginVariance.color[marginBucket]
        || args.thresholds.marginVariance.color.neutral,
      outOfRange: oor,
      hasActivity: hasActivity,
      projected: todayMonth ? mk > todayMonth : false,
      revenueItems: monthItems,
    });
    lifetimeRevenue += rev;
    lifetimeLabor += lab;
    lifetimeExpenses += exp;
  }

  // §M.8 Lifetime totals row (margin derived from the summed monthlies).
  var lifetimeTotalCost = lifetimeLabor + lifetimeExpenses;
  var lifetimeGrossProfit = lifetimeRevenue - lifetimeTotalCost;
  var lifetimeMarginDerived = lifetimeRevenue > 0
    ? (lifetimeGrossProfit / lifetimeRevenue) * 100
    : null;

  var lifetime = {
    revenue: lifetimeRevenue,
    labor: lifetimeLabor,
    expenses: lifetimeExpenses,
    totalCost: lifetimeTotalCost,
    grossProfit: lifetimeGrossProfit,
    marginPctDerived: lifetimeMarginDerived,
    marginPctFromAgreement: args.lifetimeMarginPct === null
      || args.lifetimeMarginPct === undefined ? null : Number(args.lifetimeMarginPct),
    laborSkipped: laborSkipped,
  };

  // §M.9 Discrepancy check — 5% threshold, per decision M.5.
  var discrepancyCheck = computeDiscrepancyCheck_({
    summedLabor: summedLabor,
    summedExpenses: summedExpenses,
    summedMarginPct: lifetimeMarginDerived,
    lifetimeLabor: Number(args.lifetimeLabor || 0),
    lifetimeExpenses: Number(args.lifetimeExpenses || 0),
    lifetimeMarginPct: args.lifetimeMarginPct,
  });

  return {
    months: months,
    lifetime: lifetime,
    discrepancyCheck: discrepancyCheck,
  };
}

/**
 * Returns {hasLaborDelta, hasExpensesDelta, hasMarginDelta} per the §M.9
 * 5% rule (M.5 decision). Numbers are returned alongside for tooltip
 * display.
 *
 * @param {!Object} args
 * @return {!Object}
 * @private
 */
function computeDiscrepancyCheck_(args) {
  var TOLERANCE_PCT = 5;
  function pctDelta(summed, lifetime) {
    var base = Math.abs(Number(lifetime || 0));
    if (!base) {
      // If the lifetime field is zero and the summed value is non-zero,
      // treat as "infinite" delta — surface the caption.
      return Number(summed || 0) === 0 ? 0 : Infinity;
    }
    return Math.abs(Number(summed || 0) - Number(lifetime || 0)) / base * 100;
  }
  var laborDelta = pctDelta(args.summedLabor, args.lifetimeLabor);
  var expensesDelta = pctDelta(args.summedExpenses, args.lifetimeExpenses);
  var marginPtsDelta = (args.summedMarginPct === null || args.summedMarginPct === undefined
    || args.lifetimeMarginPct === null || args.lifetimeMarginPct === undefined)
    ? 0
    : Math.abs(Number(args.summedMarginPct) - Number(args.lifetimeMarginPct));
  return {
    tolerancePct: TOLERANCE_PCT,
    summedLabor: Number(args.summedLabor || 0),
    lifetimeLabor: Number(args.lifetimeLabor || 0),
    laborDeltaPct: laborDelta === Infinity ? null : Math.round(laborDelta * 10) / 10,
    hasLaborDelta: laborDelta > TOLERANCE_PCT,
    summedExpenses: Number(args.summedExpenses || 0),
    lifetimeExpenses: Number(args.lifetimeExpenses || 0),
    expensesDeltaPct: expensesDelta === Infinity ? null : Math.round(expensesDelta * 10) / 10,
    hasExpensesDelta: expensesDelta > TOLERANCE_PCT,
    summedMarginPct: args.summedMarginPct === null || args.summedMarginPct === undefined
      ? null : Number(args.summedMarginPct),
    lifetimeMarginPct: args.lifetimeMarginPct === null || args.lifetimeMarginPct === undefined
      ? null : Number(args.lifetimeMarginPct),
    marginPtsDelta: Math.round(marginPtsDelta * 10) / 10,
    hasMarginDelta: marginPtsDelta > TOLERANCE_PCT,
  };
}

/* ------------------------------------------------------------------------- */
/* Per-agreement Fibery fetchers.                                              */
/* ------------------------------------------------------------------------- */

/**
 * Fetches the agreement's contextual fields needed for the P&L (target
 * margin, duration, lifetime rollups). Single small query.
 *
 * @param {string} agreementId
 * @return {!{ ok: true, agreement: !Object }|!{ ok: false, reason: string, message: string }}
 * @private
 */
function fetchAgreementContextForPnl_(agreementId) {
  var q = {
    query: {
      'q/from': 'Agreement Management/Agreements',
      'q/select': {
        id: 'fibery/id',
        name: 'Agreement Management/Name',
        plannedRev: 'Agreement Management/Total Planned Revenue',
        revRec: 'Agreement Management/Rev Recognized',
        laborCosts: 'Agreement Management/Total Labor Costs',
        materialsOdc: 'Agreement Management/Total Materials & ODC',
        margin: 'Agreement Management/Current Margin',
        targetMargin: 'Agreement Management/Target Margin',
        duration: 'Agreement Management/Duration',
        executionDate: 'Agreement Management/Execution Date',
      },
      'q/where': ['=', ['fibery/id'], '$agreementId'],
      'q/limit': 1,
    },
    params: { $agreementId: agreementId },
  };
  var r = fiberyQuery_(q);
  if (!r.ok) return r;
  var row = (r.rows && r.rows[0]) || null;
  if (!row) {
    return { ok: false, reason: 'AGREEMENT_NOT_FOUND', message: 'Agreement not found in Fibery.' };
  }
  var dur = row.duration && typeof row.duration === 'object' ? row.duration : null;
  return {
    ok: true,
    agreement: {
      id: stringOr_(row.id, agreementId),
      name: stringOr_(row.name, '(Unnamed project)'),
      plannedRev: numberOr_(row.plannedRev, 0),
      revRec: numberOr_(row.revRec, 0),
      laborCosts: numberOr_(row.laborCosts, 0),
      materialsOdc: numberOr_(row.materialsOdc, 0),
      margin: scaleFractionToPercent_(row.margin),
      targetMargin: scaleFractionToPercent_(row.targetMargin),
      durStart: dur ? stringOrNull_(dur.start) : null,
      durEnd: dur ? stringOrNull_(dur.end) : null,
      executionDate: stringOrNull_(row.executionDate),
    },
  };
}

/**
 * Fetches all Labor Cost rows for one agreement (full lifetime, paginated).
 *
 * @param {string} agreementId
 * @param {number} maxRows  Hard cap; `0` = unlimited.
 * @return {!{ ok: true, rows: !Array<!Object>, partial: boolean }|
 *          !{ ok: false, reason: string, message: string }}
 * @private
 */
function fetchLaborCostsForAgreement_(agreementId, maxRows) {
  var rows = [];
  var offset = 0;
  var partial = false;
  // The Fibery REST API caps a single result page at 1000 rows; loop until
  // we drain or hit the configured ceiling.
  while (true) {
    var q = {
      query: {
        'q/from': 'Agreement Management/Labor Costs',
        'q/select': {
          id: 'fibery/id',
          cost: 'Agreement Management/Cost',
          startDateTime: 'Agreement Management/Start Date Time',
        },
        'q/where': ['=', ['Agreement Management/Agreement', 'fibery/id'], '$agreementId'],
        'q/order-by': [[['Agreement Management/Start Date Time'], 'q/asc']],
        'q/limit': DELIVERY_QUERY_LIMIT_,
        'q/offset': offset,
      },
      params: { $agreementId: agreementId },
    };
    var r = fiberyQuery_(q);
    if (!r.ok) return r;
    var page = r.rows || [];
    for (var i = 0; i < page.length; i++) {
      rows.push({
        id: stringOr_(page[i].id, ''),
        cost: numberOr_(page[i].cost, 0),
        startDateTime: stringOrNull_(page[i].startDateTime),
      });
      if (maxRows && rows.length >= maxRows) {
        partial = true;
        break;
      }
    }
    if (partial) break;
    if (page.length < DELIVERY_QUERY_LIMIT_) break;
    offset += DELIVERY_QUERY_LIMIT_;
  }
  return { ok: true, rows: rows, partial: partial };
}

/**
 * Fetches Other Direct Costs rows for one agreement (full lifetime).
 *
 * @param {string} agreementId
 * @param {boolean} includeProjected  When false, restrict to Status=Actual.
 * @return {!{ ok: true, rows: !Array<!Object> }|
 *          !{ ok: false, reason: string, message: string }}
 * @private
 */
function fetchOtherDirectCostsForAgreement_(agreementId, includeProjected) {
  var whereClause = ['=', ['Agreement Management/Engagement', 'fibery/id'], '$agreementId'];
  if (!includeProjected) {
    whereClause = [
      'q/and',
      whereClause,
      ['=', ['Agreement Management/Status', 'enum/name'], '$actual'],
    ];
  }
  var q = {
    query: {
      'q/from': 'Agreement Management/Other Direct Costs',
      'q/select': {
        id: 'fibery/id',
        amount: 'Agreement Management/Amount',
        date: 'Agreement Management/Date',
        status: ['Agreement Management/Status', 'enum/name'],
        type: ['Agreement Management/Type', 'enum/name'],
      },
      'q/where': whereClause,
      'q/order-by': [[['Agreement Management/Date'], 'q/asc']],
      'q/limit': DELIVERY_QUERY_LIMIT_,
    },
    params: includeProjected
      ? { $agreementId: agreementId }
      : { $agreementId: agreementId, $actual: 'Actual' },
  };
  var r = fiberyQuery_(q);
  if (!r.ok) return r;
  var page = r.rows || [];
  var rows = [];
  for (var i = 0; i < page.length; i++) {
    rows.push({
      id: stringOr_(page[i].id, ''),
      amount: numberOr_(page[i].amount, 0),
      date: stringOrNull_(page[i].date),
      status: stringOrNull_(page[i].status),
      type: stringOrNull_(page[i].type),
    });
  }
  return { ok: true, rows: rows };
}

/**
 * Fetches ALL Revenue Items for one agreement (recognized and
 * unrecognized). Phase B (FR-94) widened this from the Phase A
 * recognized-only fetch so future-dated milestones surface in projected
 * months. The `recognized` flag and workflow `state` are returned per
 * row so the client can render the drill-down modal (FR-95) with the
 * same fidelity as the Agreement Dashboard's milestones modal.
 *
 * @param {string} agreementId
 * @return {!{ ok: true, rows: !Array<!Object> }|
 *          !{ ok: false, reason: string, message: string }}
 * @private
 */
function fetchRevenueItemsForAgreement_(agreementId) {
  var q = {
    query: {
      'q/from': 'Agreement Management/Revenue Item',
      'q/select': {
        id: 'fibery/id',
        name: 'Agreement Management/Name',
        targetAmount: 'Agreement Management/Target Amount',
        actualAmount: 'Agreement Management/Actual Amount',
        targetDate: 'Agreement Management/Target Date',
        actualDate: 'Agreement Management/Actual Date',
        recognized: 'Agreement Management/Revenue Recognized',
        state: ['workflow/state', 'enum/name'],
      },
      'q/where': ['=', ['Agreement Management/Agreement', 'fibery/id'], '$agreementId'],
      'q/order-by': [[['Agreement Management/Target Date'], 'q/asc']],
      'q/limit': DELIVERY_QUERY_LIMIT_,
    },
    params: { $agreementId: agreementId },
  };
  var r = fiberyQuery_(q);
  if (!r.ok) return r;
  var page = r.rows || [];
  var rows = [];
  for (var i = 0; i < page.length; i++) {
    rows.push({
      id: stringOr_(page[i].id, ''),
      name: stringOr_(page[i].name, '(Unnamed milestone)'),
      targetAmount: numberOr_(page[i].targetAmount, 0),
      actualAmount: numberOr_(page[i].actualAmount, 0),
      targetDate: stringOrNull_(page[i].targetDate),
      actualDate: stringOrNull_(page[i].actualDate),
      recognized: page[i].recognized === true,
      state: stringOrNull_(page[i].state),
    });
  }
  return { ok: true, rows: rows };
}

/* ------------------------------------------------------------------------- */
/* Script Property resolvers.                                                  */
/* ------------------------------------------------------------------------- */

/** @private */
function resolveDeliveryCacheTtlMinutes_() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(DELIVERY_CACHE_TTL_PROP_);
  var n = parseFloat(String(raw || '').trim());
  if (!isFinite(n) || n <= 0) {
    return DELIVERY_DEFAULT_CACHE_TTL_MIN_;
  }
  return Math.max(1, Math.round(n));
}

/**
 * @return {!{ activeStates: !Array<string>, excludeInternal: boolean }}
 * @private
 */
function resolveDeliveryFilters_() {
  var props = PropertiesService.getScriptProperties();
  var activeStates = parseCsvList_(props.getProperty(DELIVERY_ACTIVE_STATES_PROP_));
  var excludeInternal = parseBoolean_(props.getProperty(DELIVERY_EXCLUDE_INTERNAL_PROP_), true);
  return { activeStates: activeStates, excludeInternal: excludeInternal };
}

/**
 * Phase B (FR-94) flipped the default to `true` so projected ODC rows
 * appear in the monthly P&L by default. Operators can opt out by setting
 * `DELIVERY_PNL_INCLUDE_PROJECTED_ODC = false` in Script Properties.
 * @private
 */
function resolveIncludeProjectedOdc_() {
  return parseBoolean_(
    PropertiesService.getScriptProperties().getProperty(DELIVERY_PNL_INCLUDE_PROJECTED_ODC_PROP_),
    true
  );
}

/** @private */
function resolveMaxLaborRows_() {
  var raw = PropertiesService.getScriptProperties().getProperty(DELIVERY_PNL_MAX_LABOR_ROWS_PROP_);
  var n = parseFloat(String(raw || '').trim());
  if (!isFinite(n) || n < 0) {
    return DELIVERY_PNL_DEFAULT_MAX_LABOR_ROWS_;
  }
  if (n === 0) return 0;
  return Math.round(n);
}

/* ------------------------------------------------------------------------- */
/* Helpers.                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * @param {?string} iso  yyyy-mm-dd or yyyy-mm-ddTHH:MM:SSZ
 * @return {?string}     "yyyy-mm" or null
 * @private
 */
function monthKeyFromIso_(iso) {
  if (!iso) return null;
  var s = String(iso);
  if (s.length < 7) return null;
  // Defensive: bail on values that don't look like a date.
  if (!/^\d{4}-\d{2}/.test(s)) return null;
  return s.slice(0, 7);
}

/**
 * Returns an inclusive list of yyyy-mm keys from `startKey` through
 * `endKey`. Empty when either bound is missing or `start > end`.
 *
 * @param {?string} startKey
 * @param {?string} endKey
 * @return {!Array<string>}
 * @private
 */
function enumerateMonthKeys_(startKey, endKey) {
  if (!startKey || !endKey) return [];
  if (startKey > endKey) return [];
  var out = [];
  var y = parseInt(startKey.slice(0, 4), 10);
  var m = parseInt(startKey.slice(5, 7), 10);
  var endY = parseInt(endKey.slice(0, 4), 10);
  var endM = parseInt(endKey.slice(5, 7), 10);
  if (!isFinite(y) || !isFinite(m) || !isFinite(endY) || !isFinite(endM)) return [];
  while (y < endY || (y === endY && m <= endM)) {
    out.push(y + '-' + (m < 10 ? '0' + m : m));
    m++;
    if (m > 12) { m = 1; y++; }
    // Hard ceiling to prevent runaway loops on bad data.
    if (out.length > 600) break;
  }
  return out;
}

/**
 * Pretty label for a yyyy-mm key. e.g. "2026-05" → "May 2026".
 *
 * @param {string} key
 * @return {string}
 * @private
 */
function monthLabel_(key) {
  if (!key || key.length < 7) return String(key || '');
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var y = key.slice(0, 4);
  var m = parseInt(key.slice(5, 7), 10);
  var name = (m >= 1 && m <= 12) ? MONTHS[m - 1] : key.slice(5, 7);
  return name + ' ' + y;
}

/** @private */
function emptyLifetime_() {
  return {
    revenue: 0, labor: 0, expenses: 0,
    totalCost: 0, grossProfit: 0,
    marginPctDerived: null,
    marginPctFromAgreement: null,
    laborSkipped: 0,
  };
}

/** @private */
function emptyDiscrepancy_() {
  return {
    tolerancePct: 5,
    summedLabor: 0, lifetimeLabor: 0, laborDeltaPct: 0, hasLaborDelta: false,
    summedExpenses: 0, lifetimeExpenses: 0, expensesDeltaPct: 0, hasExpensesDelta: false,
    summedMarginPct: null, lifetimeMarginPct: null, marginPtsDelta: 0, hasMarginDelta: false,
  };
}

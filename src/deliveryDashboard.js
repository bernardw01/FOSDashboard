/**
 * PRD version 3.10.1 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Delivery Dashboard orchestrator (route id `pm-overview`, panel
 * `#panel-pm-overview`). Public endpoints, all authorized via
 * `requireAuthForApi_()`:
 *
 *   getDeliveryDashboardData(forceRefresh?)
 *     Returns the active-projects list. Reuses Agreement via
 *     `getAgreementDashboardData` (Drive warm cache or Fibery; feature 034)
 *     and re-projects each agreement into a Delivery row with
 *     completion %, margin variance, and lifetime cost rollups precomputed.
 *     Propagates Agreement `source` / `loadSource` / `fromDrive` /
 *     `cacheDateKey` for FR-120 labels.
 *
 *   getDeliveryDashboardDataFromAgreementPayload(agreementPayload)
 *     Thin RPC: auth + validate browser Agreement JSON, then
 *     `buildDeliveryDashboardPayloadFromAgreement_` with no Fibery.
 *     Returns `{ ok: false, fallback: true }` when unsafe / too large
 *     so the client can fall back to `getDeliveryDashboardData`.
 *
 *   getDeliveryProjectPersonTimeEntries({ agreementId, personName, personRole, startMonth, endMonth })
 *     Feature 045: on-demand daily hours/cost for one person on one agreement
 *     from `fos_labor_costs` (does not enlarge the P&L payload).
 *
 *   getDeliveryProjectMonthlyPnL(agreementId)
 *     Returns a per-project monthly P&L time-series. Issues THREE small
 *     Fibery queries scoped to the single agreement (no date filter, full
 *     project lifetime):
 *       1. Labor Costs       - Cost + Start Date Time + User Role
 *       2. Other Direct Costs - Amount + Date + Status (Actual + Projected)
 *       3. Revenue Item       - Actual/Target Amount + Actual/Target Date
 *                               + Revenue Recognized + Name + workflow
 *                               state (recognized AND unrecognized;
 *                               Phase B FR-94 drives projected-month
 *                               support)
 *     Aggregates client-ready monthly rows {revenue, labor, expenses,
 *     totalCost, grossProfit, marginPct, marginBucket, outOfRange,
 *     hasActivity, projected, revenueItems[]}, plus a Section M.9
 *     discrepancyCheck block comparing the summed totals to the
 *     agreement's lifetime fields.
 *
 *     Each month carries:
 *       - `projected: bool` - true when the month key is later than the
 *         current UTC month. Drives the "Projected" pill on the client
 *         and a distinct fill in the stacked-area chart view (FR-94).
 *       - `revenueItems: !Array<!Object>` - the milestone rows that
 *         contributed to the month's revenue, ready for the FR-95
 *         drill-down modal. Schema:
 *           { id, name, amount, targetAmount, recognized, targetDate,
 *             actualDate, state }
 *
 *     `lifetime` includes `revenue` (actual + forecast),
 *     `revenueRecognized`, and `revenueForecast` (v2.6.2).
 *     `laborRoles: !Array<string>` + per-month `laborByRole` map (v2.6.8).
 *     `statusUpdates: { latest, history, statusOptions }` (v2.12.5 / feature 018).
 *     `resourceAllocations: { hasAllocations, rowCount, months?, lifetimeAllocatedCost?,
 *       emptyMessage?, assignments? }` (v2.12.6 / feature 019); per-month `allocatedByRole`
 *       (v2.12.9 / 020); `assignments[]` detail rows (v2.15.10 / 024; v2.15.12 adds roleName).
 *     `cacheSchemaVersion: 10` (client key suffix `_v10`; v2.15.12 adds assignments[].roleName).
 *
 * Diagnostics (run from the Apps Script editor):
 *   _diag_sampleDeliveryPayload()
 *   _diag_sampleMonthlyPnL(agreementId)
 *
 * Required Script Properties (all optional; safe defaults baked in):
 *   DELIVERY_CACHE_TTL_MINUTES            default 10
 *   DELIVERY_ACTIVE_STATES                comma-separated whitelist; empty
 *                                         = use the default rule
 *                                         (state â‰  Closed-Lost)
 *   DELIVERY_EXCLUDE_INTERNAL             boolean (default true) - drop
 *                                         Agreement Type = Internal rows
 *   DELIVERY_PNL_INCLUDE_PROJECTED_ODC    boolean (default true in
 *                                         Phase B; opt out by setting
 *                                         to false to restrict ODC to
 *                                         Status = "Actual")
 *   DELIVERY_PNL_MAX_LABOR_ROWS           hard cap per project (default
 *                                         10000; set 0 for unlimited)
 */

/** @const {number} Bumped when the client cache shape changes. */
var DELIVERY_DASHBOARD_CACHE_SCHEMA_VERSION_ = 2;

/**
 * Per-project monthly P&L cache shape version.
 *   v1 - Phase A: { months, lifetime, discrepancyCheck, partial, capCounts }
 *   v2 - Phase B: above + monthly `projected` flag + per-month
 *        `revenueItems[]` for drill-down (FR-94 / FR-95).
 *   v3 - v2.6.2: forecast revenue in projected months.
 *   v4 - v2.6.8: per-month `laborByRole` + payload `laborRoles[]`.
 *   v5 - v2.12.5: `statusUpdates` block (feature 018).
 *   v6 - v2.12.6: `resourceAllocations` block (feature 019).
 *   v7 - v2.12.9: `resourceAllocations.months[].allocatedByRole` (feature 020).
 *   v8 - v2.13.0: per-month `laborEmployee` + `laborContractor` (feature 022).
 *   v11 - v3.4.9: Delivery Live requires full (non-portfolioMode) payloads with
 *        `resourceAllocations` (Allocated cost plan line). Portfolio hydrate
 *        must not overwrite these rows with slim portfolioMode blobs.
 *   v12 - v3.4.11: per-month `laborByPerson[]` ({ name, role, hours, cost }) for
 *        chart month modal (hours by individual); chart/tooltips stay on
 *        `laborByRole`.
 *   v13 - v3.4.12: laborByPerson enriched with month-prorated allocatedHours,
 *        Fibery percentAllocated, allocatedAndBillable, highlightOrange.
 *   v14 - v3.6.0 / feature 040: `performance` block (planned/projected margin,
 *        EAC hours/$, timing review, resourcesLifetime).
 *   v15 - v3.7.3: resourcesLifetime merges alias / first-name duplicates.
 *   v16 - v3.7.6 / feature 040 R5: laborByPerson.allocatedCost (month-prorated).
 * @const {number}
 */
var DELIVERY_PNL_CACHE_SCHEMA_VERSION_ = 16;

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
 * Max serialized Agreement JSON accepted by
 * `getDeliveryDashboardDataFromAgreementPayload` (google.script.run arg size).
 * Over this, return fallback so the client uses Drive/Fibery path.
 * @const {number}
 */
var DELIVERY_FROM_AGREEMENT_PAYLOAD_MAX_CHARS_ = 1500000;

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
 * Uses Agreement Drive warm cache when available (feature 034); optional
 * `forceRefresh` rebuilds Agreement from Fibery and rewrites Drive.
 *
 * @param {boolean=} forceRefresh Bypass Agreement Drive cache.
 * @return {{
 *   ok: boolean,
 *   source: string,
 *   loadSource?: string,
 *   fromDrive?: boolean,
 *   cacheDateKey?: ?string,
 *   fetchedAt: string,
 *   cacheSchemaVersion: number,
 *   ttlMinutes: number,
 *   projects: !Array<!Object>,
 *   filtersApplied: !Object,
 *   message?: string,
 *   warnings?: !Array<string>
 * }}
 */
function getDeliveryDashboardData(forceRefresh) {
  requireAuthForApi_();
  // Live Datastore: serve panel blob, or rebuild agreement+delivery from typed
  // tables when Refresh is forced or delivery schema lags (e.g. Assigned Owner).
  if (typeof serveLiveAgreementFamilyOrRebuild_ === 'function') {
    return serveLiveAgreementFamilyOrRebuild_(
      'delivery',
      DELIVERY_DASHBOARD_CACHE_SCHEMA_VERSION_,
      forceRefresh === true
    );
  }
  return serveLivePanelFromSupabaseOrFail_(
    'delivery',
    DELIVERY_DASHBOARD_CACHE_SCHEMA_VERSION_
  );
}

/**
 * Derives Delivery from a client-supplied Agreement payload (feature 034 B1).
 * Does not call Fibery. Returns `fallback: true` when the payload is missing,
 * schema-mismatched, or too large for a safe google.script.run argument.
 *
 * @param {?Object} agreementPayload
 * @return {!Object}
 */
function getDeliveryDashboardDataFromAgreementPayload(agreementPayload) {
  requireAuthForApi_();
  var fetchedAtIso = new Date().toISOString();
  var ttlMinutes = resolveDeliveryCacheTtlMinutes_();
  var validation = validateAgreementPayloadForDelivery_(agreementPayload);
  if (!validation.ok) {
    return {
      ok: false,
      fallback: true,
      reason: validation.reason,
      source: 'agreement-payload',
      loadSource: 'agreement-payload',
      fromDrive: false,
      cacheDateKey: null,
      fetchedAt: fetchedAtIso,
      cacheSchemaVersion: DELIVERY_DASHBOARD_CACHE_SCHEMA_VERSION_,
      ttlMinutes: ttlMinutes,
      projects: [],
      filtersApplied: {},
      message: validation.message,
      warnings: [validation.reason || 'INVALID_AGREEMENT_PAYLOAD'],
    };
  }
  return buildDeliveryDashboardPayloadFromAgreement_(
    agreementPayload,
    fetchedAtIso,
    ttlMinutes
  );
}

/**
 * @param {?Object} payload
 * @return {{ ok: boolean, reason?: string, message?: string }}
 * @private
 */
function validateAgreementPayloadForDelivery_(payload) {
  if (!payload || typeof payload !== 'object') {
    return {
      ok: false,
      reason: 'INVALID_PAYLOAD',
      message: 'Agreement payload is missing or not an object.',
    };
  }
  if (payload.ok === false) {
    return {
      ok: false,
      reason: 'AGREEMENT_NOT_OK',
      message: payload.message || 'Agreement payload is not ok.',
    };
  }
  if (payload.cacheSchemaVersion !== AGREEMENT_DASHBOARD_CACHE_SCHEMA_VERSION_) {
    return {
      ok: false,
      reason: 'SCHEMA_MISMATCH',
      message:
        'Agreement cache schema mismatch (got ' +
        payload.cacheSchemaVersion +
        ', expected ' +
        AGREEMENT_DASHBOARD_CACHE_SCHEMA_VERSION_ +
        ').',
    };
  }
  if (!payload.agreements || typeof payload.agreements.length !== 'number') {
    return {
      ok: false,
      reason: 'INVALID_AGREEMENTS',
      message: 'Agreement payload missing agreements array.',
    };
  }
  var size;
  try {
    size = JSON.stringify(payload).length;
  } catch (e) {
    return {
      ok: false,
      reason: 'SERIALIZE_FAILED',
      message: 'Could not serialize Agreement payload for size check.',
    };
  }
  if (size > DELIVERY_FROM_AGREEMENT_PAYLOAD_MAX_CHARS_) {
    return {
      ok: false,
      reason: 'PAYLOAD_TOO_LARGE',
      message:
        'Agreement payload too large for Delivery RPC (' +
        size +
        ' chars); use Drive or Fibery path.',
    };
  }
  return { ok: true };
}

/**
 * Re-projects a normalized agreement payload into the Delivery projects list.
 * No Fibery round-trip - used by the historical snapshot job after agreement
 * data is already fetched.
 *
 * @param {!Object} agreementPayload Output of `buildAgreementDashboardPayload_`.
 * @param {?string=} fetchedAtIso
 * @param {?number=} ttlMinutes
 * @return {!Object}
 */
function buildDeliveryDashboardPayloadFromAgreement_(agreementPayload, fetchedAtIso, ttlMinutes) {
  var fetchedAt = fetchedAtIso || new Date().toISOString();
  var ttl = ttlMinutes != null ? ttlMinutes : resolveDeliveryCacheTtlMinutes_();
  var raw = agreementPayload;
  var agrSource = (raw && raw.source) || 'fibery';
  var fromDrive = !!(raw && (raw.fromDrive || agrSource === 'drive-cache'));
  var cacheDateKey = (raw && raw.cacheDateKey) || null;
  var loadSource =
    (raw && raw.loadSource) || (fromDrive ? 'drive-cache' : agrSource);

  if (!raw || raw.ok === false) {
    return {
      ok: false,
      source: agrSource,
      loadSource: loadSource,
      fromDrive: fromDrive,
      cacheDateKey: fromDrive ? cacheDateKey : null,
      fetchedAt: fetchedAt,
      cacheSchemaVersion: DELIVERY_DASHBOARD_CACHE_SCHEMA_VERSION_,
      ttlMinutes: ttl,
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
    source: agrSource,
    loadSource: loadSource,
    fromDrive: fromDrive,
    cacheDateKey: cacheDateKey,
    fetchedAt: raw.fetchedAt || fetchedAt,
    cacheSchemaVersion: DELIVERY_DASHBOARD_CACHE_SCHEMA_VERSION_,
    ttlMinutes: ttl,
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
function getDeliveryProjectPersonTimeEntries(opts) {
  requireAuthForApi_();
  opts = opts || {};
  var agreementId = String(opts.agreementId || '').trim();
  var personName = String(opts.personName || '').trim();
  var personRole = String(opts.personRole || '').trim();
  var startMonth = String(opts.startMonth || '').slice(0, 7);
  var endMonth = String(opts.endMonth || '').slice(0, 7);
  if (startMonth && !/^\d{4}-\d{2}$/.test(startMonth)) startMonth = '';
  if (endMonth && !/^\d{4}-\d{2}$/.test(endMonth)) endMonth = '';
  var empty = {
    ok: true,
    agreementId: agreementId,
    personName: personName,
    personRole: personRole,
    days: [],
    totalHours: 0,
    totalCost: 0,
    truncated: false,
    message: '',
  };
  if (!agreementId) {
    empty.ok = false;
    empty.message = 'Missing agreementId.';
    return empty;
  }
  if (!personName) {
    empty.ok = false;
    empty.message = 'Missing personName.';
    return empty;
  }
  if (typeof fetchAgreementContextForPnlFromSupabase_ !== 'function' ||
      typeof fetchLaborCostsForAgreementFromSupabase_ !== 'function') {
    empty.ok = false;
    empty.message = 'Datastore labor lookup is unavailable.';
    return empty;
  }
  var ctx = fetchAgreementContextForPnlFromSupabase_(agreementId);
  if (!ctx.ok) {
    empty.ok = false;
    empty.message = ctx.message || 'Could not load agreement.';
    return empty;
  }
  if (!ctx.agreement.clockifyProjectId) {
    empty.message = 'No Clockify project is linked to this agreement.';
    return empty;
  }
  var maxLaborRows = typeof resolveMaxLaborRows_ === 'function' ? resolveMaxLaborRows_() : 10000;
  var laborFetch = fetchLaborCostsForAgreementFromSupabase_(
    agreementId,
    ctx.agreement.clockifyProjectId,
    maxLaborRows,
    ctx.agreement.name
  );
  if (!laborFetch.ok) {
    empty.ok = false;
    empty.message = laborFetch.message || 'Could not load time entries.';
    empty.truncated = true;
    return empty;
  }
  var nameMatch = typeof ppPersonNamesMatch_ === 'function'
    ? ppPersonNamesMatch_
    : function (a, b) {
      return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    };
  var roleWanted = personRole.toLowerCase();
  function roleMatches_(rowRole) {
    if (!roleWanted || roleWanted === '(no role)') {
      return true;
    }
    var got = String(rowRole || '').trim().toLowerCase();
    if (!got || got === '(no role)') return roleWanted === '(no role)';
    return got === roleWanted;
  }
  function dayInRange_(day) {
    var mk = String(day || '').slice(0, 7);
    if (startMonth && mk < startMonth) return false;
    if (endMonth && mk > endMonth) return false;
    return true;
  }
  function collect_(requireRole) {
    var byDay = {};
    var rows = laborFetch.rows || [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var rowName = String(row.userName || '').trim() || '(Unknown user)';
      if (!nameMatch(personName, rowName)) continue;
      if (requireRole && !roleMatches_(row.userRole || row.clockifyUserRole)) continue;
      var hours = Number(row.hours);
      if (!isFinite(hours) || hours <= 0) continue;
      var iso = String(row.startDateTime || '');
      var day = iso.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : '';
      if (!day) continue;
      if (!dayInRange_(day)) continue;
      var cost = Number(row.cost);
      if (!isFinite(cost)) cost = 0;
      if (!byDay[day]) byDay[day] = { date: day, hours: 0, cost: 0 };
      byDay[day].hours += hours;
      byDay[day].cost += cost;
    }
    return byDay;
  }
  var byDay = collect_(true);
  if (!Object.keys(byDay).length && roleWanted && roleWanted !== '(no role)') {
    byDay = collect_(false);
  }
  var days = Object.keys(byDay).sort().reverse().map(function (k) {
    var d = byDay[k];
    return {
      date: d.date,
      hours: Math.round(d.hours * 100) / 100,
      cost: Math.round(d.cost * 100) / 100,
    };
  });
  var totalHours = 0;
  var totalCost = 0;
  for (var t = 0; t < days.length; t++) {
    totalHours += days[t].hours;
    totalCost += days[t].cost;
  }
  empty.days = days;
  empty.totalHours = Math.round(totalHours * 100) / 100;
  empty.totalCost = Math.round(totalCost * 100) / 100;
  empty.truncated = !!laborFetch.partial;
  if (laborFetch.partial) {
    empty.message = 'Labor fetch was truncated; some days may be missing.';
  }
  return empty;
}

function getDeliveryProjectMonthlyPnL(agreementId) {
  requireAuthForApi_();
  if (typeof serveLiveDeliveryPnLOrRebuildFull_ === 'function') {
    return serveLiveDeliveryPnLOrRebuildFull_(
      agreementId,
      DELIVERY_PNL_CACHE_SCHEMA_VERSION_,
      false
    );
  }
  return serveLiveDeliveryPnLFromSupabaseOrFail_(
    agreementId,
    DELIVERY_PNL_CACHE_SCHEMA_VERSION_
  );
}

/**
 * Per-project monthly P&L without user authorization (snapshot job).
 *
 * @param {string} agreementId
 * @return {!Object}
 */
function buildDeliveryProjectMonthlyPnLInternal_(agreementId, options) {
  options = options || {};
  var portfolioMode = options.portfolioMode === true;
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
    laborRoles: [],
    lifetime: emptyLifetime_(),
    discrepancyCheck: emptyDiscrepancy_(),
    partial: false,
    capCounts: { laborRowsRead: 0, laborRowCap: 0 },
    statusUpdates: buildStatusUpdatesBlock_([], true),
    resourceAllocations: emptyResourceAllocationsBlock_(),
  };
  if (!agreementId) {
    emptyShell.message = 'Missing agreementId.';
    return emptyShell;
  }

  // Fetch the agreement's contextual fields (target margin, duration,
  // lifetime totals) - used for Section M.7 margin coloring and Section M.9
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

  var statusWarnings = [];
  var statusUpdates = buildStatusUpdatesBlock_([], true);
  if (!portfolioMode) {
    var statusFetch = fetchStatusUpdatesForAgreement_(agreementId);
    if (statusFetch.ok) {
      statusUpdates = buildStatusUpdatesBlock_(statusFetch.rows, true);
    } else {
      statusUpdates = buildStatusUpdatesBlock_([], false);
      statusWarnings.push(statusFetch.reason || 'STATUS_UPDATES_FETCH_FAILED');
      console.warn('Status updates fetch failed for ' + agreementId + ': ' + statusFetch.message);
    }
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

  var allocWarnings = [];
  var resourceAllocations = emptyResourceAllocationsBlock_();
  var allocRowsForEnrich = [];
  if (!portfolioMode) {
    var allocFetch = fetchResourceAllocationsForAgreement_(agreementId);
    if (allocFetch.ok) {
      allocRowsForEnrich = allocFetch.rows || [];
      resourceAllocations = buildResourceAllocationsBlock_(
        allocRowsForEnrich,
        built.months,
        allocWarnings
      );
    } else {
      allocWarnings.push(allocFetch.reason || 'RESOURCE_ALLOCATIONS_FETCH_FAILED');
      console.warn('Resource allocations fetch failed for ' + agreementId + ': ' + allocFetch.message);
    }
    enrichMonthsLaborByPersonWithAllocations_(built.months, allocRowsForEnrich);
  }

  var allWarnings = statusWarnings.concat(allocWarnings);

  var out = {
    ok: true,
    source: 'fibery',
    fetchedAt: fetchedAtIso,
    cacheSchemaVersion: DELIVERY_PNL_CACHE_SCHEMA_VERSION_,
    agreementId: agreementId,
    agreementName: ctx.agreement.name,
    currency: 'USD',
    months: built.months,
    laborRoles: built.laborRoles,
    lifetime: built.lifetime,
    partial: laborFetch.partial,
    capCounts: {
      laborRowsRead: laborFetch.rows.length,
      laborRowCap: maxLaborRows,
    },
    warnings: allWarnings.length ? allWarnings : undefined,
  };
  if (portfolioMode) {
    out.portfolioMode = true;
  } else {
    out.discrepancyCheck = built.discrepancyCheck;
    out.statusUpdates = statusUpdates;
    out.resourceAllocations = resourceAllocations;
    if (typeof buildProjectPerformanceBlock_ === 'function') {
      out.performance = buildProjectPerformanceBlock_({
        months: built.months,
        resourceAllocations: resourceAllocations,
        targetMarginPct: ctx.agreement.targetMargin,
        assignments: resourceAllocations.assignments || [],
      });
    }
  }
  return out;
}

/**
 * Slim monthly P&L for Portfolio aggregation (skips status + allocations).
 *
 * @param {string} agreementId
 * @return {!Object}
 */
function buildPortfolioMonthlyPnLInternal_(agreementId) {
  return buildDeliveryProjectMonthlyPnLInternal_(agreementId, { portfolioMode: true });
}

/* ------------------------------------------------------------------------- */
/* Diagnostics - run manually from the Apps Script editor.                    */
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
    source: payload.source,
    loadSource: payload.loadSource,
    fromDrive: !!payload.fromDrive,
    cacheDateKey: payload.cacheDateKey || null,
    projectCount: (payload.projects || []).length,
    filtersApplied: payload.filtersApplied,
    sample: (payload.projects || [])[0] || null,
    message: payload.message || null,
  };
  console.log('_diag_sampleDeliveryPayload  -> ', JSON.stringify(summary).slice(0, 4000));
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
    resourceAllocations: p.resourceAllocations || null,
    message: p.message || null,
  };
  console.log('_diag_sampleMonthlyPnL  -> ', JSON.stringify(summary).slice(0, 4000));
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
      customer: a.customer || ' - ',
      type: a.type || ' - ',
      state: a.state || ' - ',
      assignedOwner:
        a.assignedOwner && String(a.assignedOwner).trim()
          ? String(a.assignedOwner).trim()
          : 'Unassigned',
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
 * Revenue amount for one P&L month bucket. Recognized milestones prefer
 * non-zero Actual Amount, then Target Amount; unrecognized (forecast)
 * milestones always use Target Amount (v2.6.2 fix - Actual Amount = 0
 * must not suppress forecast).
 *
 * @param {!Object} row
 * @return {number}
 * @private
 */
function resolvePnlRevenueItemAmount_(row) {
  var target = Number(row.targetAmount || 0);
  if (row.recognized === true) {
    var actual = Number(row.actualAmount || 0);
    if (isFinite(actual) && actual !== 0) return actual;
    return isFinite(target) ? target : 0;
  }
  return isFinite(target) ? target : 0;
}

/**
 * Month key for revenue bucketing. Unrecognized milestones bucket by
 * Target Date so future forecast lands in the planned month.
 *
 * @param {!Object} row
 * @return {?string}
 * @private
 */
function resolvePnlRevenueItemMonthKey_(row) {
  if (row.recognized === true) {
    return monthKeyFromIso_(row.actualDate || row.targetDate);
  }
  return monthKeyFromIso_(row.targetDate || row.actualDate);
}

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
  var internalNames = (args.internalCompanyNames && args.internalCompanyNames.length)
    ? args.internalCompanyNames
    : getAgreementThresholds_().internalCompanyNames;
  var laborByMonth = {};
  var laborByMonthEmployee = {};
  var laborByMonthContractor = {};
  var laborByMonthByRole = {};
  // name\0role -> { name, role, hours, cost } per month (chart month modal).
  var laborByMonthByPerson = {};
  var laborRoleTotals = {};
  var odcByMonth = {};
  var revenueByMonth = {};
  // Phase B (FR-94 / FR-95) - capture the contributing milestone rows
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
    var roleName = l.userRole || l.clockifyUserRole || '(No role)';
    var personName = String(l.userName || '').trim() || '(Unknown user)';
    var hours = Number(l.hours);
    if (!isFinite(hours) || hours < 0) hours = 0;
    laborByMonth[key] = (laborByMonth[key] || 0) + cost;
    if (isInternalLabor_(l, internalNames)) {
      laborByMonthEmployee[key] = (laborByMonthEmployee[key] || 0) + cost;
    } else {
      laborByMonthContractor[key] = (laborByMonthContractor[key] || 0) + cost;
    }
    if (!laborByMonthByRole[key]) laborByMonthByRole[key] = {};
    laborByMonthByRole[key][roleName] = (laborByMonthByRole[key][roleName] || 0) + cost;
    laborRoleTotals[roleName] = (laborRoleTotals[roleName] || 0) + cost;
    if (!laborByMonthByPerson[key]) laborByMonthByPerson[key] = {};
    var personKey = personName + '\0' + roleName;
    var personAgg = laborByMonthByPerson[key][personKey];
    if (!personAgg) {
      personAgg = { name: personName, role: roleName, hours: 0, cost: 0 };
      laborByMonthByPerson[key][personKey] = personAgg;
    }
    personAgg.hours += hours;
    personAgg.cost += cost;
    activityMonths[key] = true;
    summedLabor += cost;
  }

  var laborRoles = Object.keys(laborRoleTotals).sort(function (a, b) {
    return (laborRoleTotals[b] || 0) - (laborRoleTotals[a] || 0);
  });

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

  // Revenue Items: recognized  ->  Actual Amount (fallback Target); forecast
  // milestones  ->  Target Amount only. Phase B (FR-94) lifted the
  // recognized-only filter so future-dated milestones land in projected
  // months; v2.6.2 ensures Target Amount is used when Actual is zero.
  var summedRevenue = 0;
  var summedRevenueRecognized = 0;
  var summedRevenueForecast = 0;
  for (var k = 0; k < args.revenueRows.length; k++) {
    var r = args.revenueRows[k];
    var keyR = resolvePnlRevenueItemMonthKey_(r);
    if (!keyR) continue;
    var amount = resolvePnlRevenueItemAmount_(r);
    if (!isFinite(amount)) continue;
    revenueByMonth[keyR] = (revenueByMonth[keyR] || 0) + amount;
    if (!revenueItemsByMonth[keyR]) revenueItemsByMonth[keyR] = [];
    revenueItemsByMonth[keyR].push({
      id: r.id,
      name: r.name,
      amount: amount,
      targetAmount: Number(r.targetAmount || 0),
      recognized: r.recognized === true,
      targetDate: r.targetDate,
      actualDate: r.actualDate,
      state: r.state,
    });
    activityMonths[keyR] = true;
    summedRevenue += amount;
    if (r.recognized === true) {
      summedRevenueRecognized += amount;
    } else {
      summedRevenueForecast += amount;
    }
  }

  // Resolve the month window: max(durStart-month, earliest-activity-month)
  // through min(today-month, durEnd-month). Activity outside that window
  // is still emitted with an `outOfRange: true` marker (Section M.10).
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
    var personMap = laborByMonthByPerson[mk] || {};
    var laborByPerson = [];
    var personKeys = Object.keys(personMap);
    for (var pk = 0; pk < personKeys.length; pk++) {
      var pa = personMap[personKeys[pk]];
      laborByPerson.push({
        name: pa.name,
        role: pa.role,
        hours: Math.round(pa.hours * 100) / 100,
        cost: pa.cost,
      });
    }
    laborByPerson.sort(function (a, b) {
      var costDelta = (b.cost || 0) - (a.cost || 0);
      if (costDelta) return costDelta;
      var nameCmp = String(a.name || '').localeCompare(String(b.name || ''));
      if (nameCmp) return nameCmp;
      return String(a.role || '').localeCompare(String(b.role || ''));
    });
    months.push({
      key: mk,
      label: monthLabel_(mk),
      revenue: rev,
      labor: lab,
      laborEmployee: Number(laborByMonthEmployee[mk] || 0),
      laborContractor: Number(laborByMonthContractor[mk] || 0),
      laborByRole: laborByMonthByRole[mk] ? Object.assign({}, laborByMonthByRole[mk]) : {},
      laborByPerson: laborByPerson,
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

  // Section M.8 Lifetime totals row (margin derived from the summed monthlies).
  var lifetimeTotalCost = lifetimeLabor + lifetimeExpenses;
  var lifetimeGrossProfit = lifetimeRevenue - lifetimeTotalCost;
  var lifetimeMarginDerived = lifetimeRevenue > 0
    ? (lifetimeGrossProfit / lifetimeRevenue) * 100
    : null;

  var lifetimeGrossProfitRecognized = summedRevenueRecognized - lifetimeTotalCost;
  var lifetimeMarginRecognized = summedRevenueRecognized > 0
    ? (lifetimeGrossProfitRecognized / summedRevenueRecognized) * 100
    : null;

  var lifetime = {
    revenue: lifetimeRevenue,
    revenueRecognized: summedRevenueRecognized,
    revenueForecast: summedRevenueForecast,
    labor: lifetimeLabor,
    expenses: lifetimeExpenses,
    totalCost: lifetimeTotalCost,
    grossProfit: lifetimeGrossProfit,
    marginPctDerived: lifetimeMarginDerived,
    marginPctFromAgreement: args.lifetimeMarginPct === null
      || args.lifetimeMarginPct === undefined ? null : Number(args.lifetimeMarginPct),
    laborSkipped: laborSkipped,
  };

  // Section M.9 Discrepancy check - 5% threshold, per decision M.5. Margin
  // compares recognized revenue only (agreement.margin is recognized basis).
  var discrepancyCheck = computeDiscrepancyCheck_({
    summedLabor: summedLabor,
    summedExpenses: summedExpenses,
    summedMarginPct: lifetimeMarginRecognized,
    lifetimeLabor: Number(args.lifetimeLabor || 0),
    lifetimeExpenses: Number(args.lifetimeExpenses || 0),
    lifetimeMarginPct: args.lifetimeMarginPct,
  });

  return {
    months: months,
    laborRoles: laborRoles,
    lifetime: lifetime,
    discrepancyCheck: discrepancyCheck,
  };
}

/**
 * Returns {hasLaborDelta, hasExpensesDelta, hasMarginDelta} per the Section M.9
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
      // treat as "infinite" delta - surface the caption.
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
          userName: 'Agreement Management/Time Entry User Name',
          hours: 'Agreement Management/Clockify Hours',
          userRole: ['Agreement Management/User Role', 'Agreement Management/Name'],
          clockifyUserRole: ['Agreement Management/Clockify User Role', 'enum/name'],
          clockifyUserCompany: ['Agreement Management/Clockify User Company', 'enum/name'],
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
        userName: stringOrNull_(page[i].userName),
        hours: numberOr_(page[i].hours, 0),
        userRole: stringOrNull_(page[i].userRole),
        clockifyUserRole: stringOrNull_(page[i].clockifyUserRole),
        clockifyUserCompany: stringOrNull_(page[i].clockifyUserCompany),
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

/**
 * Fetches Resource Allocation rows for one agreement (full lifetime).
 *
 * @param {string} agreementId
 * @return {!{ ok: true, rows: !Array<!Object> }|
 *          !{ ok: false, reason: string, message: string }}
 * @private
 */
function fetchResourceAllocationsForAgreement_(agreementId) {
  var q = {
    query: {
      'q/from': 'Agreement Management/Resource Allocations',
      'q/select': {
        id: 'fibery/id',
        allocatedCost: 'Agreement Management/Allocated Cost',
        allocatedHours: 'Agreement Management/Allocated Hours',
        duration: 'Agreement Management/Duration',
        allocationName: 'Agreement Management/Allocation Name',
        clockifyUserName: [
          'Agreement Management/Clockify User',
          'Agreement Management/Name',
        ],
        percentAllocated: 'Agreement Management/Percent Allocated',
        allocatedAndBillable: 'Agreement Management/Allocated & Billable',
        roleName: [
          'Agreement Management/Clockify User Team Member Role',
          'Agreement Management/Name',
        ],
      },
      'q/where': ['=', ['Agreement Management/Agreement', 'fibery/id'], '$agreementId'],
      'q/limit': DELIVERY_QUERY_LIMIT_,
    },
    params: { $agreementId: agreementId },
  };
  var r = fiberyQuery_(q);
  if (!r.ok) return r;
  var page = r.rows || [];
  var rows = [];
  for (var i = 0; i < page.length; i++) {
    var dur = page[i].duration && typeof page[i].duration === 'object'
      ? page[i].duration : null;
    var billableRaw = page[i].allocatedAndBillable;
    rows.push({
      id: stringOr_(page[i].id, ''),
      allocatedCost: numberOr_(page[i].allocatedCost, 0),
      allocatedHours: numberOr_(page[i].allocatedHours, 0),
      allocationName: stringOrNull_(page[i].allocationName),
      clockifyUserName: stringOrNull_(page[i].clockifyUserName),
      percentAllocated: page[i].percentAllocated != null && page[i].percentAllocated !== ''
        ? numberOr_(page[i].percentAllocated, 0) : null,
      allocatedAndBillable: billableRaw === true ? true : billableRaw === false ? false : null,
      roleName: stringOrNull_(page[i].roleName) || '(No role)',
      durStart: dur ? stringOrNull_(dur.start) : null,
      durEnd: dur ? stringOrNull_(dur.end) : null,
    });
  }
  return { ok: true, rows: rows };
}

/**
 * @return {!{ hasAllocations: boolean, rowCount: number }}
 * @private
 */
function emptyResourceAllocationsBlock_() {
  return { hasAllocations: false, rowCount: 0, assignments: [] };
}

/**
 * @param {?string} iso
 * @return {string}
 * @private
 */
function allocationYmdFromIso_(iso) {
  if (!iso) return '';
  var s = String(iso).trim();
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/**
 * @param {?string} durStart
 * @param {?string} durEnd
 * @return {string}
 * @private
 */
function formatResourceAllocationDurationLabel_(durStart, durEnd) {
  var s = allocationYmdFromIso_(durStart);
  var e = allocationYmdFromIso_(durEnd);
  if (s && e) return s === e ? s : s + ' to ' + e;
  if (s) return s + ' (open end)';
  if (e) return '(open start) to ' + e;
  return ' - ';
}

/**
 * @param {!Array<!Object>} rows
 * @return {!Array<!Object>}
 * @private
 */
function buildResourceAllocationAssignmentsList_(rows) {
  if (!rows || !rows.length) return [];
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var name = stringOrNull_(row.clockifyUserName)
      || stringOrNull_(row.allocationName)
      || '(Unnamed)';
    var pct = row.percentAllocated;
    var pctNum = (pct === null || pct === undefined || pct === '') ? null : Number(pct);
    out.push({
      id: row.id,
      name: name,
      roleName: stringOrNull_(row.roleName) || '(No role)',
      durationLabel: formatResourceAllocationDurationLabel_(row.durStart, row.durEnd),
      percentAllocated: (pctNum !== null && isFinite(pctNum))
        ? deliveryPnlNormalizePercent_(pctNum) : null,
      allocatedHours: Number(row.allocatedHours || 0),
      allocatedCost: Number(row.allocatedCost || 0),
      allocatedAndBillable: row.allocatedAndBillable === true
        ? true
        : row.allocatedAndBillable === false
          ? false
          : null,
    });
  }
  out.sort(function (a, b) {
    var ad = a.durationLabel || '';
    var bd = b.durationLabel || '';
    if (ad !== bd) return ad < bd ? -1 : 1;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return 0;
  });
  return out;
}

/**
 * @param {?number|string} raw
 * @return {?number} Percent on 0-100 scale
 * @private
 */
function deliveryPnlNormalizePercent_(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  var n = Number(raw);
  if (!isFinite(n)) return null;
  if (n > 0 && n <= 1) n = n * 100;
  return n;
}

/**
 * @param {string} s
 * @return {string}
 * @private
 */
function deliveryPnlNormalizePersonToken_(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/@.*$/, '')
    .replace(/[._\s\-]+/g, '');
}

/**
 * Alias keys for matching labor Time Entry User Name to Clockify User Name.
 * @param {?string} name
 * @return {!Array<string>}
 * @private
 */
function deliveryPnlPersonAliasKeys_(name) {
  var out = [];
  var seen = {};
  function add(v) {
    var s = v != null ? String(v).trim() : '';
    if (!s || seen[s]) return;
    seen[s] = true;
    out.push(s);
    var lower = s.toLowerCase();
    if (!seen[lower]) {
      seen[lower] = true;
      out.push(lower);
    }
    var token = deliveryPnlNormalizePersonToken_(s);
    if (token) {
      var alias = '~' + token;
      if (!seen[alias]) {
        seen[alias] = true;
        out.push(alias);
      }
    }
  }
  add(name);
  if (name && String(name).indexOf('@') >= 0) {
    add(String(name).split('@')[0]);
  }
  return out;
}

/**
 * @param {?string} aName
 * @param {?string} bName
 * @return {boolean}
 * @private
 */
function deliveryPnlPersonNamesMatch_(aName, bName) {
  var a = deliveryPnlPersonAliasKeys_(aName);
  var bSet = {};
  var b = deliveryPnlPersonAliasKeys_(bName);
  for (var i = 0; i < b.length; i++) bSet[b[i]] = true;
  for (var j = 0; j < a.length; j++) {
    if (bSet[a[j]]) return true;
  }
  return false;
}

/**
 * Calendar-day prorate of Allocated Hours into one month.
 * @param {!Object} row
 * @param {string} monthKey
 * @return {?{ hours: number, cost: number, percent: ?number, billable: ?boolean, name: string, role: string }}
 * @private
 */
function prorateAllocationHoursForMonth_(row, monthKey) {
  var durStartIso = row.durStart || null;
  var durEndIso = row.durEnd || null;
  var rowHours = Number(row.allocatedHours || 0);
  if (!isFinite(rowHours) || rowHours < 0) rowHours = 0;
  var rowCost = Number(row.allocatedCost || 0);
  if (!isFinite(rowCost) || rowCost < 0) rowCost = 0;
  var pct = deliveryPnlNormalizePercent_(row.percentAllocated);
  var name = stringOrNull_(row.clockifyUserName)
    || stringOrNull_(row.allocationName)
    || '(Unnamed)';
  var role = stringOrNull_(row.roleName) || '(No role)';
  var billable = row.allocatedAndBillable === true
    ? true
    : row.allocatedAndBillable === false
      ? false
      : null;

  var bounds = monthBoundsUtc_(monthKey);
  var allocStart = parseIsoDateOnlyUtc_(durStartIso || durEndIso);
  var allocEnd = parseIsoDateOnlyUtc_(durEndIso || durStartIso);
  if (!allocStart && !allocEnd) {
    // No duration: count full hours into first/only overlap as zero-day skip.
    return null;
  }
  if (!allocStart) allocStart = allocEnd;
  if (!allocEnd) allocEnd = allocStart;
  if (allocEnd.getTime() < allocStart.getTime()) {
    var swap = allocStart;
    allocStart = allocEnd;
    allocEnd = swap;
  }
  var intersection = intersectDateRangesInclusiveUtc_(
    allocStart, allocEnd, bounds.start, bounds.end
  );
  if (!intersection) return null;
  var totalDays = calendarDaysInclusiveUtc_(allocStart, allocEnd);
  if (totalDays <= 0) return null;
  var daysInMonth = calendarDaysInclusiveUtc_(intersection.start, intersection.end);
  if (daysInMonth <= 0) return null;
  var hours = rowHours > 0 ? rowHours * (daysInMonth / totalDays) : 0;
  var cost = rowCost > 0 ? rowCost * (daysInMonth / totalDays) : 0;
  return {
    hours: hours,
    cost: cost,
    percent: pct,
    billable: billable,
    name: name,
    role: role,
  };
}

/**
 * Join logged laborByPerson with month-prorated allocation hours / Fibery %.
 * Mutates `months[].laborByPerson` in place.
 *
 * @param {!Array<!Object>} months
 * @param {!Array<!Object>} allocRows
 * @private
 */
function enrichMonthsLaborByPersonWithAllocations_(months, allocRows) {
  months = months || [];
  allocRows = allocRows || [];
  for (var mi = 0; mi < months.length; mi++) {
    var month = months[mi];
    if (!month || !month.key) continue;
    var monthKey = month.key;

    // personToken -> { displayName, byRole: { role: { hours, pctWeight, pctSum, billableTrue } } }
    var allocByPerson = {};
    function ensurePerson(token, displayName) {
      if (!allocByPerson[token]) {
        allocByPerson[token] = {
          displayName: displayName,
          byRole: {},
          anyBillable: false,
          hasOverlap: false,
        };
      }
      return allocByPerson[token];
    }
    function personToken(name) {
      return '~' + deliveryPnlNormalizePersonToken_(name);
    }

    for (var ai = 0; ai < allocRows.length; ai++) {
      var slice = prorateAllocationHoursForMonth_(allocRows[ai], monthKey);
      if (!slice) continue;
      var token = personToken(slice.name);
      if (!token || token === '~') continue;
      var pers = ensurePerson(token, slice.name);
      pers.hasOverlap = true;
      if (slice.billable === true) pers.anyBillable = true;
      var roleKey = slice.role || '(No role)';
      if (!pers.byRole[roleKey]) {
        pers.byRole[roleKey] = {
          hours: 0,
          cost: 0,
          pctWeight: 0,
          pctSum: 0,
          billableTrue: false,
        };
      }
      var roleAgg = pers.byRole[roleKey];
      roleAgg.hours += slice.hours;
      roleAgg.cost += Number(slice.cost || 0);
      if (slice.percent != null && isFinite(slice.percent)) {
        var w = slice.hours > 0 ? slice.hours : 1;
        roleAgg.pctWeight += w;
        roleAgg.pctSum += slice.percent * w;
      }
      if (slice.billable === true) roleAgg.billableTrue = true;
    }

    function findAllocPerson(laborName) {
      var keys = deliveryPnlPersonAliasKeys_(laborName);
      for (var k = 0; k < keys.length; k++) {
        var t = personToken(keys[k]);
        if (allocByPerson[t]) return allocByPerson[t];
      }
      // Scan all for alias match (different display forms).
      var tokens = Object.keys(allocByPerson);
      for (var ti = 0; ti < tokens.length; ti++) {
        var cand = allocByPerson[tokens[ti]];
        if (deliveryPnlPersonNamesMatch_(laborName, cand.displayName)) return cand;
      }
      return null;
    }

    function resolvePercent(roleAgg) {
      if (!roleAgg || !(roleAgg.pctWeight > 0)) return null;
      return Math.round((roleAgg.pctSum / roleAgg.pctWeight) * 10) / 10;
    }

    var labor = Array.isArray(month.laborByPerson) ? month.laborByPerson : [];
    var seenLaborTokens = {};
    var enriched = [];
    for (var li = 0; li < labor.length; li++) {
      var row = labor[li] || {};
      var lName = row.name || '(Unknown user)';
      var lRole = row.role || '(No role)';
      var logged = Number(row.hours || 0);
      var cost = Number(row.cost || 0);
      var allocPers = findAllocPerson(lName);
      var allocHours = 0;
      var allocCost = 0;
      var pct = null;
      var billable = null;
      if (allocPers) {
        seenLaborTokens[personToken(allocPers.displayName)] = true;
        // Prefer matching role; else sum all roles for the person.
        var roleAgg = allocPers.byRole[lRole];
        if (roleAgg) {
          allocHours = roleAgg.hours;
          allocCost = roleAgg.cost || 0;
          pct = resolvePercent(roleAgg);
        } else {
          var roles = Object.keys(allocPers.byRole);
          var pctW = 0;
          var pctS = 0;
          for (var ri = 0; ri < roles.length; ri++) {
            var ra = allocPers.byRole[roles[ri]];
            allocHours += ra.hours;
            allocCost += ra.cost || 0;
            if (ra.pctWeight > 0) {
              pctW += ra.pctWeight;
              pctS += ra.pctSum;
            }
          }
          pct = pctW > 0 ? Math.round((pctS / pctW) * 10) / 10 : null;
        }
        billable = allocPers.hasOverlap
          ? (allocPers.anyBillable ? true : false)
          : null;
      }
      var orange = logged > 0 && billable !== true;
      enriched.push({
        name: lName,
        role: lRole,
        hours: logged,
        cost: cost,
        allocatedHours: Math.round(allocHours * 100) / 100,
        allocatedCost: Math.round(allocCost * 100) / 100,
        percentAllocated: pct,
        allocatedAndBillable: billable,
        highlightOrange: orange,
      });
    }

    // Allocated-only people (no logged hours this month).
    var allocTokens = Object.keys(allocByPerson);
    for (var at = 0; at < allocTokens.length; at++) {
      var tok = allocTokens[at];
      if (seenLaborTokens[tok]) continue;
      var ap = allocByPerson[tok];
      var roleKeys = Object.keys(ap.byRole);
      for (var rj = 0; rj < roleKeys.length; rj++) {
        var rk = roleKeys[rj];
        var rAgg = ap.byRole[rk];
        if (!(rAgg.hours > 0) && !(rAgg.cost > 0) && resolvePercent(rAgg) == null) continue;
        enriched.push({
          name: ap.displayName,
          role: rk,
          hours: 0,
          cost: 0,
          allocatedHours: Math.round(rAgg.hours * 100) / 100,
          allocatedCost: Math.round((rAgg.cost || 0) * 100) / 100,
          percentAllocated: resolvePercent(rAgg),
          allocatedAndBillable: ap.anyBillable ? true : false,
          highlightOrange: false,
        });
      }
    }

    enriched.sort(function (a, b) {
      var costDelta = (b.cost || 0) - (a.cost || 0);
      if (costDelta) return costDelta;
      var hoursDelta = (b.hours || 0) - (a.hours || 0);
      if (hoursDelta) return hoursDelta;
      var nameCmp = String(a.name || '').localeCompare(String(b.name || ''));
      if (nameCmp) return nameCmp;
      return String(a.role || '').localeCompare(String(b.role || ''));
    });
    month.laborByPerson = enriched;
  }
}

/**
 * Adds a prorated allocation amount to month + role buckets.
 *
 * @param {!Object} allocatedByMonth
 * @param {!Object} allocatedByMonthByRole
 * @param {string} monthKey
 * @param {string} roleName
 * @param {number} amount
 * @private
 */
function addAllocatedCostToMonthRole_(
  allocatedByMonth, allocatedByMonthByRole, monthKey, roleName, amount
) {
  if (!monthKey || !isFinite(amount) || amount <= 0) return;
  allocatedByMonth[monthKey] = (allocatedByMonth[monthKey] || 0) + amount;
  if (!allocatedByMonthByRole[monthKey]) allocatedByMonthByRole[monthKey] = {};
  var role = roleName || '(No role)';
  allocatedByMonthByRole[monthKey][role] =
    (allocatedByMonthByRole[monthKey][role] || 0) + amount;
}

/**
 * @param {!Object} row
 * @param {!Array<string>} monthKeys
 * @param {!Object} allocatedByMonth
 * @param {!Object} allocatedByMonthByRole
 * @param {!Array<string>} warningsOut
 * @return {number} lifetime row cost counted
 * @private
 */
function prorateAllocationRowToMonths_(
  row, monthKeys, allocatedByMonth, allocatedByMonthByRole, warningsOut
) {
  var rowCost = Number(row.allocatedCost || 0);
  var roleName = row.roleName || '(No role)';
  var durStartIso = row.durStart || null;
  var durEndIso = row.durEnd || null;
  var touched = false;

  if (!durStartIso && !durEndIso) {
    warningsOut.push('RESOURCE_ALLOCATION_MISSING_DURATION');
    var fallbackKey = monthKeyFromIso_(durStartIso) || (monthKeys.length ? monthKeys[0] : null);
    if (fallbackKey) {
      addAllocatedCostToMonthRole_(
        allocatedByMonth, allocatedByMonthByRole, fallbackKey, roleName, rowCost
      );
      touched = true;
    }
    return touched ? rowCost : 0;
  }

  var allocStart = parseIsoDateOnlyUtc_(durStartIso || durEndIso);
  var allocEnd = parseIsoDateOnlyUtc_(durEndIso || durStartIso);
  if (!allocStart || !allocEnd) return 0;
  if (allocEnd.getTime() < allocStart.getTime()) {
    var swap = allocStart;
    allocStart = allocEnd;
    allocEnd = swap;
  }
  var totalDays = calendarDaysInclusiveUtc_(allocStart, allocEnd);
  if (totalDays <= 0) return 0;

  for (var mi = 0; mi < monthKeys.length; mi++) {
    var monthKey = monthKeys[mi];
    var bounds = monthBoundsUtc_(monthKey);
    var intersection = intersectDateRangesInclusiveUtc_(
      allocStart, allocEnd, bounds.start, bounds.end
    );
    if (!intersection) continue;
    var daysInMonth = calendarDaysInclusiveUtc_(intersection.start, intersection.end);
    if (daysInMonth <= 0) continue;
    var prorated = rowCost * (daysInMonth / totalDays);
    addAllocatedCostToMonthRole_(
      allocatedByMonth, allocatedByMonthByRole, monthKey, roleName, prorated
    );
    touched = true;
  }
  return touched ? rowCost : 0;
}

/**
 * @param {?Object} roleMap
 * @return {!Object}
 * @private
 */
function roundAllocatedByRole_(roleMap) {
  var out = {};
  if (!roleMap || typeof roleMap !== 'object') return out;
  var keys = Object.keys(roleMap);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var v = Math.round(Number(roleMap[k] || 0));
    if (v !== 0) out[k] = v;
  }
  return out;
}

/**
 * Prorates Fibery Resource Allocation rows across the P&L chart month axis.
 * Calendar-day proration within each allocation Duration (feature 019 / 020).
 *
 * @param {!Array<!Object>} rows
 * @param {!Array<!Object>} chartMonths  `buildMonthlyPnL_().months`
 * @param {!Array<string>} warningsOut
 * @return {!Object}
 * @private
 */
function buildResourceAllocationsBlock_(rows, chartMonths, warningsOut) {
  var empty = emptyResourceAllocationsBlock_();
  var assignments = buildResourceAllocationAssignmentsList_(rows || []);
  if (!rows || !rows.length) return empty;

  var validRows = [];
  for (var i = 0; i < rows.length; i++) {
    var cost = Number(rows[i].allocatedCost || 0);
    if (!isFinite(cost) || cost <= 0) continue;
    validRows.push(rows[i]);
  }
  if (!validRows.length) {
    return { hasAllocations: false, rowCount: 0, assignments: assignments };
  }

  var monthKeys = [];
  var monthKeySet = {};
  for (var m = 0; m < (chartMonths || []).length; m++) {
    var mk = chartMonths[m] && chartMonths[m].key;
    if (mk && !monthKeySet[mk]) {
      monthKeySet[mk] = true;
      monthKeys.push(mk);
    }
  }

  var allocatedByMonth = {};
  var allocatedByMonthByRole = {};
  var lifetimeTotal = 0;
  var hasAnyOverlap = false;

  for (var r = 0; r < validRows.length; r++) {
    var counted = prorateAllocationRowToMonths_(
      validRows[r],
      monthKeys,
      allocatedByMonth,
      allocatedByMonthByRole,
      warningsOut
    );
    if (counted > 0) {
      lifetimeTotal += counted;
      hasAnyOverlap = true;
    }
  }

  if (!hasAnyOverlap) {
    return {
      hasAllocations: true,
      rowCount: validRows.length,
      lifetimeAllocatedCost: Math.round(lifetimeTotal),
      emptyMessage: 'Allocations exist but none overlap project dates.',
      assignments: assignments,
    };
  }

  var monthsOut = [];
  var cumulative = 0;
  for (var mj = 0; mj < monthKeys.length; mj++) {
    var key = monthKeys[mj];
    var amt = Math.round(allocatedByMonth[key] || 0);
    cumulative += amt;
    var monthEntry = {
      key: key,
      allocatedCost: amt,
      cumulativeAllocatedCost: cumulative,
    };
    var byRole = roundAllocatedByRole_(allocatedByMonthByRole[key]);
    if (Object.keys(byRole).length) monthEntry.allocatedByRole = byRole;
    monthsOut.push(monthEntry);
  }

  return {
    hasAllocations: true,
    rowCount: validRows.length,
    months: monthsOut,
    lifetimeAllocatedCost: Math.round(lifetimeTotal),
    assignments: assignments,
  };
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
 * @param {?string} iso  yyyy-mm-dd or ISO datetime
 * @return {?Date} UTC midnight on that calendar day
 * @private
 */
function parseIsoDateOnlyUtc_(iso) {
  if (!iso) return null;
  var s = String(iso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  var parts = s.split('-');
  var y = parseInt(parts[0], 10);
  var mo = parseInt(parts[1], 10);
  var d = parseInt(parts[2], 10);
  if (!isFinite(y) || !isFinite(mo) || !isFinite(d)) return null;
  var dt = new Date(Date.UTC(y, mo - 1, d));
  return isNaN(dt.getTime()) ? null : dt;
}

/**
 * @param {!Date} start
 * @param {!Date} end
 * @return {number}
 * @private
 */
function calendarDaysInclusiveUtc_(start, end) {
  var ms = end.getTime() - start.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / 86400000) + 1;
}

/**
 * @param {string} monthKey  yyyy-mm
 * @return {!{ start: !Date, end: !Date }}
 * @private
 */
function monthBoundsUtc_(monthKey) {
  var y = parseInt(monthKey.slice(0, 4), 10);
  var m = parseInt(monthKey.slice(5, 7), 10);
  var start = new Date(Date.UTC(y, m - 1, 1));
  var end = new Date(Date.UTC(y, m, 0));
  return { start: start, end: end };
}

/**
 * @param {!Date} aStart
 * @param {!Date} aEnd
 * @param {!Date} bStart
 * @param {!Date} bEnd
 * @return {?{ start: !Date, end: !Date }}
 * @private
 */
function intersectDateRangesInclusiveUtc_(aStart, aEnd, bStart, bEnd) {
  var startMs = Math.max(aStart.getTime(), bStart.getTime());
  var endMs = Math.min(aEnd.getTime(), bEnd.getTime());
  if (startMs > endMs) return null;
  return { start: new Date(startMs), end: new Date(endMs) };
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
 * Pretty label for a yyyy-mm key. e.g. "2026-05"  ->  "May 2026".
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
    revenue: 0,
    revenueRecognized: 0,
    revenueForecast: 0,
    labor: 0,
    expenses: 0,
    totalCost: 0,
    grossProfit: 0,
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

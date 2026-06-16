/**
 * PRD version 2.15.12 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Portfolio Project P&L (Finance route `portfolio-pnl`, feature 022).
 * Returns the in-scope project index (Subscription + Services agreements)
 * for client-side aggregation of per-project monthly P&L payloads.
 */

/** @const {number} */
var PORTFOLIO_PNL_INDEX_CACHE_SCHEMA_VERSION_ = 1;

/** @const {!Array<string>} Agreement types included in portfolio P&L. */
var PORTFOLIO_PNL_AGREEMENT_TYPES_ = ['Subscription', 'Services'];

/**
 * @param {!Object} auth
 * @return {boolean}
 * @private
 */
function requirePortfolioPnlAccess_(auth) {
  if (!canAccessExpensesDashboard_(auth)) {
    throw new Error('Portfolio P&L is available to the Finance team, Execs, and Admins.');
  }
}

/**
 * Active Delivery projects limited to Subscription and Services agreement types.
 *
 * @param {!Array<!Object>} projects
 * @return {!Array<!Object>}
 * @private
 */
function filterPortfolioProjects_(projects) {
  var out = [];
  var allowed = {};
  for (var i = 0; i < PORTFOLIO_PNL_AGREEMENT_TYPES_.length; i++) {
    allowed[PORTFOLIO_PNL_AGREEMENT_TYPES_[i]] = true;
  }
  for (var j = 0; j < (projects || []).length; j++) {
    var p = projects[j];
    if (!p || !p.id) continue;
    var type = String(p.type || '').trim();
    if (!allowed[type]) continue;
    out.push({
      id: p.id,
      name: p.name || '(Unnamed project)',
      customer: p.customer || ' - ',
      type: type,
      state: p.state || ' - ',
    });
  }
  out.sort(function (a, b) {
    var ca = String(a.customer || '').toLowerCase();
    var cb = String(b.customer || '').toLowerCase();
    if (ca !== cb) return ca < cb ? -1 : 1;
    return String(a.name || '').toLowerCase() < String(b.name || '').toLowerCase() ? -1 : 1;
  });
  return out;
}

/**
 * Returns Subscription + Services project rows for portfolio P&L loading.
 *
 * @return {{
 *   ok: boolean,
 *   source: string,
 *   fetchedAt: string,
 *   cacheSchemaVersion: number,
 *   calendarYear: number,
 *   projects: !Array<!Object>,
 *   filtersApplied: !Object,
 *   message?: string
 * }}
 */
function getPortfolioProjectIndex() {
  var auth = requireAuthForApi_();
  requirePortfolioPnlAccess_(auth);
  var fetchedAt = new Date().toISOString();
  var empty = {
    ok: false,
    source: 'fibery',
    fetchedAt: fetchedAt,
    cacheSchemaVersion: PORTFOLIO_PNL_INDEX_CACHE_SCHEMA_VERSION_,
    calendarYear: new Date().getFullYear(),
    projects: [],
    filtersApplied: { agreementTypes: PORTFOLIO_PNL_AGREEMENT_TYPES_.slice() },
  };
  var delivery;
  try {
    delivery = getDeliveryDashboardData();
  } catch (e) {
    empty.message = e && e.message ? e.message : String(e);
    return empty;
  }
  if (!delivery || !delivery.ok) {
    empty.message = (delivery && delivery.message) || 'Could not load delivery projects.';
    return empty;
  }
  return {
    ok: true,
    source: delivery.source || 'fibery',
    fetchedAt: delivery.fetchedAt || fetchedAt,
    cacheSchemaVersion: PORTFOLIO_PNL_INDEX_CACHE_SCHEMA_VERSION_,
    calendarYear: new Date().getFullYear(),
    projects: filterPortfolioProjects_(delivery.projects || []),
    filtersApplied: {
      agreementTypes: PORTFOLIO_PNL_AGREEMENT_TYPES_.slice(),
      deliveryFilters: delivery.filtersApplied || {},
    },
  };
}

/**
 * @return {!Object}
 * @private
 */
function _diag_samplePortfolioProjectIndex() {
  return getPortfolioProjectIndex();
}

/** Default agreements processed per batch (single server execution). */
var PORTFOLIO_PNL_BATCH_SIZE_DEFAULT_ = 2;

/**
 * Fetches monthly P&L payloads for a slice of agreement ids in one server
 * execution. Avoids parallel HtmlService `google.script.run` calls that often
 * fail under concurrent Fibery load (root cause of portfolio partial-data warnings).
 *
 * @param {!Array<string>} agreementIds
 * @param {number} startIndex
 * @param {number=} batchSize
 * @return {{
 *   ok: boolean,
 *   results: !Array<{ agreementId: string, payload: !Object }>,
 *   failures: !Array<{ agreementId: string, message: string, warnings?: !Array<string> }>,
 *   startIndex: number,
 *   processed: number,
 *   nextIndex: number,
 *   total: number,
 *   done: boolean
 * }}
 */
function getPortfolioProjectPnLBatch(agreementIds, startIndex, batchSize) {
  var auth = requireAuthForApi_();
  requirePortfolioPnlAccess_(auth);
  var ids = agreementIds || [];
  var start = Math.max(0, Number(startIndex) || 0);
  var limit = Number(batchSize);
  if (!isFinite(limit) || limit < 1) {
    limit = PORTFOLIO_PNL_BATCH_SIZE_DEFAULT_;
  }
  limit = Math.min(4, Math.max(1, Math.round(limit)));
  var slice = ids.slice(start, start + limit);
  var results = [];
  var failures = [];
  for (var i = 0; i < slice.length; i++) {
    var agreementId = slice[i];
    try {
      var pnl = buildDeliveryProjectMonthlyPnLInternal_(agreementId);
      if (pnl && pnl.ok === true) {
        results.push({ agreementId: agreementId, payload: pnl });
      } else {
        failures.push({
          agreementId: agreementId,
          message: (pnl && pnl.message) || 'P&L returned no monthly rows.',
          warnings: pnl && pnl.warnings ? pnl.warnings : undefined,
        });
      }
    } catch (e) {
      failures.push({
        agreementId: agreementId,
        message: e && e.message ? e.message : String(e),
      });
    }
  }
  var next = start + slice.length;
  return {
    ok: true,
    results: results,
    failures: failures,
    startIndex: start,
    processed: slice.length,
    nextIndex: next,
    total: ids.length,
    done: next >= ids.length,
  };
}

/**
 * @param {!Array<string>} agreementIds
 * @return {!Object}
 * @private
 */
function _diag_portfolioPnLBatchProbe(agreementIds) {
  var ids = agreementIds || [];
  if (!ids.length) {
    var idx = getPortfolioProjectIndex();
    ids = (idx.projects || []).slice(0, 5).map(function (p) { return p.id; });
  }
  return getPortfolioProjectPnLBatch(ids, 0, 2);
}

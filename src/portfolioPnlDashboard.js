/**
 * PRD version 2.17.1 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Portfolio Project P&L (Finance route `portfolio-pnl`, features 022 + 025).
 * Returns the in-scope project index and bundled monthly P&L payloads
 * (Drive daily cache, Fibery slim builder, or snapshot portfolio-pnl.json).
 */

/** @const {number} */
var PORTFOLIO_PNL_INDEX_CACHE_SCHEMA_VERSION_ = 1;

/** @const {!Array<string>} Agreement types included in portfolio P&L. */
var PORTFOLIO_PNL_AGREEMENT_TYPES_ = ['Subscription', 'Services'];

/** Default agreements processed per batch (legacy batch API). */
var PORTFOLIO_PNL_BATCH_SIZE_DEFAULT_ = 3;

/** @const {string} */
var PORTFOLIO_PNL_BATCH_SIZE_PROP_ = 'PORTFOLIO_PNL_BATCH_SIZE';

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
 * @return {number}
 * @private
 */
function resolvePortfolioPnlBatchSize_() {
  var raw = PropertiesService.getScriptProperties().getProperty(PORTFOLIO_PNL_BATCH_SIZE_PROP_);
  var n = parseInt(raw, 10);
  if (!isFinite(n) || n < 1) {
    n = PORTFOLIO_PNL_BATCH_SIZE_DEFAULT_;
  }
  return Math.min(4, Math.max(1, Math.round(n)));
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
 * @return {!Object}
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
 * Live Portfolio P&L bundle (Drive daily cache or Fibery slim builder).
 *
 * @param {boolean=} forceRefresh When true, rebuild today's Drive cache from Fibery.
 * @return {!Object}
 */
function getPortfolioPnLDashboardData(forceRefresh) {
  var auth = requireAuthForApi_();
  requirePortfolioPnlAccess_(auth);
  var refresh = forceRefresh === true;
  var cacheDateKey = resolveSnapshotDateKey_(new Date());

  if (isPortfolioPnlDriveCacheEnabled_()) {
    var cacheResult = loadOrBuildPortfolioPnlDriveCache_(cacheDateKey, refresh);
    if (cacheResult.ok && cacheResult.bundle) {
      return portfolioPnlDashboardPayloadFromBundle_(
        cacheResult.bundle,
        !!cacheResult.fromDrive,
        cacheDateKey
      );
    }
    if (!cacheResult.ok && cacheResult.message) {
      return cacheResult;
    }
  }

  var built = buildPortfolioPnlBundleFromFibery_();
  if (!built.ok) {
    return built;
  }
  return portfolioPnlDashboardPayloadFromBundle_(built, false, null);
}

/**
 * Legacy batch API (diagnostics / fallback). Uses slim portfolio builder.
 *
 * @param {!Array<string>} agreementIds
 * @param {number} startIndex
 * @param {number=} batchSize
 * @return {!Object}
 */
function getPortfolioProjectPnLBatch(agreementIds, startIndex, batchSize) {
  var auth = requireAuthForApi_();
  requirePortfolioPnlAccess_(auth);
  var ids = agreementIds || [];
  var start = Math.max(0, Number(startIndex) || 0);
  var limit = Number(batchSize);
  if (!isFinite(limit) || limit < 1) {
    limit = resolvePortfolioPnlBatchSize_();
  }
  limit = Math.min(4, Math.max(1, Math.round(limit)));
  var slice = ids.slice(start, start + limit);
  var results = [];
  var failures = [];
  for (var i = 0; i < slice.length; i++) {
    var agreementId = slice[i];
    try {
      var pnl = buildPortfolioMonthlyPnLInternal_(agreementId);
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
    batchSize: limit,
  };
}

/**
 * @return {!Object}
 * @private
 */
function _diag_samplePortfolioProjectIndex() {
  return getPortfolioProjectIndex();
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
  return getPortfolioProjectPnLBatch(ids, 0, resolvePortfolioPnlBatchSize_());
}

/**
 * @return {!Object}
 * @private
 */
function _diag_portfolioPnLDashboardSample() {
  return getPortfolioPnLDashboardData(false);
}

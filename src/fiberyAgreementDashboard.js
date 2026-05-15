/**
 * PRD version 1.27.3 — sync with docs/FOS-Dashboard-PRD.md
 *
 * Agreement Dashboard orchestrator (route id `agreement-dashboard`, panel
 * `#panel-agreement-dashboard`). No persistent server-side cache
 * of payloads — Fibery is source of truth. The browser owns presentation cache
 * (`sessionStorage`) with a configurable TTL surfaced through
 * `getAgreementCacheTtlMinutes()` (Script Property `AGREEMENT_CACHE_TTL_MINUTES`,
 * default 10).
 *
 * Public surface (client-callable via google.script.run):
 *   getAgreementDashboardData()      — returns the full view-model payload.
 *   getAgreementCacheTtlMinutes()    — returns the configured default TTL.
 *
 * Internal diagnostics (run from the Apps Script editor):
 *   _diag_pingFibery()               — verifies host + token reach Fibery.
 *   _diag_sampleAgreementPayload()   — dumps a 1-agreement / 1-company sample.
 */

/** @const {number} Bumped when the client cache shape changes. */
var AGREEMENT_DASHBOARD_CACHE_SCHEMA_VERSION_ = 3;

/** @const {number} Default TTL (minutes) for the client-side cache. */
var AGREEMENT_DEFAULT_CACHE_TTL_MIN_ = 10;

/** @const {string} */
var AGREEMENT_CACHE_TTL_PROP_ = 'AGREEMENT_CACHE_TTL_MINUTES';

/** @const {number} Per-query result cap (matches agreement PRD §4.1). */
var AGREEMENT_QUERY_LIMIT_ = 1000;

/**
 * Returns the configured default TTL (minutes) for the agreement dashboard
 * client cache. Floored at 1 minute; falsy / non-positive values fall back to
 * the 10-minute default. The browser may override per-user via a localStorage
 * preference (FR-56b); this value is the seed.
 *
 * @return {number}
 */
function getAgreementCacheTtlMinutes() {
  requireAuthForApi_();
  return resolveAgreementCacheTtlMinutes_();
}

/**
 * Returns normalized agreement dashboard JSON for the Agreement Dashboard panel.
 * Re-checks spreadsheet authorization via requireAuthForApi_().
 *
 * @return {{
 *   ok: boolean,
 *   partial?: boolean,
 *   source: string,
 *   fetchedAt: string,
 *   cacheSchemaVersion: number,
 *   ttlMinutes: number,
 *   agreements: !Array<!Object>,
 *   companies: !Array<!Object>,
 *   futureRevenueItems: !Array<!Object>,
 *   historicalRevenueItems: !Array<!Object>,
 *   kpis: !Object,
 *   alerts: !Array<!Object>,
 *   charts: !Object,
 *   financialTable: !Object,
 *   warnings?: !Array<string>,
 *   message?: string
 * }}
 */
function getAgreementDashboardData() {
  requireAuthForApi_();

  var now = new Date();
  var fetchedAtIso = now.toISOString();
  var todayIso = formatDateOnlyIso_(now);
  var ttlMinutes = resolveAgreementCacheTtlMinutes_();
  var thresholds = getAgreementThresholds_();

  var batchResult = fiberyBatchQuery_([
    buildAgreementsQuery_(),
    buildCompaniesQuery_(),
    buildHistoricalRevenueItemsQuery_(),
    buildFutureRevenueItemsQuery_(todayIso),
  ]);

  if (!batchResult.ok) {
    return {
      ok: false,
      source: 'fibery',
      fetchedAt: fetchedAtIso,
      cacheSchemaVersion: AGREEMENT_DASHBOARD_CACHE_SCHEMA_VERSION_,
      ttlMinutes: ttlMinutes,
      agreements: [],
      companies: [],
      futureRevenueItems: [],
      historicalRevenueItems: [],
      kpis: emptyKpis_(),
      alerts: [],
      charts: emptyCharts_(),
      financialTable: emptyFinancialTable_(),
      customerCards: [],
      forwardPipeline: emptyForwardPipeline_(),
      sankey: emptySankey_(),
      message: batchResult.message || 'Could not load agreement data from Fibery.',
      warnings: ['Fibery error: ' + (batchResult.reason || 'UNKNOWN')],
    };
  }

  var rawAgreements = batchResult.results[0] || [];
  var rawCompanies = batchResult.results[1] || [];
  var rawHistRevItems = batchResult.results[2] || [];
  var rawFutureRevItems = batchResult.results[3] || [];

  var companies = normalizeCompanies_(rawCompanies);
  var futureRevenueItems = normalizeRevenueItems_(rawFutureRevItems);
  var historicalRevenueItems = normalizeRevenueItems_(rawHistRevItems);
  var agreements = normalizeAgreements_(rawAgreements);

  enrichAgreementsWithRevenueItems_(agreements, futureRevenueItems, historicalRevenueItems);
  var revenueItemsByAgreement = groupRevenueItemsByAgreement_(historicalRevenueItems, futureRevenueItems);

  var companyByName = indexByLowercaseName_(companies);
  var customerOrder = buildCustomerOrder_(companies, thresholds);
  var customerColorMap = buildCustomerColorMap_(customerOrder, thresholds.customerPalette);

  var kpis = computeKpis_(agreements, companies, companyByName, thresholds);
  var alerts = evaluateAlerts_(agreements, futureRevenueItems, thresholds);
  var charts = buildChartViewModels_(agreements, companies, companyByName, customerColorMap, thresholds);
  var financialTable = buildFinancialTable_(agreements, kpis.topCustomerName, thresholds);
  var customerCards = buildCustomerCards_(companies, customerColorMap, thresholds);
  var forwardPipeline = buildForwardPipeline_(agreements, futureRevenueItems, customerColorMap, thresholds);
  var sankey = buildSankey_(agreements, customerColorMap, thresholds);

  return {
    ok: true,
    source: 'fibery',
    fetchedAt: fetchedAtIso,
    cacheSchemaVersion: AGREEMENT_DASHBOARD_CACHE_SCHEMA_VERSION_,
    ttlMinutes: ttlMinutes,
    agreements: agreements,
    companies: companies,
    futureRevenueItems: futureRevenueItems,
    historicalRevenueItems: historicalRevenueItems,
    revenueItemsByAgreement: revenueItemsByAgreement,
    kpis: kpis,
    alerts: alerts,
    charts: charts,
    financialTable: financialTable,
    customerCards: customerCards,
    forwardPipeline: forwardPipeline,
    sankey: sankey,
  };
}

/* ------------------------------------------------------------------------- */
/* Diagnostics — run manually from the Apps Script editor.                    */
/* ------------------------------------------------------------------------- */

/**
 * Lightweight credential / connectivity check. Logs the workspace version when
 * `FIBERY_HOST` + `FIBERY_API_TOKEN` are set correctly.
 * @return {!Object}
 */
function _diag_pingFibery() {
  var r = fiberyPing_();
  console.log('fiberyPing_ →', JSON.stringify(r));
  return r;
}

/**
 * One-of-each shape probe. Logs the first raw row from each of the four queries
 * (truncated). Useful for verifying field paths after a workspace schema change.
 * @return {!Object}
 */
function _diag_sampleAgreementPayload() {
  var todayIso = formatDateOnlyIso_(new Date());
  var batch = fiberyBatchQuery_([
    buildAgreementsQuery_(),
    buildCompaniesQuery_(),
    buildHistoricalRevenueItemsQuery_(),
    buildFutureRevenueItemsQuery_(todayIso),
  ]);
  var summary = {
    ok: batch.ok,
    reason: batch.ok ? null : batch.reason,
    samples: batch.ok
      ? {
          agreement: batch.results[0][0] || null,
          company: batch.results[1][0] || null,
          historicalRevenueItem: batch.results[2][0] || null,
          futureRevenueItem: batch.results[3][0] || null,
          counts: {
            agreements: batch.results[0].length,
            companies: batch.results[1].length,
            historicalRevenueItems: batch.results[2].length,
            futureRevenueItems: batch.results[3].length,
          },
        }
      : null,
    message: batch.message || null,
  };
  console.log('_diag_sampleAgreementPayload →', JSON.stringify(summary).slice(0, 4000));
  return summary;
}

/* ------------------------------------------------------------------------- */
/* Query builders (agreement PRD §4).                                         */
/* ------------------------------------------------------------------------- */

/**
 * §4.1 Agreements query. WHERE workflow/state ≠ "Closed-Lost".
 * @return {!Object}
 * @private
 */
function buildAgreementsQuery_() {
  return {
    query: {
      'q/from': 'Agreement Management/Agreements',
      'q/select': {
        id: 'fibery/id',
        publicId: 'fibery/public-id',
        name: 'Agreement Management/Name',
        state: ['workflow/state', 'enum/name'],
        type: ['Agreement Management/Agreement Type', 'enum/name'],
        progress: ['Agreement Management/Agreement Progress', 'enum/name'],
        customer: ['Agreement Management/Customer', 'Agreement Management/Name'],
        plannedRev: 'Agreement Management/Total Planned Revenue',
        revRec: 'Agreement Management/Rev Recognized',
        laborCosts: 'Agreement Management/Total Labor Costs',
        materialsOdc: 'Agreement Management/Total Materials & ODC',
        margin: 'Agreement Management/Current Margin',
        targetMargin: 'Agreement Management/Target Margin',
        // fibery/date-range is opaque inside q/select — its sub-fields (`start`, `end`)
        // are not addressable as a second segment. We select the whole range here and
        // unpack it in normalizeAgreements_().
        duration: 'Agreement Management/Duration',
        executionDate: 'Agreement Management/Execution Date',
      },
      'q/where': ['!=', ['workflow/state', 'enum/name'], '$closedLost'],
      // Fibery's REST `/api/commands` expects q/order-by as an array of
      // [[field-path-vector], direction] tuples — the field-path itself MUST be
      // wrapped in an array even for single-segment paths (same convention as
      // q/where). Bare-string keys produce the error
      // `Unknown order by expression {"v":"…"}`.
      'q/order-by': [[['Agreement Management/Total Planned Revenue'], 'q/desc']],
      'q/limit': AGREEMENT_QUERY_LIMIT_,
    },
    params: { $closedLost: 'Closed-Lost' },
  };
}

/**
 * §4.2 Companies query.
 * @return {!Object}
 * @private
 */
function buildCompaniesQuery_() {
  return {
    query: {
      'q/from': 'Agreement Management/Companies',
      'q/select': {
        id: 'fibery/id',
        publicId: 'fibery/public-id',
        name: 'Agreement Management/Name',
        funnelStage: ['Agreement Management/Funnel Stage', 'enum/name'],
        segment: ['Agreement Management/Segment', 'enum/name'],
        leadSource: ['Agreement Management/Lead Source', 'enum/name'],
        totalContractValue: 'Agreement Management/Total Customer Contract Value',
        ndaCompleted: 'Agreement Management/NDA Completed',
      },
      'q/limit': AGREEMENT_QUERY_LIMIT_,
    },
  };
}

/**
 * §4.3 Historical (recognized) revenue items.
 * @return {!Object}
 * @private
 */
function buildHistoricalRevenueItemsQuery_() {
  return {
    query: {
      'q/from': 'Agreement Management/Revenue Item',
      'q/select': {
        id: 'fibery/id',
        name: 'Agreement Management/Name',
        targetAmount: 'Agreement Management/Target Amount',
        actualAmount: 'Agreement Management/Actual Amount',
        targetDate: 'Agreement Management/Target Date',
        recognized: 'Agreement Management/Revenue Recognized',
        state: ['workflow/state', 'enum/name'],
        agreement: ['Agreement Management/Agreement', 'Agreement Management/Name'],
        agreementId: ['Agreement Management/Agreement', 'fibery/id'],
        // Revenue Item exposes the parent-agreement's customer via the
        // `Agreement Customer` lookup field (NOT a direct `Customer` relation).
        customer: ['Agreement Management/Agreement Customer', 'Agreement Management/Name'],
      },
      'q/where': ['=', ['Agreement Management/Revenue Recognized'], '$recognized'],
      'q/order-by': [[['Agreement Management/Target Date'], 'q/desc']],
      'q/limit': AGREEMENT_QUERY_LIMIT_,
    },
    params: { $recognized: true },
  };
}

/**
 * §4.4 Future (unrecognized, target-date > today) revenue items.
 * @param {string} todayIso  Date-only ISO string (yyyy-mm-dd).
 * @return {!Object}
 * @private
 */
function buildFutureRevenueItemsQuery_(todayIso) {
  return {
    query: {
      'q/from': 'Agreement Management/Revenue Item',
      'q/select': {
        id: 'fibery/id',
        name: 'Agreement Management/Name',
        targetAmount: 'Agreement Management/Target Amount',
        actualAmount: 'Agreement Management/Actual Amount',
        targetDate: 'Agreement Management/Target Date',
        recognized: 'Agreement Management/Revenue Recognized',
        state: ['workflow/state', 'enum/name'],
        agreement: ['Agreement Management/Agreement', 'Agreement Management/Name'],
        agreementId: ['Agreement Management/Agreement', 'fibery/id'],
        customer: ['Agreement Management/Agreement Customer', 'Agreement Management/Name'],
      },
      'q/where': [
        'q/and',
        ['=', ['Agreement Management/Revenue Recognized'], '$recognized'],
        ['>', ['Agreement Management/Target Date'], '$today'],
      ],
      'q/order-by': [[['Agreement Management/Target Date'], 'q/asc']],
      'q/limit': AGREEMENT_QUERY_LIMIT_,
    },
    params: { $recognized: false, $today: todayIso },
  };
}

/* ------------------------------------------------------------------------- */
/* Normalization. Fibery selects with object form return the keys we asked    */
/* for, but values may be null / missing — defend everywhere.                  */
/* ------------------------------------------------------------------------- */

/** @private */
function normalizeAgreements_(rows) {
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i] || {};
    // Fibery returns `Duration` as a `{ start, end }` object (or null when unset).
    var dur = r.duration && typeof r.duration === 'object' ? r.duration : null;
    out.push({
      id: stringOr_(r.id, ''),
      publicId: stringOr_(r.publicId, ''),
      name: stringOr_(r.name, '(Unnamed agreement)'),
      state: stringOrNull_(r.state),
      type: stringOrNull_(r.type),
      progress: stringOrNull_(r.progress),
      customer: stringOrNull_(r.customer),
      plannedRev: numberOr_(r.plannedRev, 0),
      revRec: numberOr_(r.revRec, 0),
      laborCosts: numberOr_(r.laborCosts, 0),
      materialsOdc: numberOr_(r.materialsOdc, 0),
      // Fibery stores Current/Target Margin as a 0–1 decimal fraction (e.g. 0.67
      // for 67%). PRD §6/§8 thresholds (low margin = 35, bucket cutoffs 35/60)
      // are in percent units, so we normalize once here and let the rest of the
      // pipeline stay in percent space.
      margin: scaleFractionToPercent_(r.margin),
      targetMargin: scaleFractionToPercent_(r.targetMargin),
      durStart: dur ? stringOrNull_(dur.start) : null,
      durEnd: dur ? stringOrNull_(dur.end) : null,
      executionDate: stringOrNull_(r.executionDate),
      revenueItemCount: 0,
      futureRevenueItemCount: 0,
      schedulingStatus: 'No Pipeline Items',
    });
  }
  return out;
}

/** @private */
function normalizeCompanies_(rows) {
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i] || {};
    // `Segment` is a multi-select enum in Fibery — returned as an Array<string>
    // (possibly empty). Preserve the full array for later filters, and surface a
    // joined display string for any UI that wants a single value.
    var segments = Array.isArray(r.segment) ? r.segment.slice() : (r.segment ? [String(r.segment)] : []);
    out.push({
      id: stringOr_(r.id, ''),
      publicId: stringOr_(r.publicId, ''),
      name: stringOr_(r.name, '(Unnamed company)'),
      funnelStage: stringOrNull_(r.funnelStage),
      segments: segments,
      segment: segments.length ? segments.join(', ') : null,
      leadSource: stringOrNull_(r.leadSource),
      totalContractValue: numberOr_(r.totalContractValue, 0),
      ndaCompleted: r.ndaCompleted === true,
      agreementCount: 0,
    });
  }
  return out;
}

/** @private */
function normalizeRevenueItems_(rows) {
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i] || {};
    out.push({
      id: stringOr_(r.id, ''),
      name: stringOr_(r.name, ''),
      targetAmount: numberOr_(r.targetAmount, 0),
      actualAmount: numberOr_(r.actualAmount, 0),
      targetDate: stringOrNull_(r.targetDate),
      recognized: r.recognized === true,
      state: stringOrNull_(r.state),
      agreement: stringOrNull_(r.agreement),
      agreementId: stringOrNull_(r.agreementId),
      customer: stringOrNull_(r.customer),
    });
  }
  return out;
}

/**
 * Per-agreement counts + §5.6 scheduling status, plus per-company agreement
 * counts. Mutates the input arrays.
 *
 * @param {!Array<!Object>} agreements
 * @param {!Array<!Object>} futureItems
 * @param {!Array<!Object>} historicalItems
 * @private
 */
function enrichAgreementsWithRevenueItems_(agreements, futureItems, historicalItems) {
  var futureByAgreementId = {};
  var totalByAgreementId = {};

  for (var i = 0; i < futureItems.length; i++) {
    var f = futureItems[i];
    if (!f.agreementId) {
      continue;
    }
    if (!futureByAgreementId[f.agreementId]) {
      futureByAgreementId[f.agreementId] = [];
    }
    futureByAgreementId[f.agreementId].push(f);
    totalByAgreementId[f.agreementId] = (totalByAgreementId[f.agreementId] || 0) + 1;
  }
  for (var j = 0; j < historicalItems.length; j++) {
    var h = historicalItems[j];
    if (!h.agreementId) {
      continue;
    }
    totalByAgreementId[h.agreementId] = (totalByAgreementId[h.agreementId] || 0) + 1;
  }

  for (var k = 0; k < agreements.length; k++) {
    var a = agreements[k];
    var futures = futureByAgreementId[a.id] || [];
    a.futureRevenueItemCount = futures.length;
    a.revenueItemCount = totalByAgreementId[a.id] || 0;
    a.schedulingStatus = deriveSchedulingStatus_(a, futures);
  }
}

/**
 * Re-keys the historical + future revenue items by agreementId so the client
 * can show an agreement's milestones in a dialog without re-fetching from
 * Fibery (FR-86, v1.18.0). Items without an agreementId are dropped because
 * they cannot be attributed to a row in the Financial Performance table.
 * Within each agreement the items are sorted by targetDate ascending; rows
 * with a null targetDate sort last so they don't visually crowd the top of
 * the milestones table. Each bucket row carries agreementId, agreement,
 * and customer so clients (Revenue review tree, milestones modal) can join
 * back to agreements without a second fetch.
 *
 * @param {!Array<!Object>} historicalItems Normalized historical items.
 * @param {!Array<!Object>} futureItems Normalized future items.
 * @return {!Object<string, !Array<!Object>>}
 * @private
 */
function groupRevenueItemsByAgreement_(historicalItems, futureItems) {
  var byId = {};
  function push(item) {
    if (!item || !item.agreementId) return;
    var bucket = byId[item.agreementId];
    if (!bucket) {
      bucket = [];
      byId[item.agreementId] = bucket;
    }
    bucket.push({
      id: item.id,
      name: item.name,
      targetAmount: item.targetAmount,
      actualAmount: item.actualAmount,
      targetDate: item.targetDate,
      recognized: item.recognized === true,
      state: item.state,
      // Preserve attribution fields for clients (Revenue review milestone
      // tree, CSV, drill-downs). Omitting them left every row without
      // agreementId/customer so UI fell back to "(Unknown)" / "—".
      agreementId: item.agreementId,
      agreement: item.agreement,
      customer: item.customer,
    });
  }
  for (var i = 0; i < historicalItems.length; i++) push(historicalItems[i]);
  for (var j = 0; j < futureItems.length; j++) push(futureItems[j]);

  var keys = Object.keys(byId);
  for (var k = 0; k < keys.length; k++) {
    byId[keys[k]].sort(function (a, b) {
      var ad = a.targetDate || '';
      var bd = b.targetDate || '';
      if (!ad && !bd) return 0;
      if (!ad) return 1;
      if (!bd) return -1;
      return ad < bd ? -1 : (ad > bd ? 1 : 0);
    });
  }
  return byId;
}

/**
 * §5.6 scheduling status.
 * @param {!Object} agreement
 * @param {!Array<!Object>} futureItems
 * @return {string}
 * @private
 */
function deriveSchedulingStatus_(agreement, futureItems) {
  if (!futureItems.length) {
    return agreement.state === 'Delivery In Progress' ? 'No Pipeline Items' : 'No Pipeline Items';
  }
  var scheduled = 0;
  var notScheduled = 0;
  for (var i = 0; i < futureItems.length; i++) {
    var s = futureItems[i].state;
    if (s === 'Scheduled') {
      scheduled++;
    } else if (s === 'Not Scheduled') {
      notScheduled++;
    }
  }
  if (notScheduled > 0 && scheduled === 0) {
    return 'Not Scheduled';
  }
  if (notScheduled > 0 && scheduled > 0) {
    return 'Partially Scheduled';
  }
  return 'Fully Scheduled';
}

/* ------------------------------------------------------------------------- */
/* KPI computation (agreement PRD §7.2 + §5.2/§5.3).                          */
/* ------------------------------------------------------------------------- */

/**
 * @param {!Array<!Object>} agreements
 * @param {!Array<!Object>} companies
 * @param {!Object<string,!Object>} companyByName
 * @param {!Object} thresholds
 * @return {!Object}
 * @private
 */
function computeKpis_(agreements, companies, companyByName, thresholds) {
  var activeAgreements = [];
  var externalCustomerSet = {};
  var inDeliveryCount = 0;
  var proposalsCount = 0;
  var completeCount = 0;
  var tcv = 0;
  var revRec = 0;
  var portfolioPlanned = 0;
  var worstNegativeMargin = null; // { value, agreement }
  var lowestPositiveMargin = null;
  var topCustomerName = '—';
  var topCustomerValue = 0;
  var topCustomerSowCount = 0;

  for (var i = 0; i < agreements.length; i++) {
    var a = agreements[i];
    var isInternalType = a.type === 'Internal';
    if (!isInternalType) {
      activeAgreements.push(a);
      tcv += Number(a.plannedRev || 0);
      revRec += Number(a.revRec || 0);
      portfolioPlanned += Number(a.plannedRev || 0);
      if (a.customer) {
        externalCustomerSet[a.customer] = true;
      }
      if (a.margin !== null && a.margin !== undefined && !isNaN(a.margin)) {
        if (a.margin < 0) {
          if (!worstNegativeMargin || a.margin < worstNegativeMargin.value) {
            worstNegativeMargin = { value: a.margin, agreement: a.name };
          }
        } else if (a.margin >= 0) {
          if (!lowestPositiveMargin || a.margin < lowestPositiveMargin.value) {
            lowestPositiveMargin = { value: a.margin, agreement: a.name };
          }
        }
      }
    }
    if (a.state === 'Delivery In Progress') {
      inDeliveryCount++;
    } else if (a.state === 'Proposal Delivered') {
      proposalsCount++;
    } else if (a.state === 'Contract Complete') {
      completeCount++;
    }
  }

  // Top customer by Total Customer Contract Value (from Companies query, §5.4),
  // restricted to non-Internal companies.
  for (var j = 0; j < companies.length; j++) {
    var c = companies[j];
    if (isInternalCompany_(c, thresholds.internalCompanyNames)) {
      continue;
    }
    if (Number(c.totalContractValue || 0) > topCustomerValue) {
      topCustomerValue = Number(c.totalContractValue || 0);
      topCustomerName = c.name;
    }
  }

  // Cross-link agreement counts onto companies.
  for (var k = 0; k < agreements.length; k++) {
    var ag = agreements[k];
    if (!ag.customer) {
      continue;
    }
    var co = companyByName[ag.customer.toLowerCase()];
    if (co) {
      co.agreementCount += 1;
    }
    if (ag.customer === topCustomerName) {
      topCustomerSowCount++;
    }
  }

  var recognitionRate = portfolioPlanned > 0 ? (revRec / portfolioPlanned) * 100 : 0;
  var portfolioPct = tcv > 0 ? (topCustomerValue / tcv) * 100 : 0;

  var flagged = pickFlaggedMargin_(worstNegativeMargin, lowestPositiveMargin);

  return {
    totalAgreements: activeAgreements.length,
    externalCustomers: Object.keys(externalCustomerSet).length,
    totalContractValue: tcv,
    revenueRecognized: revRec,
    portfolioRecognitionRate: recognitionRate,
    inDeliveryCount: inDeliveryCount,
    proposalsCount: proposalsCount,
    completeCount: completeCount,
    topCustomerName: topCustomerName,
    topCustomerPortfolioPct: portfolioPct,
    topCustomerSowCount: topCustomerSowCount,
    flaggedMarginPct: flagged.pct,
    flaggedMarginIsNegative: flagged.isNegative,
    flaggedMarginAgreement: flagged.agreement,
  };
}

/**
 * §7.2 "Flagged margin" rule: worst negative if any exists; otherwise the
 * lowest non-negative; otherwise null.
 * @private
 */
function pickFlaggedMargin_(worstNeg, lowestPos) {
  if (worstNeg) {
    return { pct: worstNeg.value, isNegative: true, agreement: worstNeg.agreement };
  }
  if (lowestPos) {
    return { pct: lowestPos.value, isNegative: false, agreement: lowestPos.agreement };
  }
  return { pct: null, isNegative: false, agreement: '—' };
}

/* ------------------------------------------------------------------------- */
/* Chart view models (§7.3, §7.4, §7.9, §7.10).                                */
/* ------------------------------------------------------------------------- */

/** @private */
function buildChartViewModels_(agreements, companies, companyByName, customerColorMap, thresholds) {
  return {
    statusDonut: buildStatusDonut_(agreements, thresholds),
    typeDonut: buildTypeDonut_(agreements, thresholds),
    recognitionStack: buildRecognitionStack_(agreements, thresholds),
    customerBar: buildCustomerBar_(companies, companyByName, customerColorMap, thresholds),
  };
}

/** §7.3 Agreement Status Donut. */
function buildStatusDonut_(agreements, thresholds) {
  var byState = {};
  for (var i = 0; i < agreements.length; i++) {
    var s = agreements[i].state || '(No Status)';
    byState[s] = (byState[s] || 0) + 1;
  }
  var labels = Object.keys(byState).sort();
  var values = [];
  var colors = [];
  var total = 0;
  for (var j = 0; j < labels.length; j++) {
    values.push(byState[labels[j]]);
    colors.push(thresholds.workflowStateColor[labels[j]] || thresholds.workflowStateColorFallback);
    total += byState[labels[j]];
  }
  return { labels: labels, values: values, colors: colors, total: total };
}

/** §7.10 Agreement Type Mix Donut. */
function buildTypeDonut_(agreements, thresholds) {
  var byType = {};
  for (var i = 0; i < agreements.length; i++) {
    var t = agreements[i].type || '(No Type)';
    byType[t] = (byType[t] || 0) + 1;
  }
  var labels = Object.keys(byType).sort();
  var values = [];
  var colors = [];
  var total = 0;
  for (var j = 0; j < labels.length; j++) {
    values.push(byType[labels[j]]);
    colors.push(thresholds.agreementTypeColor[labels[j]] || thresholds.agreementTypeColorFallback);
    total += byType[labels[j]];
  }
  return { labels: labels, values: values, colors: colors, total: total };
}

/** §7.9 Revenue Recognition Progress (top-N stacked bar; exclude Internal / zero-planned). */
function buildRecognitionStack_(agreements, thresholds) {
  var eligible = [];
  for (var i = 0; i < agreements.length; i++) {
    var a = agreements[i];
    if (a.type === 'Internal') {
      continue;
    }
    if (!a.plannedRev || a.plannedRev <= 0) {
      continue;
    }
    eligible.push(a);
  }
  eligible.sort(function (x, y) {
    return Number(y.plannedRev || 0) - Number(x.plannedRev || 0);
  });
  var capped = eligible.slice(0, thresholds.topNRecognition);

  var names = [];
  var recognized = [];
  var remaining = [];
  for (var j = 0; j < capped.length; j++) {
    var a2 = capped[j];
    names.push(truncateName_(a2.name, 25));
    var r = Number(a2.revRec || 0);
    var p = Number(a2.plannedRev || 0);
    recognized.push(r);
    remaining.push(Math.max(0, p - r));
  }
  return {
    agreementNames: names,
    recognized: recognized,
    remaining: remaining,
    recognizedColor: '#43d6ba',
    remainingColor: '#1a4060',
  };
}

/** §7.4 Customer Contract Value horizontal bar. */
function buildCustomerBar_(companies, companyByName, customerColorMap, thresholds) {
  var eligible = [];
  for (var i = 0; i < companies.length; i++) {
    var c = companies[i];
    if (isInternalCompany_(c, thresholds.internalCompanyNames)) {
      continue;
    }
    if (!c.agreementCount || c.agreementCount === 0) {
      continue;
    }
    if (!Number(c.totalContractValue) || Number(c.totalContractValue) <= 0) {
      continue;
    }
    eligible.push(c);
  }
  eligible.sort(function (x, y) {
    return Number(y.totalContractValue || 0) - Number(x.totalContractValue || 0);
  });

  var names = [];
  var values = [];
  var colors = [];
  for (var j = 0; j < eligible.length; j++) {
    var c2 = eligible[j];
    names.push(c2.name);
    values.push(Number(c2.totalContractValue || 0));
    colors.push(customerColorMap[c2.name] || thresholds.customerPalette[j % thresholds.customerPalette.length]);
  }
  return { customerNames: names, values: values, colors: colors };
}

/* ------------------------------------------------------------------------- */
/* Financial Performance Table (§7.5).                                        */
/* ------------------------------------------------------------------------- */

/** @private */
function buildFinancialTable_(agreements, topCustomerName, thresholds) {
  var rows = [];
  for (var i = 0; i < agreements.length; i++) {
    var a = agreements[i];
    if (a.type === 'Internal') {
      continue;
    }
    rows.push(buildFinancialRow_(a, thresholds));
  }
  rows.sort(function (x, y) {
    return Number(y.planned || 0) - Number(x.planned || 0);
  });

  var topRows = [];
  var otherRows = [];
  if (topCustomerName && topCustomerName !== '—') {
    for (var j = 0; j < rows.length; j++) {
      if (rows[j].customer === topCustomerName) {
        topRows.push(rows[j]);
      } else {
        otherRows.push(rows[j]);
      }
    }
  } else {
    otherRows = rows.slice();
  }

  return {
    topCustomerName: topCustomerName,
    tabs: {
      allActive: rows,
      topCustomer: topRows,
      otherCustomers: otherRows,
    },
  };
}

/** @private */
function buildFinancialRow_(a, thresholds) {
  return {
    id: a.id,
    publicId: a.publicId || '',
    name: a.name,
    customer: a.customer || '—',
    type: a.type || '—',
    state: a.state || '—',
    typeColor: thresholds.agreementTypeColor[a.type] || thresholds.agreementTypeColorFallback,
    stateColor: thresholds.workflowStateColor[a.state] || thresholds.workflowStateColorFallback,
    planned: Number(a.plannedRev || 0),
    recognized: Number(a.revRec || 0),
    margin: a.margin,
    marginColor: marginBucketColor_(a.margin, thresholds.lowMargin),
  };
}

/* ------------------------------------------------------------------------- */
/* Customer Relationship Cards (§7.6)                                         */
/* ------------------------------------------------------------------------- */

/**
 * Builds the §7.6 view model: one card per company, sorted by TCV desc with
 * internal companies pushed to the bottom. Each card carries the data the
 * client needs for direct render (no further enrichment required).
 *
 * @param {!Array<!Object>} companies   Normalized companies (with agreementCount).
 * @param {!Object<string,string>} customerColorMap
 * @param {!Object} thresholds
 * @return {!Array<!Object>}
 * @private
 */
function buildCustomerCards_(companies, customerColorMap, thresholds) {
  var cards = [];
  for (var i = 0; i < companies.length; i++) {
    var c = companies[i];
    var isInternal = isInternalCompany_(c, thresholds.internalCompanyNames);
    cards.push({
      id: c.id,
      name: c.name,
      initials: computeInitials_(c.name),
      color: isInternal
        ? thresholds.agreementTypeColor.Internal || '#2a5a7a'
        : customerColorMap[c.name] || thresholds.customerPalette[i % thresholds.customerPalette.length],
      agreementCount: c.agreementCount || 0,
      funnelStage: c.funnelStage || '—',
      segment: c.segment || (isInternal ? 'Internal' : '—'),
      ndaCompleted: c.ndaCompleted === true,
      totalContractValue: Number(c.totalContractValue || 0),
      isInternal: isInternal,
    });
  }
  cards.sort(function (a, b) {
    if (a.isInternal !== b.isInternal) {
      return a.isInternal ? 1 : -1;
    }
    return Number(b.totalContractValue || 0) - Number(a.totalContractValue || 0);
  });
  return cards;
}

/**
 * @param {?string} name
 * @return {string}  Up to 3 uppercase initials, falling back to "??".
 * @private
 */
function computeInitials_(name) {
  var s = String(name || '').trim();
  if (!s) {
    return '??';
  }
  var parts = s.split(/\s+/);
  var letters = '';
  for (var i = 0; i < parts.length && letters.length < 3; i++) {
    var first = parts[i].charAt(0);
    if (/[A-Za-z0-9]/.test(first)) {
      letters += first.toUpperCase();
    }
  }
  if (!letters) {
    letters = s.slice(0, 2).toUpperCase();
  }
  return letters;
}

/* ------------------------------------------------------------------------- */
/* Forward Revenue Pipeline (§7.8 + §5.5)                                     */
/* ------------------------------------------------------------------------- */

/**
 * Builds the §7.8 view model. One row per non-Internal agreement, with the
 * §5.5 monthly billing rate derived from its future revenue items. Agreements
 * that are still active but have no future items are surfaced with a null
 * monthly rate so the client can render the "no pipeline items" treatment.
 *
 * Result is sorted by monthly rate desc (nulls last). Used directly by the
 * client horizontal-bar chart.
 *
 * @param {!Array<!Object>} agreements
 * @param {!Array<!Object>} futureItems
 * @param {!Object<string,string>} customerColorMap
 * @param {!Object} thresholds
 * @return {!{ rows: !Array<!Object>, maxMonthlyRate: number }}
 * @private
 */
function buildForwardPipeline_(agreements, futureItems, customerColorMap, thresholds) {
  // Group future items by agreement id and collect the distinct calendar
  // months they span (formula §5.5).
  var byAgreement = {};
  for (var i = 0; i < futureItems.length; i++) {
    var f = futureItems[i];
    if (!f.agreementId) {
      continue;
    }
    if (!byAgreement[f.agreementId]) {
      byAgreement[f.agreementId] = { total: 0, months: {} };
    }
    var bucket = byAgreement[f.agreementId];
    bucket.total += Number(f.targetAmount || 0);
    var monthKey = extractYearMonth_(f.targetDate);
    if (monthKey) {
      bucket.months[monthKey] = true;
    }
  }

  var rows = [];
  for (var j = 0; j < agreements.length; j++) {
    var a = agreements[j];
    if (a.type === 'Internal') {
      continue;
    }
    var stats = byAgreement[a.id];
    // §7.8: "Each bar represents one agreement with future scheduled revenue
    // items." Agreements with no future items are surfaced separately via the
    // §6.5 "no pipeline data" attention alert, so they're skipped here.
    if (!stats || !stats.total) {
      continue;
    }
    var monthCount = Object.keys(stats.months).length;
    var monthlyRate = monthCount > 0 ? stats.total / monthCount : null;

    rows.push({
      agreementId: a.id,
      agreementName: a.name,
      customer: a.customer || '—',
      color: customerColorMap[a.customer] || thresholds.customerPalette[j % thresholds.customerPalette.length],
      monthlyRate: monthlyRate,
      totalFutureRevenue: stats.total,
      futureMonthCount: monthCount,
      schedulingStatus: a.schedulingStatus || 'Not Scheduled',
      futureRevenueItemCount: a.futureRevenueItemCount || 0,
    });
  }

  rows.sort(function (x, y) {
    var xr = x.monthlyRate === null ? -Infinity : Number(x.monthlyRate);
    var yr = y.monthlyRate === null ? -Infinity : Number(y.monthlyRate);
    return yr - xr;
  });

  var maxRate = 0;
  for (var k = 0; k < rows.length; k++) {
    var r = rows[k].monthlyRate;
    if (r !== null && r > maxRate) {
      maxRate = r;
    }
  }
  return { rows: rows, maxMonthlyRate: maxRate };
}

/**
 * @param {?string} isoDate  yyyy-mm-dd or yyyy-mm-ddTHH:MM:SSZ
 * @return {?string}         "yyyy-mm" or null
 * @private
 */
function extractYearMonth_(isoDate) {
  if (!isoDate) {
    return null;
  }
  var s = String(isoDate);
  if (s.length < 7) {
    return null;
  }
  return s.slice(0, 7);
}

/* ------------------------------------------------------------------------- */
/* Revenue Flow Sankey (§7.11)                                                */
/* ------------------------------------------------------------------------- */

/**
 * Builds the §7.11 Sankey view model: three node layers (Status, Customer,
 * Type) joined by two link sets (Status→Customer and Customer→Type). Values
 * are summed Total Planned Revenue. Internal-type agreements are excluded
 * unless the operator sets `AGREEMENT_SANKEY_INCLUDE_INTERNAL=true`.
 *
 * The output matches the contract documented in §7.11.7 — `nodes` carries
 * `{name, layer, color}` and `links` carries `{source, target, value}` with
 * 0-based indices into `nodes`. The opacity comes from `thresholds.sankeyLinkOpacity`.
 *
 * @param {!Array<!Object>} agreements
 * @param {!Object<string,string>} customerColorMap
 * @param {!Object} thresholds
 * @return {!{
 *   nodes: !Array<!Object>,
 *   links: !Array<!Object>,
 *   total: number,
 *   linkOpacity: number,
 *   includeInternal: boolean
 * }}
 * @private
 */
function buildSankey_(agreements, customerColorMap, thresholds) {
  var nodes = [];
  var nodeIndex = {};
  var linkIndex = {};
  var links = [];
  var total = 0;

  function getNode(name, layer, color) {
    var key = layer + '::' + name;
    if (!Object.prototype.hasOwnProperty.call(nodeIndex, key)) {
      nodeIndex[key] = nodes.length;
      nodes.push({ name: name, layer: layer, color: color });
    }
    return nodeIndex[key];
  }

  function addOrMergeLink(sourceIdx, targetIdx, value) {
    var key = sourceIdx + '|' + targetIdx;
    if (Object.prototype.hasOwnProperty.call(linkIndex, key)) {
      links[linkIndex[key]].value += value;
      return;
    }
    linkIndex[key] = links.length;
    links.push({ source: sourceIdx, target: targetIdx, value: value });
  }

  for (var i = 0; i < agreements.length; i++) {
    var a = agreements[i];
    if (!thresholds.sankeyIncludeInternal && a.type === 'Internal') {
      continue;
    }
    var planned = Number(a.plannedRev || 0);
    if (!planned || planned <= 0) {
      continue;
    }

    var statusName = a.state || '(No Status)';
    var customerName = a.customer || '(Unassigned)';
    var typeName = a.type || '(No Type)';

    var statusColor = thresholds.workflowStateColor[statusName] || thresholds.workflowStateColorFallback;
    var customerColor = customerColorMap[customerName] || '#4a5580';
    var typeColor = thresholds.agreementTypeColor[typeName] || thresholds.agreementTypeColorFallback;

    var sIdx = getNode(statusName, 'status', statusColor);
    var cIdx = getNode(customerName, 'customer', customerColor);
    var tIdx = getNode(typeName, 'type', typeColor);

    addOrMergeLink(sIdx, cIdx, planned);
    addOrMergeLink(cIdx, tIdx, planned);
    total += planned;
  }

  return {
    nodes: nodes,
    links: links,
    total: total,
    linkOpacity: thresholds.sankeyLinkOpacity,
    includeInternal: !!thresholds.sankeyIncludeInternal,
  };
}

/* ------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* ------------------------------------------------------------------------- */

/** @private */
function indexByLowercaseName_(companies) {
  var out = {};
  for (var i = 0; i < companies.length; i++) {
    out[String(companies[i].name || '').toLowerCase()] = companies[i];
  }
  return out;
}

/**
 * Returns the §8.5 customer order: non-internal companies sorted by TCV desc.
 * Color assignment cycles in this exact order for deterministic palettes.
 * @private
 */
function buildCustomerOrder_(companies, thresholds) {
  var eligible = [];
  for (var i = 0; i < companies.length; i++) {
    if (isInternalCompany_(companies[i], thresholds.internalCompanyNames)) {
      continue;
    }
    eligible.push(companies[i]);
  }
  eligible.sort(function (x, y) {
    return Number(y.totalContractValue || 0) - Number(x.totalContractValue || 0);
  });
  var names = [];
  for (var j = 0; j < eligible.length; j++) {
    names.push(eligible[j].name);
  }
  return names;
}

/** @private */
function resolveAgreementCacheTtlMinutes_() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(AGREEMENT_CACHE_TTL_PROP_);
  var n = parseFloat(String(raw || '').trim());
  if (!isFinite(n) || n <= 0) {
    return AGREEMENT_DEFAULT_CACHE_TTL_MIN_;
  }
  return Math.max(1, Math.round(n));
}

/** @private */
function emptyKpis_() {
  return {
    totalAgreements: 0,
    externalCustomers: 0,
    totalContractValue: 0,
    revenueRecognized: 0,
    portfolioRecognitionRate: 0,
    inDeliveryCount: 0,
    proposalsCount: 0,
    completeCount: 0,
    topCustomerName: '—',
    topCustomerPortfolioPct: 0,
    topCustomerSowCount: 0,
    flaggedMarginPct: null,
    flaggedMarginIsNegative: false,
    flaggedMarginAgreement: '—',
  };
}

/** @private */
function emptyCharts_() {
  return {
    statusDonut: { labels: [], values: [], colors: [], total: 0 },
    typeDonut: { labels: [], values: [], colors: [], total: 0 },
    recognitionStack: {
      agreementNames: [],
      recognized: [],
      remaining: [],
      recognizedColor: '#43d6ba',
      remainingColor: '#1a4060',
    },
    customerBar: { customerNames: [], values: [], colors: [] },
  };
}

/** @private */
function emptyFinancialTable_() {
  return {
    topCustomerName: '—',
    tabs: { allActive: [], topCustomer: [], otherCustomers: [] },
  };
}

/** @private */
function emptyForwardPipeline_() {
  return { rows: [], maxMonthlyRate: 0 };
}

/** @private */
function emptySankey_() {
  return { nodes: [], links: [], total: 0, linkOpacity: 0.35, includeInternal: false };
}

/** @private */
function truncateName_(s, maxLen) {
  if (!s) {
    return '';
  }
  var str = String(s);
  if (str.length <= maxLen) {
    return str;
  }
  return str.slice(0, Math.max(1, maxLen - 1)) + '…';
}

/** @private */
function formatDateOnlyIso_(d) {
  var y = d.getUTCFullYear();
  var m = d.getUTCMonth() + 1;
  var dd = d.getUTCDate();
  return y + '-' + (m < 10 ? '0' + m : m) + '-' + (dd < 10 ? '0' + dd : dd);
}

/** @private */
function stringOr_(v, fallback) {
  if (v === null || v === undefined) {
    return fallback;
  }
  var s = String(v);
  return s.length ? s : fallback;
}

/** @private */
function stringOrNull_(v) {
  if (v === null || v === undefined) {
    return null;
  }
  var s = String(v);
  return s.length ? s : null;
}

/** @private */
function numberOr_(v, fallback) {
  if (v === null || v === undefined || v === '') {
    return fallback;
  }
  var n = Number(v);
  return isFinite(n) ? n : fallback;
}

/** @private */
function numberOrNull_(v) {
  if (v === null || v === undefined || v === '') {
    return null;
  }
  var n = Number(v);
  return isFinite(n) ? n : null;
}

/**
 * Converts a Fibery decimal fraction (0–1) to a percent value (0–100).
 * Returns null for null/undefined/empty inputs.
 * @private
 */
function scaleFractionToPercent_(v) {
  if (v === null || v === undefined || v === '') {
    return null;
  }
  var n = Number(v);
  if (!isFinite(n)) {
    return null;
  }
  return n * 100;
}

/**
 * PRD version 2.26.2 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Sales **Pipeline** dashboard (features 016 + 030). Merges the sales opportunity
 * tracker spreadsheet with HubSpot deals synced into Fibery (`HubSpot/Deal`).
 * Sheet wins for stage and ACV; HubSpot/Fibery values are retained for delta (*).
 *
 * Script Properties: PIPELINE_MAX_ROWS, PIPELINE_STAGE_BUCKET_MAP_JSON,
 *   SALES_PIPELINE_SPREADSHEET_ID, SALES_PIPELINE_DEALS_SHEET_NAME, ...
 */

/** @const {number} */
var PIPELINE_CACHE_SCHEMA_VERSION_ = 3;

/** @const {number} */
var PIPELINE_QUERY_PAGE_LIMIT_ = 1000;

/** @const {number} */
var PIPELINE_QUERY_MAX_PAGES_ = 10;

/** @const {number} */
var PIPELINE_DELTA_AMOUNT_EPSILON_ = 500;

/** @const {!Object<string, string>} */
var PIPELINE_DEFAULT_STAGE_BUCKET_MAP_ = {
  prospecting: 'prospecting',
  prospect: 'prospecting',
  qualifying: 'prospecting',
  discovery: 'discovery',
  'discovery / demo': 'demo',
  demo: 'demo',
  'solutioning / validation': 'validation',
  validation: 'validation',
  proposing: 'proposing',
  'proposal sent': 'proposing',
  negotiating: 'negotiating',
  'negotiating / contract': 'negotiating',
  'negotiation/contract': 'negotiating',
  'negotiation / contract': 'negotiating',
  'proposal sent': 'proposing',
  'demo': 'demo',
  'closed won': 'won',
  'closed lost': 'lost',
  'on hold': 'onhold',
  'kickoff scheduled/in implementation': 'implementation',
};

function requirePipelineAccessForApi_() {
  var auth = requireAuthForApi_();
  if (!canAccessPipelineDashboard_(auth)) {
    throw new Error('FORBIDDEN');
  }
  return auth;
}

function canAccessPipelineDashboard_(auth) {
  if (!auth || !auth.email) {
    return false;
  }
  var role = String(auth.role || '').trim().toUpperCase();
  if (role === 'ADMIN' || role === 'EXEC') {
    return true;
  }
  return String(auth.team || '').trim().toUpperCase() === 'CLIENT-ENGAGEMENT';
}

function getPipelineDashboardData() {
  requirePipelineAccessForApi_();
  try {
    return buildPipelineDashboardPayload_();
  } catch (e) {
    var msg = e && e.message ? String(e.message) : 'Could not load pipeline.';
    if (msg === 'NOT_AUTHORIZED') {
      msg = 'Your session is not authorized. Reload the page.';
    }
    if (msg === 'FORBIDDEN') {
      msg = 'Pipeline is available to the Client Engagement team, Execs, and Admins.';
    }
    try {
      console.warn('getPipelineDashboardData: ' + msg);
    } catch (_) {}
    return {
      ok: false,
      message: msg,
      fetchedAt: new Date().toISOString(),
      cacheSchemaVersion: PIPELINE_CACHE_SCHEMA_VERSION_,
    };
  }
}

function getPipelineProps_() {
  var p = PropertiesService.getScriptProperties();
  var rawMax = (p.getProperty('PIPELINE_MAX_ROWS') || '').trim();
  var maxRows = parseInt(rawMax, 10);
  if (!isFinite(maxRows) || maxRows <= 0) {
    maxRows = 2000;
  }
  var map = {};
  var k;
  for (k in PIPELINE_DEFAULT_STAGE_BUCKET_MAP_) {
    if (PIPELINE_DEFAULT_STAGE_BUCKET_MAP_.hasOwnProperty(k)) {
      map[k] = PIPELINE_DEFAULT_STAGE_BUCKET_MAP_[k];
    }
  }
  var rawJson = (p.getProperty('PIPELINE_STAGE_BUCKET_MAP_JSON') || '').trim();
  if (rawJson) {
    try {
      var parsed = JSON.parse(rawJson);
      if (parsed && typeof parsed === 'object') {
        for (k in parsed) {
          if (parsed.hasOwnProperty(k) && typeof parsed[k] === 'string') {
            map[String(k).trim().toLowerCase()] = String(parsed[k]).trim().toLowerCase();
          }
        }
      }
    } catch (e) {}
  }
  return { maxRows: maxRows, stageBucketMap: map };
}

function pipelineToNumber_(v) {
  if (v === null || v === undefined || v === '') {
    return 0;
  }
  if (typeof v === 'number') {
    return isFinite(v) ? v : 0;
  }
  var n = parseFloat(String(v).replace(/[$,]/g, '').trim());
  return isFinite(n) ? n : 0;
}

function pipelineBucketForStage_(stage, map) {
  var key = String(stage || '').trim().toLowerCase();
  if (key && map.hasOwnProperty(key)) {
    return map[key];
  }
  return 'other';
}

function pipelineDeriveForecastCategory_(bucket) {
  if (bucket === 'proposing' || bucket === 'negotiating') {
    return 'COMMIT';
  }
  if (bucket === 'discovery' || bucket === 'demo' || bucket === 'validation') {
    return 'BEST_CASE';
  }
  if (bucket === 'prospecting') {
    return 'PIPELINE';
  }
  if (bucket === 'won' || bucket === 'implementation') {
    return 'CLOSED';
  }
  if (bucket === 'lost' || bucket === 'onhold') {
    return 'OMIT';
  }
  return 'PIPELINE';
}

function pipelineIsoDay_(iso) {
  if (!iso) {
    return null;
  }
  var s = String(iso);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function pipelineDaysSince_(iso) {
  if (!iso) {
    return null;
  }
  var t = new Date(iso).getTime();
  if (!isFinite(t)) {
    return null;
  }
  return Math.floor((Date.now() - t) / 86400000);
}

function pipelineParseHubspotDealId_(link) {
  if (!link) {
    return '';
  }
  var m = String(link).match(/\/deal\/(\d+)/);
  return m ? m[1] : '';
}

function pipelineStageDiffers_(a, b) {
  var na = String(a || '').trim().toLowerCase();
  var nb = String(b || '').trim().toLowerCase();
  if (!na || !nb || na === nb) {
    return false;
  }
  return (
    pipelineBucketForStage_(na, PIPELINE_DEFAULT_STAGE_BUCKET_MAP_) !==
    pipelineBucketForStage_(nb, PIPELINE_DEFAULT_STAGE_BUCKET_MAP_)
  );
}

function pipelineAmountDiffers_(sheetVal, hubVal) {
  var a = pipelineToNumber_(sheetVal);
  var b = pipelineToNumber_(hubVal);
  if (a <= 0 && b <= 0) {
    return false;
  }
  if (a <= 0 || b <= 0) {
    return true;
  }
  return Math.abs(a - b) > PIPELINE_DELTA_AMOUNT_EPSILON_;
}

function buildPipelineDealsQuery_(limit, offset) {
  return {
    query: {
      'q/from': 'HubSpot/Deal',
      'q/select': {
        id: 'fibery/id',
        publicId: 'fibery/public-id',
        name: 'HubSpot/name',
        amount: 'HubSpot/Amount',
        weightedAmount: 'HubSpot/Weighted amount',
        probability: 'HubSpot/Deal probability',
        stage: 'HubSpot/Deal Stage',
        pipeline: 'HubSpot/Pipeline',
        dealType: 'HubSpot/Deal Type',
        closeDate: 'HubSpot/Close Date',
        lastStageChangeDate: 'HubSpot/Last Stage Change Date Salesforce',
        ownerName: ['HubSpot/Deal Owner', 'HubSpot/name'],
        companyName: ['HubSpot/company', 'HubSpot/name'],
        hubspotLink: 'HubSpot/hubspotLink',
      },
      'q/order-by': [[['fibery/creation-date'], 'q/desc']],
      'q/limit': limit,
      'q/offset': offset,
    },
  };
}

function fetchAllPipelineDeals_(maxRows) {
  var all = [];
  var maxPages = Math.min(
    PIPELINE_QUERY_MAX_PAGES_,
    Math.ceil(maxRows / PIPELINE_QUERY_PAGE_LIMIT_)
  );
  for (var page = 0; page < maxPages; page++) {
    var offset = page * PIPELINE_QUERY_PAGE_LIMIT_;
    var r = fiberyQuery_(buildPipelineDealsQuery_(PIPELINE_QUERY_PAGE_LIMIT_, offset));
    if (!r.ok) {
      return r;
    }
    var rows = r.rows || [];
    for (var i = 0; i < rows.length; i++) {
      all.push(rows[i]);
      if (all.length >= maxRows) {
        return { ok: true, rows: all, truncated: rows.length === PIPELINE_QUERY_PAGE_LIMIT_ };
      }
    }
    if (rows.length < PIPELINE_QUERY_PAGE_LIMIT_) {
      return { ok: true, rows: all, truncated: false };
    }
  }
  return { ok: true, rows: all, truncated: true };
}

function normalizeFiberyPipelineDeals_(raw, stageBucketMap) {
  var deals = [];
  var byHubspotId = {};
  var pipelinesSeen = {};
  var unmappedStages = {};
  var skippedTest = 0;

  for (var i = 0; i < raw.length; i++) {
    var d = raw[i];
    var name = d.name === null || d.name === undefined ? '' : String(d.name).trim();
    if (/^test/i.test(name)) {
      skippedTest++;
      continue;
    }
    var stage = d.stage === null || d.stage === undefined ? '' : String(d.stage).trim();
    var bucket = pipelineBucketForStage_(stage, stageBucketMap);
    if (bucket === 'other' && stage) {
      unmappedStages[stage] = (unmappedStages[stage] || 0) + 1;
    }
    var pipeline =
      d.pipeline === null || d.pipeline === undefined ? '' : String(d.pipeline).trim();
    if (pipeline) {
      pipelinesSeen[pipeline] = true;
    }
    var hubspotLink =
      d.hubspotLink !== null && d.hubspotLink !== undefined ? String(d.hubspotLink).trim() : '';
    var hubspotDealId = pipelineParseHubspotDealId_(hubspotLink);
    var closeIso = d.closeDate ? String(d.closeDate) : null;
    var stageChangeIso = d.lastStageChangeDate ? String(d.lastStageChangeDate) : null;
    var normalized = {
      fiberyId: String(d.id || ('row-' + i)),
      publicId: d.publicId !== null && d.publicId !== undefined ? String(d.publicId) : '',
      name: name || '(no name)',
      company:
        d.companyName !== null && d.companyName !== undefined && String(d.companyName).trim()
          ? String(d.companyName).trim()
          : name || '(no name)',
      pipeline: pipeline || 'Other',
      hubspotStage: stage || 'Unknown',
      bucket: bucket,
      hubspotAmount: pipelineToNumber_(d.amount),
      hubspotWeightedAmount: pipelineToNumber_(d.weightedAmount),
      hubspotProbability: pipelineToNumber_(d.probability),
      owner:
        d.ownerName !== null && d.ownerName !== undefined && String(d.ownerName).trim()
          ? String(d.ownerName).trim()
          : 'Unassigned',
      closeDate: pipelineIsoDay_(closeIso),
      lastStageChangeDate: pipelineIsoDay_(stageChangeIso),
      daysInStage: pipelineDaysSince_(stageChangeIso),
      hubspotLink: hubspotLink,
      hubspotDealId: hubspotDealId,
      isStale: /^stale\b/i.test(name),
    };
    deals.push(normalized);
    if (hubspotDealId) {
      byHubspotId[hubspotDealId] = normalized;
    }
  }
  return {
    deals: deals,
    byHubspotId: byHubspotId,
    pipelinesSeen: pipelinesSeen,
    unmappedStages: unmappedStages,
    skippedTest: skippedTest,
  };
}

function mergePipelineSheetRow_(sheetRow, fibery, stageBucketMap, index) {
  var salesStage = sheetRow.salesStage || 'Prospect';
  var bucket = pipelineBucketForStage_(salesStage, stageBucketMap);
  var amount = pipelineToNumber_(sheetRow.acv);
  var weighted = pipelineToNumber_(sheetRow.weightedAcv);
  var probability = pipelineToNumber_(sheetRow.probability);
  if (!weighted && amount > 0 && probability > 0) {
    weighted = Math.round(amount * probability);
  }
  var hubspotStage = fibery ? fibery.hubspotStage : '';
  var hubspotAmount = fibery ? fibery.hubspotAmount : 0;
  var hubspotWeighted = fibery ? fibery.hubspotWeightedAmount : 0;
  var deltaStage = fibery ? pipelineStageDiffers_(salesStage, hubspotStage) : false;
  var deltaAmount = fibery ? pipelineAmountDiffers_(amount, hubspotAmount) : false;
  var deltaWeighted = fibery ? pipelineAmountDiffers_(weighted, hubspotWeighted) : false;
  var id =
    (sheetRow.salesOppId || 'sheet') +
    '-' +
    (sheetRow.hubspotDealId || String(sheetRow.rowNumber || index));
  return {
    id: id,
    salesOppId: sheetRow.salesOppId || '',
    hubspotDealId: sheetRow.hubspotDealId || (fibery ? fibery.hubspotDealId : ''),
    fiberyId: fibery ? fibery.fiberyId : '',
    publicId: fibery ? fibery.publicId : '',
    name: fibery ? fibery.name : sheetRow.company,
    company: sheetRow.company || (fibery ? fibery.company : ''),
    pipeline: fibery ? fibery.pipeline : 'Other',
    stage: salesStage,
    salesStage: salesStage,
    hubspotStage: hubspotStage,
    bucket: bucket,
    amount: amount,
    hubspotAmount: hubspotAmount,
    weightedAmount: weighted,
    hubspotWeightedAmount: hubspotWeighted,
    probability: probability,
    forecastCategory: pipelineDeriveForecastCategory_(bucket),
    isWon: bucket === 'won',
    isLost: bucket === 'lost',
    isClosed: bucket === 'won' || bucket === 'lost',
    isStale: fibery ? fibery.isStale : false,
    owner: fibery ? fibery.owner : 'Unassigned',
    closeDate: fibery ? fibery.closeDate : null,
    lastStageChangeDate: fibery ? fibery.lastStageChangeDate : null,
    daysInStage: fibery ? fibery.daysInStage : null,
    hubspotLink: fibery ? fibery.hubspotLink : '',
    sourceRecord: fibery ? 'merged' : 'sheet-only',
    hubspotDelta: { stage: deltaStage, amount: deltaAmount, weighted: deltaWeighted },
    hasHubspotDelta: deltaStage || deltaAmount || deltaWeighted,
    vertical: sheetRow.vertical || '',
    product: sheetRow.product || '',
    contact: sheetRow.contact || '',
    contactTitle: sheetRow.contactTitle || '',
    contactEmail: sheetRow.contactEmail || '',
    contactPhone: sheetRow.contactPhone || '',
    source: sheetRow.source || '',
    partnerSourced: !!sheetRow.partnerSourced,
    assumptions: sheetRow.assumptions || '',
    discoveryDate: sheetRow.discoveryDate || null,
    nextStep: sheetRow.nextStep || '',
    nextStepDate: sheetRow.nextStepDate || null,
    execSponsor: sheetRow.execSponsor || '',
    notes: sheetRow.notes || '',
    tcv: pipelineToNumber_(sheetRow.tcv),
    description: '',
  };
}

function buildPipelineDashboardPayload_() {
  var cfg = getPipelineProps_();
  var fetchedAt = new Date().toISOString();
  var warnings = [];

  var sheetResult = readSalesPipelineSheetRows_();
  if (!sheetResult.ok) {
    return {
      ok: false,
      message: sheetResult.message || 'Could not read sales pipeline spreadsheet.',
      fetchedAt: fetchedAt,
      cacheSchemaVersion: PIPELINE_CACHE_SCHEMA_VERSION_,
    };
  }
  if (sheetResult.warnings && sheetResult.warnings.length) {
    warnings = warnings.concat(sheetResult.warnings);
  }

  var fetched = fetchAllPipelineDeals_(cfg.maxRows);
  if (!fetched.ok) {
    return {
      ok: false,
      message: fetched.message || 'Could not reach Fibery.',
      fetchedAt: fetchedAt,
      cacheSchemaVersion: PIPELINE_CACHE_SCHEMA_VERSION_,
    };
  }

  var fiberyNorm = normalizeFiberyPipelineDeals_(fetched.rows || [], cfg.stageBucketMap);
  var sheetRows = sheetResult.rows || [];
  var merged = [];
  var matchedHubspot = 0;
  var sheetOnly = 0;

  for (var i = 0; i < sheetRows.length; i++) {
    var sr = sheetRows[i];
    var fibery = null;
    if (sr.hubspotDealId && fiberyNorm.byHubspotId[sr.hubspotDealId]) {
      fibery = fiberyNorm.byHubspotId[sr.hubspotDealId];
      matchedHubspot++;
    } else {
      sheetOnly++;
      if (sr.hubspotDealId) {
        warnings.push(
          'Sheet row ' + sr.salesOppId + ' has HubSpot ID ' + sr.hubspotDealId + ' with no Fibery match.'
        );
      }
    }
    merged.push(mergePipelineSheetRow_(sr, fibery, cfg.stageBucketMap, i));
  }

  var pipelinesSeen = {};
  for (var j = 0; j < merged.length; j++) {
    if (merged[j].pipeline) {
      pipelinesSeen[merged[j].pipeline] = true;
    }
  }
  var pipelines = [];
  for (var pn in pipelinesSeen) {
    if (pipelinesSeen.hasOwnProperty(pn)) {
      pipelines.push(pn);
    }
  }
  pipelines.sort();

  return {
    ok: true,
    source: 'merged',
    fetchedAt: fetchedAt,
    cacheSchemaVersion: PIPELINE_CACHE_SCHEMA_VERSION_,
    deals: merged,
    pipelines: pipelines,
    partial: !!fetched.truncated,
    warnings: warnings,
    editorial: {
      oneLineRead: sheetResult.oneLineRead || '',
      sheetUpdatedAt: sheetResult.sheetUpdatedAt || null,
    },
    stageDefinitions: sheetResult.stageDefinitions || [],
    meta: {
      rowCountRawFibery: (fetched.rows || []).length,
      dealCount: merged.length,
      sheetRowCount: sheetRows.length,
      matchedHubspotCount: matchedHubspot,
      sheetOnlyCount: sheetOnly,
      skippedTestCount: fiberyNorm.skippedTest,
      hiddenFiberyOnlyCount: Math.max(0, fiberyNorm.deals.length - matchedHubspot),
    },
  };
}

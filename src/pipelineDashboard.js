/**
 * PRD version 2.8.1 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Sales **Pipeline** dashboard (feature 016). Reads HubSpot deals synced into
 * Fibery (`HubSpot/Deal`) through fiberyClient.js and returns a normalized,
 * read-only payload for the #panel-pipeline surface.
 *
 * Stage / pipeline names are free text in Fibery (no enum ids). Won / Lost /
 * Closed are derived from the **stage bucket** because HubSpot/Is Won and
 * HubSpot/Is Closed are almost always null in the synced data (R0, 2026-05-28).
 *
 * Script Properties (see docs/features/016-pipeline-dashboard.md):
 *   PIPELINE_MAX_ROWS, PIPELINE_STAGE_BUCKET_MAP_JSON
 *
 * Rich-text fields (Deal Description, Next Step Date) are Fibery documents and
 * are intentionally NOT fetched in v1 (each would need a separate document
 * round-trip). The normalized shape keeps the keys for forward-compat.
 */

/** @const {number} */
var PIPELINE_CACHE_SCHEMA_VERSION_ = 1;

/** @const {number} Fibery page size (<= 1000 per API). */
var PIPELINE_QUERY_PAGE_LIMIT_ = 1000;

/** @const {number} Hard ceiling on pages fetched per call. */
var PIPELINE_QUERY_MAX_PAGES_ = 10;

/**
 * Default case-insensitive stage-name  ->  bucket map (R0 confirmed values).
 * Operators can extend / override via PIPELINE_STAGE_BUCKET_MAP_JSON.
 * @const {!Object<string, string>}
 */
var PIPELINE_DEFAULT_STAGE_BUCKET_MAP_ = {
  prospecting: 'prospecting',
  discovery: 'discovery',
  'discovery / demo': 'demo',
  demo: 'demo',
  'solutioning / validation': 'validation',
  validation: 'validation',
  proposing: 'proposing',
  'proposal sent': 'proposing',
  'negotiating / contract': 'negotiating',
  'negotiation/contract': 'negotiating',
  'closed won': 'won',
  'closed lost': 'lost',
  'on hold': 'onhold',
  'kickoff scheduled/in implementation': 'implementation',
};

/**
 * @return {{ email: string, role: string, team: string, fiberyAccess: boolean }}
 * @throws {Error} NOT_AUTHORIZED | FORBIDDEN
 */
function requirePipelineAccessForApi_() {
  var auth = requireAuthForApi_();
  if (!canAccessPipelineDashboard_(auth)) {
    throw new Error('FORBIDDEN');
  }
  return auth;
}

/**
 * Pipeline dashboard (Sales nav group) - visible when ANY is true:
 * team = CLIENT-ENGAGEMENT, role = EXEC, or role = ADMIN.
 * @param {{ email?: string, role?: string, team?: string }} auth
 * @return {boolean}
 */
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

/**
 * Public API: normalized pipeline payload for the client.
 * @return {!Object}
 */
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
    } catch (_) {
      /* ignore */
    }
    return {
      ok: false,
      message: msg,
      fetchedAt: new Date().toISOString(),
      cacheSchemaVersion: PIPELINE_CACHE_SCHEMA_VERSION_,
    };
  }
}

/**
 * @return {{ maxRows: number, stageBucketMap: !Object<string,string> }}
 * @private
 */
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
    } catch (e) {
      /* ignore malformed override; defaults still apply */
    }
  }
  return { maxRows: maxRows, stageBucketMap: map };
}

/**
 * @param {*} v Fibery numeric (often a string or null).
 * @return {number}
 * @private
 */
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

/**
 * @param {string} stage
 * @param {!Object<string,string>} map
 * @return {string} bucket key (falls back to 'other')
 * @private
 */
function pipelineBucketForStage_(stage, map) {
  var key = String(stage || '').trim().toLowerCase();
  if (key && map.hasOwnProperty(key)) {
    return map[key];
  }
  return 'other';
}

/**
 * @param {string} bucket
 * @return {string} forecast category
 * @private
 */
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

/**
 * @param {string|null} iso ISO datetime string.
 * @return {string|null} 'YYYY-MM-DD' (date part) or null.
 * @private
 */
function pipelineIsoDay_(iso) {
  if (!iso) {
    return null;
  }
  var s = String(iso);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/**
 * @param {string|null} iso
 * @return {number|null} whole days since the date, or null.
 * @private
 */
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

/**
 * @param {number} limit
 * @param {number} offset
 * @return {!Object} fiberyQuery_ spec
 * @private
 */
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

/**
 * Pages through all deals up to maxRows / page ceiling.
 * @param {number} maxRows
 * @return {!{ok: true, rows: !Array<!Object>, truncated: boolean}|
 *           !{ok: false, reason: string, message: string}}
 * @private
 */
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

/**
 * Normalized pipeline payload (live API and daily snapshot job).
 * Does not check user authorization; callers must gate access.
 *
 * @return {!Object} client payload
 * @private
 */
function buildPipelineDashboardPayload_() {
  var cfg = getPipelineProps_();
  var fetchedAt = new Date().toISOString();
  var warnings = [];

  var fetched = fetchAllPipelineDeals_(cfg.maxRows);
  if (!fetched.ok) {
    return {
      ok: false,
      message: fetched.message || 'Could not reach Fibery.',
      fetchedAt: fetchedAt,
      cacheSchemaVersion: PIPELINE_CACHE_SCHEMA_VERSION_,
    };
  }

  var raw = fetched.rows || [];
  var deals = [];
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
    var bucket = pipelineBucketForStage_(stage, cfg.stageBucketMap);
    if (bucket === 'other' && stage) {
      unmappedStages[stage] = (unmappedStages[stage] || 0) + 1;
    }

    var pipeline =
      d.pipeline === null || d.pipeline === undefined ? '' : String(d.pipeline).trim();
    if (pipeline) {
      pipelinesSeen[pipeline] = true;
    }

    var amount = pipelineToNumber_(d.amount);
    var weighted = pipelineToNumber_(d.weightedAmount);
    var probability = pipelineToNumber_(d.probability);
    var closeIso = d.closeDate ? String(d.closeDate) : null;
    var stageChangeIso = d.lastStageChangeDate ? String(d.lastStageChangeDate) : null;

    deals.push({
      id: String(d.id || ('row-' + i)),
      publicId: d.publicId !== null && d.publicId !== undefined ? String(d.publicId) : '',
      name: name || '(no name)',
      company:
        d.companyName !== null && d.companyName !== undefined && String(d.companyName).trim()
          ? String(d.companyName).trim()
          : name || '(no name)',
      pipeline: pipeline || 'Other',
      stage: stage || 'Unknown',
      bucket: bucket,
      amount: amount,
      weightedAmount: weighted,
      probability: probability,
      forecastCategory: pipelineDeriveForecastCategory_(bucket),
      isWon: bucket === 'won',
      isLost: bucket === 'lost',
      isClosed: bucket === 'won' || bucket === 'lost',
      isStale: /^stale\b/i.test(name),
      owner:
        d.ownerName !== null && d.ownerName !== undefined && String(d.ownerName).trim()
          ? String(d.ownerName).trim()
          : 'Unassigned',
      closeDate: pipelineIsoDay_(closeIso),
      lastStageChangeDate: pipelineIsoDay_(stageChangeIso),
      daysInStage: pipelineDaysSince_(stageChangeIso),
      hubspotLink:
        d.hubspotLink !== null && d.hubspotLink !== undefined ? String(d.hubspotLink).trim() : '',
      description: '',
      nextStep: '',
    });
  }

  var pipelines = [];
  for (var pn in pipelinesSeen) {
    if (pipelinesSeen.hasOwnProperty(pn)) {
      pipelines.push(pn);
    }
  }
  pipelines.sort();

  var unmappedList = [];
  for (var st in unmappedStages) {
    if (unmappedStages.hasOwnProperty(st)) {
      unmappedList.push(st + ' (' + unmappedStages[st] + ')');
    }
  }
  if (unmappedList.length) {
    warnings.push(
      'Unmapped deal stage(s) bucketed as "other": ' + unmappedList.slice(0, 8).join(', ') +
        (unmappedList.length > 8 ? ', ...' : '') +
        '. Set PIPELINE_STAGE_BUCKET_MAP_JSON to map them.'
    );
  }

  return {
    ok: true,
    source: 'fibery',
    fetchedAt: fetchedAt,
    cacheSchemaVersion: PIPELINE_CACHE_SCHEMA_VERSION_,
    deals: deals,
    pipelines: pipelines,
    partial: !!fetched.truncated,
    warnings: warnings,
    meta: {
      rowCountRaw: raw.length,
      dealCount: deals.length,
      skippedTestCount: skippedTest,
    },
  };
}

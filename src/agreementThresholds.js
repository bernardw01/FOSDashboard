/**
 * PRD version 1.21.1 — sync with docs/FOS-Dashboard-PRD.md
 *
 * Agreement-dashboard constants per agreement-dashboard-prd-v2.md §8:
 *   - §8.1 Alert thresholds (with optional Script Property overrides).
 *   - §8.2 Workflow state color map.
 *   - §8.3 Agreement type color map.
 *   - §8.4 Margin color thresholds (derived from LOW_MARGIN_THRESHOLD).
 *   - §8.5 Customer color palette (deterministic cycling).
 *   - §8.6 Internal company identification rules.
 *
 * v1.19.0 — Delivery Dashboard helpers:
 *   - §D.11 Completion bucket map (4-tier).
 *   - §D.10 Margin variance bucket map (3-tier).
 *   - Monthly P&L margin coloring reuses the §D.10 variance buckets relative
 *     to the agreement's Target Margin.
 *
 * Defaults live in code. Optional Script Properties (overlaid by
 * getAgreementThresholds_) allow ops tuning without a code change:
 *   AGREEMENT_THRESHOLD_LOW_MARGIN
 *   AGREEMENT_THRESHOLD_INTERNAL_LABOR
 *   AGREEMENT_THRESHOLD_EXPIRY_DAYS
 *   AGREEMENT_TOP_N_RECOGNITION_BARS
 *   AGREEMENT_INTERNAL_COMPANY_NAMES   (comma-separated)
 *   AGREEMENT_SANKEY_LINK_OPACITY      (0–1, default 0.35)
 *   AGREEMENT_SANKEY_INCLUDE_INTERNAL  (boolean, default false)
 *
 * v1.19.0 Delivery Dashboard Script Properties (all optional):
 *   DELIVERY_COMPLETION_UNDER_PCT      (default 25)
 *   DELIVERY_COMPLETION_BUILDING_PCT   (default 75)
 *   DELIVERY_COMPLETION_OVER_PCT       (default 100)
 *   DELIVERY_MARGIN_VARIANCE_AMBER_PTS (default 5  — within N pts BELOW target)
 */

/** @const {!Object} §8.2 workflow state → hex color (harpin.ai palette). */
var WORKFLOW_STATE_COLOR_ = {
  'Delivery In Progress': '#52C9E5',
  'Proposal Delivered': '#20B4C4',
  'Contract Complete': '#43D6BA',
  'Closed-Won': '#007FA7',
  'Identified Opportunity': '#A0AEC0',
  'First Client Call Completed': '#a29bfe',
};

/** @const {string} Fallback color for workflow states not in the map. */
var WORKFLOW_STATE_COLOR_FALLBACK_ = '#A0AEC0';

/** @const {!Object} §8.3 agreement type → hex color. */
var AGREEMENT_TYPE_COLOR_ = {
  Subscription: '#52C9E5',
  Services: '#007FA7',
  Internal: '#2a5a7a',
  License: '#20B4C4',
};

/** @const {string} */
var AGREEMENT_TYPE_COLOR_FALLBACK_ = '#A0AEC0';

/** @const {!Array<string>} §8.5 customer palette (deterministic cycling). */
var CUSTOMER_PALETTE_ = [
  '#52C9E5',
  '#007FA7',
  '#20B4C4',
  '#43D6BA',
  '#fd9644',
  '#fc5c65',
  '#a29bfe',
  '#A0AEC0',
  '#ee5a24',
  '#0fb9b1',
];

/** @const {!Array<string>} §8.6 default internal-company names. */
var INTERNAL_COMPANY_NAMES_DEFAULT_ = ['harpin.ai'];

/**
 * §D.11 Delivery Dashboard completion-percent buckets. Drives the
 * Active Projects table's `% Complete` progress-bar fill color.
 *   under     0% ≤ pct < 25%   blue
 *   building  25% ≤ pct < 75%  teal
 *   on-track  75% ≤ pct ≤ 100% green
 *   over      pct > 100%       orange
 * @const {!Object}
 */
var COMPLETION_COLOR_ = {
  under: '#52C9E5',
  building: '#20B4C4',
  'on-track': '#43D6BA',
  over: '#fd9644',
};

/** @const {!Object} §D.10 Delivery margin-variance bucket colors. */
var MARGIN_VARIANCE_COLOR_ = {
  green: '#43D6BA',
  amber: '#f9c74f',
  red: '#fc5c65',
  neutral: '#A0AEC0',
};

/** @const {!Object} §8.1 defaults (used when no Script Property override). */
var THRESHOLD_DEFAULTS_ = {
  LOW_MARGIN_THRESHOLD: 35,
  INTERNAL_LABOR_THRESHOLD: 5000,
  EXPIRY_WARNING_DAYS: 60,
  TOP_N_RECOGNITION_BARS: 10,
  SANKEY_LINK_OPACITY: 0.35,
  SANKEY_INCLUDE_INTERNAL: false,
  DELIVERY_COMPLETION_UNDER_PCT: 25,
  DELIVERY_COMPLETION_BUILDING_PCT: 75,
  DELIVERY_COMPLETION_OVER_PCT: 100,
  DELIVERY_MARGIN_VARIANCE_AMBER_PTS: 5,
};

/**
 * Resolves the active threshold + palette config for one render pass.
 * Reads optional Script Property overrides; returns a plain object the rest of
 * the pipeline (alerts, charts, table) can pass around without reading props
 * repeatedly.
 *
 * @return {!{
 *   lowMargin: number,
 *   internalLabor: number,
 *   expiryDays: number,
 *   topNRecognition: number,
 *   internalCompanyNames: !Array<string>,
 *   sankeyLinkOpacity: number,
 *   sankeyIncludeInternal: boolean,
 *   workflowStateColor: !Object,
 *   workflowStateColorFallback: string,
 *   agreementTypeColor: !Object,
 *   agreementTypeColorFallback: string,
 *   customerPalette: !Array<string>
 * }}
 */
function getAgreementThresholds_() {
  var props = PropertiesService.getScriptProperties();

  var lowMargin = parsePositiveNumber_(
    props.getProperty('AGREEMENT_THRESHOLD_LOW_MARGIN'),
    THRESHOLD_DEFAULTS_.LOW_MARGIN_THRESHOLD
  );
  var internalLabor = parsePositiveNumber_(
    props.getProperty('AGREEMENT_THRESHOLD_INTERNAL_LABOR'),
    THRESHOLD_DEFAULTS_.INTERNAL_LABOR_THRESHOLD
  );
  var expiryDays = parsePositiveNumber_(
    props.getProperty('AGREEMENT_THRESHOLD_EXPIRY_DAYS'),
    THRESHOLD_DEFAULTS_.EXPIRY_WARNING_DAYS
  );
  var topN = parsePositiveNumber_(
    props.getProperty('AGREEMENT_TOP_N_RECOGNITION_BARS'),
    THRESHOLD_DEFAULTS_.TOP_N_RECOGNITION_BARS
  );

  var internalNames = parseCsvList_(props.getProperty('AGREEMENT_INTERNAL_COMPANY_NAMES'));
  if (!internalNames.length) {
    internalNames = INTERNAL_COMPANY_NAMES_DEFAULT_.slice();
  }

  var sankeyOpacity = parsePositiveNumber_(
    props.getProperty('AGREEMENT_SANKEY_LINK_OPACITY'),
    THRESHOLD_DEFAULTS_.SANKEY_LINK_OPACITY
  );
  // Clamp opacity to [0, 1] regardless of source.
  if (sankeyOpacity < 0) sankeyOpacity = 0;
  if (sankeyOpacity > 1) sankeyOpacity = 1;

  var sankeyIncludeInternal = parseBoolean_(
    props.getProperty('AGREEMENT_SANKEY_INCLUDE_INTERNAL'),
    THRESHOLD_DEFAULTS_.SANKEY_INCLUDE_INTERNAL
  );

  var completionUnder = parsePositiveNumber_(
    props.getProperty('DELIVERY_COMPLETION_UNDER_PCT'),
    THRESHOLD_DEFAULTS_.DELIVERY_COMPLETION_UNDER_PCT
  );
  var completionBuilding = parsePositiveNumber_(
    props.getProperty('DELIVERY_COMPLETION_BUILDING_PCT'),
    THRESHOLD_DEFAULTS_.DELIVERY_COMPLETION_BUILDING_PCT
  );
  var completionOver = parsePositiveNumber_(
    props.getProperty('DELIVERY_COMPLETION_OVER_PCT'),
    THRESHOLD_DEFAULTS_.DELIVERY_COMPLETION_OVER_PCT
  );
  var marginVarianceAmber = parsePositiveNumber_(
    props.getProperty('DELIVERY_MARGIN_VARIANCE_AMBER_PTS'),
    THRESHOLD_DEFAULTS_.DELIVERY_MARGIN_VARIANCE_AMBER_PTS
  );

  return {
    lowMargin: lowMargin,
    internalLabor: internalLabor,
    expiryDays: expiryDays,
    topNRecognition: Math.max(1, Math.round(topN)),
    internalCompanyNames: internalNames,
    sankeyLinkOpacity: sankeyOpacity,
    sankeyIncludeInternal: sankeyIncludeInternal,
    workflowStateColor: WORKFLOW_STATE_COLOR_,
    workflowStateColorFallback: WORKFLOW_STATE_COLOR_FALLBACK_,
    agreementTypeColor: AGREEMENT_TYPE_COLOR_,
    agreementTypeColorFallback: AGREEMENT_TYPE_COLOR_FALLBACK_,
    customerPalette: CUSTOMER_PALETTE_.slice(),
    completion: {
      underMax: completionUnder,
      buildingMax: completionBuilding,
      overMin: completionOver,
      color: COMPLETION_COLOR_,
    },
    marginVariance: {
      amberPts: marginVarianceAmber,
      color: MARGIN_VARIANCE_COLOR_,
    },
  };
}

/**
 * §D.11 Returns one of `under` / `building` / `on-track` / `over` for a
 * completion percent. Null inputs map to `neutral` and the caller should
 * use the muted-gray color.
 *
 * @param {?number} pct  Completion percent (0–100; > 100 is over).
 * @param {!{ underMax: number, buildingMax: number, overMin: number }} cfg
 * @return {string}
 */
function completionBucket_(pct, cfg) {
  if (pct === null || pct === undefined || isNaN(pct)) {
    return 'neutral';
  }
  var n = Number(pct);
  if (n > cfg.overMin) {
    return 'over';
  }
  if (n >= cfg.buildingMax) {
    return 'on-track';
  }
  if (n >= cfg.underMax) {
    return 'building';
  }
  return 'under';
}

/**
 * §D.10 / §M.7 Margin variance bucket — used for both the Active Projects
 * Margin column dot and the per-month Margin % cell coloring in the
 * Delivery P&L grid.
 *
 *   variance ≥ 0                          → green
 *   −amberPts ≤ variance < 0              → amber
 *   variance < −amberPts                  → red
 *   null margin / null target / NaN       → neutral
 *
 * @param {?number} actualPct    Actual margin (0–100, may be negative).
 * @param {?number} targetPct    Target margin (0–100).
 * @param {!{ amberPts: number }} cfg
 * @return {string}
 */
function marginVarianceBucket_(actualPct, targetPct, cfg) {
  if (actualPct === null || actualPct === undefined || isNaN(actualPct)) {
    return 'neutral';
  }
  if (targetPct === null || targetPct === undefined || isNaN(targetPct)) {
    return 'neutral';
  }
  var v = Number(actualPct) - Number(targetPct);
  if (v >= 0) return 'green';
  if (v >= -Number(cfg.amberPts || 0)) return 'amber';
  return 'red';
}

/**
 * §8.4 margin-bucket color for a numeric current-margin percent.
 *   margin < 0                     → danger
 *   0 ≤ margin < lowMargin         → caution (medium teal)
 *   lowMargin ≤ margin < 60        → acceptable (teal action)
 *   margin ≥ 60                    → healthy (green-teal)
 *   null / NaN / Internal          → dim
 *
 * @param {?number} margin
 * @param {number} lowMargin
 * @return {string}
 */
function marginBucketColor_(margin, lowMargin) {
  if (margin === null || margin === undefined || isNaN(margin)) {
    return '#2a5a7a';
  }
  if (margin < 0) {
    return '#fc5c65';
  }
  if (margin < lowMargin) {
    return '#20B4C4';
  }
  if (margin < 60) {
    return '#007FA7';
  }
  return '#43D6BA';
}

/**
 * Assigns a stable color to each customer name by cycling the §8.5 palette
 * after sorting the input list. The same name always gets the same color
 * within a render pass.
 *
 * @param {!Array<string>} customerNamesSortedByValueDesc
 * @param {!Array<string>} palette
 * @return {!Object<string,string>}
 */
function buildCustomerColorMap_(customerNamesSortedByValueDesc, palette) {
  var out = {};
  for (var i = 0; i < customerNamesSortedByValueDesc.length; i++) {
    var name = customerNamesSortedByValueDesc[i];
    if (!name) {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(out, name)) {
      continue;
    }
    out[name] = palette[i % palette.length];
  }
  return out;
}

/**
 * §8.6 internal-company test. Returns true if any of:
 *   - company.funnelStage is empty
 *   - company.segment === 'Internal'
 *   - company has no contract value AND no linked external customers
 *     (best-effort: the company query doesn't return agreement-count, so we
 *      treat zero/null tcv as a proxy)
 *   - company.name matches the configured internal-name list
 *
 * @param {!Object} company  Normalized company row (see fiberyAgreementDashboard.js).
 * @param {!Array<string>} internalNames
 * @return {boolean}
 */
function isInternalCompany_(company, internalNames) {
  if (!company) {
    return false;
  }
  var name = (company.name || '').trim().toLowerCase();
  for (var i = 0; i < internalNames.length; i++) {
    if (name === String(internalNames[i] || '').trim().toLowerCase()) {
      return true;
    }
  }
  if (!company.funnelStage) {
    return true;
  }
  // `segments` (preferred) is an array of multi-select values; `segment` is the
  // legacy joined string. Match "Internal" against either, case-insensitively.
  var segs = Array.isArray(company.segments) ? company.segments : [];
  for (var s = 0; s < segs.length; s++) {
    if (String(segs[s] || '').trim().toLowerCase() === 'internal') {
      return true;
    }
  }
  if (!segs.length && String(company.segment || '').trim().toLowerCase() === 'internal') {
    return true;
  }
  if (!company.totalContractValue || Number(company.totalContractValue) <= 0) {
    return true;
  }
  return false;
}

/**
 * @param {?string} raw
 * @param {number} fallback
 * @return {number}
 * @private
 */
function parsePositiveNumber_(raw, fallback) {
  if (raw === null || raw === undefined) {
    return fallback;
  }
  var n = parseFloat(String(raw).trim());
  if (!isFinite(n) || n < 0) {
    return fallback;
  }
  return n;
}

/**
 * Parses a Script Property as a boolean. Accepts `true`/`false`, `1`/`0`,
 * `yes`/`no`, `on`/`off` (case-insensitive). Falls back to `defaultValue` for
 * empty / unrecognized inputs.
 *
 * @param {?string} raw
 * @param {boolean} defaultValue
 * @return {boolean}
 * @private
 */
function parseBoolean_(raw, defaultValue) {
  if (raw === null || raw === undefined) {
    return defaultValue;
  }
  var s = String(raw).trim().toLowerCase();
  if (!s) {
    return defaultValue;
  }
  if (s === 'true' || s === '1' || s === 'yes' || s === 'on') {
    return true;
  }
  if (s === 'false' || s === '0' || s === 'no' || s === 'off') {
    return false;
  }
  return defaultValue;
}

/**
 * @param {?string} raw
 * @return {!Array<string>}
 * @private
 */
function parseCsvList_(raw) {
  if (!raw) {
    return [];
  }
  var parts = String(raw).split(',');
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i].trim();
    if (p) {
      out.push(p);
    }
  }
  return out;
}

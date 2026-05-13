/**
 * PRD version 1.17.0 — sync with docs/FOS-Dashboard-PRD.md
 *
 * Utilization Management Dashboard constants per
 * docs/features/005-utilization-management-dashboard.md:
 *   - §U.9 Weekly capacity baseline.
 *   - §U.10 Utilization color buckets.
 *   - §U.11 Internal-company detection rules.
 *   - Date-range defaults / caps.
 *   - Top-N caps for the §N.4 / §N.5 / §N.7 horizontal bars.
 *
 * Defaults live in code. Optional Script Properties (overlaid by
 * getUtilizationThresholds_) allow ops tuning without a code change:
 *   UTILIZATION_CACHE_TTL_MINUTES         (default 10)
 *   UTILIZATION_DEFAULT_RANGE_DAYS        (default 90)
 *   UTILIZATION_MAX_RANGE_DAYS            (default 365)
 *   UTILIZATION_WEEKLY_CAPACITY_HOURS     (default 40)
 *   UTILIZATION_TARGET_PERCENT            (default 85)
 *   UTILIZATION_UNDER_PERCENT             (default 60)
 *   UTILIZATION_OVER_PERCENT              (default 110)
 *   UTILIZATION_INTERNAL_COMPANY_NAMES    (CSV, default "harpin.ai,Harpin")
 *   UTILIZATION_TOP_N_PERSONS             (default 20)
 *   UTILIZATION_TOP_N_PROJECTS            (default 20)
 *   UTILIZATION_TOP_N_CUSTOMERS           (default 20)
 *   UTILIZATION_HEATMAP_TOP_N_PERSONS     (default 30 — Phase C heatmap row cap)
 *   UTILIZATION_STALE_APPROVAL_WARN_DAYS  (default 7  — Phase C stale-approval rule)
 *   UTILIZATION_STALE_APPROVAL_CRIT_DAYS  (default 14 — Phase C stale-approval rule)
 *
 * The agreement-dashboard module already defines the §8.5 customer palette
 * (CUSTOMER_PALETTE_), the parsePositiveNumber_ / parseCsvList_ helpers, and
 * the WORKFLOW/Agreement-Type color maps — we reuse them here so the
 * Utilization panel renders with the same customer hue per name as the
 * Agreement panel.
 */

/** @const {number} Bumped when the client cache shape changes. v2 adds the
 *  Phase C `aggregates.byPersonWeek` and `alerts[]` blocks (v1.14.0). */
var UTILIZATION_DASHBOARD_CACHE_SCHEMA_VERSION_ = 2;

/** @const {number} Default Fibery `q/limit` per labor-cost page. */
var UTILIZATION_QUERY_PAGE_LIMIT_ = 1000;

/** @const {number} Hard ceiling on paginated pages to keep round-trip bounded. */
var UTILIZATION_QUERY_MAX_PAGES_ = 20;

/** @const {!Object} §U.10 utilization buckets — same hues as the spec. */
var UTILIZATION_BUCKET_COLORS_ = {
  UNDER: '#fc5c65',
  BUILDING: '#f9c74f',
  TARGET: '#43D6BA',
  OVER: '#f78c1f',
  UNKNOWN: '#A0AEC0',
};

/** @const {!Object} Billable vs Non-billable bar colors. */
var UTILIZATION_BILLABLE_COLORS_ = {
  BILLABLE: '#43D6BA',
  NON_BILLABLE: '#A0AEC0',
};

/** @const {!Object} Approval-state colors (used by Phase C / Pending Approvals). */
var UTILIZATION_APPROVAL_COLORS_ = {
  APPROVED: '#43D6BA',
  PENDING: '#f9c74f',
  UNAPPROVED: '#fc5c65',
  UNKNOWN: '#A0AEC0',
};

/** @const {!Array<string>} Role-palette hues (deterministic by sorted hours). */
var UTILIZATION_ROLE_PALETTE_ = [
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
  '#7f8fa6',
  '#f9c74f',
];

/** @const {!Object} Default thresholds (overridden via Script Properties). */
var UTILIZATION_DEFAULTS_ = {
  CACHE_TTL_MINUTES: 10,
  DEFAULT_RANGE_DAYS: 90,
  MAX_RANGE_DAYS: 365,
  WEEKLY_CAPACITY_HOURS: 40,
  TARGET_PERCENT: 85,
  UNDER_PERCENT: 60,
  OVER_PERCENT: 110,
  TOP_N_PERSONS: 20,
  TOP_N_PROJECTS: 20,
  TOP_N_CUSTOMERS: 20,
  // Phase C — heatmap row cap (separate from TOP_N_PERSONS so the donut/bar
  // and the heatmap can scale independently).
  HEATMAP_TOP_N_PERSONS: 30,
  // Phase C — stale-approval bucket boundaries in days.
  STALE_APPROVAL_WARN_DAYS: 7,
  STALE_APPROVAL_CRIT_DAYS: 14,
  INTERNAL_COMPANY_NAMES: ['harpin.ai', 'Harpin'],
};

/**
 * Resolves the active threshold + palette config for one render pass.
 * Reads optional Script Property overrides; returns a plain object the rest of
 * the utilization pipeline can pass around without reading props repeatedly.
 *
 * @return {!{
 *   cacheTtlMinutes: number,
 *   defaultRangeDays: number,
 *   maxRangeDays: number,
 *   weeklyCapacityHours: number,
 *   targetPercent: number,
 *   underPercent: number,
 *   overPercent: number,
 *   topNPersons: number,
 *   topNProjects: number,
 *   topNCustomers: number,
 *   internalCompanyNames: !Array<string>,
 *   bucketColors: !Object,
 *   billableColors: !Object,
 *   approvalColors: !Object,
 *   rolePalette: !Array<string>,
 *   customerPalette: !Array<string>
 * }}
 */
function getUtilizationThresholds_() {
  var props = PropertiesService.getScriptProperties();

  var ttl = parsePositiveNumber_(
    props.getProperty('UTILIZATION_CACHE_TTL_MINUTES'),
    UTILIZATION_DEFAULTS_.CACHE_TTL_MINUTES
  );
  var defaultRange = parsePositiveNumber_(
    props.getProperty('UTILIZATION_DEFAULT_RANGE_DAYS'),
    UTILIZATION_DEFAULTS_.DEFAULT_RANGE_DAYS
  );
  var maxRange = parsePositiveNumber_(
    props.getProperty('UTILIZATION_MAX_RANGE_DAYS'),
    UTILIZATION_DEFAULTS_.MAX_RANGE_DAYS
  );
  var capacity = parsePositiveNumber_(
    props.getProperty('UTILIZATION_WEEKLY_CAPACITY_HOURS'),
    UTILIZATION_DEFAULTS_.WEEKLY_CAPACITY_HOURS
  );
  var target = parsePositiveNumber_(
    props.getProperty('UTILIZATION_TARGET_PERCENT'),
    UTILIZATION_DEFAULTS_.TARGET_PERCENT
  );
  var under = parsePositiveNumber_(
    props.getProperty('UTILIZATION_UNDER_PERCENT'),
    UTILIZATION_DEFAULTS_.UNDER_PERCENT
  );
  var over = parsePositiveNumber_(
    props.getProperty('UTILIZATION_OVER_PERCENT'),
    UTILIZATION_DEFAULTS_.OVER_PERCENT
  );
  var topNPersons = parsePositiveNumber_(
    props.getProperty('UTILIZATION_TOP_N_PERSONS'),
    UTILIZATION_DEFAULTS_.TOP_N_PERSONS
  );
  var topNProjects = parsePositiveNumber_(
    props.getProperty('UTILIZATION_TOP_N_PROJECTS'),
    UTILIZATION_DEFAULTS_.TOP_N_PROJECTS
  );
  var topNCustomers = parsePositiveNumber_(
    props.getProperty('UTILIZATION_TOP_N_CUSTOMERS'),
    UTILIZATION_DEFAULTS_.TOP_N_CUSTOMERS
  );
  var heatmapTopN = parsePositiveNumber_(
    props.getProperty('UTILIZATION_HEATMAP_TOP_N_PERSONS'),
    UTILIZATION_DEFAULTS_.HEATMAP_TOP_N_PERSONS
  );
  var staleWarnDays = parsePositiveNumber_(
    props.getProperty('UTILIZATION_STALE_APPROVAL_WARN_DAYS'),
    UTILIZATION_DEFAULTS_.STALE_APPROVAL_WARN_DAYS
  );
  var staleCritDays = parsePositiveNumber_(
    props.getProperty('UTILIZATION_STALE_APPROVAL_CRIT_DAYS'),
    UTILIZATION_DEFAULTS_.STALE_APPROVAL_CRIT_DAYS
  );

  var internalNames = parseCsvList_(props.getProperty('UTILIZATION_INTERNAL_COMPANY_NAMES'));
  if (!internalNames.length) {
    internalNames = UTILIZATION_DEFAULTS_.INTERNAL_COMPANY_NAMES.slice();
  }

  // Ensure WARN < CRIT so the stale-approval bucket math is monotonic.
  var warnDaysClean = Math.max(1, Math.round(staleWarnDays));
  var critDaysClean = Math.max(warnDaysClean + 1, Math.round(staleCritDays));

  return {
    cacheTtlMinutes: Math.max(1, Math.round(ttl)),
    defaultRangeDays: Math.max(1, Math.round(defaultRange)),
    maxRangeDays: Math.max(1, Math.round(maxRange)),
    weeklyCapacityHours: Math.max(1, capacity),
    targetPercent: target,
    underPercent: under,
    overPercent: over,
    topNPersons: Math.max(1, Math.round(topNPersons)),
    topNProjects: Math.max(1, Math.round(topNProjects)),
    topNCustomers: Math.max(1, Math.round(topNCustomers)),
    heatmapTopNPersons: Math.max(1, Math.round(heatmapTopN)),
    staleApprovalWarnDays: warnDaysClean,
    staleApprovalCritDays: critDaysClean,
    internalCompanyNames: internalNames,
    bucketColors: UTILIZATION_BUCKET_COLORS_,
    billableColors: UTILIZATION_BILLABLE_COLORS_,
    approvalColors: UTILIZATION_APPROVAL_COLORS_,
    rolePalette: UTILIZATION_ROLE_PALETTE_.slice(),
    customerPalette: CUSTOMER_PALETTE_.slice(),
  };
}

/**
 * §U.10 utilization-bucket color for a numeric percent.
 *   < underPercent     → UNDER  (red)
 *   < targetPercent    → BUILDING (yellow)
 *   ≤ overPercent      → TARGET (green)
 *   > overPercent      → OVER   (orange)
 *   null / NaN         → UNKNOWN (grey)
 *
 * @param {?number} pct
 * @param {!{underPercent:number, targetPercent:number, overPercent:number, bucketColors:!Object}} t
 * @return {string}
 */
function utilizationBucketColor_(pct, t) {
  if (pct === null || pct === undefined || isNaN(pct)) {
    return t.bucketColors.UNKNOWN;
  }
  if (pct < t.underPercent) {
    return t.bucketColors.UNDER;
  }
  if (pct < t.targetPercent) {
    return t.bucketColors.BUILDING;
  }
  if (pct <= t.overPercent) {
    return t.bucketColors.TARGET;
  }
  return t.bucketColors.OVER;
}

/**
 * §U.11 "is this row internal labor?" predicate. Returns true when:
 *   - row.clockifyUserCompany matches the configured internal-company list
 *     (case-insensitive), OR
 *   - row.agreementType === 'Internal'
 *
 * @param {!Object} row  Normalized labor-cost row.
 * @param {!Array<string>} internalNames
 * @return {boolean}
 */
function isInternalLabor_(row, internalNames) {
  if (!row) {
    return false;
  }
  if (String(row.agreementType || '').trim().toLowerCase() === 'internal') {
    return true;
  }
  var company = String(row.clockifyUserCompany || '').trim().toLowerCase();
  if (!company) {
    return false;
  }
  for (var i = 0; i < internalNames.length; i++) {
    if (company === String(internalNames[i] || '').trim().toLowerCase()) {
      return true;
    }
  }
  return false;
}

/**
 * Assigns a stable color to each role name by cycling the role palette after
 * sorting the input list by hours desc. The same role always gets the same
 * color within a render pass.
 *
 * @param {!Array<string>} roleNamesSortedByHoursDesc
 * @param {!Array<string>} palette
 * @return {!Object<string,string>}
 */
function buildRoleColorMap_(roleNamesSortedByHoursDesc, palette) {
  var out = {};
  for (var i = 0; i < roleNamesSortedByHoursDesc.length; i++) {
    var name = roleNamesSortedByHoursDesc[i];
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

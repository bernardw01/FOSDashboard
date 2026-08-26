/**
 * PRD version 3.17.0 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 047 performance kill switches.
 *
 * Every performance workstream ships behind one boolean Script Property so a
 * regression can be reverted without a redeploy. Defaults below are the
 * intended steady state; set the property to `false` to fall back to the
 * previous code path.
 *
 * Values are read per execution and memoized, because a single dashboard load
 * can consult the same flag thousands of times inside row loops and
 * PropertiesService reads are not free.
 *
 * Diagnostics may temporarily force a flag with perfFlagOverridePush_ so the
 * parity harness can run both code paths in one execution. Overrides are
 * in-memory only and never touch Script Properties.
 */

/**
 * Flag name to default value. A property that is absent or unparseable uses
 * the default here.
 * @const {!Object<string, boolean>}
 */
var PERF_FLAG_DEFAULTS_ = {
  // Workstream A: read cost_amount / user_role_name / user_company_name
  // columns instead of parsing fibery_payload_json per row.
  PERF_USE_NORMALIZED_LABOR_COLS: true,
  // Workstream B: Postgres aggregate RPCs instead of paging fact rows.
  PERF_USE_UTIL_RPC: false,
  PERF_USE_RA_RPC: false,
  PERF_USE_SLIM_CHARTS: false,
  // Workstream B3: encode aggregates.byPersonWeek as positional tuples plus
  // string tables instead of 617 fully-keyed objects.
  PERF_SLIM_VIZ_AGGREGATES: false,
  // Workstream B6: encode resource-assignments.personVariances as positional
  // tuples plus string tables with shared byDay dedup (measured 94.1 percent
  // off the compact slice).
  PERF_SLIM_RA_PERSON_VARIANCES: false,
  // Workstream B4: cache normalized labor rows per UTC-day-aligned window in
  // fos_viz_range_payloads and re-slice to the exact requested instants.
  PERF_USE_RANGE_CACHE: false,
  // Workstream B5: Reload re-reads the stored Agreement / Delivery blob instead
  // of rebuilding it from typed tables inside the user's request.
  PERF_RELOAD_REREADS_BLOB: false,
  // Workstream C: incremental AM mirror driven by fos_sync_watermarks.
  PERF_INCREMENTAL_AM_MIRROR: false,
  // Workstream D: lazy panel markup in DashboardShell.
  PERF_LAZY_PANEL_MARKUP: false,
};

/**
 * Per-execution memo of resolved flag values.
 * @type {?Object<string, boolean>}
 */
var PERF_FLAG_CACHE_ = null;

/**
 * Diagnostic override stack. Non-empty only while a `_diag_` harness runs.
 * @type {!Array<!Object<string, boolean>>}
 */
var PERF_FLAG_OVERRIDES_ = [];

/**
 * Resolves a performance kill switch.
 *
 * @param {string} name One of the keys in PERF_FLAG_DEFAULTS_.
 * @return {boolean}
 */
function perfFlag_(name) {
  for (var i = PERF_FLAG_OVERRIDES_.length - 1; i >= 0; i--) {
    if (Object.prototype.hasOwnProperty.call(PERF_FLAG_OVERRIDES_[i], name)) {
      return !!PERF_FLAG_OVERRIDES_[i][name];
    }
  }
  if (PERF_FLAG_CACHE_ && Object.prototype.hasOwnProperty.call(PERF_FLAG_CACHE_, name)) {
    return PERF_FLAG_CACHE_[name];
  }
  if (!PERF_FLAG_CACHE_) {
    PERF_FLAG_CACHE_ = {};
  }
  var fallback = Object.prototype.hasOwnProperty.call(PERF_FLAG_DEFAULTS_, name)
    ? !!PERF_FLAG_DEFAULTS_[name]
    : false;
  var raw;
  try {
    raw = PropertiesService.getScriptProperties().getProperty(name);
  } catch (e) {
    raw = null;
  }
  var value = fallback;
  if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
    var norm = String(raw).trim().toLowerCase();
    if (norm === 'true' || norm === '1' || norm === 'yes') {
      value = true;
    } else if (norm === 'false' || norm === '0' || norm === 'no') {
      value = false;
    }
  }
  PERF_FLAG_CACHE_[name] = value;
  return value;
}

/**
 * Forces flag values for the remainder of the current execution or until the
 * matching pop. Diagnostics only.
 *
 * @param {!Object<string, boolean>} overrides
 */
function perfFlagOverridePush_(overrides) {
  PERF_FLAG_OVERRIDES_.push(overrides || {});
}

/** Removes the most recent override frame. */
function perfFlagOverridePop_() {
  PERF_FLAG_OVERRIDES_.pop();
}

/**
 * Current resolved value of every known flag, for ADMIN Settings display.
 * @return {!Object<string, boolean>}
 */
function perfFlagsSnapshot_() {
  var out = {};
  for (var name in PERF_FLAG_DEFAULTS_) {
    if (Object.prototype.hasOwnProperty.call(PERF_FLAG_DEFAULTS_, name)) {
      out[name] = perfFlag_(name);
    }
  }
  return out;
}

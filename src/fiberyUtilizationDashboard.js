/**
 * PRD version 3.14.1 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Utilization Management Dashboard orchestrator (route id `operations`, panel
 * `#panel-operations`). Reads `Agreement Management/Labor Costs` from Fibery
 * through batched / paginated `fibery.entity/query` calls, normalizes rows,
 * computes KPIs + server-side aggregates, and returns the JSON view-model
 * the client renders for the Phase A surfaces in
 * docs/features/005-utilization-management-dashboard.md.
 *
 * No persistent server-side cache of payloads - Fibery is source of truth.
 * The browser owns presentation cache (`sessionStorage`) with a configurable
 * TTL surfaced through `getUtilizationCacheTtlMinutes()`.
 *
 * Public surface (client-callable via google.script.run):
 *   getUtilizationDashboardData(rangeStart?, rangeEnd?)
 *     - returns the full view-model payload for the date window (includes
 *       `laborHours` target config for the Labor Hours panel, feature 007).
 *   getUtilizationCacheTtlMinutes()
 *     - returns the configured default TTL minutes (Script Property
 *       UTILIZATION_CACHE_TTL_MINUTES, default 10).
 *
 * Internal diagnostics (run from the Apps Script editor):
 *   _diag_pingUtilization()           - verifies host + token reach Fibery.
 *   _diag_sampleUtilizationPayload()  - fetches a tiny window + dumps shapes.
 *   _diag_sampleUtilizationAlerts()   - fetches the configured default range
 *                                       + dumps the per-rule alert breakdown.
 */

/** @const {string} */
var UTILIZATION_CACHE_TTL_PROP_ = 'UTILIZATION_CACHE_TTL_MINUTES';

/**
 * Returns the configured default TTL (minutes) for the utilization dashboard
 * client cache. Floored at 1 minute; falsy / non-positive values fall back to
 * the default. The browser may override per-user via a localStorage preference
 * (FR-76b - analogous to the agreement dashboard's FR-56b).
 *
 * @return {number}
 */
function getUtilizationCacheTtlMinutes() {
  requireAuthForApi_();
  var t = getUtilizationThresholds_();
  return t.cacheTtlMinutes;
}

/**
 * Returns the normalized utilization-dashboard JSON for the Operations panel.
 * Re-checks spreadsheet authorization via requireAuthForApi_().
 *
 * @param {?string=} rangeStart ISO datetime (inclusive). Optional. When both
 *   range args are absent, defaults to `now - UTILIZATION_DEFAULT_RANGE_DAYS`.
 * @param {?string=} rangeEnd ISO datetime (exclusive upper bound). Optional.
 *   When both range args are absent, defaults to `now`.
 * @return {{
 *   ok: boolean,
 *   partial?: boolean,
 *   source: string,
 *   fetchedAt: string,
 *   cacheSchemaVersion: number,
 *   ttlMinutes: number,
 *   range: !{ start: string, end: string, defaulted: boolean, clamped: boolean },
 *   rows: !Array<!Object>,
 *   kpis: !Object,
 *   dimensions: !Object,
 *   aggregates: !Object,
 *   alerts: !Array<!Object>,
 *   laborHours: !Object,
 *   warnings?: !Array<string>,
 *   message?: string
 * }}
 */
function getUtilizationDashboardData(rangeStart, rangeEnd) {
  requireAuthForApi_();
  var thresholds = getUtilizationThresholds_();
  var now = new Date();
  var range = resolveRange_(rangeStart, rangeEnd, now, thresholds);

  // Prefer fos_labor_costs (Clockify Hub mirror): spans YTD+ and honors the
  // panel date picker without depending on the narrow panel hydrate blob.
  var fromMirror = buildUtilizationPayloadFromFosLaborCosts_(
    range,
    thresholds,
    now
  );
  if (fromMirror && fromMirror.ok) {
    return fromMirror;
  }

  // Fallback: slice the hydrated panel payload (legacy ~60-day windows).
  var served = serveLivePanelFromSupabaseOrFail_(
    'utilization',
    UTILIZATION_DASHBOARD_CACHE_SCHEMA_VERSION_
  );
  if (!served || served.ok === false) {
    return served;
  }
  return applyUtilizationRequestedRange_(served, rangeStart, rangeEnd);
}

/**
 * Builds a Live utilization payload from `fos_labor_costs` for `[range.start, range.end)`.
 * @param {!{start: string, end: string, defaulted: boolean, clamped: boolean}} range
 * @param {!Object} thresholds
 * @param {!Date} now
 * @return {!Object}
 * @private
 */
function buildUtilizationPayloadFromFosLaborCosts_(range, thresholds, now) {
  if (!isSupabaseConfigured_()) {
    return { ok: false, reason: 'SUPABASE_UNCONFIGURED' };
  }
  // Feature 047 B4. The cache path returns null for every outcome that is not a
  // usable serve, so a cache read error, an oversized window, or a truncated
  // fetch all fall through to the exact-range build below unchanged.
  if (perfFlag_('PERF_USE_RANGE_CACHE')) {
    var cached = serveUtilizationFromRangeCache_(range, thresholds, now);
    if (cached) {
      return cached;
    }
  }
  var built = buildUtilizationRowsForWindow_(range.start, range.end, thresholds);
  if (!built.ok) {
    return {
      ok: false,
      reason: built.reason || 'FOS_LABOR_FETCH_FAILED',
      message: built.message || 'Could not read fos_labor_costs.',
    };
  }
  return assembleUtilizationPayload_(built.rows, range, thresholds, now, {
    truncated: built.truncated,
    loadSource: 'fos_labor_costs',
  });
}

/**
 * Reads `[startIso, endIso)` from `fos_labor_costs` and returns normalized rows.
 *
 * Split out of `buildUtilizationPayloadFromFosLaborCosts_` in 3.13.0 so the
 * range cache can build a day-aligned superset through exactly the same fetch,
 * mapping, and normalization the direct path uses. `normalizeLaborRows_` is
 * strictly row-local, which is what makes normalizing a superset and then
 * filtering equivalent to filtering and then normalizing.
 *
 * @param {string} startIso inclusive
 * @param {string} endIso exclusive
 * @param {!Object} thresholds
 * @return {!{ok: boolean, rows?: !Array<!Object>, truncated?: boolean,
 *            reason?: string, message?: string}}
 * @private
 */
function buildUtilizationRowsForWindow_(startIso, endIso, thresholds) {
  var fetched = fetchFosLaborCostsByRange_(startIso, endIso);
  if (!fetched.ok) {
    return {
      ok: false,
      reason: fetched.reason || 'FOS_LABOR_FETCH_FAILED',
      message: fetched.message || 'Could not read fos_labor_costs.',
    };
  }
  var source = fetched.rows || [];
  var dimMaps = loadUtilizationLaborDimMaps_();
  var raw = [];
  for (var i = 0; i < source.length; i++) {
    raw.push(
      mapFosLaborCostRowToUtilRaw_(
        source[i],
        dimMaps.usersByClockifyId,
        dimMaps.agreementsByProjectId,
        dimMaps.companiesMap,
        dimMaps.rolesMap
      )
    );
  }
  return {
    ok: true,
    rows: normalizeLaborRows_(raw, thresholds),
    truncated: !!fetched.truncated,
  };
}

/**
 * Assembles the Live utilization payload from normalized rows.
 *
 * This is the single payload constructor for every Live utilization path. It
 * exists because feature 047 has already shipped two bugs of the same class: two
 * call sites handling the same data where only one applied the required
 * transform. B1 hit it on the server re-slice and 3.10.0 hit it in
 * `applyUtilPayload`. With the fresh build and the range-cache serve both
 * routing through here, the two cannot disagree about key set, key order, or
 * encoding, so there is nothing left for a reviewer to have to keep in sync.
 *
 * Everything here is derived, not stored: alerts depend on `now`, and every
 * aggregate depends on the resolved thresholds, so recomputing per serve keeps an
 * ADMIN threshold change effective immediately.
 *
 * @param {!Array<!Object>} rows Normalized rows already filtered to `range`.
 * @param {!{start: string, end: string, defaulted: boolean, clamped: boolean}} range
 * @param {!Object} thresholds
 * @param {!Date} now
 * @param {!{truncated: (boolean|undefined), loadSource: (string|undefined)}} opts
 * @return {!Object}
 * @private
 */
function assembleUtilizationPayload_(rows, range, thresholds, now, opts) {
  opts = opts || {};
  var kpis = computeUtilizationKpis_(rows);
  var dimensions = buildUtilizationDimensions_(rows, thresholds);
  var aggregates = buildUtilizationAggregates_(rows, thresholds);
  aggregates.byPersonWeek = buildByPersonWeek_(rows, range, thresholds);
  var alerts = buildUtilizationAlerts_(
    rows,
    aggregates.byPersonWeek,
    thresholds,
    range,
    now
  );
  // Encode only after alerts, which read the object form.
  encodeUtilizationAggregatesForWire_(aggregates);

  var warnings = [];
  if (opts.truncated) {
    warnings.push(
      'fos_labor_costs page ceiling reached; data may be incomplete for this range.'
    );
  }
  if (range.clamped) {
    warnings.push(
      'Date range clamped to UTILIZATION_MAX_RANGE_DAYS (' +
        thresholds.maxRangeDays +
        ').'
    );
  }

  var out = {
    ok: true,
    source: 'supabase',
    loadSource: opts.loadSource || 'fos_labor_costs',
    fetchedAt: now.toISOString(),
    cacheSchemaVersion: UTILIZATION_DASHBOARD_CACHE_SCHEMA_VERSION_,
    ttlMinutes: thresholds.cacheTtlMinutes,
    range: range,
    dataWindow: { start: range.start, end: range.end },
    rows: encodeUtilizationRowsForWire_(rows),
    rowsCodec: utilizationRowsCodec_(),
    kpis: kpis,
    dimensions: dimensions,
    aggregates: aggregates,
    alerts: alerts,
    laborHours: getLaborHoursConfig_(),
    heatmapTopNPersons: thresholds.heatmapTopNPersons,
  };
  if (warnings.length) {
    out.warnings = warnings;
    out.partial = true;
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/* Range-keyed cache (feature 047 workstream B4)                             */
/* ------------------------------------------------------------------------- */

/**
 * The inputs, other than the window itself, that can change a cached bundle's
 * rows. Hashed into the cache key.
 *
 * Deliberately over-keyed. Only `internalCompanyNames` provably reaches a stored
 * row today, through `isInternal`; every other threshold feeds an aggregate that
 * is recomputed on serve. Keying on the whole resolved threshold object means an
 * ADMIN retuning any utilization knob costs one rebuild, whereas a key that
 * missed a threshold which later started feeding a row would serve wrong numbers
 * with no symptom. The palettes ride along harmlessly: they are code constants,
 * so they add no key churn between deploys.
 *
 * `PERF_USE_NORMALIZED_LABOR_COLS` is included because it selects which columns
 * the mapper reads. `PERF_SLIM_VIZ_AGGREGATES` is excluded on purpose: a bundle
 * stores no aggregates, so the flag cannot change one.
 *
 * @param {!Object} thresholds
 * @return {!Object}
 * @private
 */
function utilizationRangeCacheKeyInputs_(thresholds) {
  return {
    bundleVersion: VIZ_RANGE_CACHE_BUNDLE_VERSION_,
    thresholds: thresholds,
    normalizedLaborCols: perfFlag_('PERF_USE_NORMALIZED_LABOR_COLS'),
  };
}

/**
 * Filters normalized rows to `[range.start, range.end)`.
 *
 * Mirrors the PostgREST predicate `start_date_time >= start and < end`, using the
 * same `utilizationRowStartMs_` the stored-blob re-slice uses. A row with no
 * parseable start is dropped here and excluded by `>=` there, so the two agree.
 *
 * @param {!Array<!Object>} rows
 * @param {!{start: string, end: string}} range
 * @return {!Array<!Object>}
 * @private
 */
function filterUtilizationRowsToRange_(rows, range) {
  var startMs = parseIsoMs_(range.start);
  var endMs = parseIsoMs_(range.end);
  if (startMs === null || endMs === null) {
    return rows || [];
  }
  var out = [];
  for (var i = 0; i < (rows || []).length; i++) {
    var ms = utilizationRowStartMs_(rows[i]);
    if (ms === null) {
      continue;
    }
    if (ms >= startMs && ms < endMs) {
      out.push(rows[i]);
    }
  }
  return out;
}

/**
 * Serves a utilization payload through the range cache, or returns null so the
 * caller falls back to the exact-range build.
 *
 * On a hit the bundle's rows are filtered to the exact requested instants. On a
 * miss the superset is built once, stored, and the same filter applied, so a
 * first request pays about 0.8 percent more rows than it needs and every later
 * request in the same hydrate epoch pays one read instead of eleven.
 *
 * Returns null (never a partial payload) whenever the cache cannot be trusted:
 * an unresolvable range, an RPC error, a fetch failure, or a truncated superset.
 * A truncated superset is refused rather than stored because it is missing rows
 * by definition and would poison every later request for that window.
 *
 * @param {!{start: string, end: string, defaulted: boolean, clamped: boolean}} range
 * @param {!Object} thresholds
 * @param {!Date} now
 * @return {?Object}
 * @private
 */
function serveUtilizationFromRangeCache_(range, thresholds, now) {
  var superset = vizRangeCacheSupersetForRange_(range);
  if (!superset) {
    vizRangeCacheTallyBump_('skip');
    return null;
  }
  var keyHash = vizRangeCacheKeyHash_(utilizationRangeCacheKeyInputs_(thresholds));
  var got = vizRangeCacheGet_(
    'utilization',
    superset,
    UTILIZATION_DASHBOARD_CACHE_SCHEMA_VERSION_,
    keyHash
  );
  if (!got.ok) {
    vizRangeCacheTallyBump_('error');
    return null;
  }

  if (got.fresh && got.bundle) {
    var decoded = decodeUtilizationRowsFromWire_(got.bundle);
    var cachedRows = decoded && decoded.rows;
    if (Object.prototype.toString.call(cachedRows) === '[object Array]') {
      vizRangeCacheTallyBump_('hit');
      return assembleUtilizationPayload_(
        filterUtilizationRowsToRange_(cachedRows, range),
        range,
        thresholds,
        now,
        { truncated: false, loadSource: 'fos_viz_range_cache' }
      );
    }
  }

  var built = buildUtilizationRowsForWindow_(superset.startIso, superset.endIso, thresholds);
  if (!built.ok || built.truncated) {
    vizRangeCacheTallyBump_('error');
    return null;
  }
  vizRangeCachePut_(
    'utilization',
    superset,
    UTILIZATION_DASHBOARD_CACHE_SCHEMA_VERSION_,
    keyHash,
    {
      v: VIZ_RANGE_CACHE_BUNDLE_VERSION_,
      window: { start: superset.startIso, end: superset.endIso },
      rowCount: built.rows.length,
      rows: encodeUtilizationRowsForWire_(built.rows),
      rowsCodec: utilizationRowsCodec_(),
    },
    got.currentWatermark,
    got.currentRowCount
  );
  vizRangeCacheTallyBump_('miss');
  return assembleUtilizationPayload_(
    filterUtilizationRowsToRange_(built.rows, range),
    range,
    thresholds,
    now,
    { truncated: false, loadSource: 'fos_viz_range_cache_build' }
  );
}

/**
 * Rolling day presets to warm at the end of hydrate.
 *
 * These are the `util-range-preset` options the client can send as a rolling
 * window. **180 and YTD are deliberately absent.** `hydrateSupabaseUtilization_`
 * records that a YTD-sized JSON upsert times out in Postgres, and warming the
 * two widest windows would spend the most hydrate time on the least used
 * options. They still populate on first use, subject to
 * `VIZ_RANGE_CACHE_MAX_CHARS_`.
 * @const {!Array<number>}
 */
var UTILIZATION_WARM_PRESET_DAYS_ = [30, 60, 90];

/**
 * Warms the range cache for the rolling presets, then garbage-collects entries
 * whose sources have moved on.
 *
 * One labor fetch, not one per preset. The presets are nested windows ending on
 * the same UTC day, so the widest is fetched and normalized once and the
 * narrower bundles are sliced out of it in memory. That is the difference
 * between roughly four seconds and roughly fifteen at the end of the hydrate.
 *
 * A warmed key only helps a request on the same UTC day, because the day-aligned
 * end bound moves at UTC midnight. That is accepted: a request that misses
 * writes its own entry.
 *
 * @return {!{ok: boolean, detail: string, warmed: !Array<!Object>, message?: string}}
 */
function warmUtilizationRangeCache_() {
  var thresholds = getUtilizationThresholds_();
  var now = new Date();
  var keyHash = vizRangeCacheKeyHash_(utilizationRangeCacheKeyInputs_(thresholds));

  var dayList = [thresholds.defaultRangeDays];
  for (var p = 0; p < UTILIZATION_WARM_PRESET_DAYS_.length; p++) {
    if (dayList.indexOf(UTILIZATION_WARM_PRESET_DAYS_[p]) === -1) {
      dayList.push(UTILIZATION_WARM_PRESET_DAYS_[p]);
    }
  }
  var widestDays = 0;
  for (var w = 0; w < dayList.length; w++) {
    if (dayList[w] > widestDays) {
      widestDays = dayList[w];
    }
  }

  var widestRange = resolveRange_(
    new Date(now.getTime() - widestDays * 86400000).toISOString(),
    now.toISOString(),
    now,
    thresholds
  );
  var widestSuperset = vizRangeCacheSupersetForRange_(widestRange);
  if (!widestSuperset) {
    return { ok: false, detail: 'no window', warmed: [], message: 'Could not resolve a window.' };
  }
  // Read the fingerprint before the fetch so a mid-build upstream sync makes the
  // new entries stale rather than making them look current.
  var probe = vizRangeCacheGet_(
    'utilization',
    widestSuperset,
    UTILIZATION_DASHBOARD_CACHE_SCHEMA_VERSION_,
    keyHash
  );
  if (!probe.ok || !probe.currentWatermark) {
    return {
      ok: false,
      detail: 'no fingerprint',
      warmed: [],
      message: probe.message || 'Could not read the source fingerprint.',
    };
  }
  var built = buildUtilizationRowsForWindow_(
    widestSuperset.startIso,
    widestSuperset.endIso,
    thresholds
  );
  if (!built.ok) {
    return {
      ok: false,
      detail: 'fetch failed',
      warmed: [],
      message: built.message || 'Labor fetch failed.',
    };
  }
  if (built.truncated) {
    return { ok: false, detail: 'truncated fetch', warmed: [], message: 'Page ceiling reached.' };
  }

  var warmed = [];
  for (var i = 0; i < dayList.length; i++) {
    var days = dayList[i];
    var range = resolveRange_(
      new Date(now.getTime() - days * 86400000).toISOString(),
      now.toISOString(),
      now,
      thresholds
    );
    var superset = vizRangeCacheSupersetForRange_(range);
    if (!superset) {
      continue;
    }
    var slice = filterUtilizationRowsToRange_(built.rows, {
      start: superset.startIso,
      end: superset.endIso,
    });
    var put = vizRangeCachePut_(
      'utilization',
      superset,
      UTILIZATION_DASHBOARD_CACHE_SCHEMA_VERSION_,
      keyHash,
      {
        v: VIZ_RANGE_CACHE_BUNDLE_VERSION_,
        window: { start: superset.startIso, end: superset.endIso },
        rowCount: slice.length,
        rows: encodeUtilizationRowsForWire_(slice),
        rowsCodec: utilizationRowsCodec_(),
      },
      probe.currentWatermark,
      probe.currentRowCount
    );
    warmed.push({
      days: days,
      rangeStart: superset.startYmd,
      rangeEnd: superset.endYmd,
      rowCount: slice.length,
      chars: put.chars,
      stored: put.ok,
      skipped: put.skipped || null,
    });
  }

  var gc = vizRangeCacheGc_('utilization');
  var storedCount = 0;
  for (var s = 0; s < warmed.length; s++) {
    if (warmed[s].stored) {
      storedCount++;
    }
  }
  return {
    ok: true,
    detail:
      'warmed ' +
      storedCount +
      '/' +
      warmed.length +
      ' preset(s) from ' +
      built.rows.length +
      ' rows; gc deleted ' +
      gc.deleted,
    warmed: warmed,
    gc: gc,
  };
}

/**
 * @param {string} startIso inclusive
 * @param {string} endIso exclusive
 * @return {!{ok: boolean, rows?: !Array<!Object>, truncated?: boolean, message?: string, reason?: string}}
 * @private
 */
function fetchFosLaborCostsByRange_(startIso, endIso) {
  var pageSize = SUPABASE_DEFAULT_PAGE_SIZE_ || 1000;
  var maxPages = 60;
  var all = [];
  // Feature 047 A1: `fibery_payload_json` carries only 13 keys, all of which
  // duplicate typed columns already selected here. The role, rate, company, and
  // customer keys the mapper prefers are absent from every mirrored row, so
  // those lookups always fall through to the dimension maps. Omitting the
  // column took a default 90-day window from ~10 MB to ~3.6 MB of JSON and
  // removed ~9,500 per-row JSON.parse calls, with identical output.
  var selectCols =
    'clockify_time_log_id,start_date_time,end_date_time,seconds,clockify_hours,' +
    'task,project_id,billable,user_id,time_entry_user_name,time_entry_project_name';
  if (!perfFlag_('PERF_USE_NORMALIZED_LABOR_COLS')) {
    selectCols += ',fibery_payload_json';
  }
  var andFilter =
    '(start_date_time.gte."' +
    String(startIso) +
    '",start_date_time.lt."' +
    String(endIso) +
    '")';

  for (var page = 0; page < maxPages; page++) {
    var offset = page * pageSize;
    var res = supabaseRest_(
      'get',
      '/rest/v1/fos_labor_costs',
      {
        select: selectCols,
        and: andFilter,
        // Feature 047 B4: the primary key is a required tiebreaker, not a
        // nicety. Measured on the default window, 4,736 of 5,821 rows share
        // their `start_date_time` with at least one other row (865 tied
        // timestamps, largest group 19), and the plan for this query is an index
        // scan feeding a quicksort, which is unstable. Two identical requests
        // could therefore already return tied rows in different positions, and a
        // range cache cannot be verified against a freshly built window unless
        // the order is deterministic. Cost of the second sort key: 16.9 ms
        // against a ~2,800 ms panel build. This makes production order
        // deterministic where it was previously arbitrary; it can shift a row's
        // position within one timestamp, and with it a Top-N entry whose hours
        // tie exactly, but it cannot change any total.
        order: 'start_date_time.asc,clockify_time_log_id.asc',
        limit: String(pageSize),
        offset: String(offset),
      },
      null,
      null
    );
    if (!res.ok) {
      return {
        ok: false,
        reason: res.reason || 'SUPABASE_HTTP',
        message: res.message || 'fos_labor_costs query failed.',
      };
    }
    var chunk = res.json;
    if (!chunk || !chunk.length) {
      return { ok: true, rows: all, truncated: false };
    }
    for (var i = 0; i < chunk.length; i++) {
      all.push(chunk[i]);
    }
    if (chunk.length < pageSize) {
      return { ok: true, rows: all, truncated: false };
    }
  }
  return { ok: true, rows: all, truncated: true };
}

/**
 * Normalizes PostgREST / Postgres timestamptz strings to ISO-8601 so
 * `Date.parse` / Apps Script `new Date` behave consistently.
 * e.g. `2026-07-20 03:30:00+00` -> `2026-07-20T03:30:00+00:00`
 * @param {?*} v
 * @return {?string}
 * @private
 */
function normalizePostgresTimestamptzToIso_(v) {
  if (v == null || v === '') {
    return null;
  }
  if (Object.prototype.toString.call(v) === '[object Date]') {
    var dt = /** @type {!Date} */ (v);
    return isFinite(dt.getTime()) ? dt.toISOString() : null;
  }
  var s = String(v).trim();
  if (!s) {
    return null;
  }
  if (s.indexOf(' ') >= 0 && s.indexOf('T') < 0) {
    s = s.replace(' ', 'T');
  }
  // Postgres often emits +00 / -05 without minutes.
  if (/[+-]\d{2}$/.test(s)) {
    s += ':00';
  }
  return s;
}

/**
 * Dimension maps for joining `fos_labor_costs` to agreement customer and
 * Clockify user role (same sources as Resource Assignments).
 * @return {{
 *   usersByClockifyId: !Object,
 *   agreementsByProjectId: !Object,
 *   companiesMap: !Object,
 *   rolesMap: !Object
 * }}
 * @private
 */
function loadUtilizationLaborDimMaps_() {
  var maps = {
    usersByClockifyId: {},
    agreementsByProjectId: {},
    companiesMap: {},
    rolesMap: {},
  };
  try {
    if (typeof loadFosClockifyUsersByClockifyIdMap_ === 'function') {
      maps.usersByClockifyId = loadFosClockifyUsersByClockifyIdMap_() || {};
    }
  } catch (eUsers) {
    maps.usersByClockifyId = {};
  }
  try {
    if (typeof loadFosAgreementsByClockifyProjectIdMap_ === 'function') {
      maps.agreementsByProjectId = loadFosAgreementsByClockifyProjectIdMap_() || {};
    }
  } catch (eAgr) {
    maps.agreementsByProjectId = {};
  }
  try {
    if (typeof loadFosCompaniesMap_ === 'function') {
      maps.companiesMap = loadFosCompaniesMap_() || {};
    }
  } catch (eCo) {
    maps.companiesMap = {};
  }
  try {
    if (typeof loadFosTeamMemberRolesMap_ === 'function') {
      maps.rolesMap = loadFosTeamMemberRolesMap_() || {};
    }
  } catch (eRole) {
    maps.rolesMap = {};
  }
  return maps;
}

/**
 * String name from a Fibery relation / enum blob or a plain string.
 * @param {?*} v
 * @return {?string}
 * @private
 */
function fiberyRelName_(v) {
  if (v == null || v === '') {
    return null;
  }
  if (typeof v === 'string') {
    var s = v.trim();
    return s || null;
  }
  if (typeof v === 'object') {
    if (v['Agreement Management/Name'] != null) {
      return fiberyRelName_(v['Agreement Management/Name']);
    }
    if (v['enum/name'] != null) {
      return fiberyRelName_(v['enum/name']);
    }
    if (v.name != null) {
      return fiberyRelName_(v.name);
    }
  }
  return null;
}

/**
 * Customer name from a mirrored Fibery labor payload, when present.
 * @param {!Object} p
 * @return {?string}
 * @private
 */
function customerNameFromFiberyLaborPayload_(p) {
  var agr = p['Agreement Management/Agreement'];
  if (agr && typeof agr === 'object') {
    var fromAgr = fiberyRelName_(agr['Agreement Management/Customer']);
    if (fromAgr) {
      return fromAgr;
    }
  }
  return fiberyRelName_(p['Agreement Management/Customer']);
}

/**
 * Maps a fos_labor_costs row into the raw shape normalizeLaborRows_ expects.
 * Joins Datastore `fos_agreements` / `fos_companies` for customer and
 * `fos_clockify_users` / `fos_team_member_roles` for role (FR-75 / FR-77).
 *
 * @param {!Object} row
 * @param {?Object=} usersByClockifyId email/Clockify-id -> fos_clockify_users
 * @param {?Object=} agreementsByProjectId clockify_project_id -> fos_agreements
 * @param {?Object=} companiesMap fibery_id -> fos_companies
 * @param {?Object=} rolesMap fibery_id -> fos_team_member_roles
 * @return {!Object}
 * @private
 */
function mapFosLaborCostRowToUtilRaw_(
  row,
  usersByClockifyId,
  agreementsByProjectId,
  companiesMap,
  rolesMap
) {
  row = row || {};
  usersByClockifyId = usersByClockifyId || {};
  agreementsByProjectId = agreementsByProjectId || {};
  companiesMap = companiesMap || {};
  rolesMap = rolesMap || {};
  var p = row.fibery_payload_json;
  if (typeof p === 'string') {
    try {
      p = JSON.parse(p);
    } catch (e) {
      p = null;
    }
  }
  p = p || {};
  var hours = Number(row.clockify_hours);
  if (!isFinite(hours)) {
    hours = Number(p['Agreement Management/Clockify Hours']);
  }
  if (!isFinite(hours) && row.seconds != null) {
    hours = Number(row.seconds) / 3600;
  }
  if (!isFinite(hours)) {
    hours = 0;
  }
  var startIso = normalizePostgresTimestamptzToIso_(
    row.start_date_time || p['Agreement Management/Start Date Time'] || null
  );
  var endIso = normalizePostgresTimestamptzToIso_(
    row.end_date_time || p['Agreement Management/End Date Time'] || null
  );
  var company =
    p['Agreement Management/Clockify User Company'] ||
    (p['Agreement Management/Clockify User Company'] &&
      p['Agreement Management/Clockify User Company']['enum/name']) ||
    null;
  if (company && typeof company === 'object' && company['enum/name']) {
    company = company['enum/name'];
  }
  var workStatus = null;
  var wsPath = p['Agreement Management/Clockify User'];
  if (wsPath && typeof wsPath === 'object') {
    var wsNested = wsPath['Agreement Management/Work Status'];
    if (wsNested && typeof wsNested === 'object' && wsNested['enum/name']) {
      workStatus = wsNested['enum/name'];
    } else if (typeof wsNested === 'string') {
      workStatus = wsNested;
    }
  }
  var userName =
    row.time_entry_user_name ||
    p['Agreement Management/Time Entry User Name'] ||
    '(Unknown user)';
  var userId = row.user_id || p['Agreement Management/User ID'] || null;
  var user = null;
  if (userId) {
    var uid = String(userId);
    user =
      usersByClockifyId[uid] ||
      usersByClockifyId[uid.toLowerCase()] ||
      null;
  }
  if (user) {
    if (user.company_enum_name) {
      company = user.company_enum_name;
    }
    if (user.work_status_name) {
      workStatus = user.work_status_name;
    }
    if (user.name) {
      userName = user.name;
    }
  }

  var projectId = row.project_id || p['Agreement Management/Project ID'] || null;
  var agreement = null;
  if (projectId) {
    agreement = agreementsByProjectId[String(projectId)] || null;
  }
  var customer = customerNameFromFiberyLaborPayload_(p);
  var agreementId = null;
  var agreementName = null;
  var agreementState = null;
  var agreementType = null;
  if (agreement) {
    agreementId = agreement.fibery_id || null;
    agreementName = agreement.name || null;
    agreementState = agreement.state_name || null;
    agreementType = agreement.agreement_type || null;
    var companyRow =
      agreement.customer_id && companiesMap
        ? companiesMap[agreement.customer_id]
        : null;
    if (companyRow && companyRow.name) {
      customer = companyRow.name;
    }
  }
  if (!customer) {
    customer = '(Unassigned)';
  }

  var roleFromUser =
    user && user.team_member_role_id && rolesMap
      ? rolesMap[user.team_member_role_id]
      : null;
  var userRole =
    fiberyRelName_(p['Agreement Management/User Role']) ||
    (roleFromUser && roleFromUser.name ? String(roleFromUser.name) : null);
  var clockifyUserRole =
    fiberyRelName_(p['Agreement Management/Clockify User Role']) ||
    userRole;
  var billRate = numberOrNull_(p['Agreement Management/User Role Bill Rate']);
  var costRate = numberOrNull_(p['Agreement Management/User Role Cost Rate']);
  if (billRate === null && roleFromUser) {
    billRate = numberOrNull_(roleFromUser.bill_rate);
  }
  if (costRate === null && roleFromUser) {
    costRate = numberOrNull_(roleFromUser.cost_rate);
  }
  if (costRate === null && user) {
    costRate = numberOrNull_(user.team_member_role_cost_rate);
  }
  var cost = 0;
  if (costRate !== null && isFinite(hours)) {
    cost = hours * costRate;
  }

  return {
    id: row.clockify_time_log_id || '',
    hours: hours,
    seconds: numberOr_(row.seconds, 0),
    cost: cost,
    billable:
      row.billable || p['Agreement Management/Billable'] || 'No',
    startDateTime: startIso,
    endDateTime: endIso,
    agreementId: agreementId,
    agreementName: agreementName,
    agreementType: agreementType,
    agreementState: agreementState,
    customer: customer,
    projectName:
      row.time_entry_project_name ||
      p['Agreement Management/Time Entry Project Name'] ||
      '(No Project)',
    projectId: projectId,
    task: row.task || p['Agreement Management/Task'] || null,
    userName: userName,
    userId: userId,
    clockifyUserCompany: company ? String(company) : null,
    clockifyUserRole: clockifyUserRole,
    clockifyUserWorkStatus: workStatus ? String(workStatus) : null,
    userRole: userRole,
    userRoleBillRate: billRate,
    userRoleCostRate: costRate,
  };
}

/**
 * Filters a hydrated utilization payload to `[rangeStart, rangeEnd)` and
 * recomputes KPIs, dimensions, aggregates (incl. byPersonWeek), and alerts.
 * Does not call Fibery. Rows outside the Datastore window stay unavailable.
 *
 * @param {!Object} payload
 * @param {?string=} rangeStart
 * @param {?string=} rangeEnd
 * @return {!Object}
 * @private
 */
function applyUtilizationRequestedRange_(payload, rangeStart, rangeEnd) {
  // The stored blob ships encoded rows; slicing needs the object form.
  payload = decodeUtilizationRowsFromWire_(payload);
  var thresholds = getUtilizationThresholds_();
  var now = new Date();
  var range = resolveRange_(rangeStart, rangeEnd, now, thresholds);
  var dataWindow = payload.dataWindow || payload.range || null;
  var startMs = parseIsoMs_(range.start);
  var endMs = parseIsoMs_(range.end);
  if (startMs === null || endMs === null) {
    return payload;
  }
  var rowsIn = payload.rows || [];
  var filtered = [];
  for (var i = 0; i < rowsIn.length; i++) {
    var row = rowsIn[i];
    var ms = utilizationRowStartMs_(row);
    if (ms === null) {
      continue;
    }
    if (ms >= startMs && ms < endMs) {
      filtered.push(row);
    }
  }

  var warnings = [];
  if (payload.warnings && payload.warnings.length) {
    for (var wi = 0; wi < payload.warnings.length; wi++) {
      warnings.push(payload.warnings[wi]);
    }
  }
  if (dataWindow && dataWindow.start) {
    var windowStartMs = parseIsoMs_(dataWindow.start);
    var windowEndMs = dataWindow.end ? parseIsoMs_(dataWindow.end) : null;
    if (windowStartMs !== null && startMs < windowStartMs - 12 * 3600000) {
      warnings.push(
        'Requested range starts before the Datastore utilization window (' +
          String(dataWindow.start).slice(0, 10) +
          '). Days before that date are empty until the next ADMIN Pull / nightly hydrate.'
      );
    }
    if (windowEndMs !== null && endMs > windowEndMs + 12 * 3600000) {
      warnings.push(
        'Requested range ends after the Datastore utilization window (' +
          String(dataWindow.end).slice(0, 10) +
          '). Later days are empty until the next ADMIN Pull / nightly hydrate.'
      );
    }
  }

  var kpis = computeUtilizationKpis_(filtered);
  var dimensions = buildUtilizationDimensions_(filtered, thresholds);
  var aggregates = buildUtilizationAggregates_(filtered, thresholds);
  aggregates.byPersonWeek = buildByPersonWeek_(filtered, range, thresholds);
  var alerts = buildUtilizationAlerts_(
    filtered,
    aggregates.byPersonWeek,
    thresholds,
    range,
    now
  );
  encodeUtilizationAggregatesForWire_(aggregates);

  var out = {
    ok: true,
    source: payload.source || 'supabase',
    fetchedAt: payload.fetchedAt || now.toISOString(),
    supabaseSyncedAt: payload.supabaseSyncedAt || null,
    cacheDateKey: payload.cacheDateKey || null,
    cacheSchemaVersion:
      payload.cacheSchemaVersion || UTILIZATION_DASHBOARD_CACHE_SCHEMA_VERSION_,
    ttlMinutes:
      payload.ttlMinutes != null ? payload.ttlMinutes : thresholds.cacheTtlMinutes,
    range: range,
    dataWindow: dataWindow
      ? { start: dataWindow.start, end: dataWindow.end }
      : null,
    rows: encodeUtilizationRowsForWire_(filtered),
    rowsCodec: utilizationRowsCodec_(),
    kpis: kpis,
    dimensions: dimensions,
    aggregates: aggregates,
    alerts: alerts,
    laborHours: payload.laborHours || getLaborHoursConfig_(),
    heatmapTopNPersons:
      payload.heatmapTopNPersons != null
        ? payload.heatmapTopNPersons
        : thresholds.heatmapTopNPersons,
  };
  if (payload.loadSource) {
    out.loadSource = payload.loadSource;
  }
  if (warnings.length) {
    out.warnings = warnings;
    out.partial = true;
  }
  if (range.clamped) {
    out.warnings = out.warnings || [];
    out.warnings.push(
      'Date range clamped to UTILIZATION_MAX_RANGE_DAYS (' +
        thresholds.maxRangeDays +
        ').'
    );
    out.partial = true;
  }
  return out;
}

/**
 * @param {!Object} row
 * @return {?number}
 * @private
 */
function utilizationRowStartMs_(row) {
  if (!row) {
    return null;
  }
  var ms = parseIsoMs_(row.startDateTime);
  if (ms !== null) {
    return ms;
  }
  if (row.day) {
    return parseIsoMs_(String(row.day) + 'T12:00:00.000Z');
  }
  return null;
}

/**
 * Builds the utilization dashboard payload without user authorization.
 * Used by the daily historical snapshot job (`dashboardSnapshotJob.js`).
 *
 * @param {?string=} rangeStart ISO datetime (inclusive).
 * @param {?string=} rangeEnd ISO datetime (exclusive upper bound).
 * @return {!Object}
 */
function buildUtilizationDashboardPayload_(rangeStart, rangeEnd) {
  var now = new Date();
  var fetchedAtIso = now.toISOString();
  var thresholds = getUtilizationThresholds_();
  var ttlMinutes = thresholds.cacheTtlMinutes;
  var laborHoursCfg = getLaborHoursConfig_();
  var range = resolveRange_(rangeStart, rangeEnd, now, thresholds);

  var fetched = fetchAllLaborCosts_(range.start, range.end);
  if (!fetched.ok) {
    return {
      ok: false,
      source: 'fibery',
      fetchedAt: fetchedAtIso,
      cacheSchemaVersion: UTILIZATION_DASHBOARD_CACHE_SCHEMA_VERSION_,
      ttlMinutes: ttlMinutes,
      range: range,
      rows: [],
      kpis: emptyUtilizationKpis_(),
      dimensions: emptyUtilizationDimensions_(),
      aggregates: emptyUtilizationAggregates_(),
      alerts: [],
      laborHours: laborHoursCfg,
      message: fetched.message || 'Could not load utilization data from Fibery.',
      warnings: ['Fibery error: ' + (fetched.reason || 'UNKNOWN')],
    };
  }

  var rows = normalizeLaborRows_(fetched.rows, thresholds);
  var kpis = computeUtilizationKpis_(rows);
  var dimensions = buildUtilizationDimensions_(rows, thresholds);
  var aggregates = buildUtilizationAggregates_(rows, thresholds);
  // Phase C - per-person  x  per-week trajectory (capacity-scaled), feeds the
  // heatmap surface and the under/over-utilized alert rules.
  aggregates.byPersonWeek = buildByPersonWeek_(rows, range, thresholds);
  var alerts = buildUtilizationAlerts_(rows, aggregates.byPersonWeek, thresholds, range, now);
  encodeUtilizationAggregatesForWire_(aggregates);

  var warnings = [];
  if (fetched.truncated) {
    warnings.push(
      'Result paginator hit the ' + UTILIZATION_QUERY_MAX_PAGES_ + '-page ceiling; ' +
        'data may be incomplete. Narrow the date range to refetch in full.'
    );
  }

  var payload = {
    ok: true,
    source: 'fibery',
    fetchedAt: fetchedAtIso,
    cacheSchemaVersion: UTILIZATION_DASHBOARD_CACHE_SCHEMA_VERSION_,
    ttlMinutes: ttlMinutes,
    range: range,
    dataWindow: { start: range.start, end: range.end },
    rows: encodeUtilizationRowsForWire_(rows),
    rowsCodec: utilizationRowsCodec_(),
    kpis: kpis,
    dimensions: dimensions,
    aggregates: aggregates,
    alerts: alerts,
    laborHours: laborHoursCfg,
    heatmapTopNPersons: thresholds.heatmapTopNPersons,
  };
  if (warnings.length) {
    payload.warnings = warnings;
    payload.partial = true;
  }
  return payload;
}

/* ------------------------------------------------------------------------- */
/* Diagnostics - run manually from the Apps Script editor.                    */
/* ------------------------------------------------------------------------- */

/**
 * Lightweight credential / connectivity check (re-uses the agreement-dashboard
 * fibery client). Logs the workspace version when `FIBERY_HOST` +
 * `FIBERY_API_TOKEN` are set correctly.
 * @return {!Object}
 */
function _diag_pingUtilization() {
  var r = fiberyPing_();
  console.log('fiberyPing_ (utilization)  -> ', JSON.stringify(r));
  return r;
}

/**
 * One-page shape probe. Fetches the most recent ~25 labor rows for the last
 * 7 days, logs the first normalized row + KPI snapshot. Useful for verifying
 * field paths after a workspace schema change.
 * @return {!Object}
 */
function _diag_sampleUtilizationPayload() {
  var now = new Date();
  var endIso = now.toISOString();
  var start = new Date(now.getTime() - 7 * 86400000);
  var startIso = start.toISOString();
  var thresholds = getUtilizationThresholds_();
  var q = buildLaborCostsQuery_(startIso, endIso, 25, 0);
  var single = fiberyQuery_(q);
  if (!single.ok) {
    console.log('_diag_sampleUtilizationPayload (fetch failed)  -> ', JSON.stringify(single));
    return single;
  }
  var rows = normalizeLaborRows_(single.rows || [], thresholds);
  var summary = {
    ok: true,
    range: { start: startIso, end: endIso, defaulted: false, clamped: false },
    rawCount: (single.rows || []).length,
    normalizedCount: rows.length,
    firstRaw: (single.rows && single.rows[0]) || null,
    firstNormalized: rows[0] || null,
    kpis: computeUtilizationKpis_(rows),
  };
  console.log('_diag_sampleUtilizationPayload  -> ', JSON.stringify(summary).slice(0, 4000));
  return summary;
}

/**
 * Runs the full pipeline for the default range and prints the alert breakdown
 * (count per `kind`, top 5 by severity). Use after schema or threshold tweaks
 * to confirm the rules fire as expected against live data.
 *
 * @return {!Object}
 */
function _diag_sampleUtilizationAlerts() {
  var now = new Date();
  var thresholds = getUtilizationThresholds_();
  var range = resolveRange_(null, null, now, thresholds);
  var fetched = fetchAllLaborCosts_(range.start, range.end);
  if (!fetched.ok) {
    console.log('_diag_sampleUtilizationAlerts (fetch failed)  -> ', JSON.stringify(fetched));
    return fetched;
  }
  var rows = normalizeLaborRows_(fetched.rows, thresholds);
  var byPersonWeek = buildByPersonWeek_(rows, range, thresholds);
  var alerts = buildUtilizationAlerts_(rows, byPersonWeek, thresholds, range, now);
  var counts = {};
  for (var i = 0; i < alerts.length; i++) {
    counts[alerts[i].kind] = (counts[alerts[i].kind] || 0) + 1;
  }
  var summary = {
    ok: true,
    range: range,
    rowCount: rows.length,
    byPersonWeekCount: byPersonWeek.length,
    alertCount: alerts.length,
    countsByKind: counts,
    top5: alerts.slice(0, 5).map(function (a) {
      return { severity: a.severity, kind: a.kind, title: a.title };
    }),
  };
  console.log('_diag_sampleUtilizationAlerts  -> ', JSON.stringify(summary).slice(0, 4000));
  return summary;
}

/* ------------------------------------------------------------------------- */
/* Query builder + paginator                                                  */
/* ------------------------------------------------------------------------- */

/**
 * Builds one page of the `Agreement Management/Labor Costs` query. Field paths
 * match `docs/features/005-utilization-management-dashboard.md` Section "Data source".
 *
 * @param {string} startIso ISO datetime (inclusive lower bound).
 * @param {string} endIso ISO datetime (exclusive upper bound).
 * @param {number} limit
 * @param {number} offset
 * @return {!Object}
 * @private
 */
function buildLaborCostsQuery_(startIso, endIso, limit, offset) {
  return {
    query: {
      'q/from': 'Agreement Management/Labor Costs',
      'q/select': {
        id: 'fibery/id',
        publicId: 'fibery/public-id',
        name: 'Agreement Management/Name',
        hours: 'Agreement Management/Hours',
        seconds: 'Agreement Management/Seconds',
        cost: 'Agreement Management/Cost',
        billable: 'Agreement Management/Billable',
        startDateTime: 'Agreement Management/Start Date Time',
        endDateTime: 'Agreement Management/End Date Time',
        dateOfCreation: 'Agreement Management/Date of creation',
        agreementId: ['Agreement Management/Agreement', 'fibery/id'],
        agreementName: ['Agreement Management/Agreement', 'Agreement Management/Name'],
        agreementType: ['Agreement Management/Agreement', 'Agreement Management/Agreement Type', 'enum/name'],
        agreementState: ['Agreement Management/Agreement', 'workflow/state', 'enum/name'],
        customer: ['Agreement Management/Agreement', 'Agreement Management/Customer', 'Agreement Management/Name'],
        projectName: 'Agreement Management/Time Entry Project Name',
        projectId: 'Agreement Management/Project ID',
        task: 'Agreement Management/Task',
        userName: 'Agreement Management/Time Entry User Name',
        userId: 'Agreement Management/User ID',
        clockifyUserCompany: ['Agreement Management/Clockify User Company', 'enum/name'],
        clockifyUserRole: ['Agreement Management/Clockify User Role', 'enum/name'],
        clockifyUserWorkStatus: [
          'Agreement Management/Clockify User',
          'Agreement Management/Work Status',
          'enum/name',
        ],
        userRole: ['Agreement Management/User Role', 'Agreement Management/Name'],
        userRoleBillRate: 'Agreement Management/User Role Bill Rate',
        userRoleCostRate: 'Agreement Management/User Role Cost Rate',
      },
      'q/where': [
        'q/and',
        ['>=', ['Agreement Management/Start Date Time'], '$startIso'],
        ['<', ['Agreement Management/Start Date Time'], '$endIso'],
      ],
      // q/order-by uses the wrapped-vector form documented in PRD v1.9.2 - the
      // field-path itself MUST be an array even when single-segment. Bare-string
      // keys raise `Unknown order by expression {"v":"..."}` on raw REST.
      'q/order-by': [[['Agreement Management/Start Date Time'], 'q/desc']],
      'q/limit': limit,
      'q/offset': offset,
    },
    params: { $startIso: startIso, $endIso: endIso },
  };
}

/**
 * Fetches every labor-cost row in the requested window by paging through
 * Fibery until a page returns fewer than `q/limit` rows or until the
 * per-call page ceiling is hit. Each page is a separate `/api/commands` POST.
 *
 * @param {string} startIso
 * @param {string} endIso
 * @return {!{ok: true, rows: !Array<!Object>, truncated: boolean}|
 *           !{ok: false, reason: string, message: string}}
 * @private
 */
function fetchAllLaborCosts_(startIso, endIso) {
  var all = [];
  var truncated = false;
  for (var page = 0; page < UTILIZATION_QUERY_MAX_PAGES_; page++) {
    var offset = page * UTILIZATION_QUERY_PAGE_LIMIT_;
    var q = buildLaborCostsQuery_(startIso, endIso, UTILIZATION_QUERY_PAGE_LIMIT_, offset);
    var r = fiberyQuery_(q);
    if (!r.ok) {
      return r;
    }
    var rows = r.rows || [];
    for (var i = 0; i < rows.length; i++) {
      all.push(rows[i]);
    }
    if (rows.length < UTILIZATION_QUERY_PAGE_LIMIT_) {
      return { ok: true, rows: all, truncated: false };
    }
  }
  truncated = true;
  return { ok: true, rows: all, truncated: truncated };
}

/* ------------------------------------------------------------------------- */
/* Normalization                                                              */
/* ------------------------------------------------------------------------- */

/**
 * Coerces raw Fibery labor rows into the canonical client-ready shape (see
 * Section "Server contract" in 005-utilization-management-dashboard.md). Adds the
 * derived fields the rest of the pipeline relies on:
 *   - billable: boolean
 *   - hours: number (Fibery returns text)
 *   - day: 'YYYY-MM-DD'
 *   - week: 'YYYY-Www' (ISO Monday-anchored)
 *   - isInternal: Section U.11 derived
 *   - revenueFromLabor: hours  x  billRate when both known, else null
 *
 * @param {!Array<!Object>} rawRows
 * @param {!Object} thresholds
 * @return {!Array<!Object>}
 * @private
 */
function normalizeLaborRows_(rawRows, thresholds) {
  var out = [];
  for (var i = 0; i < rawRows.length; i++) {
    var r = rawRows[i] || {};
    var hours = numberOr_(r.hours, 0);
    var billable = isBillableText_(r.billable);
    var billRate = numberOrNull_(r.userRoleBillRate);
    var costRate = numberOrNull_(r.userRoleCostRate);
    var startIso = stringOrNull_(r.startDateTime);
    var customerName = stringOr_(r.customer, '(Unassigned)');
    if (!customerName) {
      customerName = '(Unassigned)';
    }

    // Feature 047 B1: `billableLabel`, `day`, `marginPerHour`, and
    // `revenueFromLabor` were derivable from fields already present, and
    // `seconds`, `endDateTime`, and `name` had no client reader at all. They
    // cost ~1 MB per default-window payload to carry. `week` stays because the
    // client re-aggregates on it and reproducing the Monday-anchored UTC key in
    // two places invites drift.
    var row = {
      id: stringOr_(r.id, ''),
      hours: hours,
      cost: numberOr_(r.cost, 0),
      billable: billable,
      startDateTime: startIso,
      week: extractIsoWeekKey_(startIso),
      agreementId: stringOrNull_(r.agreementId),
      agreementName: stringOrNull_(r.agreementName),
      agreementType: stringOrNull_(r.agreementType),
      agreementState: stringOrNull_(r.agreementState),
      customer: customerName,
      projectName: stringOr_(r.projectName, '(No Project)'),
      projectId: stringOrNull_(r.projectId),
      task: stringOrNull_(r.task),
      userName: stringOr_(r.userName, '(Unknown user)'),
      userId: stringOrNull_(r.userId),
      clockifyUserCompany: stringOrNull_(r.clockifyUserCompany),
      clockifyUserRole: stringOrNull_(r.clockifyUserRole),
      clockifyUserWorkStatus: stringOrNull_(r.clockifyUserWorkStatus),
      userRole: stringOrNull_(r.userRole),
      userRoleBillRate: billRate,
      userRoleCostRate: costRate,
    };
    row.isInternal = isInternalLabor_(row, thresholds.internalCompanyNames);
    out.push(row);
  }
  return out;
}

/**
 * Wire field order for encoded utilization rows. Append-only: the client maps
 * positionally, so inserting or reordering silently corrupts every row. Add new
 * fields at the end and bump `UTILIZATION_DASHBOARD_CACHE_SCHEMA_VERSION_`.
 * @const {!Array<string>}
 */
var UTIL_ROW_WIRE_FIELDS_ = [
  'id',
  'hours',
  'cost',
  'billable',
  'startDateTime',
  'week',
  'agreementId',
  'agreementName',
  'agreementType',
  'agreementState',
  'customer',
  'projectName',
  'projectId',
  'task',
  'userName',
  'userId',
  'clockifyUserCompany',
  'clockifyUserRole',
  'clockifyUserWorkStatus',
  'userRole',
  'userRoleBillRate',
  'userRoleCostRate',
  'isInternal',
];

/**
 * Fields encoded as an index into a per-field string table rather than repeated
 * inline. Chosen by cardinality against a default window: 8 customers, 22
 * agreements, 26 projects, 76 users, and 23 roles across ~6,000 rows. `task` is
 * included at ~978 distinct values because it still repeats about six times
 * each. `id` and `startDateTime` are deliberately excluded, being near-unique.
 * @const {!Array<string>}
 */
var UTIL_ROW_DICT_FIELDS_ = [
  'billable',
  'week',
  'agreementId',
  'agreementName',
  'agreementType',
  'agreementState',
  'customer',
  'projectName',
  'projectId',
  'task',
  'userName',
  'userId',
  'clockifyUserCompany',
  'clockifyUserRole',
  'clockifyUserWorkStatus',
  'userRole',
];

/**
 * Server-side inverse of `encodeUtilizationRowsForWire_`.
 *
 * Needed because the stored panel blob is re-sliced in Apps Script by
 * `applyUtilizationRequestedRange_` before it reaches a browser. Without this
 * that path would iterate the encoded envelope as if it were an array, find no
 * length, and quietly return an empty panel.
 *
 * Idempotent: payloads without a codec, or already decoded, pass through.
 *
 * @param {?Object} payload
 * @return {?Object} Payload whose `rows` is a plain array of row objects.
 * @private
 */
function decodeUtilizationRowsFromWire_(payload) {
  if (!payload || !payload.rowsCodec) {
    return payload;
  }
  var enc = payload.rows;
  if (!enc || Object.prototype.toString.call(enc.r) !== '[object Array]') {
    return payload;
  }
  var fields = payload.rowsCodec.fields || [];
  var dictFields = payload.rowsCodec.dictFields || [];
  var isDict = {};
  for (var d = 0; d < dictFields.length; d++) {
    isDict[dictFields[d]] = true;
  }
  var tables = enc.d || {};
  var out = [];
  for (var i = 0; i < enc.r.length; i++) {
    var tuple = enc.r[i] || [];
    var row = {};
    for (var f = 0; f < fields.length; f++) {
      var field = fields[f];
      var v = tuple[f];
      if (isDict[field] && typeof v === 'number') {
        var table = tables[field];
        row[field] = table && table.length > v ? table[v] : null;
      } else {
        row[field] = v === undefined ? null : v;
      }
    }
    out.push(row);
  }
  var decoded = {};
  for (var k in payload) {
    if (Object.prototype.hasOwnProperty.call(payload, k)) {
      decoded[k] = payload[k];
    }
  }
  decoded.rows = out;
  return decoded;
}

/**
 * Codec descriptor shipped alongside encoded rows so the client can decode
 * without hardcoding the field order.
 * @return {!Object}
 * @private
 */
function utilizationRowsCodec_() {
  return {
    version: 1,
    fields: UTIL_ROW_WIRE_FIELDS_.slice(),
    dictFields: UTIL_ROW_DICT_FIELDS_.slice(),
  };
}

/**
 * Encodes normalized rows for transport: each row becomes a positional array,
 * and high-repetition string fields become integer indexes into a shared table.
 *
 * Two separate costs are being removed. Repeated **key names** were 44.5% of the
 * remaining row bytes, since every one of ~6,000 rows carried all 23 field names
 * verbatim; positional arrays drop that to zero. Repeated **values** are then
 * folded into per-field dictionaries. The transform is lossless and reversed by
 * `decodeUtilPayload_` in `DashboardShell.html` before any consumer sees a row,
 * so filters, the detail table, CSV export, and the drawer are unaffected.
 *
 * Aggregates, KPIs, and alerts are computed upstream on the object form, so this
 * never participates in dashboard math.
 *
 * @param {!Array<!Object>} rows Normalized rows from `normalizeLaborRows_`.
 * @return {!{d: !Object<string, !Array<*>>, r: !Array<!Array<*>>}}
 * @private
 */
function encodeUtilizationRowsForWire_(rows) {
  rows = rows || [];
  var isDict = {};
  for (var d = 0; d < UTIL_ROW_DICT_FIELDS_.length; d++) {
    isDict[UTIL_ROW_DICT_FIELDS_[d]] = true;
  }
  var tables = {};
  var lookups = {};
  for (var t = 0; t < UTIL_ROW_DICT_FIELDS_.length; t++) {
    tables[UTIL_ROW_DICT_FIELDS_[t]] = [];
    lookups[UTIL_ROW_DICT_FIELDS_[t]] = {};
  }

  var encoded = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i] || {};
    var tuple = [];
    for (var f = 0; f < UTIL_ROW_WIRE_FIELDS_.length; f++) {
      var field = UTIL_ROW_WIRE_FIELDS_[f];
      var value = row[field];
      if (!isDict[field]) {
        tuple.push(value === undefined ? null : value);
        continue;
      }
      if (value === null || value === undefined) {
        tuple.push(null);
        continue;
      }
      // Prefix the lookup key so a value of "constructor" or "__proto__" cannot
      // collide with Object.prototype members.
      var key = 'v:' + String(value);
      var idx = lookups[field][key];
      if (idx === undefined) {
        idx = tables[field].length;
        tables[field].push(value);
        lookups[field][key] = idx;
      }
      tuple.push(idx);
    }
    encoded.push(tuple);
  }
  return { d: tables, r: encoded };
}

/* ------------------------------------------------------------------------- */
/* Visualization payload codec (feature 047 workstream B3)                    */
/* ------------------------------------------------------------------------- */

/**
 * Wire field order for encoded `aggregates.byPersonWeek` entries. Append-only,
 * for the same reason as `UTIL_ROW_WIRE_FIELDS_`: the client maps positionally,
 * so inserting or reordering silently corrupts every cell in the heatmap.
 * @const {!Array<string>}
 */
var UTIL_PW_WIRE_FIELDS_ = [
  'personKey',
  'personName',
  'personId',
  'week',
  'weekStartIso',
  'weekEndIso',
  'hours',
  'billableHours',
  'capacityHours',
  'utilizationPct',
  'partial',
  'partialFraction',
  'isInternal',
  'roles',
  'customers',
];

/**
 * Scalar fields encoded as an index into a per-field string table. Measured on
 * the 2026-08-25 blob: 617 entries over 76 persons and 10 weeks, so every one
 * of these repeats about eight times.
 * @const {!Array<string>}
 */
var UTIL_PW_DICT_FIELDS_ = [
  'personKey',
  'personName',
  'personId',
  'week',
  'weekStartIso',
  'weekEndIso',
];

/**
 * Fields holding a string array, encoded as an array of indexes into a shared
 * per-field table.
 * @const {!Array<string>}
 */
var UTIL_PW_LIST_DICT_FIELDS_ = ['roles', 'customers'];

/**
 * Booleans encoded as 0 / 1 so the wire form carries `1` rather than `false`.
 * @const {!Array<string>}
 */
var UTIL_PW_BOOL_FIELDS_ = ['partial', 'isInternal'];

/**
 * Codec descriptor shipped alongside the encoded entries.
 *
 * Carries its **own** `version`, separate from the panel `cacheSchemaVersion`,
 * so a future change to the visualization slice can be detected without
 * invalidating a stored blob whose rows and tables are still current.
 *
 * @return {!Object}
 * @private
 */
function utilizationPersonWeekCodec_() {
  return {
    version: 1,
    fields: UTIL_PW_WIRE_FIELDS_.slice(),
    dictFields: UTIL_PW_DICT_FIELDS_.slice(),
    listDictFields: UTIL_PW_LIST_DICT_FIELDS_.slice(),
    boolFields: UTIL_PW_BOOL_FIELDS_.slice(),
  };
}

/**
 * Encodes `aggregates.byPersonWeek` for transport.
 *
 * Measured on the live 2026-08-25 utilization blob: this slice was 272,469 of
 * the 283,333 JSON chars in `aggregates`, because 617 entries each repeated 15
 * key names plus a 30-character email in three separate fields. Encoding is
 * **lossless** - every field survives the round trip - and yields 48,654 chars,
 * 82.1 percent smaller. A field-dropping variant reached 90.7 percent but is
 * not used: `aggregates` is also handed to Ask AI as panel context, so silently
 * deleting dimensions there changes answers rather than just size.
 *
 * @param {!Array<!Object>} entries Output of `buildByPersonWeek_`.
 * @return {!{d: !Object<string, !Array<*>>, r: !Array<!Array<*>>}}
 * @private
 */
function encodeUtilizationPersonWeekForWire_(entries) {
  entries = entries || [];
  var isDict = {};
  var isListDict = {};
  var isBool = {};
  var tables = {};
  var lookups = {};
  var f;
  for (f = 0; f < UTIL_PW_DICT_FIELDS_.length; f++) {
    isDict[UTIL_PW_DICT_FIELDS_[f]] = true;
    tables[UTIL_PW_DICT_FIELDS_[f]] = [];
    lookups[UTIL_PW_DICT_FIELDS_[f]] = {};
  }
  for (f = 0; f < UTIL_PW_LIST_DICT_FIELDS_.length; f++) {
    isListDict[UTIL_PW_LIST_DICT_FIELDS_[f]] = true;
    tables[UTIL_PW_LIST_DICT_FIELDS_[f]] = [];
    lookups[UTIL_PW_LIST_DICT_FIELDS_[f]] = {};
  }
  for (f = 0; f < UTIL_PW_BOOL_FIELDS_.length; f++) {
    isBool[UTIL_PW_BOOL_FIELDS_[f]] = true;
  }

  // Prefix the lookup key so a value of "constructor" or "__proto__" cannot
  // collide with Object.prototype members.
  function intern(field, value) {
    var key = 'v:' + String(value);
    var idx = lookups[field][key];
    if (idx === undefined) {
      idx = tables[field].length;
      tables[field].push(value);
      lookups[field][key] = idx;
    }
    return idx;
  }

  var encoded = [];
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i] || {};
    var tuple = [];
    for (var w = 0; w < UTIL_PW_WIRE_FIELDS_.length; w++) {
      var field = UTIL_PW_WIRE_FIELDS_[w];
      var value = entry[field];
      if (isBool[field]) {
        tuple.push(value ? 1 : 0);
      } else if (isListDict[field]) {
        var list = value || [];
        var idxs = [];
        for (var l = 0; l < list.length; l++) {
          idxs.push(intern(field, list[l]));
        }
        tuple.push(idxs);
      } else if (isDict[field] && value !== null && value !== undefined) {
        tuple.push(intern(field, value));
      } else {
        tuple.push(value === undefined ? null : value);
      }
    }
    encoded.push(tuple);
  }
  return { d: tables, r: encoded };
}

/**
 * Inverse of `encodeUtilizationPersonWeekForWire_`.
 *
 * No server path reads a stored `byPersonWeek` today - every builder recomputes
 * it from rows - but this exists so a future server-side reader cannot repeat
 * the workstream B1 failure, where an encoded envelope was iterated as an array,
 * yielded no length, and produced an empty panel with no error.
 *
 * Idempotent: an entry list that is already an array passes through.
 *
 * @param {?Object} encoded
 * @param {?Object} codec
 * @return {!Array<!Object>}
 * @private
 */
function decodeUtilizationPersonWeekFromWire_(encoded, codec) {
  if (!encoded) {
    return [];
  }
  if (Object.prototype.toString.call(encoded) === '[object Array]') {
    return encoded;
  }
  if (Object.prototype.toString.call(encoded.r) !== '[object Array]') {
    return [];
  }
  codec = codec || utilizationPersonWeekCodec_();
  var fields = codec.fields || [];
  var tables = encoded.d || {};
  var isDict = {};
  var isListDict = {};
  var isBool = {};
  var i;
  for (i = 0; i < (codec.dictFields || []).length; i++) {
    isDict[codec.dictFields[i]] = true;
  }
  for (i = 0; i < (codec.listDictFields || []).length; i++) {
    isListDict[codec.listDictFields[i]] = true;
  }
  for (i = 0; i < (codec.boolFields || []).length; i++) {
    isBool[codec.boolFields[i]] = true;
  }

  function lookup(field, idx) {
    var table = tables[field];
    return table && table.length > idx ? table[idx] : null;
  }

  var out = [];
  for (var e = 0; e < encoded.r.length; e++) {
    var tuple = encoded.r[e] || [];
    var entry = {};
    for (var f = 0; f < fields.length; f++) {
      var field = fields[f];
      var v = tuple[f];
      if (isBool[field]) {
        entry[field] = !!v;
      } else if (isListDict[field]) {
        var list = [];
        var idxs = v || [];
        for (var l = 0; l < idxs.length; l++) {
          list.push(lookup(field, idxs[l]));
        }
        entry[field] = list;
      } else if (isDict[field] && typeof v === 'number') {
        entry[field] = lookup(field, v);
      } else {
        entry[field] = v === undefined ? null : v;
      }
    }
    out.push(entry);
  }
  return out;
}

/**
 * Replaces `aggregates.byPersonWeek` with its encoded form in place, and adds
 * the codec descriptor the client needs to reverse it.
 *
 * A no-op when `PERF_SLIM_VIZ_AGGREGATES` is off, which leaves the plain array
 * on the wire exactly as it shipped through 3.11.0.
 *
 * @param {!Object} aggregates
 * @return {!Object} The same object, for call-site brevity.
 * @private
 */
function encodeUtilizationAggregatesForWire_(aggregates) {
  if (!aggregates || !perfFlag_('PERF_SLIM_VIZ_AGGREGATES')) {
    return aggregates;
  }
  aggregates.byPersonWeek = encodeUtilizationPersonWeekForWire_(
    aggregates.byPersonWeek
  );
  aggregates.byPersonWeekCodec = utilizationPersonWeekCodec_();
  return aggregates;
}

/* ------------------------------------------------------------------------- */
/* KPIs (Section U.1-U.6)                                                           */
/* ------------------------------------------------------------------------- */

/**
 * Computes the Section U.1-U.6 KPI bundle plus distinct-dimension counts. Numbers
 * stay full-precision; the client formats for display.
 *
 * @param {!Array<!Object>} rows
 * @return {!Object}
 * @private
 */
function computeUtilizationKpis_(rows) {
  var totalHours = 0;
  var billableHours = 0;
  var totalCost = 0;
  var billRateNumerator = 0;
  var billRateDenominator = 0;
  var personSet = {};
  var projectSet = {};
  var customerSet = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    totalHours += r.hours;
    totalCost += r.cost;
    if (r.billable) {
      billableHours += r.hours;
    }
    if (r.userRoleBillRate !== null) {
      billRateNumerator += r.hours * r.userRoleBillRate;
      billRateDenominator += r.hours;
    }
    if (r.userId) {
      personSet[r.userId] = true;
    } else if (r.userName) {
      personSet[r.userName] = true;
    }
    if (r.projectId) {
      projectSet[r.projectId] = true;
    } else if (r.projectName) {
      projectSet[r.projectName] = true;
    }
    if (r.customer) {
      customerSet[r.customer] = true;
    }
  }
  var utilizationPct = totalHours > 0 ? (billableHours / totalHours) * 100 : 0;
  var effectiveCostRate = totalHours > 0 ? totalCost / totalHours : 0;
  var effectiveBillRate = billRateDenominator > 0 ? billRateNumerator / billRateDenominator : null;
  var billRateCoverage = totalHours > 0 ? billRateDenominator / totalHours : 0;
  return {
    totalHours: totalHours,
    billableHours: billableHours,
    nonBillableHours: Math.max(0, totalHours - billableHours),
    utilizationPct: utilizationPct,
    totalCost: totalCost,
    effectiveCostRate: effectiveCostRate,
    effectiveBillRate: effectiveBillRate,
    effectiveBillRateCoverage: billRateCoverage,
    distinctPersons: Object.keys(personSet).length,
    distinctProjects: Object.keys(projectSet).length,
    distinctCustomers: Object.keys(customerSet).length,
    rowCount: rows.length,
  };
}

/* ------------------------------------------------------------------------- */
/* Dimensions + Aggregates                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Builds the Section "dimensions" view-model - sorted lists of unique values per
 * facet, each carrying enough metadata for the client filter dropdowns and
 * chart palettes. Customer + Person + Role are sorted by hours desc so the
 * top entries surface first.
 *
 * @param {!Array<!Object>} rows
 * @param {!Object} thresholds
 * @return {!Object}
 * @private
 */
function buildUtilizationDimensions_(rows, thresholds) {
  var customerMap = {};
  var projectMap = {};
  var personMap = {};
  var roleMap = {};

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];

    var cKey = r.customer || '(Unassigned)';
    if (!customerMap[cKey]) {
      customerMap[cKey] = { name: cKey, hours: 0, billableHours: 0 };
    }
    customerMap[cKey].hours += r.hours;
    if (r.billable) {
      customerMap[cKey].billableHours += r.hours;
    }

    var pKey = r.projectId || ('name::' + r.projectName);
    if (!projectMap[pKey]) {
      projectMap[pKey] = {
        name: r.projectName,
        id: r.projectId || null,
        customer: r.customer,
        hours: 0,
        billableHours: 0,
      };
    }
    projectMap[pKey].hours += r.hours;
    if (r.billable) {
      projectMap[pKey].billableHours += r.hours;
    }

    var personKey = r.userId || r.userName || '(Unknown user)';
    if (!personMap[personKey]) {
      personMap[personKey] = {
        name: r.userName,
        id: r.userId || null,
        hours: 0,
        billableHours: 0,
        clockifyUserWorkStatus: stringOrNull_(r.clockifyUserWorkStatus),
      };
    } else if (!personMap[personKey].clockifyUserWorkStatus && r.clockifyUserWorkStatus) {
      personMap[personKey].clockifyUserWorkStatus = stringOrNull_(r.clockifyUserWorkStatus);
    }
    personMap[personKey].hours += r.hours;
    if (r.billable) {
      personMap[personKey].billableHours += r.hours;
    }

    var roleName = r.userRole || r.clockifyUserRole || '(No role)';
    if (!roleMap[roleName]) {
      roleMap[roleName] = { name: roleName, hours: 0, billableHours: 0 };
    }
    roleMap[roleName].hours += r.hours;
    if (r.billable) {
      roleMap[roleName].billableHours += r.hours;
    }
  }

  var customers = sortByHoursDesc_(mapToArray_(customerMap));
  var projects = sortByHoursDesc_(mapToArray_(projectMap));
  var persons = sortByHoursDesc_(mapToArray_(personMap));
  var roles = sortByHoursDesc_(mapToArray_(roleMap));

  // Stable customer colors: cycle the Section 8.5 palette by sorted-hours order.
  var customerNames = [];
  for (var ci = 0; ci < customers.length; ci++) {
    customerNames.push(customers[ci].name);
  }
  var customerColorMap = buildCustomerColorMap_(customerNames, thresholds.customerPalette);
  for (var c = 0; c < customers.length; c++) {
    customers[c].color = customerColorMap[customers[c].name] || thresholds.customerPalette[c % thresholds.customerPalette.length];
  }

  // Project rows inherit their customer's color so the Section N.5 bar reads as a
  // grouped view of customer slices.
  for (var pj = 0; pj < projects.length; pj++) {
    var custColor = customerColorMap[projects[pj].customer || ''];
    projects[pj].color = custColor || thresholds.customerPalette[pj % thresholds.customerPalette.length];
  }

  // Person utilization% in the dimension list helps Phase B persons-bar render
  // without re-aggregating client-side.
  for (var pn = 0; pn < persons.length; pn++) {
    var p = persons[pn];
    p.utilizationPct = p.hours > 0 ? (p.billableHours / p.hours) * 100 : 0;
    p.color = thresholds.rolePalette[pn % thresholds.rolePalette.length];
  }

  // Role colors: deterministic palette cycling.
  var roleNames = [];
  for (var rn = 0; rn < roles.length; rn++) {
    roleNames.push(roles[rn].name);
  }
  var roleColorMap = buildRoleColorMap_(roleNames, thresholds.rolePalette);
  for (var r2 = 0; r2 < roles.length; r2++) {
    roles[r2].color = roleColorMap[roles[r2].name] || thresholds.rolePalette[r2 % thresholds.rolePalette.length];
  }

  return {
    customers: customers,
    projects: projects,
    persons: persons,
    roles: roles,
  };
}

/**
 * Builds the Section "aggregates" view-model - server-precomputed slices for the
 * Phase A charts so the first paint doesn't depend on client aggregation.
 * Top-N caps apply to byCustomer / byProject / byPerson; byWeek + byRole are
 * uncapped (the chart axes handle natural counts).
 *
 * @param {!Array<!Object>} rows
 * @param {!Object} thresholds
 * @return {!Object}
 * @private
 */
function buildUtilizationAggregates_(rows, thresholds) {
  var byCustomerMap = {};
  var byProjectMap = {};
  var byPersonMap = {};
  var byRoleMap = {};
  var byWeekMap = {};

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];

    if (!byCustomerMap[r.customer]) {
      byCustomerMap[r.customer] = { name: r.customer, hours: 0, billableHours: 0, cost: 0 };
    }
    byCustomerMap[r.customer].hours += r.hours;
    byCustomerMap[r.customer].cost += r.cost;
    if (r.billable) {
      byCustomerMap[r.customer].billableHours += r.hours;
    }

    var pKey = r.projectId || ('name::' + r.projectName);
    if (!byProjectMap[pKey]) {
      byProjectMap[pKey] = {
        name: r.projectName,
        id: r.projectId || null,
        customer: r.customer,
        hours: 0,
        billableHours: 0,
        cost: 0,
      };
    }
    byProjectMap[pKey].hours += r.hours;
    byProjectMap[pKey].cost += r.cost;
    if (r.billable) {
      byProjectMap[pKey].billableHours += r.hours;
    }

    var personKey = r.userId || r.userName || '(Unknown user)';
    if (!byPersonMap[personKey]) {
      byPersonMap[personKey] = {
        name: r.userName,
        id: r.userId || null,
        hours: 0,
        billableHours: 0,
        cost: 0,
      };
    }
    byPersonMap[personKey].hours += r.hours;
    byPersonMap[personKey].cost += r.cost;
    if (r.billable) {
      byPersonMap[personKey].billableHours += r.hours;
    }

    var roleName = r.userRole || r.clockifyUserRole || '(No role)';
    if (!byRoleMap[roleName]) {
      byRoleMap[roleName] = { name: roleName, hours: 0, billableHours: 0 };
    }
    byRoleMap[roleName].hours += r.hours;
    if (r.billable) {
      byRoleMap[roleName].billableHours += r.hours;
    }

    if (r.week) {
      if (!byWeekMap[r.week]) {
        byWeekMap[r.week] = { week: r.week, hours: 0, billableHours: 0, nonBillableHours: 0 };
      }
      byWeekMap[r.week].hours += r.hours;
      if (r.billable) {
        byWeekMap[r.week].billableHours += r.hours;
      } else {
        byWeekMap[r.week].nonBillableHours += r.hours;
      }
    }
  }

  var byCustomer = sortByHoursDesc_(mapToArray_(byCustomerMap)).slice(0, thresholds.topNCustomers);
  var byProject = sortByHoursDesc_(mapToArray_(byProjectMap)).slice(0, thresholds.topNProjects);
  var byPerson = sortByHoursDesc_(mapToArray_(byPersonMap)).slice(0, thresholds.topNPersons);
  for (var pi = 0; pi < byPerson.length; pi++) {
    var bp = byPerson[pi];
    bp.utilizationPct = bp.hours > 0 ? (bp.billableHours / bp.hours) * 100 : 0;
  }
  var byRole = sortByHoursDesc_(mapToArray_(byRoleMap));
  var byWeek = mapToArray_(byWeekMap).sort(function (a, b) {
    return String(a.week).localeCompare(String(b.week));
  });
  var billableVsNonBillable = byWeek.map(function (w) {
    return {
      week: w.week,
      billable: w.billableHours,
      nonBillable: w.nonBillableHours,
    };
  });

  return {
    byCustomer: byCustomer,
    byProject: byProject,
    byPerson: byPerson,
    byRole: byRole,
    byWeek: byWeek,
    billableVsNonBillable: billableVsNonBillable,
  };
}

/**
 * Phase C - per-person  x  per-week aggregate that feeds the heatmap surface
 * and the under/over-utilized alert rules. Each entry carries the raw hours
 * (filterable downstream), the capacity-scaled utilization% for that week,
 * and a `partial` flag for weeks that overlap a range edge.
 *
 * Partial-week capacity is pro-rated by `(daysInRangeInWeek / 7)` so the
 * utilization% bucket stays honest (a 3-day week at 24 hrs reads as 100%,
 * not 60%). The alert rules ignore partial weeks entirely.
 *
 * Roles are recorded as a comma-joined string of distinct role names that
 * the person logged time under in that week - the client uses this to drive
 * the heatmap-local Role filter without re-aggregating from `rows`.
 *
 * @param {!Array<!Object>} rows
 * @param {!{start: string, end: string}} range
 * @param {!Object} thresholds
 * @return {!Array<!{
 *   personKey: string, personName: string, personId: ?string,
 *   week: string, weekStartIso: string, weekEndIso: string,
 *   hours: number, billableHours: number,
 *   capacityHours: number, utilizationPct: number,
 *   partial: boolean, partialFraction: number,
 *   isInternal: boolean,
 *   roles: !Array<string>,
 *   customers: !Array<string>
 * }>}
 * @private
 */
function buildByPersonWeek_(rows, range, thresholds) {
  var rangeStartMs = parseIsoMs_(range.start);
  var rangeEndMs = parseIsoMs_(range.end);
  var bucketMap = {};

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r.week) {
      continue;
    }
    var personKey = r.userId || r.userName || '(Unknown user)';
    var bucketKey = personKey + '|' + r.week;
    var b = bucketMap[bucketKey];
    if (!b) {
      var weekRange = isoWeekRange_(r.week);
      b = {
        personKey: personKey,
        personName: r.userName || personKey,
        personId: r.userId || null,
        week: r.week,
        weekStartIso: weekRange.startIso,
        weekEndIso: weekRange.endIso,
        hours: 0,
        billableHours: 0,
        capacityHours: thresholds.weeklyCapacityHours,
        utilizationPct: 0,
        partial: false,
        partialFraction: 1,
        // Flagged true if ANY contributing row was internal; the client
        // honors the global Internal-labor toggle by inspecting per-row
        // payloads, but we surface a hint here for tooltip use.
        isInternal: false,
        roleSet: {},
        customerSet: {},
      };
      if (rangeStartMs !== null && rangeEndMs !== null) {
        var ws = parseIsoMs_(weekRange.startIso);
        var we = parseIsoMs_(weekRange.endIso);
        if (ws !== null && we !== null) {
          var overlapStart = Math.max(ws, rangeStartMs);
          var overlapEnd = Math.min(we, rangeEndMs);
          var overlapMs = Math.max(0, overlapEnd - overlapStart);
          var weekMs = Math.max(1, we - ws);
          var fraction = overlapMs / weekMs;
          if (fraction < 0.999) {
            b.partial = true;
            b.partialFraction = fraction;
            b.capacityHours = thresholds.weeklyCapacityHours * fraction;
          }
        }
      }
      bucketMap[bucketKey] = b;
    }
    b.hours += Number(r.hours || 0);
    if (r.billable) {
      b.billableHours += Number(r.hours || 0);
    }
    if (r.isInternal) {
      b.isInternal = true;
    }
    var role = r.userRole || r.clockifyUserRole || '(No role)';
    if (role) {
      b.roleSet[role] = true;
    }
    if (r.customer) {
      b.customerSet[r.customer] = true;
    }
  }

  var out = [];
  for (var k in bucketMap) {
    if (!Object.prototype.hasOwnProperty.call(bucketMap, k)) {
      continue;
    }
    var e = bucketMap[k];
    e.utilizationPct = e.capacityHours > 0 ? (e.hours / e.capacityHours) * 100 : 0;
    e.roles = Object.keys(e.roleSet);
    e.customers = Object.keys(e.customerSet);
    delete e.roleSet;
    delete e.customerSet;
    out.push(e);
  }
  out.sort(function (a, b2) {
    if (a.personKey !== b2.personKey) {
      return String(a.personKey).localeCompare(String(b2.personKey));
    }
    return String(a.week).localeCompare(String(b2.week));
  });
  return out;
}

/** @private */
function parseIsoMs_(iso) {
  if (!iso) {
    return null;
  }
  try {
    var d = new Date(iso);
    var t = d.getTime();
    return isFinite(t) ? t : null;
  } catch (e) {
    return null;
  }
}

/**
 * Returns the inclusive Monday-anchored ISO range for an ISO week key
 * (e.g. '2026-W19'  ->  start 2026-05-04T00:00:00Z, end 2026-05-11T00:00:00Z).
 *
 * @param {string} weekKey
 * @return {!{startIso: string, endIso: string}}
 * @private
 */
function isoWeekRange_(weekKey) {
  var m = /^(\d{4})-W(\d{2})$/.exec(String(weekKey));
  if (!m) {
    return { startIso: '', endIso: '' };
  }
  var year = parseInt(m[1], 10);
  var week = parseInt(m[2], 10);
  // ISO 8601: week 1 contains Jan 4. Find that, snap to the Monday.
  var jan4 = new Date(Date.UTC(year, 0, 4));
  var jan4Day = jan4.getUTCDay() || 7;
  var week1Monday = new Date(Date.UTC(year, 0, 4 - jan4Day + 1));
  var weekStart = new Date(week1Monday.getTime() + (week - 1) * 7 * 86400000);
  var weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
  return { startIso: weekStart.toISOString(), endIso: weekEnd.toISOString() };
}

/* ------------------------------------------------------------------------- */
/* Date range resolution + helpers                                            */
/* ------------------------------------------------------------------------- */

/**
 * Resolves the request range against the configured default + max windows.
 * Both endpoints are emitted as full ISO datetimes so the Fibery `<` /  `>=`
 * predicates are unambiguous.
 *
 * @param {?string|undefined} rangeStart
 * @param {?string|undefined} rangeEnd
 * @param {!Date} now
 * @param {!Object} thresholds
 * @return {!{start: string, end: string, defaulted: boolean, clamped: boolean}}
 * @private
 */
function resolveRange_(rangeStart, rangeEnd, now, thresholds) {
  var defaulted = false;
  var clamped = false;
  var endDate = parseDateOrNull_(rangeEnd);
  if (!endDate) {
    endDate = now;
    if (!rangeStart) {
      defaulted = true;
    }
  }
  var startDate = parseDateOrNull_(rangeStart);
  if (!startDate) {
    startDate = new Date(endDate.getTime() - thresholds.defaultRangeDays * 86400000);
    if (!rangeEnd) {
      defaulted = true;
    }
  }
  if (startDate.getTime() > endDate.getTime()) {
    // Caller passed start > end - swap and flag as clamped so the client can
    // surface a non-fatal warning.
    var tmp = startDate;
    startDate = endDate;
    endDate = tmp;
    clamped = true;
  }
  var maxMs = thresholds.maxRangeDays * 86400000;
  if (endDate.getTime() - startDate.getTime() > maxMs) {
    startDate = new Date(endDate.getTime() - maxMs);
    clamped = true;
  }
  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    defaulted: defaulted,
    clamped: clamped,
  };
}

/** @private */
function parseDateOrNull_(iso) {
  if (!iso) {
    return null;
  }
  try {
    var d = new Date(iso);
    if (!isFinite(d.getTime())) {
      return null;
    }
    return d;
  } catch (e) {
    return null;
  }
}

/** @private */
function extractDayKey_(iso) {
  if (!iso) {
    return null;
  }
  var d = parseDateOrNull_(iso);
  if (!d) {
    return null;
  }
  var y = d.getUTCFullYear();
  var m = d.getUTCMonth() + 1;
  var dd = d.getUTCDate();
  return y + '-' + (m < 10 ? '0' + m : m) + '-' + (dd < 10 ? '0' + dd : dd);
}

/**
 * ISO-8601 Monday-anchored week key (e.g. `2026-W19`). Always computed in UTC
 * so the bucket is stable across server runs in different timezones.
 *
 * @param {?string} iso
 * @return {?string}
 * @private
 */
function extractIsoWeekKey_(iso) {
  if (!iso) {
    return null;
  }
  var d = parseDateOrNull_(iso);
  if (!d) {
    return null;
  }
  // Copy in UTC, snap to nearest Thursday (ISO week is the year containing
  // the Thursday of that week).
  var t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  var dayNum = t.getUTCDay() || 7; // Sun = 7
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  var yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  var weekNo = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return t.getUTCFullYear() + '-W' + (weekNo < 10 ? '0' + weekNo : weekNo);
}

/** @private */
function isBillableText_(v) {
  if (v === true) {
    return true;
  }
  if (v === false) {
    return false;
  }
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'yes' || s === 'y' || s === 'true' || s === '1';
}

/** @private */
function mapToArray_(o) {
  var out = [];
  for (var k in o) {
    if (Object.prototype.hasOwnProperty.call(o, k)) {
      out.push(o[k]);
    }
  }
  return out;
}

/** @private */
function sortByHoursDesc_(arr) {
  arr.sort(function (a, b) {
    return Number(b.hours || 0) - Number(a.hours || 0);
  });
  return arr;
}

/* ------------------------------------------------------------------------- */
/* Empty-state factories                                                      */
/* ------------------------------------------------------------------------- */

/** @private */
function emptyUtilizationKpis_() {
  return {
    totalHours: 0,
    billableHours: 0,
    nonBillableHours: 0,
    utilizationPct: 0,
    totalCost: 0,
    effectiveCostRate: 0,
    effectiveBillRate: null,
    effectiveBillRateCoverage: 0,
    distinctPersons: 0,
    distinctProjects: 0,
    distinctCustomers: 0,
    rowCount: 0,
  };
}

/** @private */
function emptyUtilizationDimensions_() {
  return { customers: [], projects: [], persons: [], roles: [] };
}

/** @private */
function emptyUtilizationAggregates_() {
  return {
    byCustomer: [],
    byProject: [],
    byPerson: [],
    byRole: [],
    byWeek: [],
    billableVsNonBillable: [],
    byPersonWeek: [],
  };
}

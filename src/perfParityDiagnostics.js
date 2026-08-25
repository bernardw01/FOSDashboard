/**
 * PRD version 3.15.0 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 047 Step 0: parity and measurement harness.
 *
 * The performance program moves aggregation out of Apps Script and into
 * Postgres. That is only safe if the numbers do not move, so every workstream
 * is gated on a parity run from this file before it ships.
 *
 * Run these from the Apps Script editor (they are ADMIN diagnostics, not
 * client-callable). Every batch entry point also writes its JSON to the
 * `fos_perf_runs` table, so results can be read with SQL instead of scraped out
 * of the execution log:
 *
 *   _diag_verifyWorkstreamA()
 *     The one to run for workstream A. Parity across all fixtures plus a
 *     Utilization baseline, in a single execution.
 *
 *   _diag_verifyWorkstreamB2()
 *     The one to run for workstream B2. Parity across all fixtures for
 *     Resource assignments, plus proof that one arm really used the Postgres
 *     RPC and the other really used the row scan.
 *
 *   _diag_verifyWorkstreamB4()
 *     The one to run for workstream B4 (range-keyed Utilization row cache).
 *
 *   _diag_verifyWorkstreamB5()
 *     The one to run for workstream B5 (Reload re-reads the stored Agreement /
 *     Delivery blob instead of rebuilding it in the request).
 *
 *   _diag_verifyCodec_UtilizationRows()
 *     Workstream B1 row codec: every field of every decoded labor row against
 *     the same row before encoding.
 *
 *   _diag_verifyCodec_HeatmapWeeks()
 *     Workstream B3 heatmap codec: every field of every aggregates.byPersonWeek
 *     entry. Renamed from _diag_verifyUtilVizCodec, which sat one line away from
 *     the row codec in the editor's function dropdown and was picked by mistake.
 *
 *   _diag_verifyCodec_RaPersonVariances()
 *     Workstream B6 Resource Assignments personVariances codec: every field of
 *     every person/project/week cell including nested byDay. byDay.varianceHours
 *     is compared after normalizing the reference to actualHours - assignedHours,
 *     matching the decode contract (that field is dropped on the wire).
 *
 *   _diag_measurePanelLoad('utilization', '2026-05-26', '2026-08-24')
 *     One panel: elapsed ms, PostgREST calls, bytes received, payload size.
 *
 *   _diag_capturePerfBaseline(['utilization'])
 *     Baseline for the given panels, or all of them when omitted.
 *
 *   _diag_comparePerfParity('utilization', '2026-05-26', '2026-08-24')
 *     Runs the panel with the workstream flag off and on, then deep-compares
 *     every numeric leaf. Fails loudly on any diff outside tolerance.
 *
 *   _diag_comparePerfParityAllFixtures('utilization')
 *     The above across all four fixture ranges.
 *
 * Tolerances are deliberately tight: currency and hours to 0.01, percentages
 * to 0.1, and counts must match exactly.
 *
 * Batch entry points stop at PERF_HARNESS_BUDGET_MS_ and report
 * `complete: false` rather than being killed at the 6-minute limit with
 * nothing saved.
 */

/** @const {string} */
var PERF_RUNS_TABLE_ = 'fos_perf_runs';

/**
 * Wall-clock budget for a harness entry point, in ms.
 *
 * Apps Script kills an execution at 6 minutes with no return value, which would
 * lose the whole run including the measurements already taken. A full baseline
 * is 17 panel loads and Portfolio P&L alone can take minutes, so the harness
 * stops at 4.5 minutes, records what it finished, and reports `complete: false`
 * plus the panels it skipped. Re-run with an explicit panel list to finish.
 * @const {number}
 */
var PERF_HARNESS_BUDGET_MS_ = 4.5 * 60 * 1000;

/** @const {number} */
var PERF_PARITY_TOLERANCE_DEFAULT_ = 0.01;

/** @const {number} */
var PERF_PARITY_TOLERANCE_PERCENT_ = 0.1;

/**
 * Allowed drift between two ISO-8601 timestamp leaves, in ms.
 *
 * Only applied to fixtures with no explicit range. Those windows are derived
 * from `new Date()` inside the builder, so the baseline and candidate runs,
 * seconds apart, legitimately report different bounds. Tolerated leaves are
 * reported in `tolerated` rather than dropped, so clock drift can never hide a
 * date bug. Fixtures that pass an explicit range still require exact equality.
 * @const {number}
 */
var PERF_PARITY_CLOCK_TOLERANCE_MS_ = 5 * 60 * 1000;

/**
 * Parses a leaf as an ISO-8601 instant, or returns NaN when it is not one.
 *
 * Deliberately strict: `Date.parse` accepts plenty of non-ISO input, and a
 * loose match here would let real string mismatches through as "clock drift".
 *
 * @param {*} value
 * @return {number} Epoch ms, or NaN.
 * @private
 */
function perfParityIsoMs_(value) {
  if (typeof value !== 'string') {
    return NaN;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    return NaN;
  }
  return Date.parse(value);
}

/**
 * Leaf key patterns that are expected to differ between two runs of the same
 * builder (timestamps, run ids, and the flag-dependent source label).
 * @const {!Array<!RegExp>}
 */
var PERF_PARITY_IGNORE_KEYS_ = [
  /^fetchedAt$/,
  /^asOf$/,
  /^syncedAt$/,
  /^builtAt$/,
  /^generatedAt$/,
  /^loadSource$/,
  /^source$/,
  /Ms$/,
  /^elapsed/,
];

/**
 * Fixture ranges. Chosen to cover a quarter boundary, a partial week, and an
 * empty window, because those are where rollup math breaks first.
 * @const {!Array<!{id: string, start: string, end: string, note: string}>}
 */
var PERF_PARITY_FIXTURES_ = [
  {
    id: 'default-window',
    start: '',
    end: '',
    note:
      'Rolling default window (UTILIZATION_DEFAULT_RANGE_DAYS, currently 60 ' +
      'days), the most common load. Derived from the clock, so the two runs ' +
      'see slightly different bounds; see PERF_PARITY_CLOCK_TOLERANCE_MS_.',
  },
  {
    id: 'q2-2026',
    start: '2026-04-01',
    end: '2026-07-01',
    note: 'Quarter boundary and month rollups.',
  },
  {
    id: 'single-week',
    start: '2026-08-17',
    end: '2026-08-24',
    note: 'Partial-week edges.',
  },
  {
    id: 'empty',
    start: '2020-01-01',
    end: '2020-01-08',
    note: 'Zero-row rendering.',
  },
];

/**
 * Panels the harness knows how to invoke, and the workstream flag that governs
 * each one's fast path.
 * @const {!Object<string, !{rangeAware: boolean, flag: ?string}>}
 */
var PERF_PARITY_PANELS_ = {
  utilization: { rangeAware: true, flag: 'PERF_USE_NORMALIZED_LABOR_COLS' },
  'resource-assignments': { rangeAware: true, flag: 'PERF_USE_RA_RPC' },
  agreement: { rangeAware: false, flag: null },
  delivery: { rangeAware: false, flag: null },
  pipeline: { rangeAware: false, flag: null },
  'ai-usage': { rangeAware: true, flag: null },
  'portfolio-pnl': { rangeAware: false, flag: null },
  'services-summary': { rangeAware: false, flag: null },
};

/**
 * Persists a harness run to `fos_perf_runs` so the numbers can be read outside
 * Apps Script.
 *
 * The console log alone is not enough: comparing workstream B against the
 * workstream A baseline means retrieving both, and the execution log is
 * transient and awkward to extract. Writing the JSON to Postgres makes every
 * run queryable later.
 *
 * Never throws. A diagnostic that fails because its own bookkeeping failed
 * would be worse than one that only logs.
 *
 * @param {string} kind 'baseline' or 'parity'.
 * @param {string} label Human-readable run label.
 * @param {?boolean} passed Parity outcome, or null for a baseline.
 * @param {!Object} result Full run document.
 * @return {?string} The run id, or null when the write failed.
 * @private
 */
function perfPersistRun_(kind, label, passed, result) {
  try {
    if (!isSupabaseConfigured_()) {
      console.warn('Perf harness: Supabase not configured, results logged only.');
      return null;
    }
    var runId =
      'perf:' + kind + ':' + new Date().toISOString() + ':' + Utilities.getUuid().slice(0, 8);
    var row = {
      run_id: runId,
      kind: kind,
      captured_at: new Date().toISOString(),
      prd_version: typeof FOS_PRD_VERSION === 'string' ? FOS_PRD_VERSION : null,
      label: label,
      passed: passed,
      flags: perfFlagsSnapshot_(),
      result: result,
    };
    var res = supabaseUpsert_(PERF_RUNS_TABLE_, [row], 'run_id');
    if (!res || res.ok === false) {
      console.warn(
        'Perf harness: could not persist run: ' + ((res && res.message) || 'unknown error')
      );
      return null;
    }
    console.log('Perf harness: stored run ' + runId + ' in ' + PERF_RUNS_TABLE_ + '.');
    return runId;
  } catch (e) {
    console.warn('Perf harness: persist failed: ' + ((e && e.message) || e));
    return null;
  }
}

/**
 * Invokes a panel's server entry point.
 *
 * @param {string} panelKey
 * @param {string} startIso
 * @param {string} endIso
 * @return {!Object}
 * @private
 */
function perfInvokePanel_(panelKey, startIso, endIso) {
  var start = startIso || undefined;
  var end = endIso || undefined;
  switch (panelKey) {
    case 'utilization':
      return getUtilizationDashboardData(start, end);
    case 'resource-assignments':
      return getResourceAssignmentDashboardData(start, end);
    case 'agreement':
      return getAgreementDashboardData(false);
    case 'delivery':
      return getDeliveryDashboardData(false);
    case 'pipeline':
      return getPipelineDashboardData();
    case 'ai-usage':
      return getAiUsageDashboardData(start, end, false);
    case 'portfolio-pnl':
      return getPortfolioPnLDashboardData(false);
    case 'services-summary':
      return getServicesSummaryDashboardData(false);
    default:
      throw new Error('Unknown panel key for perf harness: ' + panelKey);
  }
}

/**
 * Approximate row count of a payload, for tracking how much data crosses the
 * google.script.run boundary.
 *
 * @param {!Object} payload
 * @return {number}
 * @private
 */
function perfPayloadRowCount_(payload) {
  if (!payload || typeof payload !== 'object') {
    return 0;
  }
  var candidates = ['rows', 'projects', 'deals', 'agreements', 'persons'];
  for (var i = 0; i < candidates.length; i++) {
    var v = payload[candidates[i]];
    if (v && v.length) {
      return v.length;
    }
  }
  return 0;
}

/**
 * Measures one panel load: wall time, PostgREST calls, bytes received, and the
 * size of the payload that would be serialized to the browser.
 *
 * @param {string} panelKey
 * @param {string=} startIso
 * @param {string=} endIso
 * @return {!Object}
 */
function _diag_measurePanelLoad(panelKey, startIso, endIso) {
  supabasePerfCounterStart_();
  var startedAt = Date.now();
  var payload = null;
  var error = null;
  try {
    payload = perfInvokePanel_(panelKey, startIso || '', endIso || '');
  } catch (e) {
    error = String((e && e.message) || e);
  }
  var elapsedMs = Date.now() - startedAt;
  var counter = supabasePerfCounterStop_();

  var payloadBytes = 0;
  try {
    payloadBytes = payload ? JSON.stringify(payload).length : 0;
  } catch (e) {
    payloadBytes = -1;
  }

  var result = {
    panel: panelKey,
    rangeStart: startIso || '(default)',
    rangeEnd: endIso || '(default)',
    ok: !!(payload && payload.ok !== false),
    error: error,
    elapsedMs: elapsedMs,
    httpCalls: counter.calls,
    httpMs: counter.ms,
    bytesReceived: counter.bytes,
    payloadBytes: payloadBytes,
    rowCount: perfPayloadRowCount_(payload),
    callsByPath: counter.byPath,
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Runs _diag_measurePanelLoad across every panel and fixture and logs one JSON
 * document. Store the output in docs/features/047-baseline-measurements.json
 * before starting Workstream A; every later claim is compared against it.
 *
 * @return {!Object}
 */
function _diag_capturePerfBaseline(panelKeys) {
  var deadline = Date.now() + PERF_HARNESS_BUDGET_MS_;
  var wanted = panelKeys && panelKeys.length ? panelKeys : null;
  var out = {
    capturedAt: new Date().toISOString(),
    prdVersion: typeof FOS_PRD_VERSION === 'string' ? FOS_PRD_VERSION : 'unknown',
    flags: perfFlagsSnapshot_(),
    scope: wanted ? wanted.join(',') : 'all panels',
    complete: true,
    skipped: [],
    measurements: [],
  };
  for (var panelKey in PERF_PARITY_PANELS_) {
    if (!Object.prototype.hasOwnProperty.call(PERF_PARITY_PANELS_, panelKey)) continue;
    if (wanted && wanted.indexOf(panelKey) === -1) continue;
    var meta = PERF_PARITY_PANELS_[panelKey];
    var fixtures = meta.rangeAware ? PERF_PARITY_FIXTURES_ : [PERF_PARITY_FIXTURES_[0]];
    for (var i = 0; i < fixtures.length; i++) {
      var fx = fixtures[i];
      if (Date.now() > deadline) {
        out.complete = false;
        out.skipped.push(panelKey + '/' + fx.id);
        continue;
      }
      var m = _diag_measurePanelLoad(panelKey, fx.start, fx.end);
      m.fixture = fx.id;
      out.measurements.push(m);
    }
  }
  console.log('===== FEATURE 047 BASELINE =====');
  console.log(JSON.stringify(out, null, 2));
  if (!out.complete) {
    console.warn(
      'Baseline hit the time budget after ' +
        out.measurements.length +
        ' measurement(s). Skipped: ' +
        out.skipped.join(', ') +
        '. Re-run as _diag_capturePerfBaseline(["panel-key"]) to finish.'
    );
  }
  out.runId = perfPersistRun_(
    'baseline',
    out.scope + (out.complete ? '' : ' (partial)'),
    null,
    out
  );
  return out;
}

/**
 * One-call verification for workstream A. Run this from the editor; everything
 * lands in `fos_perf_runs` and needs no copying out of the execution log.
 *
 * Scoped deliberately to Utilization, the only panel workstream A changed on a
 * range-aware path, so it fits inside one execution. Delivery P&L shares the
 * same select change but is driven per agreement rather than per range, and is
 * covered by the same flag.
 *
 * @return {!Object}
 */
/**
 * Proves the utilization row codec is lossless on live data.
 *
 * The parity harness cannot catch a lossy codec: both of its arms encode, so it
 * compares encoded against encoded and a dropped field would cancel out. This
 * encodes and decodes real rows, then compares field by field against the same
 * rows before encoding.
 *
 * Verified on v3.10.0 over the default window: 6,042 rows, zero diffs, rows
 * array 4,351,066 -> 843,367 bytes (80.6 percent).
 *
 * @return {!Object}
 */
function _diag_verifyCodec_UtilizationRows() {
  var thresholds = getUtilizationThresholds_();
  var now = new Date();
  var range = resolveRange_(null, null, now, thresholds);

  // One fetch, one mapping pass. The first version built the whole payload and
  // then re-fetched to get a reference shape, which is two complete passes over
  // ~6,000 rows plus KPI, aggregate, and alert work this check never looks at.
  // Folding it to a single pass is a simplification, not a fix for anything.
  //
  // The cost is that this no longer observes the builder itself, so it cannot
  // confirm the builder wires the codec in. That is verified structurally
  // instead, by checking the stored panel blob carries `rowsCodec`.
  var fetched = fetchFosLaborCostsByRange_(range.start, range.end);
  if (!fetched.ok) {
    return { ok: false, message: fetched.message || 'Fetch failed.' };
  }
  var dimMaps = loadUtilizationLaborDimMaps_();
  var raw = [];
  for (var i = 0; i < (fetched.rows || []).length; i++) {
    raw.push(
      mapFosLaborCostRowToUtilRaw_(
        fetched.rows[i],
        dimMaps.usersByClockifyId,
        dimMaps.agreementsByProjectId,
        dimMaps.companiesMap,
        dimMaps.rolesMap
      )
    );
  }
  var reference = normalizeLaborRows_(raw, thresholds);
  var referenceBytes = JSON.stringify(reference).length;

  var wire = encodeUtilizationRowsForWire_(reference);
  var encodedBytes = JSON.stringify(wire).length;
  var decoded =
    (decodeUtilizationRowsFromWire_({ rows: wire, rowsCodec: utilizationRowsCodec_() }) || {})
      .rows || [];

  var diffs = [];
  if (reference.length !== decoded.length) {
    diffs.push({
      path: '$.rows.length',
      expected: reference.length,
      actual: decoded.length,
    });
  }
  var limit = Math.min(reference.length, decoded.length);
  for (var r = 0; r < limit && diffs.length < 25; r++) {
    var exp = reference[r] || {};
    var act = decoded[r] || {};
    for (var f = 0; f < UTIL_ROW_WIRE_FIELDS_.length; f++) {
      var key = UTIL_ROW_WIRE_FIELDS_[f];
      var ev = exp[key] === undefined ? null : exp[key];
      var av = act[key] === undefined ? null : act[key];
      if (ev !== av) {
        diffs.push({ path: '$.rows[' + r + '].' + key, expected: ev, actual: av });
        if (diffs.length >= 25) break;
      }
    }
  }

  var result = {
    ok: true,
    pass: diffs.length === 0,
    rowCount: decoded.length,
    diffCount: diffs.length,
    diffs: diffs,
    encodedBytes: encodedBytes,
    unencodedBytes: referenceBytes,
    reductionPct:
      referenceBytes > 0
        ? Math.round((1 - encodedBytes / referenceBytes) * 1000) / 10
        : null,
  };
  console.log('===== UTIL ROW CODEC =====');
  console.log(JSON.stringify(result, null, 2));
  perfPersistRun_('codec', 'utilization rows', result.pass, result);
  return result;
}

/**
 * Proves the utilization visualization codec (feature 047 workstream B3) is
 * lossless on live data.
 *
 * Same reasoning as `_diag_verifyCodec_UtilizationRows`: the parity harness compares two
 * arms that both encode, so a dropped field cancels out and reports a pass.
 * This builds `byPersonWeek` once, encodes it, decodes it, and compares every
 * field of every entry against the pre-encoding reference, including the
 * `roles` and `customers` string arrays element by element.
 *
 * A good result is `pass: true` with `diffCount: 0` over roughly 600 entries,
 * and `reductionPct` near 82. Flip `PERF_SLIM_VIZ_AGGREGATES` on in ADMIN
 * Settings only after that.
 *
 * @return {!Object}
 */
function _diag_verifyCodec_HeatmapWeeks() {
  var thresholds = getUtilizationThresholds_();
  var now = new Date();
  var range = resolveRange_(null, null, now, thresholds);

  var fetched = fetchFosLaborCostsByRange_(range.start, range.end);
  if (!fetched.ok) {
    return { ok: false, message: fetched.message || 'Fetch failed.' };
  }
  var dimMaps = loadUtilizationLaborDimMaps_();
  var raw = [];
  for (var i = 0; i < (fetched.rows || []).length; i++) {
    raw.push(
      mapFosLaborCostRowToUtilRaw_(
        fetched.rows[i],
        dimMaps.usersByClockifyId,
        dimMaps.agreementsByProjectId,
        dimMaps.companiesMap,
        dimMaps.rolesMap
      )
    );
  }
  var rows = normalizeLaborRows_(raw, thresholds);
  var reference = buildByPersonWeek_(rows, range, thresholds);
  var referenceBytes = JSON.stringify(reference).length;

  // Deep-copy the reference before encoding: the encoder is fed the live array
  // and a future in-place variant would otherwise mutate what we compare with.
  reference = JSON.parse(JSON.stringify(reference));

  var wire = encodeUtilizationPersonWeekForWire_(reference);
  var codec = utilizationPersonWeekCodec_();
  var encodedBytes = JSON.stringify(wire).length + JSON.stringify(codec).length;
  var decoded = decodeUtilizationPersonWeekFromWire_(wire, codec);

  var diffs = [];
  if (reference.length !== decoded.length) {
    diffs.push({
      path: '$.byPersonWeek.length',
      expected: reference.length,
      actual: decoded.length,
    });
  }
  var limit = Math.min(reference.length, decoded.length);
  for (var e = 0; e < limit && diffs.length < 25; e++) {
    var exp = reference[e] || {};
    var act = decoded[e] || {};
    for (var f = 0; f < UTIL_PW_WIRE_FIELDS_.length && diffs.length < 25; f++) {
      var key = UTIL_PW_WIRE_FIELDS_[f];
      var ev = exp[key] === undefined ? null : exp[key];
      var av = act[key] === undefined ? null : act[key];
      var path = '$.byPersonWeek[' + e + '].' + key;
      if (Object.prototype.toString.call(ev) === '[object Array]') {
        var evj = JSON.stringify(ev);
        var avj = JSON.stringify(av);
        if (evj !== avj) {
          diffs.push({ path: path, expected: evj, actual: avj });
        }
        continue;
      }
      if (ev !== av) {
        diffs.push({ path: path, expected: ev, actual: av });
      }
    }
  }

  var result = {
    ok: true,
    pass: diffs.length === 0,
    entryCount: decoded.length,
    diffCount: diffs.length,
    diffs: diffs,
    encodedBytes: encodedBytes,
    unencodedBytes: referenceBytes,
    reductionPct:
      referenceBytes > 0
        ? Math.round((1 - encodedBytes / referenceBytes) * 1000) / 10
        : null,
  };
  console.log('===== UTIL VIZ CODEC =====');
  console.log(JSON.stringify(result, null, 2));
  perfPersistRun_('codec', 'utilization byPersonWeek', result.pass, result);
  return result;
}

/**
 * Proves the Resource Assignments personVariances codec (feature 047 workstream
 * B6) is round-trip correct on live data.
 *
 * Builds the default-range payload with the slim flag forced off so the
 * reference is a plain array, encodes it, decodes it, and compares every field
 * including nested byDay. byDay.varianceHours on the reference is normalized to
 * actualHours - assignedHours before compare, matching the decode contract
 * (that field is dropped on the wire because the builder rounded raw
 * actual-assigned separately from the hour columns on ~0.07 percent of cells).
 *
 * A good result is `pass: true` with `diffCount: 0` over roughly 75 persons,
 * and `reductionPct` near 94. Flip `PERF_SLIM_RA_PERSON_VARIANCES` on in ADMIN
 * Settings only after that. No cacheSchemaVersion bump and no re-hydrate.
 *
 * @return {!Object}
 */
function _diag_verifyCodec_RaPersonVariances() {
  perfFlagOverridePush_({ PERF_SLIM_RA_PERSON_VARIANCES: false });
  var payload;
  try {
    if (
      typeof isSupabaseConfigured_ === 'function' &&
      isSupabaseConfigured_() &&
      typeof buildResourceAssignmentDashboardPayloadFromSupabase_ === 'function'
    ) {
      payload = buildResourceAssignmentDashboardPayloadFromSupabase_(null, null);
    } else {
      payload = buildResourceAssignmentDashboardPayload_(null, null);
    }
  } finally {
    perfFlagOverridePop_();
  }
  if (!payload || !payload.ok) {
    return {
      ok: false,
      message: (payload && payload.message) || 'Resource assignments build failed.',
    };
  }

  var reference = payload.personVariances || [];
  if (Object.prototype.toString.call(reference) !== '[object Array]') {
    return {
      ok: false,
      message: 'personVariances was already encoded despite the flag override.',
    };
  }
  // Deep-copy before encoding so a future in-place encoder cannot mutate the
  // reference we compare against.
  reference = JSON.parse(JSON.stringify(reference));
  var referenceBytes = JSON.stringify(reference).length;

  var wire = encodeRaPersonVariancesForWire_(reference);
  var codec = raPersonVariancesCodec_();
  var encodedBytes = JSON.stringify(wire).length + JSON.stringify(codec).length;
  var decoded = decodeRaPersonVariancesFromWire_(wire, codec);

  function normalizeByDayVariance_(rows) {
    for (var i = 0; i < rows.length; i++) {
      var groups = (rows[i] && rows[i].groups) || {};
      for (var g = 0; g < RA_PV_GROUP_ORDER_.length; g++) {
        var list = groups[RA_PV_GROUP_ORDER_[g]] || [];
        for (var p = 0; p < list.length; p++) {
          var byWeek = list[p].byWeek || {};
          var weekKeys = Object.keys(byWeek);
          for (var w = 0; w < weekKeys.length; w++) {
            var byDay = byWeek[weekKeys[w]].byDay;
            if (!byDay) continue;
            var dayKeys = Object.keys(byDay);
            for (var d = 0; d < dayKeys.length; d++) {
              var b = byDay[dayKeys[d]] || {};
              var ah = b.assignedHours == null ? 0 : b.assignedHours;
              var act = b.actualHours == null ? 0 : b.actualHours;
              b.varianceHours = Math.round((act - ah) * 10) / 10;
            }
          }
        }
      }
    }
    return rows;
  }

  normalizeByDayVariance_(reference);

  var diffs = [];
  if (reference.length !== decoded.length) {
    diffs.push({
      path: '$.personVariances.length',
      expected: reference.length,
      actual: decoded.length,
    });
  }

  function pushDiff(path, expected, actual) {
    if (diffs.length >= 25) return;
    diffs.push({ path: path, expected: expected, actual: actual });
  }

  function compareByDay(expDay, actDay, path) {
    var expKeys = Object.keys(expDay || {}).sort();
    var actKeys = Object.keys(actDay || {}).sort();
    if (JSON.stringify(expKeys) !== JSON.stringify(actKeys)) {
      pushDiff(path + '.keys', expKeys, actKeys);
      return;
    }
    for (var i = 0; i < expKeys.length && diffs.length < 25; i++) {
      var ymd = expKeys[i];
      var e = expDay[ymd] || {};
      var a = (actDay && actDay[ymd]) || {};
      if (e.assignedHours !== a.assignedHours) {
        pushDiff(path + '.' + ymd + '.assignedHours', e.assignedHours, a.assignedHours);
      }
      if (e.actualHours !== a.actualHours) {
        pushDiff(path + '.' + ymd + '.actualHours', e.actualHours, a.actualHours);
      }
      if (e.varianceHours !== a.varianceHours) {
        pushDiff(path + '.' + ymd + '.varianceHours', e.varianceHours, a.varianceHours);
      }
    }
  }

  function compareProject(exp, act, path) {
    if ((exp.key || '') !== (act.key || '')) {
      pushDiff(path + '.key', exp.key, act.key);
    }
    if ((exp.agreementId || '') !== (act.agreementId || '')) {
      pushDiff(path + '.agreementId', exp.agreementId, act.agreementId);
    }
    if ((exp.projectName || '') !== (act.projectName || '')) {
      pushDiff(path + '.projectName', exp.projectName, act.projectName);
    }
    if ((exp.customerName || '') !== (act.customerName || '')) {
      pushDiff(path + '.customerName', exp.customerName, act.customerName);
    }
    if (!!exp.highlightOrange !== !!act.highlightOrange) {
      pushDiff(path + '.highlightOrange', !!exp.highlightOrange, !!act.highlightOrange);
    }
    var expWeeks = Object.keys(exp.byWeek || {}).sort();
    var actWeeks = Object.keys(act.byWeek || {}).sort();
    if (JSON.stringify(expWeeks) !== JSON.stringify(actWeeks)) {
      pushDiff(path + '.byWeek.keys', expWeeks, actWeeks);
      return;
    }
    for (var wi = 0; wi < expWeeks.length && diffs.length < 25; wi++) {
      var wk = expWeeks[wi];
      var eb = (exp.byWeek && exp.byWeek[wk]) || {};
      var ab = (act.byWeek && act.byWeek[wk]) || {};
      var cellPath = path + '.byWeek.' + wk;
      if (eb.assignedHours !== ab.assignedHours) {
        pushDiff(cellPath + '.assignedHours', eb.assignedHours, ab.assignedHours);
      }
      if (eb.actualHours !== ab.actualHours) {
        pushDiff(cellPath + '.actualHours', eb.actualHours, ab.actualHours);
      }
      if (eb.varianceHours !== ab.varianceHours) {
        pushDiff(cellPath + '.varianceHours', eb.varianceHours, ab.varianceHours);
      }
      if (!!eb.partial !== !!ab.partial) {
        pushDiff(cellPath + '.partial', !!eb.partial, !!ab.partial);
      }
      if (!!eb.byDay !== !!ab.byDay) {
        pushDiff(cellPath + '.byDay.present', !!eb.byDay, !!ab.byDay);
      } else if (eb.byDay) {
        compareByDay(eb.byDay, ab.byDay, cellPath + '.byDay');
      }
    }
  }

  var limit = Math.min(reference.length, decoded.length);
  for (var i = 0; i < limit && diffs.length < 25; i++) {
    var exp = reference[i] || {};
    var act = decoded[i] || {};
    var base = '$.personVariances[' + i + ']';
    if ((exp.personKey || '') !== (act.personKey || '')) {
      pushDiff(base + '.personKey', exp.personKey, act.personKey);
    }
    if ((exp.name || '') !== (act.name || '')) {
      pushDiff(base + '.name', exp.name, act.name);
    }
    if ((exp.roleName || '') !== (act.roleName || '')) {
      pushDiff(base + '.roleName', exp.roleName, act.roleName);
    }
    if ((exp.company || '') !== (act.company || '')) {
      pushDiff(base + '.company', exp.company, act.company);
    }
    if (!!exp.highlightOrange !== !!act.highlightOrange) {
      pushDiff(base + '.highlightOrange', !!exp.highlightOrange, !!act.highlightOrange);
    }
    for (var g = 0; g < RA_PV_GROUP_ORDER_.length && diffs.length < 25; g++) {
      var gid = RA_PV_GROUP_ORDER_[g];
      var expList = (exp.groups && exp.groups[gid]) || [];
      var actList = (act.groups && act.groups[gid]) || [];
      if (expList.length !== actList.length) {
        pushDiff(base + '.groups.' + gid + '.length', expList.length, actList.length);
      }
      var pl = Math.min(expList.length, actList.length);
      for (var p = 0; p < pl && diffs.length < 25; p++) {
        compareProject(expList[p], actList[p], base + '.groups.' + gid + '[' + p + ']');
      }
    }
  }

  var result = {
    ok: true,
    pass: diffs.length === 0,
    personCount: decoded.length,
    uniqueByDayTables: (wire.b && wire.b.length) || 0,
    diffCount: diffs.length,
    diffs: diffs,
    encodedBytes: encodedBytes,
    unencodedBytes: referenceBytes,
    reductionPct:
      referenceBytes > 0
        ? Math.round((1 - encodedBytes / referenceBytes) * 1000) / 10
        : null,
  };
  console.log('===== RA PERSON VARIANCES CODEC =====');
  console.log(JSON.stringify(result, null, 2));
  perfPersistRun_('codec', 'ra personVariances', result.pass, result);
  return result;
}

/**
 * One-call verification for workstream B2 (Resource assignments week grid RPC).
 *
 * Parity alone is not enough here. Both arms of `_diag_comparePerfParity` build
 * the same payload shape, so if the RPC failed and the builder quietly fell
 * back to the row scan, the harness would compare the row scan against itself
 * and report a pass. This wraps the parity run with a source tally and fails
 * unless each arm used the path it was supposed to use.
 *
 * A good result: `pass: true`, `armsProven: true`, `rpcProbe.ok: true`, and a
 * tally of 4 RPC builds, 4 row-scan builds, and 0 fallbacks.
 *
 * @return {!Object}
 */
function _diag_verifyWorkstreamB2() {
  var probeRange = resolveResourceAssignmentRangeYmd_(null, null, []);
  var probe = fetchResourceAllocationsViaRpc_(probeRange.startYmd, probeRange.endYmd);
  var rpcProbe = {
    ok: !!probe.ok,
    message: probe.ok ? null : probe.message,
    rangeStart: probeRange.startYmd,
    rangeEnd: probeRange.endYmd,
    totalCount: probe.ok ? probe.totalCount : null,
    matchedCount: probe.ok ? probe.matchedCount : null,
  };

  raAllocSourceTallyReset_();
  var parity = _diag_comparePerfParityAllFixtures('resource-assignments');
  var tally = {
    rpc: RA_ALLOC_SOURCE_TALLY_.rpc,
    rows: RA_ALLOC_SOURCE_TALLY_.rows,
    rpcFallbacks: RA_ALLOC_SOURCE_TALLY_.rpcFallbacks,
  };
  var fixtureCount = (parity.runs || []).length;
  var armsProven =
    fixtureCount > 0 &&
    tally.rpc === fixtureCount &&
    tally.rows === fixtureCount &&
    tally.rpcFallbacks === 0;

  var summary = {
    workstream: 'B2',
    pass: !!parity.pass && armsProven && rpcProbe.ok,
    parityPass: parity.pass,
    parityComplete: parity.complete,
    parityRunId: parity.runId || null,
    armsProven: armsProven,
    fixtureCount: fixtureCount,
    tally: tally,
    rpcProbe: rpcProbe,
    runs: parity.runs,
  };
  console.log('===== WORKSTREAM B2 VERIFICATION =====');
  console.log(JSON.stringify(summary, null, 2));
  if (!armsProven) {
    console.error(
      'Arms not proven: expected ' +
        fixtureCount +
        ' RPC build(s) and ' +
        fixtureCount +
        ' row-scan build(s) with 0 fallbacks, got ' +
        JSON.stringify(tally) +
        '. Parity result is meaningless until this is 0 fallbacks.'
    );
  }
  perfPersistRun_('parity', 'workstream B2 (resource-assignments RPC)', summary.pass, summary);
  return summary;
}

/**
 * One-call verification for workstream B4 (range-keyed visualization cache).
 *
 * Three arms per fixture, not two, because the interesting failure modes are on
 * different paths:
 *
 *   1. flag off        the exact-range build, unchanged production behavior
 *   2. flag on, cold   the entry is deleted first, so this build fetches the
 *                      day-aligned superset, stores it, and serves a slice
 *   3. flag on, warm   the same request again, served from the stored bundle
 *
 * Arms 2 and 3 are both compared against arm 1. Comparing only arm 3 would miss
 * a superset-slicing bug, and comparing only arm 2 would miss an
 * encode/decode/round-trip bug in the stored bundle.
 *
 * The outcome tally is load-bearing for the same reason it is in B2: every
 * failure path in `serveUtilizationFromRangeCache_` returns null and falls back
 * to the exact-range build. Without the tally a cache that never worked at all
 * would compare the old path against itself and report a clean pass. A run is
 * only meaningful when arm 2 records exactly one `miss` and arm 3 exactly one
 * `hit` on every fixture.
 *
 * A good result: `pass: true`, `armsProven: true`, `diffCount: 0` on every
 * fixture, and `warm.httpCalls` materially below `baseline.httpCalls`.
 *
 * @return {!Object}
 */
function _diag_verifyWorkstreamB4() {
  var deadline = Date.now() + PERF_HARNESS_BUDGET_MS_;
  var thresholds = getUtilizationThresholds_();
  var keyHash = vizRangeCacheKeyHash_(utilizationRangeCacheKeyInputs_(thresholds));
  var runs = [];
  var skipped = [];
  var allPass = true;
  var armsProven = true;

  for (var i = 0; i < PERF_PARITY_FIXTURES_.length; i++) {
    var fx = PERF_PARITY_FIXTURES_[i];
    if (Date.now() > deadline) {
      skipped.push(fx.id);
      armsProven = false;
      continue;
    }
    var range = resolveRange_(fx.start || null, fx.end || null, new Date(), thresholds);
    var superset = vizRangeCacheSupersetForRange_(range);
    var run = {
      fixture: fx.id,
      rangeStart: fx.start || '(default)',
      rangeEnd: fx.end || '(default)',
      cacheKey: superset
        ? superset.startYmd + '..' + superset.endYmd + '#' + keyHash
        : null,
    };

    run.baseline = perfB4Arm_(fx, false);
    if (superset) {
      vizRangeCacheDelete_(
        'utilization',
        superset,
        UTILIZATION_DASHBOARD_CACHE_SCHEMA_VERSION_,
        keyHash
      );
    }
    run.cold = perfB4Arm_(fx, true);
    run.warm = perfB4Arm_(fx, true);

    run.coldDiffs = perfB4Compare_(run.baseline.payload, run.cold.payload, fx);
    run.warmDiffs = perfB4Compare_(run.baseline.payload, run.warm.payload, fx);
    run.coldOutcomeOk = run.cold.outcomes.miss === 1 && run.cold.outcomes.hit === 0;
    run.warmOutcomeOk = run.warm.outcomes.hit === 1 && run.warm.outcomes.miss === 0;
    run.pass =
      run.coldDiffs.diffCount === 0 &&
      run.warmDiffs.diffCount === 0 &&
      run.coldOutcomeOk &&
      run.warmOutcomeOk;
    if (!run.pass) {
      allPass = false;
    }
    if (!run.coldOutcomeOk || !run.warmOutcomeOk) {
      armsProven = false;
    }
    // The payloads are megabytes each; keep the numbers, drop the data.
    run.baseline.payload = null;
    run.cold.payload = null;
    run.warm.payload = null;
    runs.push(run);
  }

  var summary = {
    workstream: 'B4',
    pass: allPass && armsProven && skipped.length === 0,
    armsProven: armsProven,
    complete: skipped.length === 0,
    skipped: skipped,
    keyHash: keyHash,
    runs: runs,
  };
  console.log('===== WORKSTREAM B4 VERIFICATION =====');
  console.log(JSON.stringify(summary, null, 2));
  if (!armsProven) {
    console.error(
      'Arms not proven. Every fixture must record exactly one cache miss on the ' +
        'cold arm and one hit on the warm arm. Anything else means the cache path ' +
        'fell back to the exact-range build and the parity result is meaningless.'
    );
  }
  perfPersistRun_('range-cache', 'workstream B4 (utilization range cache)', summary.pass, summary);
  return summary;
}

/**
 * Runs one Utilization load with `PERF_USE_RANGE_CACHE` forced, and reports the
 * cache outcomes and PostgREST cost attributable to that call alone.
 *
 * @param {!{start: string, end: string}} fixture
 * @param {boolean} useCache
 * @return {!Object}
 * @private
 */
function perfB4Arm_(fixture, useCache) {
  vizRangeCacheTallyReset_();
  supabasePerfCounterStart_();
  var startedAt = Date.now();
  var payload = null;
  var error = null;
  perfFlagOverridePush_({ PERF_USE_RANGE_CACHE: useCache });
  try {
    payload = getUtilizationDashboardData(fixture.start || undefined, fixture.end || undefined);
  } catch (e) {
    error = String((e && e.message) || e);
  } finally {
    perfFlagOverridePop_();
  }
  var elapsedMs = Date.now() - startedAt;
  var counter = supabasePerfCounterStop_();
  var outcomes = {
    hit: VIZ_RANGE_CACHE_TALLY_.hit,
    miss: VIZ_RANGE_CACHE_TALLY_.miss,
    skip: VIZ_RANGE_CACHE_TALLY_.skip,
    error: VIZ_RANGE_CACHE_TALLY_.error,
    put: VIZ_RANGE_CACHE_TALLY_.put,
    putSkipped: VIZ_RANGE_CACHE_TALLY_.putSkipped,
  };
  return {
    useCache: useCache,
    error: error,
    elapsedMs: elapsedMs,
    httpCalls: counter.calls,
    httpMs: counter.ms,
    bytesReceived: counter.bytes,
    // `rows` is the B1 encoded envelope `{d, r}` on this panel, so the generic
    // `.length` probe would report 0.
    rowCount:
      payload && payload.rows && payload.rows.r && payload.rows.r.length
        ? payload.rows.r.length
        : perfPayloadRowCount_(payload),
    loadSource: (payload && payload.loadSource) || null,
    outcomes: outcomes,
    payload: payload,
  };
}

/**
 * Deep-compares two utilization payloads with the standard tolerances.
 *
 * @param {*} expected
 * @param {*} actual
 * @param {!{start: string, end: string}} fixture
 * @return {!{diffCount: number, diffs: !Array<!Object>, toleratedCount: number}}
 * @private
 */
function perfB4Compare_(expected, actual, fixture) {
  var diffs = [];
  var opts = {
    clockToleranceMs: fixture.start || fixture.end ? 0 : PERF_PARITY_CLOCK_TOLERANCE_MS_,
    tolerated: [],
  };
  perfParityWalk_(expected, actual, '$', diffs, opts);
  return {
    diffCount: diffs.length,
    diffs: diffs.slice(0, 25),
    toleratedCount: opts.tolerated.length,
  };
}

/**
 * Serve-time provenance fields that legitimately differ between a stored blob
 * and a rebuild made minutes later. Everything here is a timestamp, a timestamp
 * derivative, or the B5 path marker; nothing here can carry a number.
 * @const {!Array<string>}
 */
var PERF_B5_IGNORE_KEYS_ = [
  'dataAsOf',
  'servedAt',
  'supabaseSyncedAt',
  'cacheDateKey',
  'reloadPath',
  'reloadRebuildReason',
  'thresholdFingerprint',
];

/**
 * Panels served by `serveLiveAgreementFamilyOrRebuild_`, in the order B5 exercises
 * them. Services summary is deliberately excluded: it wraps the same agreement
 * serve, so it would re-test the same code path and spend another rebuild.
 * @const {!Array<string>}
 */
var PERF_B5_PANELS_ = ['agreement', 'delivery'];

/**
 * Runs one Agreement-family Reload with `PERF_RELOAD_REREADS_BLOB` forced.
 *
 * Always passes `forceRefresh = true`, because B5 changes the forced path only.
 * `perfInvokePanel_` deliberately passes `false`, so it cannot be reused here.
 *
 * @param {string} panelKey `agreement` or `delivery`
 * @param {boolean} reread
 * @return {!Object}
 * @private
 */
function perfB5Arm_(panelKey, reread) {
  supabasePerfCounterStart_();
  var startedAt = Date.now();
  var payload = null;
  var error = null;
  perfFlagOverridePush_({ PERF_RELOAD_REREADS_BLOB: reread });
  try {
    payload =
      panelKey === 'delivery'
        ? getDeliveryDashboardData(true)
        : getAgreementDashboardData(true);
  } catch (e) {
    error = String((e && e.message) || e);
  } finally {
    perfFlagOverridePop_();
  }
  var elapsedMs = Date.now() - startedAt;
  var counter = supabasePerfCounterStop_();
  return {
    panel: panelKey,
    flagOn: reread,
    error: error,
    elapsedMs: elapsedMs,
    httpCalls: counter.calls,
    httpMs: counter.ms,
    bytesReceived: counter.bytes,
    payloadBytes: payload ? JSON.stringify(payload).length : 0,
    reloadPath: (payload && payload.reloadPath) || null,
    reloadRebuildReason: (payload && payload.reloadRebuildReason) || null,
    loadSource: (payload && payload.loadSource) || null,
    ok: !!(payload && payload.ok !== false),
    payload: payload,
  };
}

/**
 * Compares two Agreement-family payloads, ignoring serve-time provenance.
 *
 * @param {*} expected
 * @param {*} actual
 * @return {!{diffCount: number, diffs: !Array<!Object>, toleratedCount: number}}
 * @private
 */
function perfB5Compare_(expected, actual) {
  var diffs = [];
  var opts = {
    // Both arms build their own window from the clock, so bounded ISO drift is
    // expected for the same reason the default-window fixture tolerates it.
    clockToleranceMs: PERF_PARITY_CLOCK_TOLERANCE_MS_,
    tolerated: [],
    extraIgnoreKeys: PERF_B5_IGNORE_KEYS_,
  };
  perfParityWalk_(expected, actual, '$', diffs, opts);
  return {
    diffCount: diffs.length,
    diffs: diffs.slice(0, 25),
    toleratedCount: opts.tolerated.length,
  };
}

/**
 * One-call verification for workstream B5 (Reload re-reads the stored blob).
 *
 * Three arms per panel, run in a deliberate order:
 *
 *   1. `stored`  flag on, forced. Reads the blob the **hydrate** wrote, before
 *                anything in this run has touched it.
 *   2. `rebuild` flag off, forced. Unchanged production behavior. Also rewrites
 *                both blobs, which is why arm 1 has to run first for every panel.
 *   3. `reread`  flag on, forced. Reads the blob arm 2 just wrote.
 *
 * Two comparisons, testing two different things:
 *
 *   `storedVsRebuild` is the **premise** of the whole workstream: the stored blob
 *   already equals what a rebuild would produce, because the five typed tables
 *   the rebuild reads have no writer other than the nightly AM mirror. A diff
 *   here means the premise is false and the flag must stay off.
 *
 *   `rereadVsRebuild` is the store-and-read round trip. A diff here means the
 *   blob does not survive its own jsonb round trip.
 *
 * The tally is load-bearing for the same reason it is in B2 and B4: every
 * non-serve outcome falls back to a rebuild, so without checking `reloadPath`
 * per arm a flag that never took effect would compare the rebuild against itself
 * and report a clean pass.
 *
 * A good result: `pass: true`, `armsProven: true`, both `diffCount` values 0 on
 * both panels, and `rebuild.httpCalls` well above `reread.httpCalls`.
 *
 * **If `storedVsRebuild` shows diffs on the first run**, check the blob's
 * provenance before concluding the premise is wrong: `fos_sync_runs.summary ->>
 * 'scriptVersion'` records which code built it, and on 2026-08-25 that was
 * 3.10.0 while git was several releases ahead. Arm 2 has already rewritten both
 * blobs with current code by the time you read the result, so re-running this
 * diagnostic immediately gives a same-code comparison.
 *
 * @return {!Object}
 */
function _diag_verifyWorkstreamB5() {
  var stored = {};
  var rebuild = {};
  var reread = {};
  var i;
  var panel;

  // Arm 1 for every panel first: an agreement rebuild rewrites the delivery blob
  // too, so a per-panel loop would destroy delivery's premise comparison.
  for (i = 0; i < PERF_B5_PANELS_.length; i++) {
    panel = PERF_B5_PANELS_[i];
    stored[panel] = perfB5Arm_(panel, true);
  }
  for (i = 0; i < PERF_B5_PANELS_.length; i++) {
    panel = PERF_B5_PANELS_[i];
    rebuild[panel] = perfB5Arm_(panel, false);
  }
  for (i = 0; i < PERF_B5_PANELS_.length; i++) {
    panel = PERF_B5_PANELS_[i];
    reread[panel] = perfB5Arm_(panel, true);
  }

  var runs = [];
  var allPass = true;
  var armsProven = true;
  for (i = 0; i < PERF_B5_PANELS_.length; i++) {
    panel = PERF_B5_PANELS_[i];
    var s = stored[panel];
    var b = rebuild[panel];
    var r = reread[panel];
    var run = {
      panel: panel,
      storedVsRebuild: perfB5Compare_(s.payload, b.payload),
      rereadVsRebuild: perfB5Compare_(r.payload, b.payload),
      armsOk:
        s.reloadPath === 'blob-reread' &&
        b.reloadPath === 'rebuild' &&
        b.reloadRebuildReason === 'reload-forced-rebuild' &&
        r.reloadPath === 'blob-reread' &&
        b.httpCalls > r.httpCalls,
      cost: {
        rebuildMs: b.elapsedMs,
        rereadMs: r.elapsedMs,
        rebuildHttpCalls: b.httpCalls,
        rereadHttpCalls: r.httpCalls,
        rebuildBytesReceived: b.bytesReceived,
        rereadBytesReceived: r.bytesReceived,
        speedup:
          r.elapsedMs > 0 ? Math.round((b.elapsedMs / r.elapsedMs) * 100) / 100 : null,
      },
      arms: { stored: s, rebuild: b, reread: r },
    };
    run.pass =
      run.storedVsRebuild.diffCount === 0 &&
      run.rereadVsRebuild.diffCount === 0 &&
      run.armsOk &&
      !s.error &&
      !b.error &&
      !r.error;
    if (!run.pass) allPass = false;
    if (!run.armsOk) armsProven = false;
    // The agreement payload is about 766 kB; keep the numbers, drop the data.
    run.arms.stored.payload = null;
    run.arms.rebuild.payload = null;
    run.arms.reread.payload = null;
    runs.push(run);
  }

  var summary = {
    workstream: 'B5',
    pass: allPass && armsProven,
    armsProven: armsProven,
    panels: PERF_B5_PANELS_.slice(),
    runs: runs,
  };
  console.log('===== WORKSTREAM B5 VERIFICATION =====');
  console.log(JSON.stringify(summary, null, 2));
  if (!armsProven) {
    console.error(
      'Arms not proven. Every panel must record reloadPath "blob-reread" with the ' +
        'flag on and "rebuild" with it off, and the rebuild must cost more round ' +
        'trips than the re-read. Anything else means the flag did not take effect ' +
        'and the parity result compares the rebuild against itself.'
    );
  }
  perfPersistRun_('reload-reread', 'workstream B5 (agreement family reload)', summary.pass, summary);
  return summary;
}

function _diag_verifyWorkstreamA() {
  var parity = _diag_comparePerfParityAllFixtures('utilization');
  var baseline = _diag_capturePerfBaseline(['utilization']);
  var summary = {
    workstream: 'A',
    parityPass: parity.pass,
    parityComplete: parity.complete,
    parityRunId: parity.runId || null,
    baselineRunId: baseline.runId || null,
    measurements: baseline.measurements,
  };
  console.log('===== WORKSTREAM A VERIFICATION =====');
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

/**
 * True when a leaf key should be skipped during comparison.
 *
 * `opts.extraIgnoreKeys` is per-run rather than global on purpose. B5 compares a
 * stored blob against a fresh rebuild, so the serve-time provenance fields
 * legitimately differ; adding them to `PERF_PARITY_IGNORE_KEYS_` would blind
 * every other workstream's run to them as well.
 *
 * @param {string} key
 * @param {!Object=} opts
 * @return {boolean}
 * @private
 */
function perfParityIgnoresKey_(key, opts) {
  var i;
  for (i = 0; i < PERF_PARITY_IGNORE_KEYS_.length; i++) {
    if (PERF_PARITY_IGNORE_KEYS_[i].test(key)) {
      return true;
    }
  }
  var extra = opts && opts.extraIgnoreKeys;
  if (extra) {
    for (i = 0; i < extra.length; i++) {
      if (extra[i] === key) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Tolerance for a leaf, based on its name. Percentages get a looser bound
 * than currency and hours.
 *
 * @param {string} key
 * @return {number}
 * @private
 */
function perfParityToleranceFor_(key) {
  if (/pct|percent|rate|ratio|utilization/i.test(key)) {
    return PERF_PARITY_TOLERANCE_PERCENT_;
  }
  return PERF_PARITY_TOLERANCE_DEFAULT_;
}

/**
 * Recursively compares two payloads, collecting every leaf that differs by
 * more than its tolerance. Counts and strings must match exactly.
 *
 * @param {*} expected
 * @param {*} actual
 * @param {string} path
 * @param {!Array<!Object>} diffs Accumulator.
 * @param {!{clockToleranceMs: number, tolerated: !Array<!Object>}} opts
 * @private
 */
function perfParityWalk_(expected, actual, path, diffs, opts) {
  if (diffs.length >= 100) {
    return;
  }
  var lastKey = path.split('.').pop().replace(/\[\d+\]$/, '');
  if (lastKey && perfParityIgnoresKey_(lastKey, opts)) {
    return;
  }

  var te = expected === null ? 'null' : typeof expected;
  var ta = actual === null ? 'null' : typeof actual;
  if (te !== ta) {
    diffs.push({ path: path, kind: 'type', expected: te, actual: ta });
    return;
  }

  if (typeof expected === 'number') {
    var tol = perfParityToleranceFor_(lastKey);
    var delta = Math.abs(expected - actual);
    if (!(delta <= tol)) {
      diffs.push({
        path: path,
        kind: 'number',
        expected: expected,
        actual: actual,
        delta: delta,
        tolerance: tol,
      });
    }
    return;
  }

  if (typeof expected === 'string' || typeof expected === 'boolean' || expected === null) {
    if (expected === actual) {
      return;
    }
    if (opts.clockToleranceMs > 0) {
      var expMs = perfParityIsoMs_(expected);
      var actMs = perfParityIsoMs_(actual);
      var drift = Math.abs(expMs - actMs);
      if (drift <= opts.clockToleranceMs) {
        opts.tolerated.push({
          path: path,
          kind: 'clock-drift',
          expected: expected,
          actual: actual,
          driftMs: drift,
        });
        return;
      }
    }
    diffs.push({ path: path, kind: 'value', expected: expected, actual: actual });
    return;
  }

  if (Object.prototype.toString.call(expected) === '[object Array]') {
    if (expected.length !== actual.length) {
      diffs.push({
        path: path,
        kind: 'length',
        expected: expected.length,
        actual: actual.length,
      });
      return;
    }
    for (var i = 0; i < expected.length; i++) {
      perfParityWalk_(expected[i], actual[i], path + '[' + i + ']', diffs, opts);
    }
    return;
  }

  var seen = {};
  var k;
  for (k in expected) {
    if (!Object.prototype.hasOwnProperty.call(expected, k)) continue;
    seen[k] = true;
    if (!Object.prototype.hasOwnProperty.call(actual, k)) {
      if (!perfParityIgnoresKey_(k, opts)) {
        diffs.push({ path: path + '.' + k, kind: 'missing-in-actual' });
      }
      continue;
    }
    perfParityWalk_(expected[k], actual[k], path + '.' + k, diffs, opts);
  }
  for (k in actual) {
    if (!Object.prototype.hasOwnProperty.call(actual, k)) continue;
    if (!seen[k] && !perfParityIgnoresKey_(k, opts)) {
      diffs.push({ path: path + '.' + k, kind: 'missing-in-expected' });
    }
  }
}

/**
 * Runs one panel twice, once with its workstream flag forced off (the
 * pre-change path) and once forced on (the candidate), and reports every
 * numeric leaf that moved.
 *
 * A green run is the precondition for shipping that workstream.
 *
 * @param {string} panelKey
 * @param {string=} startIso
 * @param {string=} endIso
 * @return {!Object}
 */
function _diag_comparePerfParity(panelKey, startIso, endIso) {
  var meta = PERF_PARITY_PANELS_[panelKey];
  if (!meta) {
    throw new Error('Unknown panel key for perf harness: ' + panelKey);
  }
  if (!meta.flag) {
    throw new Error(
      'Panel ' + panelKey + ' has no workstream flag yet; nothing to compare.'
    );
  }

  var baselineFlags = {};
  baselineFlags[meta.flag] = false;
  var candidateFlags = {};
  candidateFlags[meta.flag] = true;

  var baseline;
  var baselineMs;
  perfFlagOverridePush_(baselineFlags);
  try {
    var t0 = Date.now();
    baseline = perfInvokePanel_(panelKey, startIso || '', endIso || '');
    baselineMs = Date.now() - t0;
  } finally {
    perfFlagOverridePop_();
  }

  var candidate;
  var candidateMs;
  perfFlagOverridePush_(candidateFlags);
  try {
    var t1 = Date.now();
    candidate = perfInvokePanel_(panelKey, startIso || '', endIso || '');
    candidateMs = Date.now() - t1;
  } finally {
    perfFlagOverridePop_();
  }

  var diffs = [];
  var opts = {
    // An explicit range must reproduce exactly; only a derived window may drift.
    clockToleranceMs: startIso || endIso ? 0 : PERF_PARITY_CLOCK_TOLERANCE_MS_,
    tolerated: [],
  };
  perfParityWalk_(baseline, candidate, '$', diffs, opts);

  var result = {
    panel: panelKey,
    flag: meta.flag,
    rangeStart: startIso || '(default)',
    rangeEnd: endIso || '(default)',
    pass: diffs.length === 0,
    diffCount: diffs.length,
    diffs: diffs.slice(0, 25),
    toleratedCount: opts.tolerated.length,
    tolerated: opts.tolerated.slice(0, 25),
    baselineMs: baselineMs,
    candidateMs: candidateMs,
    speedup:
      candidateMs > 0 ? Math.round((baselineMs / candidateMs) * 100) / 100 : null,
  };
  if (result.pass) {
    console.log(
      'PARITY PASS ' +
        panelKey +
        ' [' +
        result.rangeStart +
        ' .. ' +
        result.rangeEnd +
        '] baseline ' +
        baselineMs +
        'ms -> candidate ' +
        candidateMs +
        'ms' +
        (opts.tolerated.length
          ? ' (' + opts.tolerated.length + ' leaf/leaves tolerated as clock drift)'
          : '')
    );
  } else {
    console.error('PARITY FAIL ' + panelKey + ': ' + diffs.length + ' diff(s)');
    console.error(JSON.stringify(result.diffs, null, 2));
  }
  return result;
}

/**
 * Parity across every fixture range for one panel.
 *
 * @param {string} panelKey
 * @return {!Object}
 */
function _diag_comparePerfParityAllFixtures(panelKey) {
  var deadline = Date.now() + PERF_HARNESS_BUDGET_MS_;
  var meta = PERF_PARITY_PANELS_[panelKey] || { rangeAware: false };
  var fixtures = meta.rangeAware ? PERF_PARITY_FIXTURES_ : [PERF_PARITY_FIXTURES_[0]];
  var runs = [];
  var skipped = [];
  var allPass = true;
  for (var i = 0; i < fixtures.length; i++) {
    var fx = fixtures[i];
    if (Date.now() > deadline) {
      skipped.push(fx.id);
      continue;
    }
    var r = _diag_comparePerfParity(panelKey, fx.start, fx.end);
    r.fixture = fx.id;
    runs.push(r);
    if (!r.pass) {
      allPass = false;
    }
  }
  var complete = skipped.length === 0;
  var summary = {
    panel: panelKey,
    pass: allPass && complete,
    complete: complete,
    skipped: skipped,
    runs: runs,
  };
  console.log(
    (allPass ? 'ALL FIXTURES PASS: ' : 'FIXTURE FAILURES: ') + panelKey
  );
  if (!complete) {
    console.warn(
      'Parity hit the time budget. Skipped fixture(s): ' +
        skipped.join(', ') +
        '. Run _diag_comparePerfParity("' +
        panelKey +
        '", start, end) for each.'
    );
  }
  summary.runId = perfPersistRun_(
    'parity',
    panelKey + ' (all fixtures)' + (complete ? '' : ' (partial)'),
    summary.pass,
    summary
  );
  return summary;
}

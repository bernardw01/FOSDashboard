/**
 * PRD version 3.9.2 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 047 Step 0: parity and measurement harness.
 *
 * The performance program moves aggregation out of Apps Script and into
 * Postgres. That is only safe if the numbers do not move, so every workstream
 * is gated on a parity run from this file before it ships.
 *
 * Run these from the Apps Script editor (they are ADMIN diagnostics, not
 * client-callable):
 *
 *   _diag_measurePanelLoad('utilization', '2026-05-26', '2026-08-24')
 *     One panel: elapsed ms, PostgREST calls, bytes received, payload size.
 *
 *   _diag_capturePerfBaseline()
 *     Every panel across every fixture range. Log output is the JSON to store
 *     in docs/features/047-baseline-measurements.json.
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
 */

/** @const {number} */
var PERF_PARITY_TOLERANCE_DEFAULT_ = 0.01;

/** @const {number} */
var PERF_PARITY_TOLERANCE_PERCENT_ = 0.1;

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
    id: 'default-90d',
    start: '',
    end: '',
    note: 'Rolling default window, the most common load.',
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
function _diag_capturePerfBaseline() {
  var out = {
    capturedAt: new Date().toISOString(),
    prdVersion: typeof FOS_PRD_VERSION === 'string' ? FOS_PRD_VERSION : 'unknown',
    flags: perfFlagsSnapshot_(),
    measurements: [],
  };
  for (var panelKey in PERF_PARITY_PANELS_) {
    if (!Object.prototype.hasOwnProperty.call(PERF_PARITY_PANELS_, panelKey)) continue;
    var meta = PERF_PARITY_PANELS_[panelKey];
    var fixtures = meta.rangeAware ? PERF_PARITY_FIXTURES_ : [PERF_PARITY_FIXTURES_[0]];
    for (var i = 0; i < fixtures.length; i++) {
      var fx = fixtures[i];
      var m = _diag_measurePanelLoad(panelKey, fx.start, fx.end);
      m.fixture = fx.id;
      out.measurements.push(m);
    }
  }
  console.log('===== FEATURE 047 BASELINE =====');
  console.log(JSON.stringify(out, null, 2));
  return out;
}

/**
 * True when a leaf key should be skipped during comparison.
 *
 * @param {string} key
 * @return {boolean}
 * @private
 */
function perfParityIgnoresKey_(key) {
  for (var i = 0; i < PERF_PARITY_IGNORE_KEYS_.length; i++) {
    if (PERF_PARITY_IGNORE_KEYS_[i].test(key)) {
      return true;
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
 * @private
 */
function perfParityWalk_(expected, actual, path, diffs) {
  if (diffs.length >= 100) {
    return;
  }
  var lastKey = path.split('.').pop().replace(/\[\d+\]$/, '');
  if (lastKey && perfParityIgnoresKey_(lastKey)) {
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
    if (expected !== actual) {
      diffs.push({ path: path, kind: 'value', expected: expected, actual: actual });
    }
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
      perfParityWalk_(expected[i], actual[i], path + '[' + i + ']', diffs);
    }
    return;
  }

  var seen = {};
  var k;
  for (k in expected) {
    if (!Object.prototype.hasOwnProperty.call(expected, k)) continue;
    seen[k] = true;
    if (!Object.prototype.hasOwnProperty.call(actual, k)) {
      if (!perfParityIgnoresKey_(k)) {
        diffs.push({ path: path + '.' + k, kind: 'missing-in-actual' });
      }
      continue;
    }
    perfParityWalk_(expected[k], actual[k], path + '.' + k, diffs);
  }
  for (k in actual) {
    if (!Object.prototype.hasOwnProperty.call(actual, k)) continue;
    if (!seen[k] && !perfParityIgnoresKey_(k)) {
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
  perfParityWalk_(baseline, candidate, '$', diffs);

  var result = {
    panel: panelKey,
    flag: meta.flag,
    rangeStart: startIso || '(default)',
    rangeEnd: endIso || '(default)',
    pass: diffs.length === 0,
    diffCount: diffs.length,
    diffs: diffs.slice(0, 25),
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
        'ms'
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
  var meta = PERF_PARITY_PANELS_[panelKey] || { rangeAware: false };
  var fixtures = meta.rangeAware ? PERF_PARITY_FIXTURES_ : [PERF_PARITY_FIXTURES_[0]];
  var runs = [];
  var allPass = true;
  for (var i = 0; i < fixtures.length; i++) {
    var fx = fixtures[i];
    var r = _diag_comparePerfParity(panelKey, fx.start, fx.end);
    r.fixture = fx.id;
    runs.push(r);
    if (!r.pass) {
      allPass = false;
    }
  }
  var summary = { panel: panelKey, pass: allPass, runs: runs };
  console.log(
    (allPass ? 'ALL FIXTURES PASS: ' : 'FIXTURE FAILURES: ') + panelKey
  );
  return summary;
}

/**
 * PRD version 3.17.0 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 047 workstream B4: range-keyed visualization cache.
 *
 * WHAT IS CACHED, AND WHAT DELIBERATELY IS NOT
 *
 * A cached entry is a **row bundle**, not a panel payload: normalized rows in
 * the workstream B1 wire encoding, plus the codec descriptor and the window
 * they cover. Nothing derived is stored. KPIs, dimensions, aggregates, the
 * heatmap slice, and alerts are all recomputed on every serve.
 *
 * That is a design decision, not an oversight, for three reasons.
 *
 *   1. Alerts are a function of `new Date()`. A stored alert list would age.
 *   2. Every aggregate is a function of the resolved thresholds, which an ADMIN
 *      can retune at any moment. Recomputing means a retune takes effect on the
 *      next load instead of after a cache purge.
 *   3. A bundle is not payload-shaped, so it cannot be handed to a browser by
 *      accident. Feature 047 has already shipped one bug of exactly that class
 *      (3.10.0 assigned a raw encoded envelope over a decoded payload and blanked
 *      the Operations panel for a day), so the safest cache artifact is one that
 *      is obviously not a payload.
 *
 * WHY THE KEY IS DAY-ALIGNED WHEN THE REQUEST IS NOT
 *
 * The client never sends a day boundary for a preset window. It sends
 * `new Date()` instants, so the default 60-day window differs by milliseconds
 * on every request and a key on the exact instants would never hit. Labor
 * timestamps are intra-day (measured: 1,163 distinct times of day across 22,546
 * rows), so rounding the *request* to a day would move numbers.
 *
 * So the key is the day-aligned **superset** of the request, the bundle holds
 * every row in that superset, and the caller filters to the exact requested
 * instants before computing anything. The window becomes cacheable and the
 * arithmetic is unchanged. Measured cost of the extra rows: 51 of 6,246 on
 * today's default window, about 0.8 percent.
 *
 * All reads and writes are gated on `PERF_USE_RANGE_CACHE`. With the flag off
 * this file is never entered.
 */

/** @const {string} */
var VIZ_RANGE_CACHE_TABLE_ = 'fos_viz_range_payloads';

/**
 * Bundle envelope version, independent of any panel `cacheSchemaVersion`.
 *
 * Following the workstream B3 precedent, the artifact is self-describing. The
 * trade is explicit and different from B3's, though: B3 used its own version so
 * a payload shape change would not force a re-hydrate. Here the panel version is
 * *also* part of the primary key, because the bundle stores rows in the codec
 * whose field list is tied to `UTILIZATION_DASHBOARD_CACHE_SCHEMA_VERSION_`, so a
 * panel bump must orphan every bundle. This envelope version covers changes to
 * the wrapper around those rows, which the panel version would not catch.
 * @const {number}
 */
var VIZ_RANGE_CACHE_BUNDLE_VERSION_ = 1;

/**
 * Largest bundle we will attempt to store, in JSON chars.
 *
 * `hydrateSupabaseUtilization_` records that a MAX_RANGE / YTD-sized JSON upsert
 * times out in Postgres. The B1 codec makes bundles far smaller than the
 * payloads that produced that finding (a 60-day bundle is about 870 kB rather
 * than 5.3 MB), but the ceiling is real and unmeasured at the top end, so an
 * oversized bundle is simply not written. The panel still renders; it just does
 * not get a cache entry.
 * @const {number}
 */
var VIZ_RANGE_CACHE_MAX_CHARS_ = 3 * 1024 * 1024;

/**
 * Per-execution tally of cache outcomes, for the parity harness.
 *
 * Workstream B2 learned that a parity run which cannot see which path each arm
 * took will happily compare the old path against itself and report a pass. The
 * same hazard applies here: a cache read that errors falls back to the row scan.
 * @type {!Object<string, number>}
 */
var VIZ_RANGE_CACHE_TALLY_ = { hit: 0, miss: 0, skip: 0, error: 0, put: 0, putSkipped: 0 };

/** Resets the tally. Diagnostics only. */
function vizRangeCacheTallyReset_() {
  VIZ_RANGE_CACHE_TALLY_ = { hit: 0, miss: 0, skip: 0, error: 0, put: 0, putSkipped: 0 };
}

/**
 * @param {string} outcome
 * @private
 */
function vizRangeCacheTallyBump_(outcome) {
  if (Object.prototype.hasOwnProperty.call(VIZ_RANGE_CACHE_TALLY_, outcome)) {
    VIZ_RANGE_CACHE_TALLY_[outcome] += 1;
  }
}

/**
 * `YYYY-MM-DD` of the UTC day containing `ms`.
 *
 * @param {number} ms
 * @return {string}
 * @private
 */
function vizRangeCacheYmd_(ms) {
  var d = new Date(ms);
  var y = d.getUTCFullYear();
  var m = d.getUTCMonth() + 1;
  var day = d.getUTCDate();
  return y + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

/**
 * Day-aligned superset of a resolved range.
 *
 * `startYmd` is the UTC day containing the requested start. `endYmd` is the
 * requested end rounded **up** to a UTC day boundary, left alone when it already
 * is one. The returned ISO bounds are the half-open window
 * `[startYmd 00:00Z, endYmd 00:00Z)` that a row fetch should use, and it always
 * contains `[range.start, range.end)`.
 *
 * @param {!{start: string, end: string}} range Resolved range.
 * @return {?{startYmd: string, endYmd: string, startIso: string, endIso: string}}
 */
function vizRangeCacheSupersetForRange_(range) {
  if (!range || !range.start || !range.end) {
    return null;
  }
  var startMs = parseIsoMs_(range.start);
  var endMs = parseIsoMs_(range.end);
  if (startMs === null || endMs === null || endMs < startMs) {
    return null;
  }
  var startYmd = vizRangeCacheYmd_(startMs);
  var endDayMs = Date.parse(vizRangeCacheYmd_(endMs) + 'T00:00:00.000Z');
  if (endMs > endDayMs) {
    endDayMs += 86400000;
  }
  var endYmd = vizRangeCacheYmd_(endDayMs);
  return {
    startYmd: startYmd,
    endYmd: endYmd,
    startIso: startYmd + 'T00:00:00.000Z',
    endIso: endYmd + 'T00:00:00.000Z',
  };
}

/**
 * JSON with object keys emitted in sorted order, so the same logical value
 * always hashes to the same string.
 *
 * @param {*} value
 * @return {string}
 * @private
 */
function vizRangeCacheStableJson_(value) {
  if (value === null || value === undefined) {
    return 'null';
  }
  var t = typeof value;
  if (t === 'number' || t === 'boolean') {
    return String(value);
  }
  if (t === 'string') {
    return JSON.stringify(value);
  }
  if (Object.prototype.toString.call(value) === '[object Array]') {
    var items = [];
    for (var i = 0; i < value.length; i++) {
      items.push(vizRangeCacheStableJson_(value[i]));
    }
    return '[' + items.join(',') + ']';
  }
  var keys = [];
  for (var k in value) {
    if (Object.prototype.hasOwnProperty.call(value, k)) {
      keys.push(k);
    }
  }
  keys.sort();
  var parts = [];
  for (var j = 0; j < keys.length; j++) {
    parts.push(JSON.stringify(keys[j]) + ':' + vizRangeCacheStableJson_(value[keys[j]]));
  }
  return '{' + parts.join(',') + '}';
}

/**
 * Hex MD5 of a stable serialization of `inputs`, truncated to 24 chars.
 *
 * MD5 is fine here: this is a cache discriminator, not a security boundary. A
 * collision would serve one window's rows for another window with identical
 * bounds and different thresholds, which 96 bits makes vanishingly unlikely.
 *
 * @param {!Object} inputs
 * @return {string}
 */
function vizRangeCacheKeyHash_(inputs) {
  var text = vizRangeCacheStableJson_(inputs);
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex.slice(0, 24);
}

/**
 * Reads a cache entry and the live source fingerprint in one round trip.
 *
 * The fingerprint comes back on a miss as well as a hit, because the caller
 * needs it to stamp the write it is about to make, and it must be the value from
 * **before** the row fetch. If an upstream sync lands mid-build, stamping the
 * pre-build fingerprint makes the new entry stale immediately, which costs a
 * rebuild rather than serving rows that never coexisted.
 *
 * @param {string} panelKey
 * @param {!{startYmd: string, endYmd: string}} superset
 * @param {number} cacheSchemaVersion
 * @param {string} keyHash
 * @return {!{ok: boolean, hit: boolean, fresh: boolean, bundle: ?Object,
 *            builtAt: ?string, currentWatermark: ?string, currentRowCount: ?number,
 *            message?: string}}
 */
function vizRangeCacheGet_(panelKey, superset, cacheSchemaVersion, keyHash) {
  var res = supabaseRpc_('fos_rpc_viz_range_get', {
    p_panel_key: panelKey,
    p_range_start: superset.startYmd,
    p_range_end: superset.endYmd,
    p_cache_schema_version: cacheSchemaVersion,
    p_key_hash: keyHash,
  });
  if (!res.ok || !res.json || typeof res.json !== 'object') {
    return {
      ok: false,
      hit: false,
      fresh: false,
      bundle: null,
      builtAt: null,
      currentWatermark: null,
      currentRowCount: null,
      message: res.message || 'Range cache read failed.',
    };
  }
  var j = res.json;
  return {
    ok: true,
    hit: !!j.hit,
    fresh: !!j.fresh,
    bundle: j.fresh ? j.payload || null : null,
    builtAt: j.builtAt || null,
    currentWatermark: j.currentWatermark || null,
    currentRowCount: j.currentRowCount === null ? null : Number(j.currentRowCount),
  };
}

/**
 * Stores a bundle. Best effort: a failed write means the next request rebuilds,
 * which is slow but correct, so it never propagates as an error.
 *
 * @param {string} panelKey
 * @param {!{startYmd: string, endYmd: string}} superset
 * @param {number} cacheSchemaVersion
 * @param {string} keyHash
 * @param {!Object} bundle
 * @param {?string} watermark Fingerprint read before the rows were fetched.
 * @param {?number} sourceRowCount
 * @return {!{ok: boolean, chars: number, skipped?: string}}
 */
function vizRangeCachePut_(
  panelKey,
  superset,
  cacheSchemaVersion,
  keyHash,
  bundle,
  watermark,
  sourceRowCount
) {
  if (!watermark) {
    vizRangeCacheTallyBump_('putSkipped');
    return { ok: false, chars: 0, skipped: 'no source watermark' };
  }
  var text;
  try {
    text = JSON.stringify(bundle);
  } catch (e) {
    vizRangeCacheTallyBump_('putSkipped');
    return { ok: false, chars: 0, skipped: 'bundle not serializable' };
  }
  if (text.length > VIZ_RANGE_CACHE_MAX_CHARS_) {
    vizRangeCacheTallyBump_('putSkipped');
    return {
      ok: false,
      chars: text.length,
      skipped:
        'bundle is ' + text.length + ' chars, over the ' + VIZ_RANGE_CACHE_MAX_CHARS_ + ' ceiling',
    };
  }
  var res = supabaseUpsert_(
    VIZ_RANGE_CACHE_TABLE_,
    [
      {
        panel_key: panelKey,
        range_start: superset.startYmd,
        range_end: superset.endYmd,
        cache_schema_version: cacheSchemaVersion,
        key_hash: keyHash,
        payload: bundle,
        row_count: bundle && bundle.rowCount ? bundle.rowCount : 0,
        payload_chars: text.length,
        built_at: new Date().toISOString(),
        source_watermark: watermark,
        source_row_count: sourceRowCount === null ? null : sourceRowCount,
      },
    ],
    'panel_key,range_start,range_end,cache_schema_version,key_hash'
  );
  if (!res || res.ok === false) {
    vizRangeCacheTallyBump_('putSkipped');
    try {
      console.warn(
        'vizRangeCachePut_: ' + ((res && res.message) || 'upsert failed') + ' for ' + panelKey
      );
    } catch (_) {
      /* ignore */
    }
    return { ok: false, chars: text.length, skipped: (res && res.message) || 'upsert failed' };
  }
  vizRangeCacheTallyBump_('put');
  return { ok: true, chars: text.length };
}

/**
 * Deletes one entry by its full key.
 *
 * Exists for the parity harness. A verification run has to be able to force a
 * cold miss, otherwise a fixture whose window the hydrate already warmed would
 * make both "candidate" arms cache hits and the run could not prove that the
 * build-and-store path still produces the same numbers.
 *
 * @param {string} panelKey
 * @param {!{startYmd: string, endYmd: string}} superset
 * @param {number} cacheSchemaVersion
 * @param {string} keyHash
 * @return {!{ok: boolean}}
 */
function vizRangeCacheDelete_(panelKey, superset, cacheSchemaVersion, keyHash) {
  var res = supabaseRest_(
    'delete',
    '/rest/v1/' + VIZ_RANGE_CACHE_TABLE_,
    {
      panel_key: 'eq.' + panelKey,
      range_start: 'eq.' + superset.startYmd,
      range_end: 'eq.' + superset.endYmd,
      cache_schema_version: 'eq.' + cacheSchemaVersion,
      key_hash: 'eq.' + keyHash,
    },
    null,
    { Prefer: 'return=minimal' }
  );
  return { ok: !!(res && res.ok) };
}

/**
 * Deletes entries that can never be served again because their source
 * fingerprint is behind the live one.
 *
 * @param {string} panelKey
 * @return {!{ok: boolean, deleted: number, remaining: number}}
 */
function vizRangeCacheGc_(panelKey) {
  var res = supabaseRpc_('fos_rpc_viz_range_gc', { p_panel_key: panelKey });
  if (!res.ok || !res.json) {
    return { ok: false, deleted: 0, remaining: 0 };
  }
  return {
    ok: true,
    deleted: Number(res.json.deleted || 0),
    remaining: Number(res.json.remaining || 0),
  };
}

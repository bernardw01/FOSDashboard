/**
 * PRD version 3.20.16 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 047 follow-on: Resource assignments range payload cache.
 *
 * Reuses fos_viz_range_payloads (migration 051) with panel_key
 * `resource-assignments`. Unlike Utilization (normalized row bundles), RA
 * stores the fully assembled panel JSON for an exact From/To YMD window so
 * Live open and Reload are one Postgres read when the source fingerprint is
 * still fresh (migration 053).
 *
 * Gated on PERF_USE_RA_RANGE_CACHE. Fingerprint includes allocations + labor
 * so Clockify sync or AM mirror invalidates automatically.
 */

/** @const {string} */
var RA_RANGE_CACHE_PANEL_KEY_ = 'resource-assignments';

/** @const {number} */
var RA_RANGE_CACHE_ENVELOPE_VERSION_ = 1;

/**
 * Inputs that change the assembled RA payload without advancing source
 * synced_at (capacity Script Property, PERF flags that reshape the wire).
 *
 * @return {!Object}
 * @private
 */
function raRangeCacheKeyInputs_() {
  return {
    envelopeVersion: RA_RANGE_CACHE_ENVELOPE_VERSION_,
    weeklyCapacityHours: resolveResourceAssignmentWeeklyCapacity_(),
    PERF_USE_RA_RPC: !!perfFlag_('PERF_USE_RA_RPC'),
    PERF_SLIM_RA_PERSON_VARIANCES: !!perfFlag_('PERF_SLIM_RA_PERSON_VARIANCES'),
  };
}

/**
 * @param {!Object} panelPayload Assembled RA dashboard payload (ok: true).
 * @return {!Object}
 * @private
 */
function raRangeCacheEnvelope_(panelPayload) {
  var assignmentCount =
    panelPayload && panelPayload.kpis && panelPayload.kpis.assignmentCount
      ? Number(panelPayload.kpis.assignmentCount)
      : 0;
  return {
    envelopeVersion: RA_RANGE_CACHE_ENVELOPE_VERSION_,
    rowCount: assignmentCount,
    payload: panelPayload,
  };
}

/**
 * Tries to serve a fresh range-cache hit. Returns null when the caller should
 * build from typed tables (miss, stale, error, flag off, or bad envelope).
 *
 * @param {string} startYmd
 * @param {string} endYmd
 * @return {?Object}
 */
function tryServeResourceAssignmentFromRangeCache_(startYmd, endYmd) {
  if (!perfFlag_('PERF_USE_RA_RANGE_CACHE')) {
    return null;
  }
  if (typeof vizRangeCacheGet_ !== 'function' || typeof vizRangeCacheKeyHash_ !== 'function') {
    return null;
  }
  var keyHash = vizRangeCacheKeyHash_(raRangeCacheKeyInputs_());
  var got = vizRangeCacheGet_(
    RA_RANGE_CACHE_PANEL_KEY_,
    { startYmd: startYmd, endYmd: endYmd },
    RESOURCE_ASSIGNMENTS_CACHE_SCHEMA_VERSION_,
    keyHash
  );
  if (!got.ok) {
    vizRangeCacheTallyBump_('error');
    return null;
  }
  if (!got.fresh || !got.bundle || typeof got.bundle !== 'object') {
    // Stash fingerprint for the miss path so the write stamps the pre-build
    // watermark (same failure direction as Utilization B4).
    RA_RANGE_CACHE_PENDING_FP_ = {
      startYmd: startYmd,
      endYmd: endYmd,
      keyHash: keyHash,
      watermark: got.currentWatermark || null,
      sourceRowCount:
        got.currentRowCount === null || got.currentRowCount === undefined
          ? null
          : Number(got.currentRowCount),
    };
    vizRangeCacheTallyBump_('miss');
    return null;
  }
  var envelope = got.bundle;
  var payload = envelope.payload || null;
  if (
    !payload ||
    payload.ok === false ||
    Number(envelope.envelopeVersion) !== RA_RANGE_CACHE_ENVELOPE_VERSION_
  ) {
    vizRangeCacheTallyBump_('error');
    return null;
  }
  vizRangeCacheTallyBump_('hit');
  RA_RANGE_CACHE_PENDING_FP_ = null;
  payload.loadSource = 'fos_ra_range_cache';
  payload.rangeCacheHit = true;
  if (got.builtAt) {
    payload.rangeCacheBuiltAt = got.builtAt;
  }
  return payload;
}

/**
 * Fingerprint captured on the last cache miss for the current execution.
 * @type {?{startYmd: string, endYmd: string, keyHash: string, watermark: ?string, sourceRowCount: ?number}}
 */
var RA_RANGE_CACHE_PENDING_FP_ = null;

/**
 * Best-effort store of a freshly built payload. Never fails the panel.
 *
 * @param {!Object} panelPayload
 * @return {void}
 */
function putResourceAssignmentRangeCache_(panelPayload) {
  if (!perfFlag_('PERF_USE_RA_RANGE_CACHE')) {
    return;
  }
  if (!panelPayload || panelPayload.ok === false) {
    return;
  }
  if (typeof vizRangeCachePut_ !== 'function') {
    return;
  }
  var startYmd = panelPayload.rangeStart ? String(panelPayload.rangeStart) : '';
  var endYmd = panelPayload.rangeEnd ? String(panelPayload.rangeEnd) : '';
  if (!startYmd || !endYmd) {
    return;
  }
  var pending = RA_RANGE_CACHE_PENDING_FP_;
  var keyHash =
    pending && pending.startYmd === startYmd && pending.endYmd === endYmd
      ? pending.keyHash
      : vizRangeCacheKeyHash_(raRangeCacheKeyInputs_());
  var watermark = pending && pending.watermark ? pending.watermark : null;
  var sourceRowCount =
    pending && pending.sourceRowCount !== undefined ? pending.sourceRowCount : null;
  // If we never probed the cache (force path), read fingerprint once so the
  // entry can still be stamped and later served.
  if (!watermark && typeof supabaseRpc_ === 'function') {
    var probe = vizRangeCacheGet_(
      RA_RANGE_CACHE_PANEL_KEY_,
      { startYmd: startYmd, endYmd: endYmd },
      RESOURCE_ASSIGNMENTS_CACHE_SCHEMA_VERSION_,
      keyHash
    );
    if (probe && probe.ok) {
      watermark = probe.currentWatermark || null;
      sourceRowCount =
        probe.currentRowCount === null || probe.currentRowCount === undefined
          ? null
          : Number(probe.currentRowCount);
    }
  }
  var toStore = raRangeCacheEnvelope_(panelPayload);
  // Do not persist transient serve markers.
  if (toStore.payload) {
    delete toStore.payload.loadSource;
    delete toStore.payload.rangeCacheHit;
    delete toStore.payload.rangeCacheBuiltAt;
  }
  vizRangeCachePut_(
    RA_RANGE_CACHE_PANEL_KEY_,
    { startYmd: startYmd, endYmd: endYmd },
    RESOURCE_ASSIGNMENTS_CACHE_SCHEMA_VERSION_,
    keyHash,
    toStore,
    watermark,
    sourceRowCount
  );
  RA_RANGE_CACHE_PENDING_FP_ = null;
}

/**
 * Warms the default -30/+90 Resource assignments window and GCs stale entries.
 * Prefer a hit from the hydrate step; only rebuild when the cache is cold.
 * Never fails the hydrate run.
 *
 * @return {!{ok: boolean, detail: string}}
 */
function warmResourceAssignmentRangeCache_() {
  if (!perfFlag_('PERF_USE_RA_RANGE_CACHE')) {
    return { ok: true, detail: 'skipped (PERF_USE_RA_RANGE_CACHE off)' };
  }
  var warnings = [];
  var range = resolveResourceAssignmentRangeYmd_(null, null, warnings);
  var cached = tryServeResourceAssignmentFromRangeCache_(range.startYmd, range.endYmd);
  if (!cached) {
    var built = buildResourceAssignmentDashboardPayloadFromSupabaseCore_(null, null);
    if (!built || built.ok === false) {
      return {
        ok: true,
        detail: 'warm build failed: ' + ((built && built.message) || 'unknown'),
      };
    }
    putResourceAssignmentRangeCache_(built);
  }
  var gc =
    typeof vizRangeCacheGc_ === 'function'
      ? vizRangeCacheGc_(RA_RANGE_CACHE_PANEL_KEY_)
      : { ok: false, deleted: 0, remaining: 0 };
  return {
    ok: true,
    detail:
      (cached ? 'ra-warm hit ' : 'ra-warm built ') +
      range.startYmd +
      '..' +
      range.endYmd +
      ' gcDeleted=' +
      (gc.deleted || 0) +
      ' remaining=' +
      (gc.remaining || 0),
  };
}

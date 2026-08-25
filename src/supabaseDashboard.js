/**
 * PRD version 3.14.0 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 036: read/write dashboard panel payloads and status rows in Supabase.
 */

/** @const {string} */
var FOS_PANEL_PAYLOADS_TABLE_ = 'fos_panel_payloads';

/** @const {string} */
var FOS_DELIVERY_PNL_TABLE_ = 'fos_delivery_pnl';

/** @const {string} */
var FOS_STATUS_UPDATES_TABLE_ = 'fos_status_updates';

/** @const {string} */
var FOS_DATASET_AS_OF_TABLE_ = 'fos_dataset_as_of';

/**
 * Panel key to the code constant its stored blob must match.
 *
 * Feature 047 A2: when a stored `cache_schema_version` falls behind its code
 * constant, the blob silently fails the schema gate and that panel falls back
 * to a full typed rebuild on every single load. Resource assignments sat in
 * that state for nine days and nine successful hydrates before anyone noticed,
 * because nothing compared the two numbers. This map is the comparison.
 *
 * @return {!Object<string, number>}
 */
function expectedPanelSchemaVersions_() {
  return {
    agreement: AGREEMENT_DASHBOARD_CACHE_SCHEMA_VERSION_,
    delivery: DELIVERY_DASHBOARD_CACHE_SCHEMA_VERSION_,
    utilization: UTILIZATION_DASHBOARD_CACHE_SCHEMA_VERSION_,
    pipeline: PIPELINE_CACHE_SCHEMA_VERSION_,
    'resource-assignments': RESOURCE_ASSIGNMENTS_CACHE_SCHEMA_VERSION_,
    'ai-usage': AI_USAGE_DASHBOARD_CACHE_SCHEMA_VERSION_,
    'portfolio-pnl': PORTFOLIO_PNL_BUNDLE_CACHE_SCHEMA_VERSION_,
  };
}

/**
 * Compares every stored panel blob's `cache_schema_version` against the code
 * constant and reports the panels that are stale, missing, or ahead.
 *
 * A panel reported here is not broken, but it is slow: it cannot use its
 * hydrated blob and rebuilds from typed tables on every load.
 *
 * @return {!{
 *   ok: boolean,
 *   drift: !Array<!{panel: string, stored: ?number, expected: number, state: string}>,
 *   checked: number,
 *   message?: string
 * }}
 */
function checkPanelSchemaDrift_() {
  var expected = expectedPanelSchemaVersions_();
  var res = supabaseSelect_(
    FOS_PANEL_PAYLOADS_TABLE_,
    null,
    'panel_key,cache_schema_version,synced_at',
    100
  );
  if (!res.ok) {
    return {
      ok: false,
      drift: [],
      checked: 0,
      message: res.message || 'Could not read panel payload versions.',
    };
  }
  var stored = {};
  var rows = res.json || [];
  for (var i = 0; i < rows.length; i++) {
    stored[String(rows[i].panel_key)] = rows[i].cache_schema_version;
  }
  var drift = [];
  var checked = 0;
  for (var panel in expected) {
    if (!Object.prototype.hasOwnProperty.call(expected, panel)) continue;
    checked++;
    var have = Object.prototype.hasOwnProperty.call(stored, panel)
      ? Number(stored[panel])
      : null;
    if (have === null) {
      drift.push({ panel: panel, stored: null, expected: expected[panel], state: 'missing' });
    } else if (have < expected[panel]) {
      drift.push({ panel: panel, stored: have, expected: expected[panel], state: 'stale' });
    } else if (have > expected[panel]) {
      drift.push({ panel: panel, stored: have, expected: expected[panel], state: 'ahead' });
    }
  }
  return { ok: true, drift: drift, checked: checked };
}

/**
 * Logs a warning when a builder stamps a blob with a version this registry does
 * not expect, for example a hardcoded literal left behind after a bump.
 *
 * Deliberately narrow: this canNOT detect a lagging `clasp push`. Both the
 * written version and `expectedPanelSchemaVersions_()` are read from the same
 * running script, so when that script is old they agree with each other and
 * disagree only with git. Nothing inside Apps Script can see git. Use
 * `scripts/check_deployed_matches_git.py` for that; the hydrate records its
 * `scriptVersion` in `fos_sync_runs.summary` so the two can be compared.
 *
 * @param {string} panelKey
 * @param {number} writtenVersion
 * @return {boolean} True when the written version matches expectations.
 */
function assertPanelSchemaVersionFresh_(panelKey, writtenVersion) {
  var expected = expectedPanelSchemaVersions_()[panelKey];
  if (expected === undefined) {
    return true;
  }
  if (Number(writtenVersion) === Number(expected)) {
    return true;
  }
  console.warn(
    'Panel schema drift: hydrate wrote ' +
      panelKey +
      ' at cache_schema_version ' +
      writtenVersion +
      ' but the serve path expects ' +
      expected +
      '. This panel will rebuild from typed tables on every load until the ' +
      'running script version matches git.'
  );
  return false;
}

/**
 * @param {string} panelKey
 * @return {!{
 *   ok: true,
 *   payload: !Object,
 *   asOf: ?string,
 *   syncedAt: ?string
 * }|{
 *   ok: false,
 *   reason: string,
 *   message: string
 * }}
 */
function loadSupabasePanelPayload_(panelKey) {
  var key = String(panelKey || '').trim();
  if (!key) {
    return { ok: false, reason: 'BAD_KEY', message: 'Missing panel key.' };
  }
  var res = supabaseSelect_(
    FOS_PANEL_PAYLOADS_TABLE_,
    { panel_key: 'eq.' + key },
    'panel_key,as_of,synced_at,cache_schema_version,payload',
    1
  );
  if (!res.ok) {
    return res;
  }
  var rows = res.json;
  if (!rows || !rows.length) {
    return {
      ok: false,
      reason: 'SUPABASE_PANEL_MISS',
      message: 'No Supabase payload for ' + key + '. Run Pull from Fibery.',
    };
  }
  var row = rows[0];
  var payload = row.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (e) {
      return {
        ok: false,
        reason: 'SUPABASE_PAYLOAD_PARSE',
        message: 'Corrupt Supabase payload for ' + key + '.',
      };
    }
  }
  if (!payload || typeof payload !== 'object') {
    return {
      ok: false,
      reason: 'SUPABASE_PAYLOAD_EMPTY',
      message: 'Empty Supabase payload for ' + key + '.',
    };
  }
  return {
    ok: true,
    payload: payload,
    asOf: row.as_of || row.synced_at || null,
    syncedAt: row.synced_at || null,
  };
}

/**
 * @param {string} panelKey
 * @param {!Object} payload
 * @param {number=} cacheSchemaVersion
 * @return {!Object}
 */
function saveSupabasePanelPayload_(panelKey, payload, cacheSchemaVersion) {
  var nowIso = new Date().toISOString();
  var row = {
    panel_key: String(panelKey || '').trim(),
    as_of: nowIso,
    synced_at: nowIso,
    cache_schema_version:
      cacheSchemaVersion != null
        ? cacheSchemaVersion
        : payload && payload.cacheSchemaVersion != null
          ? payload.cacheSchemaVersion
          : null,
    payload: payload,
  };
  assertPanelSchemaVersionFresh_(row.panel_key, row.cache_schema_version);
  return supabaseUpsert_(FOS_PANEL_PAYLOADS_TABLE_, [row], 'panel_key');
}

/**
 * @param {string} agreementId
 * @return {!Object}
 */
function loadSupabaseDeliveryPnL_(agreementId) {
  var id = String(agreementId || '').trim();
  if (!id) {
    return { ok: false, reason: 'BAD_ID', message: 'Missing agreement id.' };
  }
  var res = supabaseSelect_(
    FOS_DELIVERY_PNL_TABLE_,
    { agreement_id: 'eq.' + id },
    'agreement_id,agreement_name,as_of,synced_at,cache_schema_version,payload',
    1
  );
  if (!res.ok) {
    return res;
  }
  var rows = res.json;
  if (!rows || !rows.length) {
    return {
      ok: false,
      reason: 'SUPABASE_PNL_MISS',
      message: 'No Supabase Delivery P&L for this project. Run Pull from Fibery.',
    };
  }
  var row = rows[0];
  var payload = row.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (e) {
      return {
        ok: false,
        reason: 'SUPABASE_PAYLOAD_PARSE',
        message: 'Corrupt Supabase Delivery P&L payload.',
      };
    }
  }
  return {
    ok: true,
    payload: payload,
    asOf: row.as_of || row.synced_at || null,
    syncedAt: row.synced_at || null,
  };
}

/**
 * @param {string} agreementId
 * @param {string} agreementName
 * @param {!Object} payload
 * @return {!Object}
 */
function saveSupabaseDeliveryPnL_(agreementId, agreementName, payload) {
  var nowIso = new Date().toISOString();
  var row = {
    agreement_id: String(agreementId || '').trim(),
    agreement_name: String(agreementName || '').slice(0, 240),
    as_of: nowIso,
    synced_at: nowIso,
    cache_schema_version:
      payload && payload.cacheSchemaVersion != null ? payload.cacheSchemaVersion : null,
    payload: payload,
  };
  return supabaseUpsert_(FOS_DELIVERY_PNL_TABLE_, [row], 'agreement_id');
}

/**
 * Tag a served payload as coming from Supabase for FR-120 labels.
 * Customer-facing UI shows Datastore (not the vendor name).
 * `dataAsOf` / `supabaseSyncedAt` = hydrate watermark (moves on Pull).
 * `servedAt` / `fetchedAt` = this HTTP serve (moves on panel Reload).
 *
 * @param {!Object} payload
 * @param {?string} asOfIso
 * @return {!Object}
 */
function tagPayloadFromSupabase_(payload, asOfIso) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }
  var asOf = asOfIso || payload.dataAsOf || payload.supabaseSyncedAt || payload.fetchedAt || new Date().toISOString();
  var dateKey = String(asOf).slice(0, 10);
  var servedAt = new Date().toISOString();
  payload.source = 'supabase';
  payload.loadSource = 'supabase';
  payload.fromSupabase = true;
  payload.fromDrive = false;
  payload.dataAsOf = asOf;
  payload.supabaseSyncedAt = asOf;
  payload.cacheDateKey = dateKey;
  payload.servedAt = servedAt;
  // Back-compat: Last refreshed / TTL helpers historically used fetchedAt.
  payload.fetchedAt = servedAt;
  return payload;
}

/**
 * Live serve failure (no Fibery / Drive warm fallback).
 * @param {string} panelKey
 * @param {?Object} loadResult
 * @param {number=} cacheSchemaVersion
 * @return {!Object}
 */
function supabaseLiveMissPayload_(panelKey, loadResult, cacheSchemaVersion) {
  var configured = isSupabaseConfigured_();
  var reason =
    (loadResult && loadResult.reason) ||
    (configured ? 'SUPABASE_PANEL_MISS' : 'SUPABASE_NOT_CONFIGURED');
  var message =
    (loadResult && loadResult.message) ||
    (configured
      ? 'No Datastore payload for ' +
        panelKey +
        '. Ask an ADMIN to run Pull from Fibery in Settings.'
      : 'Datastore is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Settings.');
  return {
    ok: false,
    source: 'supabase',
    loadSource: 'supabase',
    reason: reason,
    message: message,
    fetchedAt: new Date().toISOString(),
    cacheSchemaVersion: cacheSchemaVersion != null ? cacheSchemaVersion : null,
  };
}

/**
 * Live panel serve: Datastore only. Never falls back to Fibery or Drive rebuild.
 * @param {string} panelKey
 * @param {number=} cacheSchemaVersion
 * @return {!Object}
 */
function serveLivePanelFromSupabaseOrFail_(panelKey, cacheSchemaVersion) {
  if (!isSupabaseConfigured_()) {
    return supabaseLiveMissPayload_(panelKey, null, cacheSchemaVersion);
  }
  var sb = loadSupabasePanelPayload_(panelKey);
  if (sb.ok && sb.payload) {
    return tagPayloadFromSupabase_(sb.payload, sb.asOf || sb.syncedAt);
  }
  return supabaseLiveMissPayload_(panelKey, sb, cacheSchemaVersion);
}

/**
 * @param {?Object} payload
 * @param {number=} expectedSchema
 * @return {boolean}
 * @private
 */
function panelPayloadSchemaMatches_(payload, expectedSchema) {
  if (expectedSchema == null || expectedSchema === undefined) {
    return !!(payload && typeof payload === 'object');
  }
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  return Number(payload.cacheSchemaVersion) === Number(expectedSchema);
}

/**
 * Fingerprint of every ADMIN-tunable input the Agreement / Delivery payload
 * depends on but the typed tables do not carry.
 *
 * Feature 047 B5. The Reload path serves the stored blob instead of rebuilding,
 * which is only sound while nothing that shaped the blob can have changed since
 * it was written. The typed tables cannot change between hydrates (the AM mirror
 * is their only writer). Script Properties can change at any moment, and
 * `getAgreementThresholds_()` feeds `computeKpis_`, `evaluateAlerts_`,
 * `buildChartViewModels_`, `buildFinancialTable_`, and the customer order and
 * palette. So the whole resolved object is hashed and stamped on the blob, and a
 * Reload after an ADMIN retune rebuilds rather than serving numbers computed
 * with the old knobs.
 *
 * Deliberately over-keyed, for the same reason as the B4 range-cache hash: a
 * fingerprint that omitted a threshold which later began feeding a stored field
 * would serve wrong numbers with no symptom, whereas hashing everything costs
 * one rebuild per retune.
 *
 * @return {?string} null when the thresholds cannot be resolved.
 */
function agreementPayloadInputFingerprint_() {
  if (
    typeof getAgreementThresholds_ !== 'function' ||
    typeof vizRangeCacheKeyHash_ !== 'function'
  ) {
    return null;
  }
  try {
    return vizRangeCacheKeyHash_({ agreementThresholds: getAgreementThresholds_() });
  } catch (e) {
    return null;
  }
}

/**
 * Why a stored Agreement / Delivery blob cannot answer this request, or null
 * when it can.
 *
 * `strict` is set only on the Reload path (feature 047 B5). A cold load has
 * always served whatever blob was there, and tightening that here would turn
 * every early-morning first load into a rebuild, which is a behavior change
 * this workstream is not making.
 *
 * @param {?Object} loadResult `loadSupabasePanelPayload_` result
 * @param {number=} expectedSchema
 * @param {boolean=} strict Apply the Reload-only freshness checks.
 * @return {?string}
 * @private
 */
function agreementBlobRebuildReason_(loadResult, expectedSchema, strict) {
  if (!loadResult || !loadResult.ok || !loadResult.payload) {
    return 'blob-missing';
  }
  var payload = loadResult.payload;
  if (!panelPayloadSchemaMatches_(payload, expectedSchema)) {
    return 'schema-mismatch';
  }
  if (strict !== true) {
    return null;
  }
  // The build splits revenue items on `target_date > todayIso` (UTC) and
  // evaluates alerts against its own clock, so a blob built on an earlier UTC
  // day classifies for that day. The hydrate normally writes today's blob
  // before business hours, so in practice this costs at most one rebuild on the
  // first Reload after UTC midnight.
  var builtAt = payload.fetchedAt || loadResult.syncedAt || loadResult.asOf || '';
  var builtDay = String(builtAt).slice(0, 10);
  var todayUtc = new Date().toISOString().slice(0, 10);
  if (!builtDay || builtDay !== todayUtc) {
    return 'built-on-earlier-utc-day';
  }
  // Absent on blobs written before this release. Treated as a match rather than
  // as a rebuild trigger, so the flag still helps for the one hydrate cycle
  // before every blob carries a fingerprint.
  var stamped = payload.thresholdFingerprint;
  if (stamped) {
    var current = agreementPayloadInputFingerprint_();
    if (current && String(stamped) !== String(current)) {
      return 'thresholds-changed';
    }
  }
  return null;
}

/**
 * Live Agreement / Delivery serve: read panel blob, or rebuild both from typed
 * AM tables when Reload is forced, the blob is missing, or schema lags.
 * Does not call Fibery.
 *
 * Feature 047 B5: with `PERF_RELOAD_REREADS_BLOB` on, a forced Reload re-reads
 * the stored blob instead of rebuilding it. Measured from the 2026-08-25
 * hydrate, the rebuild is about 4.6 seconds of work over seven PostgREST round
 * trips, and it reads `fos_agreements`, `fos_companies`, `fos_company_segments`,
 * `fos_revenue_items`, and `fos_clockify_users`, whose only writer is the AM
 * mirror inside the nightly hydrate. So between hydrates it re-derives the same
 * numbers from the same rows and charges the user for it.
 *
 * That also makes the freshness label honest rather than less honest: the
 * rebuild stamps `dataAsOf` with the rebuild time, which claims the data is
 * newer than the upstream mirror actually is, while the blob re-read reports the
 * hydrate time the data really came from. The button already reads **Reload**
 * and already promises "Does not pull Fibery", so this aligns the code with the
 * promise the UI makes.
 *
 * @param {string} panelKey `agreement` or `delivery`
 * @param {number} expectedSchema
 * @param {boolean=} forceRefresh
 * @return {!Object}
 */
function serveLiveAgreementFamilyOrRebuild_(panelKey, expectedSchema, forceRefresh) {
  var key = String(panelKey || '').trim();
  if (!isSupabaseConfigured_()) {
    return supabaseLiveMissPayload_(key, null, expectedSchema);
  }

  var forced = forceRefresh === true;
  var rereadOnReload =
    forced && typeof perfFlag_ === 'function' && perfFlag_('PERF_RELOAD_REREADS_BLOB');
  var reason = forced && !rereadOnReload ? 'reload-forced-rebuild' : null;

  if (!reason) {
    var existing = loadSupabasePanelPayload_(key);
    reason = agreementBlobRebuildReason_(existing, expectedSchema, rereadOnReload);
    if (!reason) {
      // `loadSource` stays `supabase` on purpose. The client reads it through
      // `isDatastorePayload_` and `loadSourceFromPayload_` to pick the Reload
      // chrome and the "Data as of" label, so a new value here would change the
      // panel header. The path is reported in additive fields instead.
      var served = tagPayloadFromSupabase_(
        existing.payload,
        existing.asOf || existing.syncedAt
      );
      served.reloadPath = forced ? 'blob-reread' : 'blob';
      served.reloadRebuildReason = null;
      return served;
    }
  }

  if (typeof rebuildAgreementDeliveryPanelsFromTyped_ !== 'function') {
    return serveLivePanelFromSupabaseOrFail_(key, expectedSchema);
  }

  var rebuilt = rebuildAgreementDeliveryPanelsFromTyped_();
  if (rebuilt && rebuilt.ok) {
    var fresh = key === 'delivery' ? rebuilt.delivery : rebuilt.agreement;
    if (fresh && typeof fresh === 'object') {
      var tagged = tagPayloadFromSupabase_(
        fresh,
        fresh.dataAsOf || fresh.fetchedAt || null
      );
      tagged.reloadPath = 'rebuild';
      tagged.reloadRebuildReason = reason;
      return tagged;
    }
  }

  var stale = loadSupabasePanelPayload_(key);
  if (stale.ok && stale.payload) {
    var staleTagged = tagPayloadFromSupabase_(stale.payload, stale.asOf || stale.syncedAt);
    var warn =
      'Typed rebuild failed; serving stale ' +
      key +
      ' panel' +
      (rebuilt && rebuilt.message ? ' (' + rebuilt.message + ')' : '') +
      '.';
    staleTagged.warnings = (staleTagged.warnings || []).concat([warn]);
    staleTagged.reloadPath = 'rebuild-failed-stale-blob';
    staleTagged.reloadRebuildReason = reason;
    return staleTagged;
  }

  return supabaseLiveMissPayload_(
    key,
    {
      reason: 'SUPABASE_REBUILD_FAILED',
      message:
        (rebuilt && rebuilt.message) ||
        'Could not rebuild ' + key + ' from typed Datastore tables.',
    },
    expectedSchema
  );
}

/**
 * Live Delivery project P&L: Datastore only.
 * @param {string} agreementId
 * @param {number=} cacheSchemaVersion
 * @return {!Object}
 */
function serveLiveDeliveryPnLFromSupabaseOrFail_(agreementId, cacheSchemaVersion) {
  var id = String(agreementId || '').trim();
  if (!id) {
    return supabaseLiveMissPayload_('delivery-pnl', {
      reason: 'BAD_AGREEMENT_ID',
      message: 'Missing agreement id.',
    }, cacheSchemaVersion);
  }
  if (!isSupabaseConfigured_()) {
    return supabaseLiveMissPayload_('delivery-pnl', null, cacheSchemaVersion);
  }
  var sb = loadSupabaseDeliveryPnL_(id);
  if (sb.ok && sb.payload) {
    return tagPayloadFromSupabase_(sb.payload, sb.asOf || sb.syncedAt);
  }
  return supabaseLiveMissPayload_(
    'delivery-pnl',
    sb || {
      reason: 'SUPABASE_PNL_MISS',
      message:
        'No Datastore P&L for this project. Ask an ADMIN to run Pull from Fibery in Settings.',
    },
    cacheSchemaVersion
  );
}

/**
 * True when a fos_delivery_pnl payload is suitable for the Delivery chart
 * (Allocated cost plan line needs `resourceAllocations`, not portfolioMode).
 * @param {?Object} payload
 * @param {number=} expectedSchema
 * @return {boolean}
 */
function isFullDeliveryPnLPayload_(payload, expectedSchema) {
  if (!payload || typeof payload !== 'object' || payload.ok === false) {
    return false;
  }
  if (payload.portfolioMode === true) {
    return false;
  }
  if (!payload.resourceAllocations || typeof payload.resourceAllocations !== 'object') {
    return false;
  }
  if (expectedSchema != null && expectedSchema !== undefined) {
    if (Number(payload.cacheSchemaVersion) !== Number(expectedSchema)) {
      return false;
    }
  }
  return true;
}

/**
 * Live Delivery P&L: serve a full (non-portfolioMode) row, or rebuild from
 * typed tables and upsert so Allocated cost (plan) is not lost after Portfolio
 * hydrate wrote a slim blob.
 *
 * @param {string} agreementId
 * @param {number=} cacheSchemaVersion
 * @param {boolean=} forceRefresh
 * @return {!Object}
 */
function serveLiveDeliveryPnLOrRebuildFull_(agreementId, cacheSchemaVersion, forceRefresh) {
  var id = String(agreementId || '').trim();
  var expected =
    cacheSchemaVersion != null
      ? cacheSchemaVersion
      : typeof DELIVERY_PNL_CACHE_SCHEMA_VERSION_ !== 'undefined'
        ? DELIVERY_PNL_CACHE_SCHEMA_VERSION_
        : null;
  if (!id) {
    return supabaseLiveMissPayload_('delivery-pnl', {
      reason: 'BAD_AGREEMENT_ID',
      message: 'Missing agreement id.',
    }, expected);
  }
  if (!isSupabaseConfigured_()) {
    return supabaseLiveMissPayload_('delivery-pnl', null, expected);
  }

  var needRebuild = forceRefresh === true;
  if (!needRebuild) {
    var existing = loadSupabaseDeliveryPnL_(id);
    if (existing.ok && isFullDeliveryPnLPayload_(existing.payload, expected)) {
      return tagPayloadFromSupabase_(existing.payload, existing.asOf || existing.syncedAt);
    }
    needRebuild = true;
  }

  if (typeof buildDeliveryProjectMonthlyPnLFromSupabase_ !== 'function') {
    return serveLiveDeliveryPnLFromSupabaseOrFail_(id, expected);
  }

  var rebuilt = buildDeliveryProjectMonthlyPnLFromSupabase_(id, { portfolioMode: false });
  if (rebuilt && rebuilt.ok !== false) {
    var name = rebuilt.agreementName || '';
    try {
      saveSupabaseDeliveryPnL_(id, name, rebuilt);
    } catch (e) {
      supabaseWarn_('save full delivery P&L after rebuild', e);
    }
    return tagPayloadFromSupabase_(rebuilt, rebuilt.dataAsOf || rebuilt.fetchedAt || null);
  }

  var stale = loadSupabaseDeliveryPnL_(id);
  if (stale.ok && stale.payload) {
    var tagged = tagPayloadFromSupabase_(stale.payload, stale.asOf || stale.syncedAt);
    var warn =
      'Full Delivery P&L rebuild failed; serving stored row' +
      (rebuilt && rebuilt.message ? ' (' + rebuilt.message + ')' : '') +
      '.';
    tagged.warnings = (tagged.warnings || []).concat([warn]);
    return tagged;
  }

  return supabaseLiveMissPayload_(
    'delivery-pnl',
    {
      reason: 'SUPABASE_PNL_REBUILD_FAILED',
      message:
        (rebuilt && rebuilt.message) ||
        'Could not rebuild Delivery P&L from typed Datastore tables.',
    },
    expected
  );
}

/**
 * Upsert a status update row after Fibery dual-write success.
 * @param {!Object} statusRow normalizeStatusUpdateRow_ shape
 * @param {string} agreementId
 * @return {!Object}
 */
function upsertSupabaseStatusUpdate_(statusRow, agreementId) {
  if (!statusRow || !statusRow.id) {
    return { ok: false, reason: 'BAD_ROW', message: 'Missing status update id.' };
  }
  var nowIso = new Date().toISOString();
  var row = {
    fibery_id: String(statusRow.id),
    agreement_id: String(agreementId || statusRow.agreementId || ''),
    status_key: String(statusRow.agreementStatus || statusRow.statusKey || ''),
    status_label: String(statusRow.agreementStatus || statusRow.statusLabel || '').slice(0, 240),
    content: String(statusRow.updatePlain || statusRow.content || '').slice(0, 10000),
    created_at: statusRow.createdAt || statusRow.timestamp || nowIso,
    author_email: String(statusRow.submittedBy || statusRow.authorEmail || '').slice(0, 320),
    synced_at: nowIso,
    raw: statusRow,
  };
  return supabaseUpsert_(FOS_STATUS_UPDATES_TABLE_, [row], 'fibery_id');
}

/**
 * @param {string} datasetKey
 * @param {string=} asOfIso
 * @return {!Object}
 */
function upsertSupabaseDatasetAsOf_(datasetKey, asOfIso) {
  var nowIso = asOfIso || new Date().toISOString();
  return supabaseUpsert_(
    FOS_DATASET_AS_OF_TABLE_,
    [
      {
        dataset_key: String(datasetKey || '').trim(),
        as_of: nowIso,
        updated_at: nowIso,
      },
    ],
    'dataset_key'
  );
}

/**
 * Enqueue dual-write retry when Supabase fails after Fibery success.
 * @param {!Object} statusRow
 * @param {string} agreementId
 * @param {string} errMsg
 */
function enqueueSupabaseStatusRetry_(statusRow, agreementId, errMsg) {
  try {
    var props = PropertiesService.getScriptProperties();
    var raw = props.getProperty('SUPABASE_STATUS_RETRY_QUEUE') || '[]';
    var queue = [];
    try {
      queue = JSON.parse(raw);
    } catch (_) {
      queue = [];
    }
    if (!Array.isArray(queue)) {
      queue = [];
    }
    queue.push({
      at: new Date().toISOString(),
      agreementId: agreementId,
      statusId: statusRow && statusRow.id ? statusRow.id : null,
      error: String(errMsg || '').slice(0, 400),
      row: statusRow,
    });
    if (queue.length > 100) {
      queue = queue.slice(queue.length - 100);
    }
    props.setProperty('SUPABASE_STATUS_RETRY_QUEUE', JSON.stringify(queue));
  } catch (e) {
    supabaseWarn_('enqueue status retry failed', e);
  }
}

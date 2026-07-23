/**
 * PRD version 3.0.12 - sync with docs/FOS-Dashboard-PRD.md
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

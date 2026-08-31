/**
 * PRD version 3.20.14 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 036 cutover: Fibery -> Supabase hydrate (nightly + ADMIN Pull).
 * Dataset am-mirror (supabaseAmMirror.js) hydrates Agreement Management typed
 * tables FIRST; panel blobs are then built by reading those typed tables
 * (`supabasePanelBuilders.js`) instead of aggregating live Fibery queries.
 * Labor facts are never re-derived from Fibery here - Utilization and every
 * P&L / resource-assignment builder read `fos_labor_costs` (Clockify-owned).
 * HubSpot deals and AI usage rows are full-replace mirrored from Fibery
 * immediately before their panel build (see hydrateSupabasePipeline_ /
 * hydrateSupabaseAiUsage_) since there is no dedicated AM-mirror step for
 * those two Fibery databases.
 */

/** @const {number} */
var SUPABASE_SYNC_TIME_BUDGET_MS_ = 270000;

/** @const {number} */
var SUPABASE_SYNC_LOCK_WAIT_MS_ = 5000;

/** @const {string} */
var SUPABASE_SYNC_STATE_PROP_ = 'SUPABASE_SYNC_STATE_V1';

/** @const {!Array<string>} */
var SUPABASE_SYNC_DATASETS_ = [
  // Relational Agreement Management mirror first, then panel JSON blobs.
  // am-mirror is multi-page; processSupabaseSyncBatch_ honors result.continue.
  'am-mirror',
  'agreement',
  'utilization',
  'pipeline',
  'resource-assignments',
  'ai-usage',
  'portfolio-pnl',
  // Feature 047 B4. Last, and deliberately so: it reads the same labor and
  // dimension tables the steps above have just finished writing, and its only
  // product is a cache, so nothing downstream depends on it.
  'viz-warm',
];

/**
 * @return {boolean}
 */
function supabaseSyncIsEnabled_() {
  var raw = PropertiesService.getScriptProperties().getProperty('SUPABASE_SYNC_ENABLED');
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return true;
  }
  var v = String(raw).trim().toLowerCase();
  return !(v === 'false' || v === 'no' || v === '0');
}

/**
 * @return {number}
 */
function supabaseSyncBatchSize_() {
  var n = parseInt(
    PropertiesService.getScriptProperties().getProperty('SUPABASE_SYNC_BATCH_SIZE') || '1',
    10
  );
  if (isNaN(n) || n < 1) {
    return 1;
  }
  if (n > 3) {
    return 3;
  }
  return n;
}

/**
 * Scheduled entry (install via installSupabaseSyncTrigger_).
 */
function runDailySupabaseSync_() {
  if (!supabaseSyncIsEnabled_()) {
    console.warn('supabaseSync: disabled; skipping nightly run');
    return;
  }
  startSupabaseSync_('scheduled');
}

/**
 * ADMIN Settings: start a full hydrate.
 * @return {!Object}
 */
function runSupabaseSyncForSettings() {
  var auth = requireAuthForApi_();
  requireAdminRole_(auth);
  if (!supabaseSyncIsEnabled_()) {
    return { ok: false, message: 'Supabase sync is disabled (SUPABASE_SYNC_ENABLED=false).' };
  }
  if (!isSupabaseConfigured_()) {
    return { ok: false, message: 'Supabase URL/key not configured.' };
  }
  // Self-heal: first/any Pull installs (or refreshes) the nightly hydrate trigger.
  try {
    installSupabaseSyncTrigger_();
  } catch (e) {
    supabaseWarn_('installSupabaseSyncTrigger_ during Pull', e);
  }
  return startSupabaseSync_('manual');
}

/**
 * ADMIN Settings: status + last run.
 * @return {!Object}
 */
function getSupabaseSyncStatus() {
  try {
    var auth = requireAuthForApi_();
    requireAdminRole_(auth);
  } catch (e) {
    var msg = e && e.message ? e.message : String(e);
    if (msg === 'NOT_AUTHORIZED' || msg === 'FORBIDDEN') {
      return { ok: false, message: 'Administrator access required.' };
    }
    throw e;
  }
  var state = readSupabaseSyncState_();
  var ping = supabasePing_();
  var nightly = getSupabaseNightlyTriggerStatus_();
  // Feature 047 A2: surface stale panel blobs. A drifted panel still renders,
  // so this is the only place an operator can see that it has quietly been
  // rebuilding from typed tables on every load.
  var schemaDrift = { ok: false, drift: [], checked: 0 };
  if (isSupabaseConfigured_()) {
    try {
      schemaDrift = checkPanelSchemaDrift_();
    } catch (e) {
      schemaDrift = {
        ok: false,
        drift: [],
        checked: 0,
        message: 'Schema drift check failed.',
      };
    }
  }
  return {
    ok: true,
    syncEnabled: supabaseSyncIsEnabled_(),
    configured: isSupabaseConfigured_(),
    readSource: dashboardReadSource_(),
    ping: ping,
    state: state,
    lastRun: state
      ? {
          status: state.status || null,
          startedAt: state.startedAt || null,
          finishedAt: state.finishedAt || null,
          durationMs: state.durationMs != null ? state.durationMs : null,
          lastError: state.lastError || null,
          scriptVersion: state.scriptVersion || null,
          datasetsDone: state.datasetsDone != null ? state.datasetsDone : null,
          datasetsTotal: state.datasetsTotal != null ? state.datasetsTotal : null,
          resumeEligible: !!state.resumeEligible,
        }
      : null,
    nightlyTrigger: nightly,
    schemaDrift: schemaDrift,
    perfFlags: perfFlagsSnapshot_(),
  };
}

/**
 * @return {!{ installed: boolean, handler: string, hour: number, count: number }}
 */
function getSupabaseNightlyTriggerStatus_() {
  var hour = parseInt(
    PropertiesService.getScriptProperties().getProperty('SUPABASE_SYNC_TRIGGER_HOUR') ||
      '4',
    10
  );
  if (isNaN(hour) || hour < 0 || hour > 23) {
    hour = 4;
  }
  var count = 0;
  try {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'runDailySupabaseSync_') {
        count++;
      }
    }
  } catch (_) {
    /* ignore */
  }
  return {
    installed: count > 0,
    handler: 'runDailySupabaseSync_',
    hour: hour,
    count: count,
  };
}

/**
 * @param {string} triggerKind
 * @return {!Object}
 */
function startSupabaseSync_(triggerKind) {
  if (!isSupabaseConfigured_()) {
    return { ok: false, message: 'Supabase is not configured.' };
  }
  var lock = LockService.getScriptLock();
  if (lock) {
    try {
      if (!lock.tryLock(SUPABASE_SYNC_LOCK_WAIT_MS_)) {
        return { ok: false, message: 'Another Supabase sync is already running.' };
      }
    } catch (_) {
      /* proceed */
    }
  }
  try {
    var existing = readSupabaseSyncState_();
    if (existing && existing.status === 'running') {
      return {
        ok: false,
        message: 'Supabase sync already in progress.',
        state: existing,
      };
    }
    var resume = supabaseSyncShouldResume_(existing);
    var runId =
      'supabase:' + new Date().toISOString() + ':' + Utilities.getUuid().slice(0, 8);
    var state;
    if (resume) {
      state = existing;
      state.runId = runId;
      if (!state.reconcileRunId) {
        state.reconcileRunId = existing.runId || runId;
      }
      state.trigger = triggerKind || 'manual';
      state.status = 'running';
      state.scriptVersion = typeof FOS_PRD_VERSION !== 'undefined' ? FOS_PRD_VERSION : null;
      state.startedAt = new Date().toISOString();
      state.finishedAt = null;
      state.lastError = null;
      state.resumeEligible = false;
      state.notes = state.notes || [];
      state.notes.push(
        'resuming from dataset ' +
          (state.datasets[state.datasetIndex] || '?') +
          (state.amMirror
            ? ' Â· am-mirror step ' + state.amMirror.stepIndex + ' offset ' + state.amMirror.offset
            : '')
      );
    } else {
      state = {
        runId: runId,
        reconcileRunId: runId,
        trigger: triggerKind || 'manual',
        status: 'running',
        scriptVersion: typeof FOS_PRD_VERSION !== 'undefined' ? FOS_PRD_VERSION : null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        datasetIndex: 0,
        datasets: SUPABASE_SYNC_DATASETS_.slice(),
        datasetsDone: 0,
        datasetsTotal: SUPABASE_SYNC_DATASETS_.length,
        notes: [],
        lastError: null,
        resumeEligible: false,
      };
      resetAmMirrorCursor_(state);
    }
    writeSupabaseSyncState_(state);
    insertSupabaseSyncRunRow_(state, 'running');
    scheduleSupabaseSyncContinuation_(500);
    return {
      ok: true,
      message: resume ? 'Supabase sync resumed.' : 'Supabase sync started.',
      state: state,
    };
  } finally {
    try {
      if (lock) {
        lock.releaseLock();
      }
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * Feature 047 C4: resume a failed hydrate from the saved dataset / am-mirror cursor
 * unless forced full or the failure is stale.
 * @param {?Object} existing
 * @return {boolean}
 * @private
 */
function supabaseSyncShouldResume_(existing) {
  if (!existing || existing.status !== 'failed' || !existing.resumeEligible) {
    return false;
  }
  var force = PropertiesService.getScriptProperties().getProperty('SUPABASE_SYNC_FORCE_FULL');
  if (force && /^(true|1|yes)$/i.test(String(force).trim())) {
    return false;
  }
  if (existing.finishedAt) {
    try {
      var ageMs = Date.now() - new Date(existing.finishedAt).getTime();
      if (ageMs > 24 * 60 * 60 * 1000) {
        return false;
      }
    } catch (_) {
      /* ignore */
    }
  }
  if (!Array.isArray(existing.datasets) || !existing.datasets.length) {
    return false;
  }
  if (typeof existing.datasetIndex !== 'number' || existing.datasetIndex < 0) {
    return false;
  }
  return true;
}

/**
 * Continuation worker (trigger target).
 */
function processSupabaseSyncBatch_() {
  if (!supabaseSyncIsEnabled_()) {
    finishSupabaseSync_('cancelled', 'Sync disabled mid-run.');
    return;
  }
  var lock = LockService.getScriptLock();
  var acquired = false;
  if (lock) {
    try {
      acquired = lock.tryLock(SUPABASE_SYNC_LOCK_WAIT_MS_);
    } catch (_) {
      acquired = false;
    }
  }
  if (!acquired) {
    scheduleSupabaseSyncContinuation_(15000);
    return;
  }
  var started = Date.now();
  try {
    var state = readSupabaseSyncState_();
    if (!state || state.status !== 'running') {
      return;
    }
    var batchSize = supabaseSyncBatchSize_();
    var processed = 0;
    while (
      processed < batchSize &&
      state.datasetIndex < state.datasets.length &&
      Date.now() - started < SUPABASE_SYNC_TIME_BUDGET_MS_
    ) {
      var key = state.datasets[state.datasetIndex];
      var result = hydrateSupabaseDataset_(key, state);
      if (!result.ok) {
        state.lastError = result.message || 'Dataset failed: ' + key;
        state.notes.push(key + ': ' + state.lastError);
        writeSupabaseSyncState_(state);
        finishSupabaseSync_('failed', state.lastError);
        return;
      }
      if (result.continue) {
        // Keep a single rolling progress note so Script Properties stay under size limits.
        var progress = key + ': ' + (result.detail || 'in progress');
        if (
          state.notes.length &&
          String(state.notes[state.notes.length - 1]).indexOf(key + ':') === 0
        ) {
          state.notes[state.notes.length - 1] = progress;
        } else {
          state.notes.push(progress);
        }
        writeSupabaseSyncState_(state);
        processed++;
        continue;
      }
      state.notes.push(key + ': ok' + (result.detail ? ' (' + result.detail + ')' : ''));
      state.datasetIndex++;
      state.datasetsDone = state.datasetIndex;
      writeSupabaseSyncState_(state);
      upsertSupabaseDatasetAsOf_(key, new Date().toISOString());
      processed++;
    }
    if (state.datasetIndex >= state.datasets.length) {
      finishSupabaseSync_('complete', 'All datasets hydrated.');
      return;
    }
    scheduleSupabaseSyncContinuation_(1000);
  } catch (e) {
    var em = e && e.message ? e.message : String(e);
    finishSupabaseSync_('failed', em);
  } finally {
    try {
      if (lock) {
        lock.releaseLock();
      }
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * @param {string} datasetKey
 * @param {!Object=} syncState Running sync state (required for am-mirror cursor).
 * @return {!{ ok: boolean, message?: string, detail?: string, continue?: boolean }}
 */
function hydrateSupabaseDataset_(datasetKey, syncState) {
  switch (datasetKey) {
    case 'am-mirror':
      return hydrateSupabaseAmMirror_(syncState || {});
    case 'agreement':
      return hydrateSupabaseAgreement_();
    case 'utilization':
      return hydrateSupabaseUtilization_();
    case 'pipeline':
      return hydrateSupabasePipeline_();
    case 'resource-assignments':
      return hydrateSupabaseResourceAssignments_();
    case 'ai-usage':
      return hydrateSupabaseAiUsage_();
    case 'portfolio-pnl':
      return hydrateSupabasePortfolio_();
    case 'viz-warm':
      return hydrateSupabaseVizRangeCache_();
    default:
      return { ok: false, message: 'Unknown dataset: ' + datasetKey };
  }
}

/** @return {!Object} */
function rebuildAgreementDeliveryPanelsFromTyped_() {
  var built = buildAgreementDashboardPayloadFromSupabase_();
  if (!built || built.ok === false) {
    return {
      ok: false,
      message: (built && built.message) || 'Agreement Supabase build failed.',
    };
  }
  // Feature 047 B5: stamped here rather than in the builder because this is the
  // only writer of the `agreement` and `delivery` blobs, so one line covers both
  // and the builders stay usable by anything that does not persist.
  // `serveLiveAgreementFamilyOrRebuild_` compares it before serving a stored
  // blob on Reload, so an ADMIN threshold retune still rebuilds.
  var inputFingerprint =
    typeof agreementPayloadInputFingerprint_ === 'function'
      ? agreementPayloadInputFingerprint_()
      : null;
  if (inputFingerprint) {
    built.thresholdFingerprint = inputFingerprint;
  }
  var save = saveSupabasePanelPayload_(
    'agreement',
    built,
    built.cacheSchemaVersion
  );
  if (!save.ok) {
    return {
      ok: false,
      message: save.message || 'Agreement upsert failed.',
      agreement: built,
    };
  }
  var delivery = null;
  try {
    delivery = buildDeliveryDashboardPayloadFromAgreement_(built);
    if (delivery && delivery.ok !== false) {
      if (inputFingerprint) {
        delivery.thresholdFingerprint = inputFingerprint;
      }
      saveSupabasePanelPayload_(
        'delivery',
        delivery,
        delivery.cacheSchemaVersion
      );
    }
  } catch (e) {
    supabaseWarn_('delivery derive during typed rebuild', e);
    return {
      ok: false,
      message: (e && e.message) || String(e),
      agreement: built,
    };
  }
  return { ok: true, agreement: built, delivery: delivery };
}

/** @return {!Object} */
function hydrateSupabaseAgreement_() {
  var rebuilt = rebuildAgreementDeliveryPanelsFromTyped_();
  if (!rebuilt.ok) {
    return {
      ok: false,
      message: rebuilt.message || 'Agreement Supabase build failed.',
    };
  }
  return { ok: true, detail: 'agreement+delivery' };
}

/** @return {!Object} */
function hydrateSupabaseUtilization_() {
  // Keep the panel blob on the default range (UTILIZATION_DEFAULT_RANGE_DAYS).
  // A MAX_RANGE / YTD-sized JSON upsert times out in Postgres. Live Utilization
  // already honors the date picker via fos_labor_costs (getUtilizationDashboardData);
  // this hydrate feeds alert digests + fallback only.
  var built = buildUtilizationDashboardPayloadFromSupabase_(null, null);
  if (!built || built.ok === false) {
    return {
      ok: false,
      message: (built && built.message) || 'Utilization Supabase build failed.',
    };
  }
  if (!built.dataWindow && built.range) {
    built.dataWindow = { start: built.range.start, end: built.range.end };
  }
  var save = saveSupabasePanelPayload_(
    'utilization',
    built,
    built.cacheSchemaVersion
  );
  return save.ok
    ? { ok: true, detail: 'default-range panel blob' }
    : { ok: false, message: save.message || 'Utilization upsert failed.' };
}

/** @return {!Object} */
function hydrateSupabasePipeline_() {
  // No AM-mirror step covers HubSpot/Deal; full-replace mirror it here,
  // immediately before building the panel from fos_hubspot_deals.
  var mirrored = mirrorHubspotDealsToSupabase_();
  if (!mirrored.ok) {
    return { ok: false, message: mirrored.message || 'HubSpot deal mirror failed.' };
  }
  var built = buildPipelineDashboardPayloadFromSupabase_();
  if (!built || built.ok === false) {
    return {
      ok: false,
      message: (built && built.message) || 'Pipeline Supabase build failed.',
    };
  }
  var save = saveSupabasePanelPayload_('pipeline', built, built.cacheSchemaVersion);
  return save.ok
    ? { ok: true, detail: 'hubspotDeals=' + mirrored.count }
    : { ok: false, message: save.message || 'Pipeline upsert failed.' };
}

/** @return {!Object} */
function hydrateSupabaseResourceAssignments_() {
  var built = buildResourceAssignmentDashboardPayloadFromSupabase_(null, null);
  if (!built || built.ok === false) {
    return {
      ok: false,
      message: (built && built.message) || 'Resource assignments Supabase build failed.',
    };
  }
  var save = saveSupabasePanelPayload_(
    'resource-assignments',
    built,
    built.cacheSchemaVersion
  );
  return save.ok
    ? { ok: true }
    : { ok: false, message: save.message || 'Resource assignments upsert failed.' };
}

/** @return {!Object} */
function hydrateSupabaseAiUsage_() {
  // No AM-mirror step covers Claude API Costs; full-replace mirror it here,
  // immediately before building the panel from fos_ai_usage_rows.
  var mirrored = mirrorAiUsageRowsFromFibery_();
  if (!mirrored.ok) {
    return { ok: false, message: mirrored.message || 'AI usage row mirror failed.' };
  }
  var built = buildAiUsagePayloadFromSupabase_(null, null);
  if (!built || built.ok === false) {
    return {
      ok: false,
      message: (built && built.message) || 'AI Usage Supabase build failed.',
    };
  }
  var save = saveSupabasePanelPayload_('ai-usage', built, built.cacheSchemaVersion);
  return save.ok
    ? { ok: true, detail: 'aiUsageRows=' + mirrored.count }
    : { ok: false, message: save.message || 'AI Usage upsert failed.' };
}

/** @return {!Object} */
function hydrateSupabasePortfolio_() {
  if (typeof buildPortfolioPnlBundleFromSupabase_ !== 'function') {
    return { ok: false, message: 'Portfolio builder not found.' };
  }
  var built = buildPortfolioPnlBundleFromSupabase_();
  if (!built || built.ok === false) {
    return {
      ok: false,
      message: (built && built.message) || 'Portfolio Supabase build failed.',
    };
  }
  var save = saveSupabasePanelPayload_(
    'portfolio-pnl',
    built,
    built.cacheSchemaVersion
  );
  if (!save.ok) {
    return { ok: false, message: save.message || 'Portfolio upsert failed.' };
  }
  var pnlById = built.pnlById || built.projectsById || null;
  // Do NOT upsert portfolioMode (slim) P&L rows into fos_delivery_pnl.
  // Delivery Live needs full payloads with resourceAllocations for the
  // Allocated cost (plan) chart line; overwriting with slim rows cleared it.
  // Portfolio serves from the portfolio-pnl panel blob (pnlById embedded).
  var embedded = 0;
  if (pnlById && typeof pnlById === 'object') {
    for (var id in pnlById) {
      if (!Object.prototype.hasOwnProperty.call(pnlById, id)) continue;
      if (pnlById[id] && typeof pnlById[id] === 'object') embedded++;
    }
  }
  return { ok: true, detail: 'portfolioBlob + embeddedPnl=' + embedded };
}

/**
 * Feature 047 B4. Warms the range-keyed visualization cache for the rolling
 * Utilization presets and drops entries the hydrate just invalidated.
 *
 * **Never fails the run.** A cache warm is an optimization with no downstream
 * consumer, so a warm failure is recorded as a note and the hydrate is still
 * reported complete. Marking a 60-minute hydrate failed because a cache did not
 * fill would be a worse outcome than a cold cache, and it would also mask the
 * real failures workstream C is meant to start alerting on.
 *
 * @return {!Object}
 */
function hydrateSupabaseVizRangeCache_() {
  var parts = [];
  if (perfFlag_('PERF_USE_RANGE_CACHE')) {
    var res;
    try {
      res = warmUtilizationRangeCache_();
    } catch (e) {
      supabaseWarn_('viz-warm', e);
      parts.push('util warm threw: ' + ((e && e.message) || String(e)));
      res = null;
    }
    if (res && res.ok) {
      parts.push(res.detail || 'util warm ok');
    } else if (res) {
      parts.push('util warm skipped: ' + (res.message || 'unknown'));
    }
  } else {
    parts.push('util skipped (PERF_USE_RANGE_CACHE off)');
  }
  if (typeof warmResourceAssignmentRangeCache_ === 'function') {
    var ra;
    try {
      ra = warmResourceAssignmentRangeCache_();
    } catch (e2) {
      supabaseWarn_('ra-warm', e2);
      parts.push('ra warm threw: ' + ((e2 && e2.message) || String(e2)));
      ra = null;
    }
    if (ra && ra.ok) {
      parts.push(ra.detail || 'ra warm ok');
    } else if (ra) {
      parts.push('ra warm skipped: ' + ((ra && ra.detail) || 'unknown'));
    }
  }
  return { ok: true, detail: parts.join('; ') };
}

/**
 * @param {string} status
 * @param {string} note
 */
function finishSupabaseSync_(status, note) {
  var state = readSupabaseSyncState_() || {};
  state.status = status;
  state.finishedAt = new Date().toISOString();
  if (note) {
    state.notes = state.notes || [];
    state.notes.push(note);
  }
  if (state.startedAt) {
    try {
      state.durationMs =
        new Date(state.finishedAt).getTime() - new Date(state.startedAt).getTime();
    } catch (_) {
      state.durationMs = null;
    }
  }
  if (status === 'failed') {
    // C4: keep datasetIndex + amMirror so the next trigger can resume.
    state.resumeEligible = true;
  } else {
    state.resumeEligible = false;
    if (status === 'complete' || status === 'cancelled') {
      state.amMirror = null;
    }
  }
  writeSupabaseSyncState_(state);
  insertSupabaseSyncRunRow_(state, status);
  deleteSupabaseSyncContinuationTriggers_();
  if (status === 'complete' || status === 'cancelled') {
    try {
      amMirrorGcReconcileSnapshots_(state.reconcileRunId || state.runId || null);
    } catch (e) {
      supabaseWarn_('finishSupabaseSync_ reconcile gc', e);
    }
  }
  if (status === 'failed') {
    try {
      notifyAdminsHydrateFailed_(state, note || state.lastError || 'Hydrate failed.');
    } catch (e) {
      try {
        console.warn('notifyAdminsHydrateFailed_: ' + (e && e.message ? e.message : e));
      } catch (_) {
        /* ignore */
      }
    }
  }
}

/**
 * Feature 047 C3: email ADMIN users and append Notification Log on hydrate failure.
 * @param {!Object} state
 * @param {string} note
 * @private
 */
function notifyAdminsHydrateFailed_(state, note) {
  var emails =
    typeof listAdminEmailsFromUsersSheet_ === 'function' ? listAdminEmailsFromUsersSheet_() : [];
  if (!emails.length) {
    try {
      console.warn('notifyAdminsHydrateFailed_: no ADMIN emails on Users sheet');
    } catch (_) {
      /* ignore */
    }
    return;
  }
  var durationLabel =
    state.durationMs != null && isFinite(Number(state.durationMs))
      ? Math.round(Number(state.durationMs) / 1000) + 's'
      : 'n/a';
  var subject = 'FinOps Datastore hydrate failed';
  var summary =
    'runId=' +
    (state.runId || '') +
    ' Â· scriptVersion=' +
    (state.scriptVersion || '') +
    ' Â· datasets=' +
    (state.datasetsDone != null ? state.datasetsDone : '?') +
    '/' +
    (state.datasetsTotal != null ? state.datasetsTotal : '?') +
    ' Â· duration=' +
    durationLabel +
    ' Â· error=' +
    String(note || '').slice(0, 400);
  var body =
    'The Fibery â†’ Datastore hydrate ended in failure.\n\n' +
    summary +
    '\n\nOpen ADMIN Settings â†’ Datastore hydrate for status, then Pull from Fibery to resume from the failed step (or set SUPABASE_SYNC_FORCE_FULL=true for a full restart).\n';
  var fromName = 'FinOps Performance Hub';
  for (var i = 0; i < emails.length; i++) {
    var email = emails[i];
    try {
      MailApp.sendEmail({
        to: email,
        subject: subject,
        body: body,
        name: fromName,
      });
      if (typeof appendNotificationLogRow_ === 'function') {
        appendNotificationLogRow_({
          email: email,
          catalogIds: ['system.hydrate_failed'],
          alertIds: ['hydrate-failed:' + (state.runId || '')],
          frequency: 'immediate',
          digestKey: 'hydrate-failed:' + (state.runId || Utilities.getUuid()),
          subject: subject,
          summary: summary,
          deepLink: '',
          status: 'sent',
        });
      }
    } catch (sendErr) {
      try {
        console.warn(
          'notifyAdminsHydrateFailed_: send failed for ' +
            email +
            ': ' +
            (sendErr && sendErr.message ? sendErr.message : sendErr)
        );
      } catch (_) {
        /* ignore */
      }
      if (typeof appendNotificationLogRow_ === 'function') {
        try {
          appendNotificationLogRow_({
            email: email,
            catalogIds: ['system.hydrate_failed'],
            alertIds: ['hydrate-failed:' + (state.runId || '')],
            frequency: 'immediate',
            digestKey: 'hydrate-failed:' + (state.runId || Utilities.getUuid()),
            subject: subject,
            summary: summary,
            deepLink: '',
            status: 'failed',
          });
        } catch (_) {
          /* ignore */
        }
      }
    }
  }
}

/**
 * @param {number} afterMs
 */
function scheduleSupabaseSyncContinuation_(afterMs) {
  deleteSupabaseSyncContinuationTriggers_();
  var ms = afterMs > 0 ? afterMs : 1000;
  ScriptApp.newTrigger('processSupabaseSyncBatch_')
    .timeBased()
    .after(ms)
    .create();
}

function deleteSupabaseSyncContinuationTriggers_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processSupabaseSyncBatch_') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

/**
 * Install nightly trigger (hour from SUPABASE_SYNC_TRIGGER_HOUR, default 4).
 * @return {!Object}
 */
function installSupabaseSyncTrigger_() {
  var hour = parseInt(
    PropertiesService.getScriptProperties().getProperty('SUPABASE_SYNC_TRIGGER_HOUR') ||
      '4',
    10
  );
  if (isNaN(hour) || hour < 0 || hour > 23) {
    hour = 4;
  }
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'runDailySupabaseSync_') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('runDailySupabaseSync_').timeBased().atHour(hour).everyDays(1).create();
  return { ok: true, message: 'Daily Supabase sync trigger installed at hour ' + hour };
}

/** @return {?Object} */
function readSupabaseSyncState_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(
      SUPABASE_SYNC_STATE_PROP_
    );
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/** @param {!Object} state */
function writeSupabaseSyncState_(state) {
  PropertiesService.getScriptProperties().setProperty(
    SUPABASE_SYNC_STATE_PROP_,
    JSON.stringify(state)
  );
}

/**
 * @param {!Object} state
 * @param {string} status
 */
function insertSupabaseSyncRunRow_(state, status) {
  try {
    if (!isSupabaseConfigured_()) {
      return;
    }
    var row = {
      run_id: state.runId,
      trigger_kind: state.trigger || 'manual',
      status: status,
      started_at: state.startedAt || new Date().toISOString(),
      finished_at: state.finishedAt || null,
      duration_ms: state.durationMs != null ? state.durationMs : null,
      dataset_cursor:
        state.datasets && state.datasetIndex != null
          ? state.datasets[Math.min(state.datasetIndex, state.datasets.length - 1)]
          : null,
      datasets_done: state.datasetsDone || 0,
      datasets_total: state.datasetsTotal || 0,
      notes: (state.notes || []).join(' | ').slice(0, 4000),
      summary: state,
    };
    supabaseUpsert_('fos_sync_runs', [row], 'run_id');
  } catch (e) {
    supabaseWarn_('insert sync run failed', e);
  }
}

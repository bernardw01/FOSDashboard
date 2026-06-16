/**
 * PRD version 2.16.1 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Upsert normalized rows into AI Usage Data/Usage (feature 017).
 */

/**
 * @param {!Array<!Object>} rows
 * @param {string} syncRunId
 * @param {number=} deadlineMs optional epoch ms; stop upsert before this time
 * @return {!{ ok: boolean, created: number, updated: number, failed: number, stoppedEarly?: boolean, message?: string }}
 */
function aiUsageUpsertRows_(rows, syncRunId, deadlineMs) {
  if (!rows || !rows.length) {
    return { ok: true, created: 0, updated: 0, failed: 0 };
  }

  var existing = aiUsageLookupExistingBySourceIds_(rows);
  if (!existing.ok) {
    return { ok: false, created: 0, updated: 0, failed: rows.length, message: existing.message };
  }

  var created = 0;
  var updated = 0;
  var failed = 0;
  var firstError = '';
  var stoppedEarly = false;
  var ingestedAt = new Date().toISOString();
  var usageDb = aiUsageUsageDatabase_();

  for (var i = 0; i < rows.length; i += AI_USAGE_FIBERY_UPSERT_BATCH_) {
    if (deadlineMs && Date.now() > deadlineMs) {
      stoppedEarly = true;
      var remaining = rows.length - i;
      failed += remaining;
      if (!firstError) {
        firstError = 'Upsert stopped early (Apps Script time budget). Run sync again to continue.';
      }
      break;
    }
    var slice = rows.slice(i, i + AI_USAGE_FIBERY_UPSERT_BATCH_);
    var commands = [];
    slice.forEach(function (row) {
      var entity = aiUsageRowToFiberyEntity_(row, syncRunId, ingestedAt);
      var fiberyId = existing.map[row.sourceRecordId] || null;
      if (fiberyId) {
        entity['fibery/id'] = fiberyId;
        commands.push({
          command: 'fibery.entity/update',
          args: { type: usageDb, entity: entity },
        });
      } else {
        commands.push({
          command: 'fibery.entity/create',
          args: { type: usageDb, entity: entity },
        });
      }
    });

    var batch = fiberyBatchCommands_(commands);
    if (!batch.ok) {
      failed += slice.length;
      if (!firstError && batch.message) {
        firstError = batch.message;
      }
      console.warn('aiUsageUpsertRows_ batch failed: ' + batch.message);
      continue;
    }
    slice.forEach(function (row) {
      if (existing.map[row.sourceRecordId]) {
        updated++;
      } else {
        created++;
      }
    });
  }

  return {
    ok: failed === 0 && !stoppedEarly,
    created: created,
    updated: updated,
    failed: failed,
    stoppedEarly: stoppedEarly,
    message: firstError || (failed ? failed + ' row(s) failed to upsert' : undefined),
  };
}

/**
 * Preloads enum fibery/id values used on Usage upserts (reduces per-batch query churn).
 */
function aiUsageWarmUsageEnums_() {
  var usageDb = aiUsageUsageDatabase_();
  var syncDb = aiUsageSyncRunsDatabase_();
  var specs = [
    [usageDb, 'Source Platform', ['Anthropic Console', 'Claude.ai']],
    [
      usageDb,
      'Source Dataset',
      ['Anthropic Messages', 'Anthropic Cost', 'Anthropic Claude Code'],
    ],
    [usageDb, 'Actor Type', ['User', 'Unknown', 'API key', 'Service account']],
    [usageDb, 'Customer Type', ['N/A', 'Team', 'Enterprise']],
    [usageDb, 'Subscription Tier', ['N/A', 'Team', 'Enterprise']],
    [usageDb, 'Mapping Status', ['Matched', 'Unmatched', 'Service account', 'Shared key']],
    [
      usageDb,
      'Allocation Category',
      ['Product development', 'Customer support', 'Internal ops', 'Shared / unallocated'],
    ],
    [syncDb, 'Status', ['running', 'complete', 'partial', 'failed']],
    [syncDb, 'Trigger', ['scheduled', 'manual', 'backfill']],
  ];
  specs.forEach(function (spec) {
    var db = spec[0];
    var field = spec[1];
    spec[2].forEach(function (name) {
      aiUsageEnumId_(db, field, name);
    });
  });
}

/**
 * @param {!Array<!Object>} rows
 * @return {!{ ok: boolean, map: !Object<string, string>, message?: string }}
 */
function aiUsageLookupExistingBySourceIds_(rows) {
  var map = {};
  var ids = [];
  rows.forEach(function (row) {
    if (row && row.sourceRecordId) {
      ids.push(row.sourceRecordId);
    }
  });
  if (!ids.length) {
    return { ok: true, map: map };
  }

  var sourceIdField = aiUsageField_('Source Record Id');
  for (var i = 0; i < ids.length; i += 50) {
    var chunk = ids.slice(i, i + 50);
    var batch = fiberyBatchQuery_([
      {
        query: {
          'q/from': aiUsageUsageDatabase_(),
          'q/select': {
            Id: ['fibery/id'],
            SourceRecordId: [sourceIdField],
          },
          'q/where': ['q/in', [sourceIdField], '$ids'],
          'q/limit': chunk.length,
        },
        params: { $ids: chunk },
      },
    ]);
    if (!batch.ok) {
      return { ok: false, map: map, message: batch.message };
    }
    (batch.results[0] || []).forEach(function (hit) {
      if (hit.SourceRecordId && hit.Id) {
        map[String(hit.SourceRecordId)] = String(hit.Id);
      }
    });
  }

  return { ok: true, map: map };
}

/**
 * @param {!Object} row
 * @param {string} syncRunId
 * @param {string} ingestedAt
 * @return {!Object}
 */
function aiUsageRowToFiberyEntity_(row, syncRunId, ingestedAt) {
  var entity = {};
  entity[aiUsageField_('Name')] = aiUsageBuildUsageTitle_(row);
  entity[aiUsageField_('Source Record Id')] = row.sourceRecordId;
  entity[aiUsageField_('Usage Date')] = row.usageDate;
  if (row.periodStart) {
    entity[aiUsageField_('Period Start')] = row.periodStart;
  }
  if (row.periodEnd) {
    entity[aiUsageField_('Period End')] = row.periodEnd;
  }
  var usageDb = aiUsageUsageDatabase_();
  aiUsageSetEnumField_(entity, usageDb, 'Source Platform', row.sourcePlatform);
  aiUsageSetEnumField_(entity, usageDb, 'Source Dataset', row.sourceDataset);
  if (row.orgExternalId) {
    entity[aiUsageField_('Org External Id')] = row.orgExternalId;
  }
  aiUsageSetEnumField_(entity, usageDb, 'Actor Type', row.actorType || 'Unknown');
  if (row.actorEmail) {
    entity[aiUsageField_('Actor Email')] = row.actorEmail;
  }
  if (row.actorExternalId) {
    entity[aiUsageField_('Actor External Id')] = row.actorExternalId;
  }
  if (row.actorLabel) {
    entity[aiUsageField_('Actor Label')] = row.actorLabel;
  }
  aiUsageSetEnumField_(entity, usageDb, 'Customer Type', row.customerType || 'N/A');
  aiUsageSetEnumField_(entity, usageDb, 'Subscription Tier', row.subscriptionTier || 'N/A');
  if (row.model) {
    entity[aiUsageField_('Model')] = row.model;
  }
  if (row.workspaceOrProject) {
    entity[aiUsageField_('Workspace or Project')] = row.workspaceOrProject;
  }
  if (row.serviceTier) {
    entity[aiUsageField_('Service Tier')] = row.serviceTier;
  }
  if (row.lineItem) {
    entity[aiUsageField_('Line Item')] = row.lineItem;
  }
  if (row.costType) {
    entity[aiUsageField_('Cost Type')] = row.costType;
  }
  if (row.tokenType) {
    entity[aiUsageField_('Token Type')] = row.tokenType;
  }
  if (row.description) {
    entity[aiUsageField_('Context Description')] = row.description;
  }
  if (row.terminalType) {
    entity[aiUsageField_('Terminal Type')] = row.terminalType;
  }
  if (row.inputTokens != null) {
    entity[aiUsageField_('Input Tokens')] = row.inputTokens;
  }
  if (row.outputTokens != null) {
    entity[aiUsageField_('Output Tokens')] = row.outputTokens;
  }
  if (row.cacheReadTokens != null) {
    entity[aiUsageField_('Cache Read Tokens')] = row.cacheReadTokens;
  }
  if (row.cacheWriteTokens != null) {
    entity[aiUsageField_('Cache Write Tokens')] = row.cacheWriteTokens;
  }
  if (row.requestCount != null) {
    entity[aiUsageField_('Request Count')] = row.requestCount;
  }
  if (row.quantity != null) {
    entity[aiUsageField_('Quantity')] = row.quantity;
  }
  if (row.costUsd != null) {
    entity[aiUsageField_('Cost USD')] = row.costUsd;
  }
  entity[aiUsageField_('Currency')] = row.currency || 'USD';
  if (row.clockifyUserFiberyId) {
    entity[aiUsageUsageClockifyUserField_()] = { 'fibery/id': row.clockifyUserFiberyId };
  }
  aiUsageSetEnumField_(entity, usageDb, 'Mapping Status', row.mappingStatus || 'Unmatched');
  aiUsageSetEnumField_(
    entity,
    usageDb,
    'Allocation Category',
    row.allocationCategory || 'Shared / unallocated'
  );
  entity[aiUsageField_('Sync Run Id')] = syncRunId;
  entity[aiUsageField_('Ingested At')] = ingestedAt;
  return entity;
}

/**
 * Sets a Fibery enum field on an entity payload using fibery/id (required on create).
 *
 * @param {!Object} entity
 * @param {string} database
 * @param {string} fieldSuffix
 * @param {string} enumName
 */
function aiUsageSetEnumField_(entity, database, fieldSuffix, enumName) {
  var id = aiUsageEnumId_(database, fieldSuffix, enumName);
  if (id) {
    entity[aiUsageField_(fieldSuffix)] = { 'fibery/id': id };
  }
}

/**
 * Resolves fibery/id for an app enum type ({Field}_{Database}).
 *
 * @param {string} database e.g. AI Usage Data/Usage
 * @param {string} fieldSuffix e.g. Source Platform
 * @param {string} enumName enum/name value
 * @return {?string}
 */
function aiUsageEnumId_(database, fieldSuffix, enumName) {
  enumName = String(enumName || '').trim();
  if (!enumName) {
    return null;
  }
  var prefix = aiUsageFiberyAppPrefix_();
  var enumDb = prefix + '/' + fieldSuffix + '_' + database;
  var cacheKey = 'ai_usage_enum:' + enumDb + ':' + enumName;
  var cache = CacheService.getScriptCache();
  var cached = cache ? cache.get(cacheKey) : null;
  if (cached) {
    return cached;
  }
  var r = fiberyQuery_({
    query: {
      'q/from': enumDb,
      'q/select': { id: 'fibery/id', name: 'enum/name' },
      'q/where': ['=', ['enum/name'], '$n'],
      'q/limit': 1,
    },
    params: { $n: enumName },
  });
  if (!r.ok || !r.rows || !r.rows.length || !r.rows[0].id) {
    console.warn('aiUsageEnumId_: could not resolve ' + enumDb + ' name=' + enumName);
    return null;
  }
  var id = String(r.rows[0].id);
  if (cache) {
    try {
      cache.put(cacheKey, id, 21600);
    } catch (_) {
      /* ignore */
    }
  }
  return id;
}

/**
 * @param {*} value
 * @return {!Object}
 */
function aiUsageFiberyDocument_(value) {
  var text = '';
  try {
    text = JSON.stringify(value || {});
  } catch (_) {
    text = '{}';
  }
  if (text.length > 120000) {
    text = text.slice(0, 120000) + '...';
  }
  return { 'fibery/document-content': text };
}

/**
 * Append a run summary to Fibery `AI Usage Data/Sync Runs` (best-effort).
 *
 * @param {!Object} summary
 * @param {string} status complete|partial|failed
 * @param {number} durationMs
 * @param {string} startedAtIso
 * @return {!{ ok: boolean, message?: string }}
 */
function aiUsageWriteFiberySyncRun_(summary, status, durationMs, startedAtIso) {
  var triggerName = aiUsageMapSyncTrigger_(summary.trigger, summary.startYmd, summary.endYmd);
  var statusName = String(status || 'failed').toLowerCase();
  var entity = {};
  entity[aiUsageField_('Name')] = String(summary.syncRunId || 'ai-usage-run');
  entity[aiUsageField_('Started At')] = startedAtIso;
  entity[aiUsageField_('Completed At')] = new Date().toISOString();
  var triggerId = aiUsageSyncRunEnumId_('trigger', triggerName);
  var statusId = aiUsageSyncRunEnumId_('status', statusName);
  if (triggerId) {
    entity[aiUsageField_('Trigger')] = { 'fibery/id': triggerId };
  }
  if (statusId) {
    entity[aiUsageField_('Status')] = { 'fibery/id': statusId };
  }
  if (summary.startYmd) {
    entity[aiUsageField_('Range Start')] = summary.startYmd;
  }
  if (summary.endYmd) {
    entity[aiUsageField_('Range End')] = summary.endYmd;
  }
  entity[aiUsageField_('Rows Fetched')] = summary.rowsFetched || 0;
  entity[aiUsageField_('Rows Upserted')] = summary.rowsUpserted || 0;
  entity[aiUsageField_('Rows Failed')] = summary.rowsFailed || 0;
  if (status === 'failed' && summary.message) {
    entity[aiUsageField_('Error')] = String(summary.message).slice(0, 2000);
  }

  var batch = fiberyBatchCommands_([
    {
      command: 'fibery.entity/create',
      args: { type: aiUsageSyncRunsDatabase_(), entity: entity },
    },
  ]);
  if (!batch.ok) {
    return { ok: false, message: batch.message };
  }
  return { ok: true };
}

/**
 * @param {string} triggerKind
 * @param {string} startYmd
 * @param {string} endYmd
 * @return {string}
 */
function aiUsageMapSyncTrigger_(triggerKind, startYmd, endYmd) {
  if (triggerKind === 'scheduled') {
    return 'scheduled';
  }
  var span = aiUsageDaySpan_(startYmd, endYmd);
  if (span > aiUsageResolveLookbackDays_()) {
    return 'backfill';
  }
  return 'manual';
}

/**
 * Returns the latest Usage Date stored in Fibery, or null when empty / unreachable.
 *
 * @return {?string} YYYY-MM-DD
 */
function aiUsageQueryMaxUsageDateYmd_() {
  var usageDateField = aiUsageField_('Usage Date');
  var q = {
    query: {
      'q/from': aiUsageUsageDatabase_(),
      'q/select': {
        usageDate: usageDateField,
      },
      'q/order-by': [[usageDateField, 'q/desc']],
      'q/limit': 1,
    },
  };
  var r = fiberyQuery_(q);
  if (!r.ok || !r.rows || !r.rows.length) {
    return null;
  }
  return aiUsageNormalizeUsageDateYmd_(r.rows[0].usageDate);
}

/**
 * Resolves fibery/id for Sync Runs enum fields (Status, Trigger).
 *
 * @param {'status'|'trigger'} kind
 * @param {string} enumName
 * @return {?string}
 */
function aiUsageSyncRunEnumId_(kind, enumName) {
  var field = kind === 'trigger' ? 'Trigger' : 'Status';
  return aiUsageEnumId_(aiUsageSyncRunsDatabase_(), field, enumName);
}

/**
 * @param {*} raw
 * @return {?string}
 * @private
 */
function aiUsageNormalizeUsageDateYmd_(raw) {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  var s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s;
  }
  var t = Date.parse(s);
  if (!isFinite(t)) {
    return null;
  }
  return new Date(t).toISOString().slice(0, 10);
}

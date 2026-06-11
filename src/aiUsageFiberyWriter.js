/**
 * PRD version 2.12.7 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Upsert normalized rows into AI Usage Data/Usage (feature 017).
 */

/**
 * @param {!Array<!Object>} rows
 * @param {string} syncRunId
 * @return {!{ ok: boolean, created: number, updated: number, failed: number, message?: string }}
 */
function aiUsageUpsertRows_(rows, syncRunId) {
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
  var ingestedAt = new Date().toISOString();
  var usageDb = aiUsageUsageDatabase_();

  for (var i = 0; i < rows.length; i += AI_USAGE_FIBERY_UPSERT_BATCH_) {
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
    ok: failed === 0,
    created: created,
    updated: updated,
    failed: failed,
    message: failed ? failed + ' row(s) failed to upsert' : undefined,
  };
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
        params: { ids: chunk },
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
  entity[aiUsageField_('Source Platform')] = row.sourcePlatform;
  entity[aiUsageField_('Source Dataset')] = row.sourceDataset;
  if (row.orgExternalId) {
    entity[aiUsageField_('Org External Id')] = row.orgExternalId;
  }
  entity[aiUsageField_('Actor Type')] = row.actorType;
  if (row.actorEmail) {
    entity[aiUsageField_('Actor Email')] = row.actorEmail;
  }
  if (row.actorExternalId) {
    entity[aiUsageField_('Actor External Id')] = row.actorExternalId;
  }
  if (row.actorLabel) {
    entity[aiUsageField_('Actor Label')] = row.actorLabel;
  }
  entity[aiUsageField_('Customer Type')] = row.customerType || 'N/A';
  entity[aiUsageField_('Subscription Tier')] = row.subscriptionTier || 'N/A';
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
    entity[aiUsageField_('Clockify User')] = { 'fibery/id': row.clockifyUserFiberyId };
  }
  if (row.clockifyUserEmail) {
    entity[aiUsageField_('Clockify User Email')] = row.clockifyUserEmail;
  }
  if (row.clockifyUserId) {
    entity[aiUsageField_('Clockify User ID')] = row.clockifyUserId;
  }
  entity[aiUsageField_('Mapping Status')] = row.mappingStatus || 'Unmatched';
  entity[aiUsageField_('Allocation Category')] = row.allocationCategory || 'Shared / unallocated';
  entity[aiUsageField_('Sync Run Id')] = syncRunId;
  entity[aiUsageField_('Ingested At')] = ingestedAt;
  entity[aiUsageField_('Raw Metrics JSON')] = aiUsageFiberyDocument_(row.rawMetrics);
  entity[aiUsageField_('Vendor Payload JSON')] = aiUsageFiberyDocument_(row.vendorPayload);
  return entity;
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
  var trigger = aiUsageMapSyncTrigger_(summary.trigger, summary.startYmd, summary.endYmd);
  var entity = {};
  entity[aiUsageField_('Name')] = String(summary.syncRunId || 'ai-usage-run');
  entity[aiUsageField_('Started At')] = startedAtIso;
  entity[aiUsageField_('Completed At')] = new Date().toISOString();
  entity[aiUsageField_('Trigger')] = trigger;
  entity[aiUsageField_('Status')] = status;
  if (summary.startYmd) {
    entity[aiUsageField_('Range Start')] = summary.startYmd;
  }
  if (summary.endYmd) {
    entity[aiUsageField_('Range End')] = summary.endYmd;
  }
  entity[aiUsageField_('Rows Fetched')] = summary.rowsFetched || 0;
  entity[aiUsageField_('Rows Upserted')] = summary.rowsUpserted || 0;
  entity[aiUsageField_('Rows Failed')] = summary.rowsFailed || 0;
  var warnings = (summary.warnings || []).slice(0, 10).join('\n');
  if (warnings) {
    entity[aiUsageField_('Warnings')] = aiUsageFiberyDocument_(warnings);
  }
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

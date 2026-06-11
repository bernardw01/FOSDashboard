/**
 * PRD version 2.12.8 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Vendor payloads → normalized AI Usage rows (feature 017).
 */

/**
 * @param {string} dateYmd
 * @param {string} orgId
 * @param {!Object<string, { name: string }>} apiKeyIndex
 * @return {!Array<!Object>}
 */
function aiUsageNormalizeAnthropicDay_(dateYmd, orgId, apiKeyIndex) {
  var rows = [];
  aiUsageFetchAnthropicMessagesForDay_(dateYmd).forEach(function (entry) {
    var normalized = aiUsageNormalizeAnthropicMessageRow_(entry, orgId, apiKeyIndex);
    if (normalized) {
      rows.push(normalized);
    }
  });
  aiUsageFetchAnthropicCostForDay_(dateYmd).forEach(function (entry) {
    var normalized = aiUsageNormalizeAnthropicCostRow_(entry, orgId);
    if (normalized) {
      rows.push(normalized);
    }
  });
  aiUsageFetchAnthropicClaudeCodeForDay_(dateYmd).forEach(function (entry) {
    rows = rows.concat(aiUsageNormalizeAnthropicClaudeCodeRow_(entry, orgId));
  });
  return rows;
}

/**
 * @param {!Object} entry
 * @param {string} orgId
 * @param {!Object<string, { name: string }>} apiKeyIndex
 * @return {?Object}
 */
function aiUsageNormalizeAnthropicMessageRow_(entry, orgId, apiKeyIndex) {
  var bucket = entry.bucket || {};
  var result = entry.result || {};
  var startingAt = bucket.starting_at || '';
  var actorId = result.account_id || result.api_key_id || result.service_account_id || '';
  var actorType = 'Unknown';
  if (result.service_account_id) {
    actorType = 'Service account';
  } else if (result.api_key_id) {
    actorType = 'API key';
  } else if (result.account_id) {
    actorType = 'User';
  }
  var apiKeyMeta = result.api_key_id && apiKeyIndex[result.api_key_id] ? apiKeyIndex[result.api_key_id] : null;
  var cacheCreation = result.cache_creation || {};
  var cacheWrite =
    (cacheCreation.ephemeral_1h_input_tokens || 0) + (cacheCreation.ephemeral_5m_input_tokens || 0);
  var sourceRecordId =
    'anthropic:messages:' +
    aiUsageSafeKeyPart_(startingAt) +
    ':' +
    aiUsageSafeKeyPart_(result.account_id || result.api_key_id || 'none') +
    ':' +
    aiUsageSafeKeyPart_(result.workspace_id || 'none') +
    ':' +
    aiUsageSafeKeyPart_(result.model || 'none') +
    ':' +
    aiUsageSafeKeyPart_(result.service_tier || 'none');

  return aiUsageBuildNormalizedRow_({
    sourceRecordId: sourceRecordId,
    usageDate: aiUsageDateFromIso_(startingAt) || aiUsageDateFromIso_(bucket.ending_at),
    periodStart: startingAt || null,
    periodEnd: bucket.ending_at || null,
    sourcePlatform: 'Anthropic Console',
    sourceDataset: 'Anthropic Messages',
    orgExternalId: orgId || null,
    actorType: actorType,
    actorEmail: null,
    actorExternalId: actorId ? String(actorId) : null,
    actorLabel: apiKeyMeta ? apiKeyMeta.name : null,
    customerType: 'API',
    subscriptionTier: 'N/A',
    model: result.model || null,
    workspaceOrProject: result.workspace_id || null,
    serviceTier: result.service_tier || null,
    inputTokens: result.uncached_input_tokens != null ? Number(result.uncached_input_tokens) : null,
    outputTokens: result.output_tokens != null ? Number(result.output_tokens) : null,
    cacheReadTokens: result.cache_read_input_tokens != null ? Number(result.cache_read_input_tokens) : null,
    cacheWriteTokens: cacheWrite || null,
    rawMetrics: {
      server_tool_use: result.server_tool_use || null,
      context_window: result.context_window || null,
      inference_geo: result.inference_geo || null,
    },
    vendorPayload: { bucket: bucket, result: result },
  });
}

/**
 * @param {!Object} entry
 * @param {string} orgId
 * @return {?Object}
 */
function aiUsageNormalizeAnthropicCostRow_(entry, orgId) {
  var bucket = entry.bucket || {};
  var result = entry.result || {};
  var startingAt = bucket.starting_at || '';
  var amount = result.amount != null ? Number(result.amount) : null;
  var sourceRecordId =
    'anthropic:cost:' +
    aiUsageSafeKeyPart_(startingAt) +
    ':' +
    aiUsageSafeKeyPart_(result.workspace_id || 'none') +
    ':' +
    aiUsageSafeKeyPart_(result.description || 'none') +
    ':' +
    aiUsageSafeKeyPart_(result.token_type || 'none') +
    ':' +
    aiUsageSafeKeyPart_(result.model || 'none');

  return aiUsageBuildNormalizedRow_({
    sourceRecordId: sourceRecordId,
    usageDate: aiUsageDateFromIso_(startingAt) || aiUsageDateFromIso_(bucket.ending_at),
    periodStart: startingAt || null,
    periodEnd: bucket.ending_at || null,
    sourcePlatform: 'Anthropic Console',
    sourceDataset: 'Anthropic Cost',
    orgExternalId: orgId || null,
    actorType: 'Unknown',
    actorEmail: null,
    actorExternalId: null,
    actorLabel: null,
    customerType: 'N/A',
    subscriptionTier: 'N/A',
    model: result.model || null,
    workspaceOrProject: result.workspace_id || null,
    costType: result.cost_type || null,
    tokenType: result.token_type || null,
    description: result.description || null,
    serviceTier: result.service_tier || null,
    costUsd: amount,
    currency: result.currency || 'USD',
    rawMetrics: {
      context_window: result.context_window || null,
      inference_geo: result.inference_geo || null,
    },
    vendorPayload: { bucket: bucket, result: result },
  });
}

/**
 * @param {!Object} row
 * @param {string} orgId
 * @return {!Array<!Object>}
 */
function aiUsageNormalizeAnthropicClaudeCodeRow_(row, orgId) {
  var usageDate = aiUsageDateFromIso_(row.date) || String(row.date || '').slice(0, 10);
  var actor = row.actor || {};
  var actorKey = aiUsageClaudeCodeActorKey_(actor);
  var actorType = actor.type === 'user_actor' ? 'User' : actor.type === 'api_actor' ? 'API key' : 'Unknown';
  var customerType = row.customer_type === 'subscription' ? 'Subscription' : 'API';
  var sourcePlatform = row.customer_type === 'subscription' ? 'Claude.ai' : 'Anthropic Console';
  var subscriptionTier = 'N/A';
  if (row.subscription_type === 'team') {
    subscriptionTier = 'Team';
  } else if (row.subscription_type === 'enterprise') {
    subscriptionTier = 'Enterprise';
  }
  var actorEmail = actor.email_address ? String(actor.email_address) : null;
  var actorExternalId =
    actor.api_key_id ||
    actor.api_key_name ||
    actor.email_address ||
    actorKey ||
    null;
  var actorLabel = actor.api_key_name || actor.email_address || null;
  var normalized = [];
  (row.model_breakdown || []).forEach(function (modelRow) {
    var model = modelRow.model || 'unknown';
    var tokens = modelRow.tokens || {};
    var estimated = modelRow.estimated_cost || {};
    var costUsd = null;
    if (estimated.amount != null) {
      costUsd = Number(estimated.amount) / 100;
    }
    var sourceRecordId =
      'anthropic:claude_code:' +
      aiUsageSafeKeyPart_(usageDate) +
      ':' +
      aiUsageSafeKeyPart_(actorKey) +
      ':' +
      aiUsageSafeKeyPart_(model);

    normalized.push(
      aiUsageBuildNormalizedRow_({
        sourceRecordId: sourceRecordId,
        usageDate: usageDate,
        periodStart: row.date || null,
        periodEnd: null,
        sourcePlatform: sourcePlatform,
        sourceDataset: 'Anthropic Claude Code',
        orgExternalId: row.organization_id || orgId || null,
        actorType: actorType,
        actorEmail: actorEmail,
        actorExternalId: actorExternalId ? String(actorExternalId) : null,
        actorLabel: actorLabel,
        customerType: customerType,
        subscriptionTier: subscriptionTier,
        model: model,
        terminalType: row.terminal_type || null,
        inputTokens: tokens.input != null ? Number(tokens.input) : null,
        outputTokens: tokens.output != null ? Number(tokens.output) : null,
        cacheReadTokens: tokens.cache_read != null ? Number(tokens.cache_read) : null,
        cacheWriteTokens: tokens.cache_creation != null ? Number(tokens.cache_creation) : null,
        costUsd: costUsd,
        currency: estimated.currency || 'USD',
        rawMetrics: {
          core_metrics: row.core_metrics || null,
          tool_actions: row.tool_actions || null,
        },
        vendorPayload: { row: row, model_breakdown: modelRow },
      })
    );
  });
  return normalized;
}

/**
 * @param {!Object} actor
 * @return {string}
 */
function aiUsageClaudeCodeActorKey_(actor) {
  if (!actor) {
    return 'unknown';
  }
  if (actor.email_address) {
    return String(actor.email_address).toLowerCase();
  }
  if (actor.api_key_id) {
    return String(actor.api_key_id);
  }
  if (actor.api_key_name) {
    return String(actor.api_key_name);
  }
  return String(actor.type || 'unknown');
}

/**
 * @param {!Object} fields
 * @return {!Object}
 */
function aiUsageBuildNormalizedRow_(fields) {
  return {
    sourceRecordId: fields.sourceRecordId,
    usageDate: fields.usageDate,
    periodStart: fields.periodStart || null,
    periodEnd: fields.periodEnd || null,
    sourcePlatform: fields.sourcePlatform,
    sourceDataset: fields.sourceDataset,
    orgExternalId: fields.orgExternalId || null,
    actorType: fields.actorType || 'Unknown',
    actorEmail: fields.actorEmail || null,
    actorExternalId: fields.actorExternalId || null,
    actorLabel: fields.actorLabel || null,
    customerType: fields.customerType || 'N/A',
    subscriptionTier: fields.subscriptionTier || 'N/A',
    model: fields.model || null,
    workspaceOrProject: fields.workspaceOrProject || null,
    serviceTier: fields.serviceTier || null,
    lineItem: fields.lineItem || null,
    costType: fields.costType || null,
    tokenType: fields.tokenType || null,
    description: fields.description || null,
    terminalType: fields.terminalType || null,
    inputTokens: fields.inputTokens != null ? fields.inputTokens : null,
    outputTokens: fields.outputTokens != null ? fields.outputTokens : null,
    cacheReadTokens: fields.cacheReadTokens != null ? fields.cacheReadTokens : null,
    cacheWriteTokens: fields.cacheWriteTokens != null ? fields.cacheWriteTokens : null,
    requestCount: fields.requestCount != null ? fields.requestCount : null,
    quantity: fields.quantity != null ? fields.quantity : null,
    costUsd: fields.costUsd != null ? fields.costUsd : null,
    currency: fields.currency || 'USD',
    clockifyUserFiberyId: null,
    clockifyUserId: null,
    clockifyUserEmail: null,
    mappingStatus: 'Unmatched',
    allocationCategory: 'Shared / unallocated',
    rawMetrics: fields.rawMetrics || {},
    vendorPayload: fields.vendorPayload || {},
  };
}

/**
 * @param {string|null|undefined} iso
 * @return {string|null}
 */
function aiUsageDateFromIso_(iso) {
  if (!iso) {
    return null;
  }
  var s = String(iso);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s;
  }
  if (s.length >= 10) {
    return s.slice(0, 10);
  }
  return null;
}

/**
 * @param {!Object} row
 * @return {string}
 */
function aiUsageBuildUsageTitle_(row) {
  var parts = [
    row.usageDate || '',
    row.sourcePlatform || '',
    row.actorLabel || row.actorEmail || row.actorExternalId || 'unknown',
    row.model || row.sourceDataset || '',
  ];
  return parts.filter(function (p) {
    return !!p;
  }).join(' | ');
}

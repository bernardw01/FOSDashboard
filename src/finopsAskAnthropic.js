/**
 * PRD version 3.0.12 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 032 - Anthropic Messages API client for FinOps Ask.
 */

/** @const {string} */
var FINOPS_ASK_ANTHROPIC_BASE_ = 'https://api.anthropic.com';

/** @const {string} */
var FINOPS_ASK_ANTHROPIC_VERSION_ = '2023-06-01';

/** @const {number} */
var FINOPS_ASK_HTTP_TIMEOUT_MS_ = 55000;

/**
 * @return {string}
 */
function finopsAskRequireMessagesKey_() {
  var key = (PropertiesService.getScriptProperties().getProperty('FINOPS_ASK_ANTHROPIC_API_KEY') || '').trim();
  if (!key) {
    throw new Error('FINOPS_ASK_ANTHROPIC_API_KEY is not set.');
  }
  return key;
}

/**
 * @return {string}
 */
function finopsAskModelId_() {
  var model = (PropertiesService.getScriptProperties().getProperty('FINOPS_ASK_MODEL') || '').trim();
  return model || 'claude-sonnet-4-6';
}

/**
 * Prompt caching master switch (default on).
 * @return {boolean}
 */
function finopsAskPromptCacheEnabled_() {
  var raw = PropertiesService.getScriptProperties().getProperty('FINOPS_ASK_PROMPT_CACHE');
  if (raw == null || raw === '') {
    return true;
  }
  var v = String(raw).trim().toLowerCase();
  return !(v === 'false' || v === '0' || v === 'no' || v === 'off');
}

/**
 * Cache TTL for the large panel-context breakpoint: 5m | 1h (default 1h).
 * @return {string}
 */
function finopsAskPromptCacheTtl_() {
  var raw = String(
    PropertiesService.getScriptProperties().getProperty('FINOPS_ASK_PROMPT_CACHE_TTL') || '1h'
  )
    .trim()
    .toLowerCase();
  if (raw === '5m' || raw === '5min' || raw === '300s' || raw === 'ephemeral') {
    return '5m';
  }
  return '1h';
}

/**
 * @param {string=} ttl 5m | 1h
 * @return {!{ type: string, ttl?: string }}
 */
function finopsAskCacheControl_(ttl) {
  var ctrl = { type: 'ephemeral' };
  if (ttl === '1h') {
    ctrl.ttl = '1h';
  }
  return ctrl;
}

/**
 * @param {!Object} body
 * @return {!Object}
 */
function finopsAskMessagesPost_(body) {
  var key = finopsAskRequireMessagesKey_();
  var url = FINOPS_ASK_ANTHROPIC_BASE_ + '/v1/messages';
  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': key,
      'anthropic-version': FINOPS_ASK_ANTHROPIC_VERSION_,
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
    timeout: Math.floor(FINOPS_ASK_HTTP_TIMEOUT_MS_ / 1000),
  });
  var code = resp.getResponseCode();
  var text = resp.getContentText() || '';
  var parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    parsed = null;
  }
  if (code < 200 || code >= 300) {
    var errMsg =
      parsed && parsed.error && parsed.error.message
        ? String(parsed.error.message)
        : 'Anthropic Messages HTTP ' + code;
    throw new Error(errMsg);
  }
  return parsed || {};
}

/**
 * @param {string|!Array<!Object>} systemPrompt Stable system text or content blocks.
 * @param {!Array<!Object>} messages Anthropic messages (string or content-block arrays).
 * @param {{ promptCache?: boolean }=} opts
 * @return {!{ text: string, usageMeta: Object }}
 */
function finopsAskCallMessages_(systemPrompt, messages, opts) {
  opts = opts || {};
  var useCache = opts.promptCache !== false && finopsAskPromptCacheEnabled_();
  var ttl = finopsAskPromptCacheTtl_();

  var systemBlocks;
  if (typeof systemPrompt === 'string') {
    systemBlocks = [{ type: 'text', text: systemPrompt }];
  } else if (systemPrompt && systemPrompt.length) {
    systemBlocks = systemPrompt;
  } else {
    systemBlocks = [{ type: 'text', text: 'You are FinOps Ask.' }];
  }
  if (useCache && systemBlocks.length) {
    systemBlocks[systemBlocks.length - 1].cache_control = finopsAskCacheControl_(ttl);
  }

  var payload = {
    model: finopsAskModelId_(),
    max_tokens: 2048,
    system: systemBlocks,
    messages: messages,
  };
  // Do not set top-level automatic cache_control: the last block is the new
  // question (varies each turn). Explicit breakpoints on system + panel context
  // keep a stable prefix for cache hits across the conversation.

  var result = finopsAskMessagesPost_(payload);
  var text = '';
  var blocks = result.content || [];
  for (var i = 0; i < blocks.length; i++) {
    if (blocks[i] && blocks[i].type === 'text' && blocks[i].text) {
      text += String(blocks[i].text);
    }
  }
  var usage = result.usage || {};
  return {
    text: text.trim(),
    usageMeta: {
      model: finopsAskModelId_(),
      inputTokens: usage.input_tokens != null ? usage.input_tokens : null,
      outputTokens: usage.output_tokens != null ? usage.output_tokens : null,
      cacheCreationInputTokens:
        usage.cache_creation_input_tokens != null ? usage.cache_creation_input_tokens : null,
      cacheReadInputTokens:
        usage.cache_read_input_tokens != null ? usage.cache_read_input_tokens : null,
      promptCache: useCache,
      promptCacheTtl: useCache ? ttl : null,
    },
  };
}

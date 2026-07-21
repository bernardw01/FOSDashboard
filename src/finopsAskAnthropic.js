/**
 * PRD version 3.0.5 - sync with docs/FOS-Dashboard-PRD.md
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
 * @param {string} systemPrompt
 * @param {!Array<!{ role: string, content: string }>} messages
 * @return {!{ text: string, usageMeta: Object }}
 */
function finopsAskCallMessages_(systemPrompt, messages) {
  var payload = {
    model: finopsAskModelId_(),
    max_tokens: 2048,
    system: systemPrompt,
    messages: messages,
  };
  var result = finopsAskMessagesPost_(payload);
  var text = '';
  var blocks = result.content || [];
  for (var i = 0; i < blocks.length; i++) {
    if (blocks[i] && blocks[i].type === 'text' && blocks[i].text) {
      text += String(blocks[i].text);
    }
  }
  return {
    text: text.trim(),
    usageMeta: {
      model: finopsAskModelId_(),
      inputTokens: result.usage && result.usage.input_tokens != null ? result.usage.input_tokens : null,
      outputTokens: result.usage && result.usage.output_tokens != null ? result.usage.output_tokens : null,
    },
  };
}

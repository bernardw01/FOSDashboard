/**
 * PRD version 3.0.5 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 032 - FinOps Ask AI (panel-scoped Q&A).
 */

/** @const {number} */
var FINOPS_ASK_QUESTION_MAX_ = 500;

/** @const {number} */
var FINOPS_ASK_CONTEXT_MAX_CHARS_ = 80000;

/** @const {!Object<string, boolean>} */
var FINOPS_ASK_SUPPORTED_PANELS_ = {
  home: true,
  'agreement-dashboard': true,
  operations: true,
  'labor-hours': true,
  'resource-assignments': true,
  delivery: true,
  'revenue-review': true,
  'portfolio-pnl': true,
  expenses: true,
  pipeline: true,
  'ai-usage': true,
};

/**
 * @return {boolean}
 */
function finopsAskIsEnabled_() {
  var raw = PropertiesService.getScriptProperties().getProperty('FINOPS_ASK_ENABLED');
  if (raw == null || raw === '') {
    return false;
  }
  var v = String(raw).trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

/**
 * @param {?Object} auth
 * @param {string} panelId
 * @return {boolean}
 */
function finopsAskCanAccessPanel_(auth, panelId) {
  if (!auth) {
    return false;
  }
  if (!FINOPS_ASK_SUPPORTED_PANELS_[panelId]) {
    return false;
  }
  if (panelId === 'pipeline') {
    return typeof canAccessPipelineDashboard_ === 'function' ? canAccessPipelineDashboard_(auth) : false;
  }
  if (panelId === 'resource-assignments') {
    return typeof canAccessResourceAssignmentsDashboard_ === 'function'
      ? canAccessResourceAssignmentsDashboard_(auth)
      : false;
  }
  if (panelId === 'expenses' || panelId === 'portfolio-pnl' || panelId === 'ai-usage') {
    return typeof canAccessExpensesDashboard_ === 'function' ? canAccessExpensesDashboard_(auth) : false;
  }
  if (
    panelId === 'agreement-dashboard' ||
    panelId === 'operations' ||
    panelId === 'labor-hours' ||
    panelId === 'delivery' ||
    panelId === 'revenue-review'
  ) {
    if (auth.fiberyAccess === false) {
      return false;
    }
  }
  return true;
}

/**
 * @param {*} raw
 * @return {string}
 */
function finopsAskSanitizeQuestion_(raw) {
  var q = String(raw || '').trim();
  if (q.length > FINOPS_ASK_QUESTION_MAX_) {
    q = q.substring(0, FINOPS_ASK_QUESTION_MAX_);
  }
  return q;
}

/**
 * @param {*} summary
 * @return {!Object}
 */
function finopsAskSanitizeContextSummary_(summary) {
  var obj = summary && typeof summary === 'object' ? summary : {};
  var json = '';
  try {
    json = JSON.stringify(obj);
  } catch (e) {
    return { truncated: true, note: 'Context could not be serialized.' };
  }
  if (json.length <= FINOPS_ASK_CONTEXT_MAX_CHARS_) {
    try {
      return JSON.parse(json);
    } catch (_) {
      return { truncated: true, note: 'Context parse failed after stringify.' };
    }
  }
  return {
    truncated: true,
    note: 'Context exceeded size budget; narrow filters and retry.',
    preview: json.substring(0, Math.min(4000, FINOPS_ASK_CONTEXT_MAX_CHARS_)),
  };
}

/**
 * @param {!Object} request
 * @return {string}
 */
function finopsAskBuildSystemPrompt_(request) {
  var panelId = String(request.panelId || '');
  var ds = request.dataSource && typeof request.dataSource === 'object' ? request.dataSource : {};
  var mode = String(ds.mode || 'live');
  var snap = ds.snapshotDate ? String(ds.snapshotDate) : '';
  return [
    'You are FinOps Ask, a read-only assistant inside FinOps Performance Hub.',
    'Answer ONLY using the provided JSON context for the current dashboard panel.',
    'Do not invent metrics, names, or dates that are not present in the context.',
    'If the context is insufficient, say so plainly and suggest narrowing filters or refreshing the panel.',
    'Always ground the answer with: panel "' +
      panelId +
      '", data source "' +
      mode +
      (snap ? ' ' + snap : '') +
      '".',
    'Use concise rich markdown (lists, bold). No HTML script tags.',
  ].join(' ');
}

/**
 * @param {!Object} request
 * @param {!Object} contextSummary
 * @return {!Array<!{ role: string, content: string }>}
 */
function finopsAskBuildMessages_(request, contextSummary) {
  var messages = [];
  var turns = request.conversationTurns;
  if (turns && turns.length) {
    var start = Math.max(0, turns.length - 8);
    for (var i = start; i < turns.length; i++) {
      var t = turns[i];
      if (!t || !t.role || !t.content) {
        continue;
      }
      var role = String(t.role) === 'assistant' ? 'assistant' : 'user';
      messages.push({ role: role, content: String(t.content).substring(0, 4000) });
    }
  }
  var userPayload = {
    question: request.question,
    panelId: request.panelId,
    dataSource: request.dataSource || {},
    filters: request.filters || {},
    fetchedAt: request.fetchedAt || null,
    contextSummary: contextSummary,
  };
  messages.push({
    role: 'user',
    content: JSON.stringify(userPayload),
  });
  return messages;
}

/**
 * @param {?Object} auth
 * @param {string} eventType
 * @param {string} panelId
 * @param {string} label
 */
function finopsAskLogActivity_(auth, eventType, panelId, label) {
  try {
    if (!isActivityLoggingEnabled_()) {
      return;
    }
    writeActivityRow_({
      email: auth && auth.email ? auth.email : '',
      role: auth && auth.role ? auth.role : '',
      team: auth && auth.team ? auth.team : '',
      eventType: eventType,
      route: panelId || 'ask-ai',
      label: truncate_(label || '', 500),
      sessionId: '',
      userAgent: '',
    });
  } catch (e) {
    try {
      console.warn('finopsAskLogActivity_: ' + (e && e.message ? e.message : e));
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * Public RPC: ask a question about the currently loaded panel context.
 * @param {Object=} request
 * @return {!Object}
 */
function askFinOpsQuestion(request) {
  var auth = requireAuthForApi_();
  request = request && typeof request === 'object' ? request : {};
  var panelId = String(request.panelId || '').trim();
  var question = finopsAskSanitizeQuestion_(request.question);
  var dataSource = request.dataSource && typeof request.dataSource === 'object' ? request.dataSource : { mode: 'live' };

  if (!finopsAskIsEnabled_()) {
    return { ok: false, error: 'Ask AI is turned off. An admin can enable it in Settings.' };
  }
  if (!panelId || !FINOPS_ASK_SUPPORTED_PANELS_[panelId]) {
    return { ok: false, error: 'Ask AI is not available on this screen.' };
  }
  if (!finopsAskCanAccessPanel_(auth, panelId)) {
    return { ok: false, error: 'You do not have access to ask about this dashboard.' };
  }
  if (!question) {
    return { ok: false, error: 'Enter a question.' };
  }

  var keyPresent = !!(PropertiesService.getScriptProperties().getProperty('FINOPS_ASK_ANTHROPIC_API_KEY') || '').trim();
  if (!keyPresent) {
    return { ok: false, error: 'Ask AI is not configured (Messages API key missing).' };
  }

  var quota = finopsAskConsumeQuota_(auth.email);
  if (!quota.ok) {
    return { ok: false, error: quota.message || 'Ask quota check failed.' };
  }
  if (!quota.allowed) {
    finopsAskLogActivity_(auth, 'finops_ask_error', panelId, 'quota:' + question);
    return {
      ok: false,
      error: quota.message || 'Daily Ask AI limit reached.',
      quotaRemaining: 0,
      quotaCount: quota.count,
      quotaCap: quota.cap,
    };
  }

  var contextSummary = finopsAskSanitizeContextSummary_(request.contextSummary);
  var contextLabel =
    String(panelId) +
    ' · ' +
    (dataSource.mode === 'snapshot'
      ? 'Snapshot' + (dataSource.snapshotDate ? ' ' + dataSource.snapshotDate : '')
      : 'Live');

  try {
    var systemPrompt = finopsAskBuildSystemPrompt_({
      panelId: panelId,
      dataSource: dataSource,
    });
    var messages = finopsAskBuildMessages_(
      {
        question: question,
        panelId: panelId,
        dataSource: dataSource,
        filters: request.filters || {},
        fetchedAt: request.fetchedAt || null,
        conversationTurns: request.conversationTurns || [],
      },
      contextSummary
    );
    var llm = finopsAskCallMessages_(systemPrompt, messages);
    var answer = llm.text || 'No answer returned.';
    finopsAskLogActivity_(
      auth,
      'finops_ask_submit',
      panelId,
      question + ' | ' + (dataSource.mode || 'live') + (dataSource.snapshotDate ? ':' + dataSource.snapshotDate : '')
    );
    finopsAskAppendChatLog_({
      at: new Date().toISOString(),
      email: auth.email || '',
      panelId: panelId,
      dataSource: dataSource,
      question: question,
      answer: answer,
      ok: true,
      usageMeta: llm.usageMeta || null,
    });
    return {
      ok: true,
      answer: answer,
      contextLabel: contextLabel,
      citations: [],
      warnings: contextSummary.truncated ? [String(contextSummary.note || 'Context truncated')] : [],
      usageMeta: llm.usageMeta || null,
      quotaRemaining: quota.remaining,
      quotaCount: quota.count,
      quotaCap: quota.cap,
    };
  } catch (e) {
    var msg = e && e.message ? e.message : 'Ask AI failed.';
    finopsAskLogActivity_(auth, 'finops_ask_error', panelId, question + ' | ' + msg);
    finopsAskAppendChatLog_({
      at: new Date().toISOString(),
      email: auth.email || '',
      panelId: panelId,
      dataSource: dataSource,
      question: question,
      answer: null,
      ok: false,
      error: msg,
    });
    var userError = 'Ask AI could not complete that request. Try again or narrow filters.';
    var lower = String(msg).toLowerCase();
    if (
      lower.indexOf('model') >= 0 ||
      lower.indexOf('not_found') >= 0 ||
      lower.indexOf('retired') >= 0 ||
      lower.indexOf('invalid') >= 0
    ) {
      userError =
        'Ask AI model is invalid or retired. An admin should set FINOPS_ASK_MODEL to an active model (e.g. claude-sonnet-4-6).';
    } else if (lower.indexOf('authentication') >= 0 || lower.indexOf('api key') >= 0 || lower.indexOf('401') >= 0) {
      userError = 'Ask AI API key was rejected. An admin should check FINOPS_ASK_ANTHROPIC_API_KEY.';
    } else if (lower.indexOf('rate') >= 0 || lower.indexOf('429') >= 0) {
      userError = 'Ask AI is rate-limited right now. Wait a moment and try again.';
    }
    return {
      ok: false,
      error: userError,
      quotaRemaining: quota.remaining,
      quotaCount: quota.count,
      quotaCap: quota.cap,
    };
  }
}

/**
 * @param {string=} panelId
 * @return {!Object}
 */
function _diag_finopsAskSample(panelId) {
  return askFinOpsQuestion({
    panelId: panelId || 'operations',
    question: 'Summarize the top attention items in one short paragraph.',
    dataSource: { mode: 'live' },
    filters: {},
    contextSummary: {
      kpis: { note: 'Diagnostic sample context only.' },
      rowsTopN: [],
    },
  });
}

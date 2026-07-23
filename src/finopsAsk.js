/**
 * PRD version 3.0.12 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 032 - FinOps Ask AI (panel-scoped Q&A).
 */

/** @const {number} */
var FINOPS_ASK_QUESTION_MAX_ = 500;

/** Soft budget for panel JSON context sent to the model (chars). */
var FINOPS_ASK_CONTEXT_MAX_CHARS_ = 480000;

/** Absolute ceiling after progressive trim (chars). */
var FINOPS_ASK_CONTEXT_HARD_MAX_CHARS_ = 560000;

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

  // Progressive trim: drop bulky optional keys, then hard-cap.
  var trimmed = null;
  try {
    trimmed = JSON.parse(json);
  } catch (_) {
    return {
      truncated: true,
      note: 'Context exceeded size budget and could not be re-parsed.',
      preview: json.substring(0, 4000),
    };
  }
  var dropped = [];
  var dropKeys = [
    'charts',
    'sankey',
    'heatmap',
    'historicalRevenueItems',
    'futureRevenueItems',
    'revenueItemsByAgreement',
    'laborHours',
    'pnlById',
    'rawRows',
    // Resource assignments: projects view duplicates person×week grids (+ actuals).
    'projects',
  ];

  function noteDrop_(label) {
    dropped.push(label);
    if (!trimmed.notes) trimmed.notes = [];
    if (trimmed.notes.push) {
      trimmed.notes.push('Omitted ' + label + ' to fit Ask context budget.');
    }
  }

  function measure_() {
    try {
      json = JSON.stringify(trimmed);
      return json.length;
    } catch (_) {
      return FINOPS_ASK_CONTEXT_HARD_MAX_CHARS_ + 1;
    }
  }

  var di;
  for (di = 0; di < dropKeys.length; di++) {
    if (measure_() <= FINOPS_ASK_CONTEXT_MAX_CHARS_) {
      break;
    }
    if (trimmed && Object.prototype.hasOwnProperty.call(trimmed, dropKeys[di])) {
      delete trimmed[dropKeys[di]];
      noteDrop_(dropKeys[di]);
    }
    if (trimmed && trimmed.dataset && typeof trimmed.dataset === 'object') {
      if (Object.prototype.hasOwnProperty.call(trimmed.dataset, dropKeys[di])) {
        delete trimmed.dataset[dropKeys[di]];
        noteDrop_('dataset.' + dropKeys[di]);
      }
    }
  }

  // Last resort for still-oversize person week grids: keep roster + totals, drop byWeek maps.
  if (measure_() > FINOPS_ASK_CONTEXT_MAX_CHARS_ && trimmed && trimmed.dataset) {
    finopsAskSlimWeekMapsInPlace_(trimmed.dataset);
    noteDrop_('per-week detail maps');
  } else if (measure_() > FINOPS_ASK_CONTEXT_MAX_CHARS_) {
    finopsAskSlimWeekMapsInPlace_(trimmed);
    noteDrop_('per-week detail maps');
  }

  if (measure_() > FINOPS_ASK_CONTEXT_HARD_MAX_CHARS_) {
    return {
      truncated: true,
      note:
        'Context still exceeded size budget after trim; Clear Ask and retry, or narrow panel filters.',
      panelId: trimmed && trimmed.panelId ? trimmed.panelId : null,
      kpis: trimmed && trimmed.kpis ? trimmed.kpis : null,
      alerts: trimmed && trimmed.alerts ? trimmed.alerts : null,
      notes: trimmed && trimmed.notes ? trimmed.notes : [],
      preview: json.substring(0, Math.min(12000, FINOPS_ASK_CONTEXT_HARD_MAX_CHARS_)),
    };
  }

  if (dropped.length) {
    trimmed.truncated = true;
    trimmed.truncateNote =
      'Omitted: ' + dropped.join(', ') + '. Clear Ask after narrowing filters for fuller detail.';
  }
  return trimmed;
}

/**
 * Strip nested byWeek / byWeekTotalPercent maps to shrink Ask context.
 * @param {?Object} root
 */
function finopsAskSlimWeekMapsInPlace_(root) {
  if (!root || typeof root !== 'object') return;
  var persons = root.persons || root.people;
  if (persons && persons.length) {
    for (var i = 0; i < persons.length; i++) {
      var p = persons[i];
      if (!p || typeof p !== 'object') continue;
      delete p.byWeekTotalPercent;
      delete p.byWeek;
      var projs = p.projects;
      if (projs && typeof projs === 'object') {
        var list = projs.length != null ? projs : null;
        if (list) {
          for (var j = 0; j < list.length; j++) {
            if (list[j]) delete list[j].byWeek;
          }
        } else {
          for (var pk in projs) {
            if (Object.prototype.hasOwnProperty.call(projs, pk) && projs[pk]) {
              delete projs[pk].byWeek;
            }
          }
        }
      }
    }
  }
  var projects = root.projects;
  if (projects && projects.length) {
    for (var pi = 0; pi < projects.length; pi++) {
      var proj = projects[pi];
      if (!proj || typeof proj !== 'object') continue;
      delete proj.byWeekTotals;
      var pm = proj.persons || proj.personsMap;
      if (pm && typeof pm === 'object') {
        var plist = pm.length != null ? pm : null;
        if (plist) {
          for (var pj = 0; pj < plist.length; pj++) {
            if (plist[pj]) delete plist[pj].byWeek;
          }
        } else {
          for (var mk in pm) {
            if (Object.prototype.hasOwnProperty.call(pm, mk) && pm[mk]) {
              delete pm[mk].byWeek;
            }
          }
        }
      }
    }
  }
}

/**
 * @param {!Object=} request
 * @return {string}
 */
function finopsAskBuildSystemPrompt_(request) {
  // Keep this byte-stable across turns so Anthropic prompt cache can hit.
  // Panel / Live vs snapshot grounding lives in the cached context JSON block.
  return [
    'You are FinOps Ask, a read-only assistant inside FinOps Performance Hub.',
    'Answer ONLY using the provided JSON dashboard panel context.',
    'The context JSON includes panelId, dataSource, filters, and contextSummary.dataset (panel data captured when the conversation started).',
    'Do not invent metrics, names, or dates that are not present in the context.',
    'If the context is insufficient or truncated, say so plainly and suggest refreshing the panel or clearing Ask to reload context.',
    'Always ground answers with the panel id and data source from the context JSON.',
    'Use concise rich markdown (lists, bold, headings). No HTML script tags.',
  ].join(' ');
}

/**
 * Build Messages API turns with a stable cached panel-context prefix.
 * @param {!Object} request
 * @param {!Object} contextSummary
 * @return {!Array<!Object>}
 */
function finopsAskBuildMessages_(request, contextSummary) {
  var useCache = finopsAskPromptCacheEnabled_();
  var ttl = finopsAskPromptCacheTtl_();
  var contextPayload = JSON.stringify({
    panelId: request.panelId,
    dataSource: request.dataSource || {},
    filters: request.filters || {},
    contextSummary: contextSummary,
  });

  var history = [];
  var turns = request.conversationTurns;
  if (turns && turns.length) {
    var start = Math.max(0, turns.length - 8);
    for (var i = start; i < turns.length; i++) {
      var t = turns[i];
      if (!t || !t.role || !t.content) {
        continue;
      }
      var role = String(t.role) === 'assistant' ? 'assistant' : 'user';
      history.push({ role: role, content: String(t.content).substring(0, 4000) });
    }
  }

  var firstQuestion = String(request.question || '');
  var rest = [];
  if (history.length && history[0].role === 'user') {
    firstQuestion = history[0].content;
    rest = history.slice(1);
  } else if (history.length) {
    rest = history;
  }

  var contextBlock = {
    type: 'text',
    text:
      'Dashboard panel context (JSON). Use only this data for answers.\n' + contextPayload,
  };
  if (useCache) {
    contextBlock.cache_control = finopsAskCacheControl_(ttl);
  }

  var messages = [
    {
      role: 'user',
      content: [
        contextBlock,
        {
          type: 'text',
          text: 'Question: ' + String(firstQuestion).substring(0, 4000),
        },
      ],
    },
  ];

  for (var r = 0; r < rest.length; r++) {
    messages.push({
      role: rest[r].role,
      content: rest[r].content,
    });
  }

  // Follow-up turn: prior history already includes the first question; append the new one.
  if (history.length > 0) {
    messages.push({
      role: 'user',
      content: 'Question: ' + String(request.question || '').substring(0, 4000),
    });
  }

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
    var llm = finopsAskCallMessages_(systemPrompt, messages, {
      promptCache: finopsAskPromptCacheEnabled_(),
    });
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
      warnings: contextSummary.truncated
        ? [
            String(
              contextSummary.truncateNote ||
                contextSummary.note ||
                'Context trimmed to fit size budget'
            ),
          ]
        : [],
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

/**
 * PRD version 3.17.0 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 037: AI synopsis for completed Engagement Reviews (locked decision
 * #25). Assembles review metadata + meeting notes + Engagement Update
 * qualitative/quantitative data into a prompt, calls the shared Hub
 * Anthropic client (`finopsAskAnthropic.js`), and persists the parsed JSON
 * on `fos_engagement_reviews.ai_synopsis_json`. Admin-only gating and the
 * `google.script.run` entry point live in `engagementReviewApi.js` /
 * `engagementReviewAuth.js` (not this file); `generateEngagementReviewSynopsis_`
 * only enforces the `status === 'completed'` precondition.
 */

/** @const {string} */
var ER_TABLE_NOTES_ = 'fos_engagement_review_notes';

/* ------------------------------------------------------------------------- */
/* Text helpers.                                                             */
/* ------------------------------------------------------------------------- */

/**
 * Minimal HTML-to-text conversion for meeting notes (rich text editor
 * output). Not a full sanitizer - only used to build an LLM prompt, never
 * rendered back as HTML.
 *
 * @param {?string} html
 * @return {string}
 * @private
 */
function erStripHtmlToText_(html) {
  var s = String(html || '');
  if (!s) return '';
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|h[1-6])>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');
  s = s.replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/**
 * @param {*} v
 * @return {string}
 * @private
 */
function erNumOrNa_(v) {
  return v === null || v === undefined || v === '' ? 'n/a' : String(v);
}

/**
 * @param {?{ rag?: string, subtext?: string }} dim
 * @return {string}
 * @private
 */
function erDimSummary_(dim) {
  if (!dim) return 'n/a';
  var rag = dim.rag || 'n/a';
  var subtext = dim.subtext ? ' - ' + dim.subtext : '';
  return rag + subtext;
}

/**
 * @param {?Array<*>} list
 * @return {string}
 * @private
 */
function erJoinList_(list) {
  if (!list || !list.length) return '';
  var out = [];
  for (var i = 0; i < list.length; i++) {
    if (list[i]) out.push(String(list[i]));
  }
  return out.join('; ');
}

/**
 * @param {?Array<!{ severity?: string, text?: string }>} list
 * @return {string}
 * @private
 */
function erJoinRiskList_(list) {
  if (!list || !list.length) return '';
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    if (!r) continue;
    var sev = r.severity ? String(r.severity).toUpperCase() + ': ' : '';
    out.push(sev + String(r.text || ''));
  }
  return out.join('; ');
}

/* ------------------------------------------------------------------------- */
/* Prompt context assembly.                                                  */
/* ------------------------------------------------------------------------- */

/** @const {number} Per-note body truncation to bound prompt size. */
var ER_SYNOPSIS_NOTE_MAX_CHARS_ = 2000;

/**
 * Formats one `fos_engagement_updates` row (qualitative + quantitative
 * snapshot columns) into a compact text block for the synopsis prompt.
 *
 * @param {!Object} update
 * @param {number} index 1-based row number for the prompt.
 * @return {string}
 * @private
 */
function erFormatUpdateForSynopsis_(update, index) {
  update = update || {};
  var qual = update.qualitative && typeof update.qualitative === 'object' ? update.qualitative : {};
  var quant =
    update.quantitative_snapshot && typeof update.quantitative_snapshot === 'object'
      ? update.quantitative_snapshot
      : {};
  var lines = [];
  lines.push(
    index +
      '. ' +
      (update.agreement_name || update.agreement_fibery_id || '(unnamed engagement)') +
      (update.company_name ? ' (' + update.company_name + ')' : '') +
      ' - period ' +
      (update.reporting_period || 'n/a') +
      ' - overall: ' +
      (update.overall_rag || 'n/a')
  );
  lines.push('   Assigned owner: ' + (update.assigned_owner_name || update.assigned_owner_email || 'n/a'));
  lines.push(
    '   RAG: schedule=' +
      erDimSummary_(qual.schedule) +
      ', cost_hours=' +
      erDimSummary_(qual.cost_hours) +
      ', margin=' +
      erDimSummary_(qual.margin) +
      ', client_sentiment=' +
      erDimSummary_(qual.client_sentiment)
  );
  if (qual.key_developments && qual.key_developments.length) {
    lines.push('   Key developments: ' + erJoinList_(qual.key_developments));
  }
  if (qual.priorities_next && qual.priorities_next.length) {
    lines.push('   Priorities next period: ' + erJoinList_(qual.priorities_next));
  }
  if (qual.risks && qual.risks.length) {
    lines.push('   Risks: ' + erJoinRiskList_(qual.risks));
  }
  if (qual.revenue_callout_html) {
    lines.push('   Revenue context: ' + erStripHtmlToText_(qual.revenue_callout_html));
  }
  if (qual.margin_footnote) {
    lines.push('   Margin footnote: ' + String(qual.margin_footnote));
  }
  lines.push(
    '   KPIs: hours MTD actual=' +
      erNumOrNa_(quant.hoursMtd && quant.hoursMtd.actual) +
      ' planned=' +
      erNumOrNa_(quant.hoursMtd && quant.hoursMtd.planned) +
      '; cost MTD actual=' +
      erNumOrNa_(quant.costMtd && quant.costMtd.actual) +
      ' planned=' +
      erNumOrNa_(quant.costMtd && quant.costMtd.planned) +
      '; EAC hours=' +
      erNumOrNa_(quant.eacHours && quant.eacHours.value) +
      '/' +
      erNumOrNa_(quant.eacHours && quant.eacHours.budgeted) +
      '; EAC $=' +
      erNumOrNa_(quant.eacDollars && quant.eacDollars.value) +
      '/' +
      erNumOrNa_(quant.eacDollars && quant.eacDollars.budgeted) +
      '; revenue invoiced MTD=' +
      erNumOrNa_(quant.revenue && quant.revenue.invoicedMtd) +
      ' FYTD=' +
      erNumOrNa_(quant.revenue && quant.revenue.invoicedFytd)
  );
  return lines.join('\n');
}

/**
 * Builds the plain-text prompt context for the AI synopsis: review
 * metadata, all meeting notes (`bundle.notes` - see the caller note below),
 * and every Engagement Update on the review.
 *
 * NOTE: `erGetReviewBundle_` (`engagementReviewStore.js`) does not return
 * notes yet (the Engagement Update status-pack migration added the notes
 * table separately). `generateEngagementReviewSynopsis_` fetches notes
 * directly from Supabase and attaches them as `bundle.notes` before calling
 * this function; once the store is updated to include notes in the bundle,
 * this function needs no change.
 *
 * @param {!Object} bundle `erGetReviewBundle_()` result, plus `notes`.
 * @param {!Array<!Object>} updates Flattened `fos_engagement_updates` rows for the review.
 * @return {string}
 */
function erBuildSynopsisContext_(bundle, updates) {
  var review = (bundle && bundle.review) || {};
  var notes = (bundle && bundle.notes) || [];
  var lines = [];
  lines.push('Engagement Review: ' + (review.name || '(untitled)'));
  lines.push('Target date: ' + (review.target_date || 'n/a'));
  lines.push('Status: ' + (review.status || 'n/a'));
  lines.push('');
  lines.push('=== Meeting notes ===');
  if (!notes.length) {
    lines.push('(no meeting notes recorded)');
  } else {
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i] || {};
      var title = n.title ? String(n.title).trim() : 'Note ' + (i + 1);
      var body = erStripHtmlToText_(n.body_html);
      if (body.length > ER_SYNOPSIS_NOTE_MAX_CHARS_) {
        body = body.slice(0, ER_SYNOPSIS_NOTE_MAX_CHARS_) + '...';
      }
      lines.push('- ' + title + ': ' + (body || '(empty)'));
    }
  }
  lines.push('');
  lines.push('=== Engagement Updates ===');
  var list = updates || [];
  if (!list.length) {
    lines.push('(no engagement updates on this review)');
  } else {
    for (var j = 0; j < list.length; j++) {
      lines.push(erFormatUpdateForSynopsis_(list[j], j + 1));
    }
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------------- */
/* Model output parsing.                                                     */
/* ------------------------------------------------------------------------- */

/**
 * @param {*} v
 * @return {!Array<string>}
 * @private
 */
function erToStringArray_(v) {
  if (!v) return [];
  if (Object.prototype.toString.call(v) !== '[object Array]') {
    var s = String(v).trim();
    return s ? [s] : [];
  }
  var out = [];
  for (var i = 0; i < v.length; i++) {
    if (v[i] === null || v[i] === undefined) continue;
    var s2 = String(v[i]).trim();
    if (s2) out.push(s2);
  }
  return out;
}

/**
 * @param {*} v
 * @return {!Array<!{ agreement_fibery_id: string, name: string, summary: string }>}
 * @private
 */
function erToPerEngagementArray_(v) {
  if (!v || Object.prototype.toString.call(v) !== '[object Array]') return [];
  var out = [];
  for (var i = 0; i < v.length; i++) {
    var item = v[i];
    if (!item || typeof item !== 'object') continue;
    out.push({
      agreement_fibery_id: item.agreement_fibery_id != null ? String(item.agreement_fibery_id) : '',
      name: item.name != null ? String(item.name) : '',
      summary: item.summary != null ? String(item.summary) : '',
    });
  }
  return out;
}

/**
 * Fallback synopsis object when the model response cannot be parsed as the
 * expected JSON shape. Keeps the raw text (truncated) so the reviewer can
 * still see what the model produced instead of losing the response.
 *
 * @param {string} rawText
 * @return {!Object}
 * @private
 */
function erFallbackSynopsis_(rawText) {
  var snippet = String(rawText || '').trim();
  if (snippet.length > 1200) {
    snippet = snippet.slice(0, 1200) + '...';
  }
  return {
    version: 1,
    headline: 'Synopsis generated (unstructured model response).',
    themes: [],
    decisions: [],
    risks: [],
    actions: [],
    per_engagement: [],
    rawText: snippet,
  };
}

/**
 * Extracts the synopsis JSON object from raw model text. Handles a plain
 * JSON object, a fenced ```json ... ``` block, or JSON embedded with
 * surrounding commentary. Falls back to a structured placeholder object
 * (never throws) when no valid JSON object can be recovered.
 *
 * @param {string} text Raw Anthropic response text.
 * @return {!Object} Matches the `ai_synopsis_json` schema (see feature 037).
 */
function erParseSynopsisJson_(text) {
  var raw = String(text || '').trim();
  var candidate = raw;
  var fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    candidate = fenceMatch[1].trim();
  } else {
    var firstBrace = raw.indexOf('{');
    var lastBrace = raw.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidate = raw.slice(firstBrace, lastBrace + 1);
    }
  }
  var parsed = null;
  try {
    parsed = JSON.parse(candidate);
  } catch (e) {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object') {
    return erFallbackSynopsis_(raw);
  }
  return {
    version: 1,
    headline: String(parsed.headline || '').trim() || 'Engagement review synopsis',
    themes: erToStringArray_(parsed.themes),
    decisions: erToStringArray_(parsed.decisions),
    risks: erToStringArray_(parsed.risks),
    actions: erToStringArray_(parsed.actions),
    per_engagement: erToPerEngagementArray_(parsed.per_engagement),
  };
}

/* ------------------------------------------------------------------------- */
/* System prompt + generation.                                               */
/* ------------------------------------------------------------------------- */

/**
 * @return {string}
 * @private
 */
function erSynopsisSystemPrompt_() {
  return (
    'You are an assistant that writes a synthesis for a Delivery engagement review call. ' +
    'You will be given the review metadata, meeting notes, and one or more Engagement Updates ' +
    '(status packs) with qualitative RAG assessments and quantitative KPIs. ' +
    'Respond with ONLY a single JSON object (no markdown code fences, no commentary before or ' +
    'after) matching exactly this shape: {"version": 1, "headline": string, "themes": string[], ' +
    '"decisions": string[], "risks": string[], "actions": string[], "per_engagement": ' +
    '[{"agreement_fibery_id": string, "name": string, "summary": string}]}. ' +
    '"headline" is a one-sentence executive summary of the review. "themes" are cross-engagement ' +
    'patterns worth calling out. "decisions" are decisions made or confirmed on the call. "risks" ' +
    'are the most material risks across engagements. "actions" are concrete follow-up actions, ' +
    'naming an owner when one is known from the context. "per_engagement" has exactly one entry ' +
    'per Engagement Update, each summarizing that engagement in two to three sentences that ' +
    'reference its overall RAG status and the most relevant KPIs. Keep every string concise and ' +
    'factual, grounded only in the provided context. Do not invent data that is not present.'
  );
}

/**
 * Generates (or regenerates) the AI synopsis for a completed Engagement
 * Review and persists it as JSON on `fos_engagement_reviews`. Admin-only
 * gating happens in the caller (`engagementReviewApi.js`); this function
 * only enforces the `status === 'completed'` precondition (locked decision
 * #25) and returns a safe, user-friendly message on any failure.
 *
 * @param {string} reviewId
 * @param {string} authEmail Caller's email (for quota + `ai_synopsis_generated_by`).
 * @return {!{ ok: boolean, message?: string, synopsis?: !Object, generatedAt?: string }}
 */
function generateEngagementReviewSynopsis_(reviewId, authEmail) {
  var id = String(reviewId || '').trim();
  if (!id) {
    return { ok: false, message: 'Review id is required.' };
  }
  if (!isSupabaseConfigured_()) {
    return { ok: false, message: 'Datastore is not configured.' };
  }

  var bundle = erGetReviewBundle_(id);
  if (!bundle.ok) {
    return { ok: false, message: bundle.message || 'Could not load review.' };
  }
  var review = bundle.review || {};
  if (String(review.status || '').toLowerCase() !== 'completed') {
    return {
      ok: false,
      message: 'Generate synopsis is only available once the review status is Completed.',
    };
  }

  var notesRes = supabaseSelect_(
    ER_TABLE_NOTES_,
    { review_id: 'eq.' + id, order: 'sort_order.asc,created_at.asc' },
    '*',
    500
  );
  bundle.notes = notesRes.ok ? erRows_(notesRes.json) : [];
  if (!notesRes.ok) {
    console.warn('generateEngagementReviewSynopsis_: notes fetch failed: ' + (notesRes.message || ''));
  }

  var updates = [];
  var updatesByAgreement = bundle.updatesByAgreement || {};
  var agreementIds = Object.keys(updatesByAgreement);
  for (var i = 0; i < agreementIds.length; i++) {
    var rows = updatesByAgreement[agreementIds[i]] || [];
    for (var j = 0; j < rows.length; j++) {
      updates.push(rows[j]);
    }
  }
  updates.sort(function (a, b) {
    var sa = a.sort_order != null ? Number(a.sort_order) : 0;
    var sb = b.sort_order != null ? Number(b.sort_order) : 0;
    if (sa !== sb) return sa - sb;
    var pa = String(a.reporting_period || '');
    var pb = String(b.reporting_period || '');
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  });

  if (!bundle.notes.length && !updates.length) {
    return {
      ok: false,
      message: 'This review has no meeting notes or Engagement Updates to summarize yet.',
    };
  }

  var context = erBuildSynopsisContext_(bundle, updates);

  if (authEmail && typeof finopsAskConsumeQuota_ === 'function') {
    var quota = finopsAskConsumeQuota_(authEmail);
    if (quota && quota.ok && quota.allowed === false) {
      return { ok: false, message: quota.message || 'Daily Ask AI limit reached.' };
    }
  }

  var result;
  try {
    result = finopsAskCallMessages_(erSynopsisSystemPrompt_(), [{ role: 'user', content: context }]);
  } catch (e) {
    return {
      ok: false,
      message: 'AI synopsis request failed: ' + (e && e.message ? e.message : 'unknown error'),
    };
  }

  var synopsis = erParseSynopsisJson_(result && result.text);
  var generatedAt = new Date().toISOString();

  var patched = erPatchById_(ER_TABLE_REVIEWS_, id, {
    ai_synopsis_json: synopsis,
    ai_synopsis_generated_at: generatedAt,
    ai_synopsis_generated_by: authEmail || null,
    updated_by_email: authEmail || null,
    updated_at: generatedAt,
  });
  if (!patched.ok) {
    return { ok: false, message: patched.message || 'Synopsis generated but could not be saved.' };
  }

  return { ok: true, synopsis: synopsis, generatedAt: generatedAt };
}

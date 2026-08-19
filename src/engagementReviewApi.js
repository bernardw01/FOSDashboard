/**
 * PRD version 3.7.6 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 037: google.script.run surface for Engagement Reviews + status packs.
 */

/**
 * @param {*} err
 * @return {!{ ok: false, message: string }}
 */
function erApiFail_(err) {
  var msg = err && err.message ? String(err.message) : 'Request failed.';
  return { ok: false, message: engagementReviewGateMessage_(msg) };
}

/**
 * @param {!Object} auth
 * @param {!Object} update mapped update
 * @return {boolean}
 */
function erCanEditStatusPack_(auth, update) {
  if (isAdminUser_(auth)) return true;
  var my = normalizeEmail_(auth.email);
  var owner = normalizeEmail_(String((update && update.assignedOwnerEmail) || ''));
  if (owner && owner === my) return true;
  var author = normalizeEmail_(String((update && update.submittedByEmail) || ''));
  return !!(author && author === my);
}

/**
 * @param {string=} filter
 * @return {!Object}
 */
function listEngagementReviews(filter) {
  try {
    requireEngagementReviewAccessForApi_();
    return erListReviews_(filter);
  } catch (e) {
    return erApiFail_(e);
  }
}

/**
 * @param {string} reviewId
 * @return {!Object}
 */
function getEngagementReview(reviewId) {
  try {
    var auth = requireEngagementReviewAccessForApi_();
    var bundle = erGetReviewBundle_(reviewId);
    if (!bundle.ok) return bundle;
    var updates = (bundle.updates || []).map(erMapUpdateRow_);
    return {
      ok: true,
      review: bundle.review,
      agreements: bundle.agreements,
      participants: bundle.participants,
      recordings: bundle.recordings,
      notes: bundle.notes || [],
      updates: updates,
      updatesByAgreement: bundle.updatesByAgreement,
      questionSet: getEngagementReviewQuestionSetPayload_(),
      isAdmin: isAdminUser_(auth),
      canCreate: canCreateEngagementReview_(auth),
    };
  } catch (e) {
    return erApiFail_(e);
  }
}

/**
 * @param {!Object} fields
 * @return {!Object}
 */
function createEngagementReview(fields) {
  try {
    var auth = requireEngagementReviewCreateForApi_();
    return erCreateReview_(fields || {}, auth.email);
  } catch (e) {
    return erApiFail_(e);
  }
}

/**
 * @param {string} reviewId
 * @param {!Object} fields
 * @return {!Object}
 */
function updateEngagementReview(reviewId, fields) {
  try {
    var auth = requireEngagementReviewCreateForApi_();
    return erUpdateReview_(reviewId, fields || {}, auth.email);
  } catch (e) {
    return erApiFail_(e);
  }
}

/**
 * @param {string} reviewId
 * @return {!Object}
 */
function deleteEngagementReview(reviewId) {
  try {
    requireEngagementReviewAdminForApi_();
    return erDeleteReview_(reviewId);
  } catch (e) {
    return erApiFail_(e);
  }
}

/**
 * @param {string} reviewId
 * @param {!Object} agreement
 * @return {!Object}
 */
function addEngagementReviewAgreement(reviewId, agreement) {
  try {
    requireEngagementReviewAdminForApi_();
    return erUpsertAgreementLink_(reviewId, agreement || {});
  } catch (e) {
    return erApiFail_(e);
  }
}

/**
 * @param {string} reviewId
 * @param {string} agreementFiberyId
 * @return {!Object}
 */
function removeEngagementReviewAgreement(reviewId, agreementFiberyId) {
  try {
    requireEngagementReviewAdminForApi_();
    return erRemoveAgreementLink_(reviewId, agreementFiberyId);
  } catch (e) {
    return erApiFail_(e);
  }
}

/**
 * @param {string} reviewId
 * @return {!Object}
 */
function suggestEngagementReviewAgreementsFromAlerts(reviewId) {
  try {
    requireEngagementReviewAdminForApi_();
    return erSuggestAgreementsFromAlerts_(reviewId);
  } catch (e) {
    return erApiFail_(e);
  }
}

/**
 * @param {string} reviewId
 * @param {!Object} participant
 * @return {!Object}
 */
function addEngagementReviewParticipant(reviewId, participant) {
  try {
    requireEngagementReviewAdminForApi_();
    var email = normalizeEmail_(String((participant && participant.email) || ''));
    if (!erIsAuthUserEmail_(email)) {
      return {
        ok: false,
        message: 'Only users on the auth Users sheet can be added as participants.',
      };
    }
    return erUpsertParticipant_(reviewId, participant || {});
  } catch (e) {
    return erApiFail_(e);
  }
}

/**
 * @param {string} reviewId
 * @param {string} email
 * @return {!Object}
 */
function removeEngagementReviewParticipant(reviewId, email) {
  try {
    requireEngagementReviewAdminForApi_();
    return erRemoveParticipant_(reviewId, email);
  } catch (e) {
    return erApiFail_(e);
  }
}

/**
 * @param {string} reviewId
 * @return {!Object}
 */
function suggestEngagementReviewParticipants(reviewId) {
  try {
    requireEngagementReviewAdminForApi_();
    return erSuggestParticipantsFromOwners_(reviewId);
  } catch (e) {
    return erApiFail_(e);
  }
}

/**
 * @param {string} reviewId
 * @return {!Object}
 */
function createEngagementReviewCalendarEvent(reviewId) {
  try {
    requireEngagementReviewAdminForApi_();
    return erCreateOrUpdateCalendarEvent_(reviewId, '');
  } catch (e) {
    return erApiFail_(e);
  }
}

/**
 * @param {string} reviewId
 * @param {string} fileName
 * @param {string} mimeType
 * @param {string} base64Data
 * @return {!Object}
 */
function uploadEngagementReviewRecording(reviewId, fileName, mimeType, base64Data) {
  try {
    var auth = requireEngagementReviewAdminForApi_();
    return erUploadRecording_(reviewId, fileName, mimeType, base64Data, auth.email);
  } catch (e) {
    return erApiFail_(e);
  }
}

/**
 * Legacy questionnaire submit (kept for back-compat). Prefer createEngagementStatusPack.
 * @param {string} reviewId
 * @param {string} agreementFiberyId
 * @param {!Object} payload
 * @return {!Object}
 */
function createEngagementUpdate(reviewId, agreementFiberyId, payload) {
  try {
    var auth = requireEngagementReviewAccessForApi_();
    var bundle = erGetReviewBundle_(reviewId);
    if (!bundle.ok) return bundle;
    var aid = String(agreementFiberyId || '').trim();
    if (!aid) return { ok: false, message: 'Agreement id is required.' };

    var linked = false;
    var ownerEmail = '';
    var agreements = bundle.agreements || [];
    for (var i = 0; i < agreements.length; i++) {
      if (String(agreements[i].agreement_fibery_id) === aid) {
        linked = true;
        ownerEmail = normalizeEmail_(String(agreements[i].owner_email || ''));
        break;
      }
    }
    if (!linked && !isAdminUser_(auth)) {
      return { ok: false, message: 'Agreement is not on this review.' };
    }

    var canSubmit = isAdminUser_(auth) || canCreateEngagementReview_(auth);
    if (!canSubmit) {
      return { ok: false, message: 'You may not submit Engagement Updates.' };
    }

    var validated = validateEngagementUpdateAnswers_(
      payload && payload.answers,
      payload && payload.questionSetVersion
    );
    if (!validated.ok) {
      return { ok: false, message: validated.message };
    }

    return erInsertUpdate_({
      review_id: String(reviewId),
      agreement_fibery_id: aid,
      submitted_by_email: auth.email,
      executive_summary: validated.executiveSummary,
      traffic_light: validated.trafficLight,
      answers: validated.answers,
      question_set_version: validated.questionSetVersion,
    });
  } catch (e) {
    return erApiFail_(e);
  }
}

/**
 * @return {!Object}
 */
function listEngagementUpdateProjects() {
  try {
    var auth = requireEngagementReviewCreateForApi_();
    return listDeliveryInProgressProjectsForEngagementUpdate_(auth);
  } catch (e) {
    return erApiFail_(e);
  }
}

/**
 * Create DEAP status-pack Engagement Update.
 * @param {string} reviewId
 * @param {!Object} fields
 * @return {!Object}
 */
function createEngagementStatusPack(reviewId, fields) {
  try {
    var auth = requireEngagementReviewCreateForApi_();
    var aid = String((fields && fields.agreementFiberyId) || '').trim();
    if (!aid) return { ok: false, message: 'Project is required.' };

    if (!isAdminUser_(auth)) {
      var picker = listDeliveryInProgressProjectsForEngagementUpdate_(auth);
      if (!picker.ok) return picker;
      var allowed = false;
      var projects = picker.projects || [];
      for (var i = 0; i < projects.length; i++) {
        if (String(projects[i].fiberyId) === aid) {
          allowed = true;
          break;
        }
      }
      if (!allowed) {
        return {
          ok: false,
          message: 'You may only create updates for Delivery In Progress projects you own.',
        };
      }
    }

    return erCreateStatusPackUpdate_(reviewId, fields || {}, auth.email);
  } catch (e) {
    return erApiFail_(e);
  }
}

/**
 * @param {string} updateId
 * @param {!Object} fields
 * @return {!Object}
 */
function updateEngagementStatusPack(updateId, fields) {
  try {
    var auth = requireEngagementReviewCreateForApi_();
    var loaded = erGetStatusPackUpdate_(updateId);
    if (!loaded.ok) return loaded;
    if (!erCanEditStatusPack_(auth, loaded.update)) {
      return { ok: false, message: 'You may not edit this Engagement Update.' };
    }
    return erUpdateStatusPackUpdate_(updateId, fields || {}, auth.email);
  } catch (e) {
    return erApiFail_(e);
  }
}

/**
 * @param {string} updateId
 * @return {!Object}
 */
function getEngagementStatusPack(updateId) {
  try {
    requireEngagementReviewAccessForApi_();
    return erGetStatusPackUpdate_(updateId);
  } catch (e) {
    return erApiFail_(e);
  }
}

/**
 * @param {string} updateId
 * @return {!Object}
 */
function refreshEngagementStatusPackMetrics(updateId) {
  try {
    var auth = requireEngagementReviewCreateForApi_();
    var loaded = erGetStatusPackUpdate_(updateId);
    if (!loaded.ok) return loaded;
    if (!erCanEditStatusPack_(auth, loaded.update)) {
      return { ok: false, message: 'You may not refresh this Engagement Update.' };
    }
    return erRefreshStatusPackMetrics_(updateId, auth.email);
  } catch (e) {
    return erApiFail_(e);
  }
}

/**
 * @param {string} reviewId
 * @param {!Array<string>} orderedIds
 * @return {!Object}
 */
function reorderEngagementStatusPacks(reviewId, orderedIds) {
  try {
    requireEngagementReviewAdminForApi_();
    return erReorderStatusPackUpdates_(reviewId, orderedIds || []);
  } catch (e) {
    return erApiFail_(e);
  }
}

/**
 * @param {string} reviewId
 * @param {!Object} fields
 * @return {!Object}
 */
function createEngagementReviewNote(reviewId, fields) {
  try {
    var auth = requireEngagementReviewCreateForApi_();
    return erCreateNote_(reviewId, fields || {}, auth.email);
  } catch (e) {
    return erApiFail_(e);
  }
}

/**
 * @param {string} noteId
 * @param {!Object} fields
 * @return {!Object}
 */
function updateEngagementReviewNote(noteId, fields) {
  try {
    var auth = requireEngagementReviewCreateForApi_();
    return erUpdateNote_(noteId, fields || {}, auth.email);
  } catch (e) {
    return erApiFail_(e);
  }
}

/**
 * @param {string} noteId
 * @return {!Object}
 */
function deleteEngagementReviewNote(noteId) {
  try {
    requireEngagementReviewAdminForApi_();
    return erDeleteNote_(noteId);
  } catch (e) {
    return erApiFail_(e);
  }
}

/**
 * @param {string} reviewId
 * @return {!Object}
 */
function generateEngagementReviewSynopsis(reviewId) {
  try {
    var auth = requireEngagementReviewAdminForApi_();
    return generateEngagementReviewSynopsis_(reviewId, auth.email);
  } catch (e) {
    return erApiFail_(e);
  }
}

/**
 * HTML export string for a status pack (print/download).
 * @param {string} updateId
 * @return {!Object}
 */
function exportEngagementStatusPackHtml(updateId) {
  try {
    requireEngagementReviewAccessForApi_();
    var loaded = erGetStatusPackUpdate_(updateId);
    if (!loaded.ok) return loaded;
    var html = erBuildStatusPackExportHtml_(loaded.update);
    return { ok: true, html: html, fileName: erStatusPackExportFileName_(loaded.update) };
  } catch (e) {
    return erApiFail_(e);
  }
}

/**
 * @param {!Object} update
 * @return {string}
 */
function erStatusPackExportFileName_(update) {
  var name = String((update && update.agreementName) || 'engagement-update')
    .replace(/[^\w\-]+/g, '_')
    .slice(0, 60);
  var period = String((update && update.reportingPeriod) || '').slice(0, 7);
  return name + '_status_' + (period || 'pack') + '.html';
}

/**
 * @param {!Object} u
 * @return {string}
 */
function erEscHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {!Object} update
 * @return {string}
 */
function erBuildStatusPackExportHtml_(update) {
  var u = update || {};
  var q = u.quantitativeSnapshot || {};
  var qual = u.qualitative || {};
  var rag = String(u.overallRag || 'on_track').replace(/_/g, ' ').toUpperCase();
  var owner = u.assignedOwnerName || u.assignedOwnerEmail || '';
  var period = String(u.reportingPeriod || '').slice(0, 7);
  var pulled = u.metricsPulledAt || '';

  function dim(key, label) {
    var d = qual[key] || {};
    return (
      '<div class="score-tile"><div class="rag">' +
      erEscHtml_(d.rag || '') +
      '</div><div class="dim-name">' +
      erEscHtml_(label) +
      '</div><div class="dim-sub">' +
      erEscHtml_(d.subtext || '') +
      '</div></div>'
    );
  }

  function bullets(arr) {
    var list = arr || [];
    if (!list.length) return '<p class="muted">None</p>';
    var html = '<ul>';
    for (var i = 0; i < list.length; i++) {
      html += '<li>' + erEscHtml_(list[i]) + '</li>';
    }
    return html + '</ul>';
  }

  var hours = q.hoursMtd || {};
  var cost = q.costMtd || {};
  var eacH = q.eacHours || {};
  var eacD = q.eacDollars || {};
  var rev = q.revenue || {};
  var resources = q.resources || [];
  var resRows = '';
  for (var r = 0; r < resources.length; r++) {
    var row = resources[r];
    resRows +=
      '<tr><td>' +
      erEscHtml_(row.name) +
      '</td><td>' +
      erEscHtml_(row.role) +
      '</td><td class="num">' +
      erEscHtml_(row.allocatedHrsMo) +
      '</td><td class="num">' +
      erEscHtml_(row.loggedHrsMo) +
      '</td><td class="num">' +
      erEscHtml_(row.pctAllocated) +
      '</td><td class="num">' +
      erEscHtml_(row.costMo) +
      '</td><td>' +
      erEscHtml_(row.billable === false ? 'No' : 'Yes') +
      '</td></tr>';
  }

  var risks = qual.risks || [];
  var riskHtml = '';
  for (var k = 0; k < risks.length; k++) {
    riskHtml +=
      '<div class="risk"><span class="badge">' +
      erEscHtml_(risks[k].severity || '') +
      '</span> ' +
      erEscHtml_(risks[k].text || '') +
      '</div>';
  }

  return (
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' +
    erEscHtml_(u.agreementName || 'Engagement Update') +
    '</title><style>' +
    'body{font-family:system-ui,sans-serif;background:#f9f9f7;color:#0b0b0b;margin:0;padding:24px}' +
    '.report{max-width:980px;margin:0 auto;background:#fcfcfb;border:1px solid rgba(11,11,11,.1);border-radius:12px;padding:28px}' +
    '.head{display:flex;justify-content:space-between;border-bottom:1px solid #e1e0d9;padding-bottom:16px;margin-bottom:18px}' +
    '.pill{padding:7px 16px;border-radius:20px;background:rgba(12,163,12,.12);font-weight:700;font-size:13px}' +
    '.scorecard{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px}' +
    '.score-tile{border:1px solid #e1e0d9;border-radius:9px;padding:12px;text-align:center}' +
    '.stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}' +
    '.stat{border:1px solid #e1e0d9;border-radius:8px;padding:12px}.label{font-size:11px;color:#898781;text-transform:uppercase}' +
    '.value{font-size:20px;font-weight:700}h2{font-size:13px;text-transform:uppercase;color:#898781;border-top:1px solid #e1e0d9;padding-top:18px}' +
    'table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:8px;border-bottom:1px solid #e1e0d9;text-align:left}' +
    'td.num{text-align:right}.muted{color:#898781;font-size:12px}.callout{background:rgba(235,104,52,.08);border-left:3px solid #eb6834;padding:12px;margin:8px 0}' +
    '@media print{body{background:#fff;padding:0}.report{border:none;box-shadow:none}}' +
    '</style></head><body><div class="report">' +
    '<div class="head"><div><div style="font-size:19px;font-weight:700">' +
    erEscHtml_(u.companyName || u.agreementName || 'Engagement') +
    ' - Monthly Status Report</div><div class="muted">Reporting period: <b>' +
    erEscHtml_(period) +
    '</b> · Assigned Owner: ' +
    erEscHtml_(owner) +
    ' · Metrics pulled: ' +
    erEscHtml_(pulled) +
    '</div></div><div class="pill">' +
    erEscHtml_(rag) +
    '</div></div>' +
    '<div class="scorecard">' +
    dim('schedule', 'Schedule') +
    dim('cost_hours', 'Cost / Hours') +
    dim('margin', 'Margin') +
    dim('client_sentiment', 'Client Sentiment') +
    '</div>' +
    '<h2>Performance to Plan - Hours &amp; Cost</h2><div class="stat-row">' +
    '<div class="stat"><div class="label">Hours Logged (MTD)</div><div class="value">' +
    erEscHtml_(hours.actual) +
    '</div><div class="muted">vs ' +
    erEscHtml_(hours.planned) +
    ' planned</div></div>' +
    '<div class="stat"><div class="label">Cost Actual (MTD)</div><div class="value">' +
    erEscHtml_(cost.actual) +
    '</div><div class="muted">vs ' +
    erEscHtml_(cost.planned) +
    ' planned</div></div>' +
    '<div class="stat"><div class="label">EAC (Hours)</div><div class="value">' +
    erEscHtml_(eacH.value) +
    '</div><div class="muted">of ' +
    erEscHtml_(eacH.budgeted) +
    ' budgeted</div></div>' +
    '<div class="stat"><div class="label">EAC (Dollars)</div><div class="value">' +
    erEscHtml_(eacD.value) +
    '</div><div class="muted">vs budget ' +
    erEscHtml_(eacD.budgeted) +
    '</div></div></div>' +
    '<h2>Revenue Status</h2><div class="stat-row" style="grid-template-columns:repeat(3,1fr)">' +
    '<div class="stat"><div class="label">Revenue Invoiced (MTD)</div><div class="value">' +
    erEscHtml_(rev.invoicedMtd) +
    '</div><div class="muted">vs ' +
    erEscHtml_(rev.plannedMtd) +
    ' planned</div></div>' +
    '<div class="stat"><div class="label">Revenue Invoiced (FYTD)</div><div class="value">' +
    erEscHtml_(rev.invoicedFytd) +
    '</div></div>' +
    '<div class="stat"><div class="label">Next Invoice Milestone</div><div class="value">' +
    erEscHtml_(rev.nextMilestoneDate) +
    '</div><div class="muted">' +
    erEscHtml_(rev.nextMilestoneAmount) +
    '</div></div></div>' +
    (qual.revenue_callout_html
      ? '<div class="callout">' + String(qual.revenue_callout_html) + '</div>'
      : '') +
    '<h2>Resource Detail</h2><table><thead><tr><th>Name</th><th>Role</th><th class="num">Allocated</th><th class="num">Logged</th><th class="num">%</th><th class="num">Cost</th><th>Billable</th></tr></thead><tbody>' +
    (resRows || '<tr><td colspan="7" class="muted">No resource rows</td></tr>') +
    '</tbody></table>' +
    '<h2>This Month / Next Month</h2><div style="display:grid;grid-template-columns:1.2fr 1fr;gap:22px">' +
    '<div><h3 style="font-size:12px;color:#898781;text-transform:uppercase">Key Developments</h3>' +
    bullets(qual.key_developments) +
    '<h3 style="font-size:12px;color:#898781;text-transform:uppercase">Priorities Next</h3>' +
    bullets(qual.priorities_next) +
    '</div><div><h3 style="font-size:12px;color:#898781;text-transform:uppercase">Risks &amp; Issues</h3>' +
    (riskHtml || '<p class="muted">None</p>') +
    (qual.margin_footnote
      ? '<p class="muted" style="margin-top:12px">' + erEscHtml_(qual.margin_footnote) + '</p>'
      : '') +
    '</div></div></div></body></html>'
  );
}

/**
 * Project detail (legacy questionnaire view still supported).
 * @param {string} reviewId
 * @param {string} agreementFiberyId
 * @return {!Object}
 */
function getEngagementReviewProjectDetail(reviewId, agreementFiberyId) {
  try {
    var auth = requireEngagementReviewAccessForApi_();
    var bundle = erGetReviewBundle_(reviewId);
    if (!bundle.ok) return bundle;
    var aid = String(agreementFiberyId || '').trim();
    var link = null;
    var agreements = bundle.agreements || [];
    for (var i = 0; i < agreements.length; i++) {
      if (String(agreements[i].agreement_fibery_id) === aid) {
        link = agreements[i];
        break;
      }
    }
    if (!link) {
      return { ok: false, message: 'Agreement is not on this review.' };
    }

    var updates = (bundle.updatesByAgreement && bundle.updatesByAgreement[aid]) || [];
    var latest = updates.length ? updates[0] : null;
    var history = updates.length > 1 ? updates.slice(1) : [];
    var projectInfo = erBuildProjectInfoSlice_(aid, link);
    var canSubmit = canCreateEngagementReview_(auth);

    return {
      ok: true,
      reviewId: String(reviewId),
      agreementId: aid,
      agreementName: link.agreement_name || aid,
      customerName: link.company_name || '',
      ownerEmail: link.owner_email || '',
      ownerName: link.owner_name || '',
      updates: {
        latest: latest ? erMapUpdateRow_(latest) : null,
        history: history.map(erMapUpdateRow_),
      },
      projectInfo: projectInfo,
      questionSet: getEngagementReviewQuestionSetPayload_(),
      canSubmitUpdate: canSubmit,
      isAdmin: isAdminUser_(auth),
    };
  } catch (e) {
    return erApiFail_(e);
  }
}

/**
 * @param {string} agreementId
 * @param {!Object} link
 * @return {!Object}
 */
function erBuildProjectInfoSlice_(agreementId, link) {
  var info = {
    state: '',
    type: '',
    alerts: [],
    pnlKpis: null,
    asOf: null,
  };
  try {
    var dims = erAgreementDimMap_();
    var dim = dims[agreementId];
    if (dim) {
      info.state = dim.status || '';
      info.type = dim.agreement_type || '';
    }
  } catch (_) {
    /* ignore */
  }

  try {
    var loaded = erLoadAgreementAlertsPayload_();
    if (loaded.ok) {
      info.asOf = loaded.asOf || null;
      var alerts = loaded.alerts || [];
      for (var i = 0; i < alerts.length; i++) {
        if (String(alerts[i].agreementId || '') === String(agreementId)) {
          info.alerts.push({
            id: alerts[i].id,
            kind: alerts[i].kind,
            severity: alerts[i].severity,
            title: alerts[i].title,
            body: alerts[i].body,
          });
        }
      }
      var list = loaded.agreements || [];
      for (var j = 0; j < list.length; j++) {
        if (String(list[j].id || '') === String(agreementId)) {
          var ag = list[j];
          info.state = info.state || ag.state || '';
          info.type = info.type || ag.type || '';
          info.pnlKpis = {
            plannedRev: ag.plannedRev,
            revRec: ag.revRec,
            laborCosts: ag.laborCosts,
            materialsOdc: ag.materialsOdc,
            margin: ag.margin,
            targetMargin: ag.targetMargin,
          };
          break;
        }
      }
    }
  } catch (_) {
    /* ignore */
  }

  try {
    if (isSupabaseConfigured_()) {
      var pnl = supabaseSelect_(
        'fos_delivery_pnl',
        { agreement_id: 'eq.' + agreementId },
        'agreement_name,as_of,payload',
        1
      );
      if (pnl.ok) {
        var rows = erRows_(pnl.json);
        if (rows.length && rows[0].payload) {
          var payload = rows[0].payload;
          var kpis = payload.kpis || payload.summary || null;
          if (kpis && !info.pnlKpis) {
            info.pnlKpis = kpis;
          } else if (kpis && info.pnlKpis) {
            for (var key in kpis) {
              if (Object.prototype.hasOwnProperty.call(kpis, key) && info.pnlKpis[key] == null) {
                info.pnlKpis[key] = kpis[key];
              }
            }
          }
          if (rows[0].as_of) info.asOf = rows[0].as_of;
          if (payload.statusUpdates && payload.statusUpdates.latest) {
            info.latestStatusUpdate = payload.statusUpdates.latest;
          }
        }
      }
    }
  } catch (_) {
    /* ignore */
  }

  return info;
}

/**
 * PRD version 3.4.0 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 037: Supabase CRUD for Engagement Reviews.
 */

/** @const {string} */
var ER_TABLE_REVIEWS_ = 'fos_engagement_reviews';
/** @const {string} */
var ER_TABLE_AGREEMENTS_ = 'fos_engagement_review_agreements';
/** @const {string} */
var ER_TABLE_PARTICIPANTS_ = 'fos_engagement_review_participants';
/** @const {string} */
var ER_TABLE_UPDATES_ = 'fos_engagement_updates';
/** @const {string} */
var ER_TABLE_RECORDINGS_ = 'fos_engagement_review_recordings';

/**
 * @param {string} table
 * @param {!Object|!Array<!Object>} body
 * @return {!Object}
 */
function erInsert_(table, body) {
  return supabaseRest_('post', '/rest/v1/' + encodeURIComponent(table), null, body, {
    Prefer: 'return=representation',
  });
}

/**
 * @param {string} table
 * @param {string} idEq filter value for id=eq.
 * @param {!Object} patch
 * @return {!Object}
 */
function erPatchById_(table, idEq, patch) {
  return supabaseRest_(
    'patch',
    '/rest/v1/' + encodeURIComponent(table),
    { id: 'eq.' + idEq },
    patch,
    { Prefer: 'return=representation' }
  );
}

/**
 * @param {string} table
 * @param {!Object<string, string>} query
 * @return {!Object}
 */
function erDelete_(table, query) {
  return supabaseRest_('delete', '/rest/v1/' + encodeURIComponent(table), query, null, {
    Prefer: 'return=minimal',
  });
}

/**
 * @param {*} rows
 * @return {!Array<!Object>}
 */
function erRows_(rows) {
  if (!rows) return [];
  if (Object.prototype.toString.call(rows) === '[object Array]') {
    return /** @type {!Array<!Object>} */ (rows);
  }
  return [];
}

/**
 * @param {string=} filter upcoming|past|all
 * @return {!{ ok: boolean, message?: string, reviews?: !Array<!Object> }}
 */
function erListReviews_(filter) {
  if (!isSupabaseConfigured_()) {
    return { ok: false, message: 'Datastore is not configured.' };
  }
  var res = supabaseSelect_(
    ER_TABLE_REVIEWS_,
    { order: 'target_date.desc,created_at.desc' },
    '*',
    200
  );
  if (!res.ok) {
    return { ok: false, message: res.message || 'Could not list reviews.' };
  }
  var rows = erRows_(res.json);
  var mode = String(filter || 'all').toLowerCase();
  if (mode === 'upcoming' || mode === 'past') {
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    rows = rows.filter(function (r) {
      var d = String(r.target_date || '');
      if (mode === 'upcoming') {
        return d >= today && r.status !== 'completed';
      }
      return d < today || r.status === 'completed';
    });
  }
  return { ok: true, reviews: rows };
}

/**
 * @param {string} reviewId
 * @return {!{ ok: boolean, message?: string, review?: !Object, agreements?: !Array, participants?: !Array, recordings?: !Array, updatesByAgreement?: !Object }}
 */
function erGetReviewBundle_(reviewId) {
  if (!isSupabaseConfigured_()) {
    return { ok: false, message: 'Datastore is not configured.' };
  }
  var id = String(reviewId || '').trim();
  if (!id) {
    return { ok: false, message: 'Review id is required.' };
  }
  var revRes = supabaseSelect_(ER_TABLE_REVIEWS_, { id: 'eq.' + id }, '*', 1);
  if (!revRes.ok) {
    return { ok: false, message: revRes.message || 'Could not load review.' };
  }
  var revs = erRows_(revRes.json);
  if (!revs.length) {
    return { ok: false, message: 'Review not found.' };
  }
  var agRes = supabaseSelect_(
    ER_TABLE_AGREEMENTS_,
    { review_id: 'eq.' + id, order: 'sort_order.asc,created_at.asc' },
    '*',
    500
  );
  var partRes = supabaseSelect_(
    ER_TABLE_PARTICIPANTS_,
    { review_id: 'eq.' + id, order: 'email.asc' },
    '*',
    500
  );
  var recRes = supabaseSelect_(
    ER_TABLE_RECORDINGS_,
    { review_id: 'eq.' + id, order: 'uploaded_at.desc' },
    '*',
    100
  );
  var updRes = supabaseSelect_(
    ER_TABLE_UPDATES_,
    { review_id: 'eq.' + id, order: 'submitted_at.desc' },
    '*',
    1000
  );
  if (!agRes.ok || !partRes.ok || !recRes.ok || !updRes.ok) {
    return {
      ok: false,
      message:
        (agRes.message || partRes.message || recRes.message || updRes.message) ||
        'Could not load review details.',
    };
  }
  var updates = erRows_(updRes.json);
  var byAg = {};
  for (var i = 0; i < updates.length; i++) {
    var u = updates[i];
    var aid = String(u.agreement_fibery_id || '');
    if (!byAg[aid]) byAg[aid] = [];
    byAg[aid].push(u);
  }
  return {
    ok: true,
    review: revs[0],
    agreements: erRows_(agRes.json),
    participants: erRows_(partRes.json),
    recordings: erRows_(recRes.json),
    updatesByAgreement: byAg,
  };
}

/**
 * @param {!Object} fields
 * @param {string} email
 * @return {!{ ok: boolean, message?: string, review?: !Object }}
 */
function erCreateReview_(fields, email) {
  var name = String((fields && fields.name) || '').trim();
  var targetDate = String((fields && fields.targetDate) || '').trim();
  if (!name) return { ok: false, message: 'Name is required.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return { ok: false, message: 'Target date must be YYYY-MM-DD.' };
  }
  var status = String((fields && fields.status) || 'draft').trim().toLowerCase();
  if (['draft', 'scheduled', 'in_progress', 'completed'].indexOf(status) < 0) {
    return { ok: false, message: 'Invalid status.' };
  }
  var row = {
    name: name,
    target_date: targetDate,
    status: status,
    notes: fields && fields.notes != null ? String(fields.notes) : null,
    call_summary_html:
      fields && fields.callSummaryHtml != null ? String(fields.callSummaryHtml) : null,
    question_set_version: engagementReviewQuestionSetVersion_(),
    created_by_email: email,
    updated_by_email: email,
  };
  var res = erInsert_(ER_TABLE_REVIEWS_, row);
  if (!res.ok) {
    return { ok: false, message: res.message || 'Could not create review.' };
  }
  var created = erRows_(res.json)[0];
  return { ok: true, review: created };
}

/**
 * @param {string} reviewId
 * @param {!Object} fields
 * @param {string} email
 * @return {!{ ok: boolean, message?: string, review?: !Object }}
 */
function erUpdateReview_(reviewId, fields, email) {
  var id = String(reviewId || '').trim();
  if (!id) return { ok: false, message: 'Review id is required.' };
  var patch = { updated_by_email: email, updated_at: new Date().toISOString() };
  if (fields && fields.name != null) {
    var name = String(fields.name).trim();
    if (!name) return { ok: false, message: 'Name is required.' };
    patch.name = name;
  }
  if (fields && fields.targetDate != null) {
    var td = String(fields.targetDate).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(td)) {
      return { ok: false, message: 'Target date must be YYYY-MM-DD.' };
    }
    patch.target_date = td;
  }
  if (fields && fields.status != null) {
    var st = String(fields.status).trim().toLowerCase();
    if (['draft', 'scheduled', 'in_progress', 'completed'].indexOf(st) < 0) {
      return { ok: false, message: 'Invalid status.' };
    }
    patch.status = st;
  }
  if (fields && fields.notes !== undefined) {
    patch.notes = fields.notes == null ? null : String(fields.notes);
  }
  if (fields && fields.callSummaryHtml !== undefined) {
    patch.call_summary_html =
      fields.callSummaryHtml == null ? null : String(fields.callSummaryHtml);
  }
  if (fields && fields.calendarEventId !== undefined) {
    patch.calendar_event_id =
      fields.calendarEventId == null ? null : String(fields.calendarEventId);
  }
  var res = erPatchById_(ER_TABLE_REVIEWS_, id, patch);
  if (!res.ok) {
    return { ok: false, message: res.message || 'Could not update review.' };
  }
  var rows = erRows_(res.json);
  return { ok: true, review: rows[0] || null };
}

/**
 * @param {string} reviewId
 * @return {!{ ok: boolean, message?: string }}
 */
function erDeleteReview_(reviewId) {
  var id = String(reviewId || '').trim();
  if (!id) return { ok: false, message: 'Review id is required.' };
  var res = erDelete_(ER_TABLE_REVIEWS_, { id: 'eq.' + id });
  if (!res.ok) {
    return { ok: false, message: res.message || 'Could not delete review.' };
  }
  return { ok: true };
}

/**
 * @param {string} reviewId
 * @param {!Object} agreement
 * @return {!{ ok: boolean, message?: string, row?: !Object }}
 */
function erUpsertAgreementLink_(reviewId, agreement) {
  var id = String(reviewId || '').trim();
  var aid = String((agreement && agreement.agreementFiberyId) || '').trim();
  if (!id || !aid) {
    return { ok: false, message: 'Review and agreement id are required.' };
  }
  var row = {
    review_id: id,
    agreement_fibery_id: aid,
    agreement_name: agreement.agreementName || null,
    company_name: agreement.companyName || null,
    owner_email: agreement.ownerEmail || null,
    owner_name: agreement.ownerName || null,
    suggested_from_alert: !!agreement.suggestedFromAlert,
    alert_snapshot: agreement.alertSnapshot || null,
    sort_order: agreement.sortOrder != null ? Number(agreement.sortOrder) : 0,
  };
  var res = supabaseUpsert_(ER_TABLE_AGREEMENTS_, [row], 'review_id,agreement_fibery_id');
  if (!res.ok) {
    // Prefer return=representation path via insert-or-select
    var sel = supabaseSelect_(
      ER_TABLE_AGREEMENTS_,
      {
        review_id: 'eq.' + id,
        agreement_fibery_id: 'eq.' + aid,
      },
      '*',
      1
    );
    if (sel.ok && erRows_(sel.json).length) {
      var existing = erRows_(sel.json)[0];
      var patchRes = erPatchById_(ER_TABLE_AGREEMENTS_, existing.id, {
        agreement_name: row.agreement_name,
        company_name: row.company_name,
        owner_email: row.owner_email || existing.owner_email,
        owner_name: row.owner_name || existing.owner_name,
        suggested_from_alert: existing.suggested_from_alert || row.suggested_from_alert,
        alert_snapshot: row.alert_snapshot || existing.alert_snapshot,
      });
      if (patchRes.ok) {
        return { ok: true, row: erRows_(patchRes.json)[0] || existing };
      }
    }
    var ins = erInsert_(ER_TABLE_AGREEMENTS_, row);
    if (!ins.ok) {
      return { ok: false, message: ins.message || res.message || 'Could not link agreement.' };
    }
    return { ok: true, row: erRows_(ins.json)[0] };
  }
  var after = supabaseSelect_(
    ER_TABLE_AGREEMENTS_,
    { review_id: 'eq.' + id, agreement_fibery_id: 'eq.' + aid },
    '*',
    1
  );
  return { ok: true, row: after.ok ? erRows_(after.json)[0] : row };
}

/**
 * @param {string} reviewId
 * @param {string} agreementFiberyId
 * @return {!{ ok: boolean, message?: string }}
 */
function erRemoveAgreementLink_(reviewId, agreementFiberyId) {
  var id = String(reviewId || '').trim();
  var aid = String(agreementFiberyId || '').trim();
  if (!id || !aid) return { ok: false, message: 'Review and agreement id are required.' };
  var res = erDelete_(ER_TABLE_AGREEMENTS_, {
    review_id: 'eq.' + id,
    agreement_fibery_id: 'eq.' + aid,
  });
  if (!res.ok) {
    return { ok: false, message: res.message || 'Could not remove agreement.' };
  }
  return { ok: true };
}

/**
 * @param {string} reviewId
 * @param {!Object} participant
 * @return {!{ ok: boolean, message?: string, row?: !Object }}
 */
function erUpsertParticipant_(reviewId, participant) {
  var id = String(reviewId || '').trim();
  var email = normalizeEmail_(String((participant && participant.email) || ''));
  if (!id || !email) {
    return { ok: false, message: 'Review and participant email are required.' };
  }
  var row = {
    review_id: id,
    email: email,
    display_name: (participant && participant.displayName) || null,
    participant_role: (participant && participant.participantRole) || 'owner',
    suggested: !!(participant && participant.suggested),
    invite_status: (participant && participant.inviteStatus) || 'pending',
  };
  if (participant && participant.inviteSentAt) {
    row.invite_sent_at = participant.inviteSentAt;
  }
  var sel = supabaseSelect_(
    ER_TABLE_PARTICIPANTS_,
    { review_id: 'eq.' + id, email: 'eq.' + email },
    '*',
    1
  );
  if (sel.ok && erRows_(sel.json).length) {
    var existing = erRows_(sel.json)[0];
    var patch = {
      display_name: row.display_name || existing.display_name,
      participant_role: row.participant_role || existing.participant_role,
      suggested: existing.suggested || row.suggested,
    };
    if (participant && participant.inviteStatus) {
      patch.invite_status = participant.inviteStatus;
    }
    if (participant && participant.inviteSentAt) {
      patch.invite_sent_at = participant.inviteSentAt;
    }
    var patchRes = erPatchById_(ER_TABLE_PARTICIPANTS_, existing.id, patch);
    if (!patchRes.ok) {
      return { ok: false, message: patchRes.message || 'Could not update participant.' };
    }
    return { ok: true, row: erRows_(patchRes.json)[0] || existing };
  }
  var ins = erInsert_(ER_TABLE_PARTICIPANTS_, row);
  if (!ins.ok) {
    return { ok: false, message: ins.message || 'Could not add participant.' };
  }
  return { ok: true, row: erRows_(ins.json)[0] };
}

/**
 * @param {string} reviewId
 * @param {string} email
 * @return {!{ ok: boolean, message?: string }}
 */
function erRemoveParticipant_(reviewId, email) {
  var id = String(reviewId || '').trim();
  var em = normalizeEmail_(String(email || ''));
  if (!id || !em) return { ok: false, message: 'Review and email are required.' };
  var res = erDelete_(ER_TABLE_PARTICIPANTS_, {
    review_id: 'eq.' + id,
    email: 'eq.' + em,
  });
  if (!res.ok) {
    return { ok: false, message: res.message || 'Could not remove participant.' };
  }
  return { ok: true };
}

/**
 * @param {!Object} row
 * @return {!{ ok: boolean, message?: string, update?: !Object }}
 */
function erInsertUpdate_(row) {
  var res = erInsert_(ER_TABLE_UPDATES_, row);
  if (!res.ok) {
    return { ok: false, message: res.message || 'Could not save update.' };
  }
  return { ok: true, update: erRows_(res.json)[0] };
}

/**
 * @param {!Object} row
 * @return {!{ ok: boolean, message?: string, recording?: !Object }}
 */
function erInsertRecording_(row) {
  var res = erInsert_(ER_TABLE_RECORDINGS_, row);
  if (!res.ok) {
    return { ok: false, message: res.message || 'Could not save recording metadata.' };
  }
  return { ok: true, recording: erRows_(res.json)[0] };
}

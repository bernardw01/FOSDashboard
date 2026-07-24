/**
 * PRD version 3.4.0 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 037: google.script.run surface for Engagement Reviews.
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
    requireEngagementReviewAccessForApi_();
    var bundle = erGetReviewBundle_(reviewId);
    if (!bundle.ok) return bundle;
    return {
      ok: true,
      review: bundle.review,
      agreements: bundle.agreements,
      participants: bundle.participants,
      recordings: bundle.recordings,
      updatesByAgreement: bundle.updatesByAgreement,
      questionSet: getEngagementReviewQuestionSetPayload_(),
      isAdmin: isAdminUser_(requireAuthForApi_()),
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
    var auth = requireEngagementReviewAdminForApi_();
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
    var auth = requireEngagementReviewAdminForApi_();
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
 * @param {string} reviewId
 * @param {string} agreementFiberyId
 * @param {!Object} payload answers + optional questionSetVersion
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
    if (!linked) {
      return { ok: false, message: 'Agreement is not on this review.' };
    }

    var canSubmit = isAdminUser_(auth);
    if (!canSubmit) {
      var my = normalizeEmail_(auth.email);
      if (ownerEmail && ownerEmail === my) {
        canSubmit = true;
      } else {
        var parts = bundle.participants || [];
        for (var p = 0; p < parts.length; p++) {
          if (normalizeEmail_(String(parts[p].email || '')) === my) {
            canSubmit = true;
            break;
          }
        }
      }
    }
    if (!canSubmit) {
      return {
        ok: false,
        message: 'Only Admins, invited participants, or the agreement owner may submit updates.',
      };
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
 * Project detail: updates + Datastore project info slices.
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

    var canSubmit = isAdminUser_(auth);
    var my = normalizeEmail_(auth.email);
    var ownerEmail = normalizeEmail_(String(link.owner_email || ''));
    if (!canSubmit && ownerEmail && ownerEmail === my) canSubmit = true;
    if (!canSubmit) {
      var parts = bundle.participants || [];
      for (var p = 0; p < parts.length; p++) {
        if (normalizeEmail_(String(parts[p].email || '')) === my) {
          canSubmit = true;
          break;
        }
      }
    }

    return {
      ok: true,
      reviewId: String(reviewId),
      agreementId: aid,
      agreementName: link.agreement_name || aid,
      customerName: link.company_name || '',
      ownerEmail: link.owner_email || '',
      ownerName: link.owner_name || '',
      updates: {
        latest: latest
          ? {
              id: latest.id,
              executiveSummary: latest.executive_summary,
              trafficLight: latest.traffic_light,
              answers: latest.answers,
              submittedByEmail: latest.submitted_by_email,
              submittedAt: latest.submitted_at,
              questionSetVersion: latest.question_set_version,
            }
          : null,
        history: history.map(function (u) {
          return {
            id: u.id,
            executiveSummary: u.executive_summary,
            trafficLight: u.traffic_light,
            answers: u.answers,
            submittedByEmail: u.submitted_by_email,
            submittedAt: u.submitted_at,
            questionSetVersion: u.question_set_version,
          };
        }),
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

  if (!info.state && link) {
    /* keep empty */
  }
  return info;
}

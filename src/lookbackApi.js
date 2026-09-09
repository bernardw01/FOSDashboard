/**
 * PRD version 3.21.1 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 056: google.script.run surface for monthly Lookback.
 */

/**
 * @param {*} err
 * @return {!{ ok: false, message: string }}
 */
function lbApiFail_(err) {
  var msg = err && err.message ? String(err.message) : 'Request failed.';
  return { ok: false, message: engagementReviewGateMessage_(msg) };
}

/**
 * @param {!Object} auth
 * @return {boolean}
 */
function lookbackIsOverride_(auth) {
  if (isAdminUser_(auth)) return true;
  var role = String(auth.role || '').trim().toUpperCase();
  if (role === 'EXEC') return true;
  return String(auth.team || '').trim().toUpperCase() === 'CLIENT-ENGAGEMENT';
}

/**
 * @param {!Object} auth
 * @param {!Object} project
 * @return {boolean}
 */
function lookbackCanEditProject_(auth, project) {
  if (lookbackIsOverride_(auth)) return true;
  var my = normalizeEmail_(auth.email);
  var owner = normalizeEmail_(String((project && project.assigned_owner_email) || ''));
  return !!(owner && owner === my);
}

/**
 * @param {!Object} auth
 * @param {!Object=} project
 * @return {boolean}
 */
function lookbackCanOptIn_(auth, project) {
  if (isAdminUser_(auth)) return true;
  var role = String(auth.role || '').trim().toUpperCase();
  if (role === 'EXEC') return true;
  if (isLookbackOptInEmail_(auth.email)) return true;
  if (!project) return false;
  var my = normalizeEmail_(auth.email);
  var owner = normalizeEmail_(String(project.assigned_owner_email || ''));
  return !!(owner && owner === my);
}

/**
 * @param {!Object} month
 * @return {boolean}
 */
function lookbackMonthWritable_(month) {
  return !!(month && month.status === 'open_for_narratives');
}

/**
 * @param {!Object} bundle
 * @param {!Object} auth
 * @return {!Object}
 */
function lbMapBundleForClient_(bundle, auth) {
  var month = lbMapMonth_(bundle.month);
  var projects = bundle.projects || [];
  var evMap = bundle.evidenceByProject || {};
  var selected = [];
  var green = [];
  var kpis = {
    totalSelected: 0,
    automatic: 0,
    manual: 0,
    notStarted: 0,
    inProgress: 0,
    complete: 0,
    green: 0,
  };
  var i;
  for (i = 0; i < projects.length; i++) {
    var mapped = lbMapProject_(projects[i]);
    mapped.evidence = evMap[String(projects[i].id)] || [];
    if (mapped.selected) {
      selected.push(mapped);
      kpis.totalSelected++;
      if (mapped.reviewType === 'automatic') kpis.automatic++;
      if (mapped.reviewType === 'manual') kpis.manual++;
      if (mapped.narrativeStatus === 'complete') kpis.complete++;
      else if (mapped.narrativeStatus === 'in_progress') kpis.inProgress++;
      else kpis.notStarted++;
    } else {
      green.push(mapped);
      kpis.green++;
    }
  }
  function rank(p) {
    var ready = mappedStatusRank_(p.narrativeStatus);
    var auto = p.reviewType === 'automatic' ? 0 : 1;
    return [ready, auto, String(p.agreementName || '').toLowerCase()];
  }
  function mappedStatusRank_(st) {
    return st === 'complete' ? 0 : 1;
  }
  selected.sort(function (a, b) {
    var ra = rank(a);
    var rb = rank(b);
    for (var k = 0; k < ra.length; k++) {
      if (ra[k] < rb[k]) return -1;
      if (ra[k] > rb[k]) return 1;
    }
    return 0;
  });
  green.sort(function (a, b) {
    return String(a.agreementName || '').localeCompare(String(b.agreementName || ''));
  });
  var lockYmd = '';
  if (month.lockedAt) {
    try {
      lockYmd = Utilities.formatDate(
        new Date(month.lockedAt),
        month.lockTimezone || lookbackTimezone_(),
        'yyyy-MM-dd'
      );
    } catch (e) {
      lockYmd = String(month.lockedAt).slice(0, 10);
    }
  }
  var period = euNormalizeReportingPeriod_(month.reportingPeriod);
  var sched = period ? lookbackComputeLockSchedule_(period) : null;
  return {
    ok: true,
    month: month,
    kpis: kpis,
    selected: selected,
    green: green,
    schedule: sched,
    ownerWindowEnd: lookbackOwnerWindowEnd_(lockYmd),
    canLock: isAdminUser_(auth),
    canArchive: isAdminUser_(auth) && lookbackMonthWritable_(bundle.month),
    canOptInAny: lookbackCanOptIn_(auth, null),
    canOverride: lookbackIsOverride_(auth),
    lookbackOnly: canAccessLookback_(auth) && !canAccessEngagementReview_(auth),
    userEmail: auth.email,
    thresholdPct: month.thresholdPct,
    isAdmin: isAdminUser_(auth),
  };
}

/**
 * @return {!Object}
 */
function listLookbackMonths() {
  try {
    var auth = requireLookbackAccessForApi_();
    var listed = lbListMonths_();
    if (!listed.ok) return listed;
    var months = (listed.months || []).map(lbMapMonth_);
    return {
      ok: true,
      months: months,
      canLock: isAdminUser_(auth),
      lookbackOnly: canAccessLookback_(auth) && !canAccessEngagementReview_(auth),
      canCreateReviews: canCreateEngagementReview_(auth),
      userEmail: auth.email,
      isAdmin: isAdminUser_(auth),
    };
  } catch (e) {
    return lbApiFail_(e);
  }
}

/**
 * @param {string} monthIdOrPeriod
 * @return {!Object}
 */
function getLookbackMonth(monthIdOrPeriod) {
  try {
    var auth = requireLookbackAccessForApi_();
    var raw = String(monthIdOrPeriod || '').trim();
    var monthId = raw;
    if (/^\d{4}-\d{2}/.test(raw)) {
      var byPeriod = lbGetMonthByPeriod_(raw);
      if (!byPeriod.ok) return byPeriod;
      if (!byPeriod.month) return { ok: false, message: 'No Lookback exists for that month yet.' };
      monthId = byPeriod.month.id;
    }
    var bundle = lbGetMonthBundle_(monthId);
    if (!bundle.ok) return bundle;
    return lbMapBundleForClient_(bundle, auth);
  } catch (e) {
    return lbApiFail_(e);
  }
}

/**
 * @param {string} period
 * @return {!Object}
 */
function lockLookbackMonth(period) {
  try {
    var auth = requireAuthForApi_();
    requireAdminRole_(auth);
    return lookbackLockMonth_(period, auth.email);
  } catch (e) {
    return lbApiFail_(e);
  }
}

/**
 * @param {string} monthId
 * @return {!Object}
 */
function archiveLookbackMonth(monthId) {
  try {
    var auth = requireAuthForApi_();
    requireAdminRole_(auth);
    var bundle = lbGetMonthBundle_(monthId);
    if (!bundle.ok) return bundle;
    if (!lookbackMonthWritable_(bundle.month)) {
      return { ok: false, message: 'That Lookback month is already archived.' };
    }
    return lbPatchMonth_(monthId, { status: 'archived' });
  } catch (e) {
    return lbApiFail_(e);
  }
}

/**
 * @param {string} monthId
 * @param {string} agreementFiberyId
 * @param {string} reason
 * @return {!Object}
 */
function optInLookbackProject(monthId, agreementFiberyId, reason) {
  try {
    var auth = requireLookbackAccessForApi_();
    var bundle = lbGetMonthBundle_(monthId);
    if (!bundle.ok) return bundle;
    if (!lookbackMonthWritable_(bundle.month)) {
      return { ok: false, message: 'This Lookback month is read-only.' };
    }
    var aid = String(agreementFiberyId || '').trim();
    var why = String(reason || '').trim();
    if (!why) return { ok: false, message: 'A Reason is required to opt a project in.' };
    var row = null;
    var projects = bundle.projects || [];
    for (var i = 0; i < projects.length; i++) {
      if (String(projects[i].agreement_fibery_id) === aid) {
        row = projects[i];
        break;
      }
    }
    if (!row) return { ok: false, message: 'That project is not in this Lookback month.' };
    if (!lookbackCanOptIn_(auth, row)) {
      return { ok: false, message: 'You can only opt in projects you own, unless you are on the Lookback allowlist.' };
    }
    if (row.selected && row.review_type === 'automatic') {
      return {
        ok: false,
        message: 'Automatic selections cannot be removed or converted to Manual.',
      };
    }
    if (row.selected && row.review_type === 'manual') {
      return lbPatchProject_(row.id, {
        reason: why,
        selected_by_email: auth.email,
        updated_by_email: auth.email,
      });
    }
    return lbPatchProject_(row.id, {
      selected: true,
      review_type: 'manual',
      reason: why,
      selected_by_email: auth.email,
      updated_by_email: auth.email,
    });
  } catch (e) {
    return lbApiFail_(e);
  }
}

/**
 * @param {string} projectId
 * @param {!Object} narrative
 * @param {string} narrativeStatus
 * @return {!Object}
 */
function saveLookbackNarrative(projectId, narrative, narrativeStatus) {
  try {
    var auth = requireLookbackAccessForApi_();
    var got = lbGetProjectById_(projectId);
    if (!got.ok) return got;
    var monthRes = supabaseSelect_(LB_TABLE_MONTHS_, { id: 'eq.' + got.project.month_id }, '*', 1);
    if (!monthRes.ok) return { ok: false, message: monthRes.message || 'Could not load Lookback month.' };
    var month = lbRows_(monthRes.json)[0];
    if (!lookbackMonthWritable_(month)) {
      return { ok: false, message: 'This Lookback month is read-only.' };
    }
    if (!got.project.selected) {
      return { ok: false, message: 'This project is not selected for Lookback review.' };
    }
    if (!lookbackCanEditProject_(auth, got.project)) {
      return { ok: false, message: 'You can edit narratives for your assigned projects only.' };
    }
    var n = narrative || {};
    var clean = {
      whatHappened: String(n.whatHappened || '').trim(),
      why: String(n.why || '').trim(),
      recovery: String(n.recovery || '').trim(),
      leadership: String(n.leadership || '').trim(),
      additional: String(n.additional || '').trim(),
    };
    var st = String(narrativeStatus || '').trim();
    if (st !== 'not_started' && st !== 'in_progress' && st !== 'complete') {
      st = lbNarrativeRequiredComplete_(clean) ? 'complete' : (clean.whatHappened || clean.why || clean.recovery ? 'in_progress' : 'not_started');
    }
    if (st === 'complete' && !lbNarrativeRequiredComplete_(clean)) {
      return {
        ok: false,
        message: 'Complete requires What happened, Why, and Recovery plan.',
      };
    }
    return lbPatchProject_(got.project.id, {
      narrative: clean,
      narrative_status: st,
      updated_by_email: auth.email,
    });
  } catch (e) {
    return lbApiFail_(e);
  }
}

/**
 * @param {string} projectId
 * @param {string} fileName
 * @param {string} mimeType
 * @param {string} base64Data
 * @return {!Object}
 */
function uploadLookbackEvidence(projectId, fileName, mimeType, base64Data) {
  try {
    var auth = requireLookbackAccessForApi_();
    var got = lbGetProjectById_(projectId);
    if (!got.ok) return got;
    var monthRes = supabaseSelect_(LB_TABLE_MONTHS_, { id: 'eq.' + got.project.month_id }, '*', 1);
    if (!monthRes.ok) return { ok: false, message: monthRes.message || 'Could not load Lookback month.' };
    var month = lbRows_(monthRes.json)[0];
    if (!lookbackMonthWritable_(month)) {
      return { ok: false, message: 'This Lookback month is read-only.' };
    }
    if (!lookbackCanEditProject_(auth, got.project) && !lookbackCanOptIn_(auth, got.project)) {
      return { ok: false, message: 'You cannot attach evidence on this project.' };
    }
    if (!got.project.selected) {
      return { ok: false, message: 'Opt the project in before attaching evidence.' };
    }
    return lbUploadEvidence_(projectId, fileName, mimeType, base64Data, auth.email);
  } catch (e) {
    return lbApiFail_(e);
  }
}

/**
 * @param {string} evidenceId
 * @param {string} projectId
 * @return {!Object}
 */
function deleteLookbackEvidence(evidenceId, projectId) {
  try {
    var auth = requireLookbackAccessForApi_();
    var got = lbGetProjectById_(projectId);
    if (!got.ok) return got;
    var monthRes = supabaseSelect_(LB_TABLE_MONTHS_, { id: 'eq.' + got.project.month_id }, '*', 1);
    if (!monthRes.ok) return { ok: false, message: monthRes.message || 'Could not load Lookback month.' };
    var month = lbRows_(monthRes.json)[0];
    if (!lookbackMonthWritable_(month)) {
      return { ok: false, message: 'This Lookback month is read-only.' };
    }
    if (!lookbackCanEditProject_(auth, got.project)) {
      return { ok: false, message: 'You cannot delete evidence on this project.' };
    }
    return lbDeleteEvidence_(evidenceId);
  } catch (e) {
    return lbApiFail_(e);
  }
}

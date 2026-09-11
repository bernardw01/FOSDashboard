/**
 * PRD version 3.29.2 - sync with docs/FOS-Dashboard-PRD.md
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
  function rankAction(p) {
    var auto = p.reviewType === 'automatic' ? 0 : 1;
    return [auto, String(p.agreementName || '').toLowerCase()];
  }
  // FEATURE-056-07: Ready (complete) order is sort_order only (replaces rank).
  // Action Required keeps auto-then-name. Green stays alpha.
  selected.sort(function (a, b) {
    var aReady = a.narrativeStatus === 'complete' ? 0 : 1;
    var bReady = b.narrativeStatus === 'complete' ? 0 : 1;
    if (aReady !== bReady) return aReady - bReady;
    if (aReady === 0) {
      var sa = a.sortOrder != null ? Number(a.sortOrder) : 0;
      var sb = b.sortOrder != null ? Number(b.sortOrder) : 0;
      if (sa !== sb) return sa - sb;
      return String(a.agreementName || '').localeCompare(String(b.agreementName || ''));
    }
    var ra = rankAction(a);
    var rb = rankAction(b);
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
    canRedo: isAdminUser_(auth) && lookbackMonthWritable_(bundle.month),
    canDeleteMonth: isAdminUser_(auth) && String(bundle.month.status || '') !== 'locking',
    canReorderReady: isAdminUser_(auth) && lookbackMonthWritable_(bundle.month),
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
 * Admin: re-run automatic selection for an open Lookback month (keeps Manual + narratives).
 * @param {string} monthId
 * @return {!Object}
 */
function redoLookbackSelection(monthId) {
  try {
    var auth = requireAuthForApi_();
    requireAdminRole_(auth);
    return lookbackRedoSelection_(monthId, auth.email);
  } catch (e) {
    return lbApiFail_(e);
  }
}

/**
 * Admin: delete a Lookback month (cascade projects/evidence; Drive trash best-effort).
 * @param {string} monthId
 * @return {!Object}
 */
function deleteLookbackMonth(monthId) {
  try {
    var auth = requireAuthForApi_();
    requireAdminRole_(auth);
    return lookbackDeleteMonth_(monthId);
  } catch (e) {
    return lbApiFail_(e);
  }
}

/**
 * Admin: reorder Ready for Review projects (FEATURE-056-07).
 * @param {string} monthId
 * @param {!Array<string>} orderedProjectIds
 * @return {!Object}
 */
function reorderLookbackReadyProjects(monthId, orderedProjectIds) {
  try {
    var auth = requireAuthForApi_();
    requireAdminRole_(auth);
    return lookbackReorderReadyProjects_(monthId, orderedProjectIds || []);
  } catch (e) {
    return lbApiFail_(e);
  }
}

/**
 * Selected Lookback projects (Automatic + Manual) for a reporting period.
 * Used by Project Update create (feature 037 / 056).
 * @param {string} period YYYY-MM or YYYY-MM-01
 * @return {!Object}
 */
function listLookbackSelectedProjects(period) {
  try {
    var auth = requireLookbackAccessForApi_();
    var p = euNormalizeReportingPeriod_(period);
    if (!p) return { ok: false, message: 'Lookback period is required.' };
    var byPeriod = lbGetMonthByPeriod_(p);
    if (!byPeriod.ok) return byPeriod;
    if (!byPeriod.month) {
      return { ok: false, message: 'No Lookback exists for that month yet.' };
    }
    if (!lookbackMonthWritable_(byPeriod.month)) {
      return {
        ok: false,
        message: 'That Lookback month is archived. Open a month that is still open for narratives.',
      };
    }
    var bundle = lbGetMonthBundle_(byPeriod.month.id);
    if (!bundle.ok) return bundle;
    var projects = [];
    var rows = bundle.projects || [];
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i].selected) continue;
      projects.push({
        fiberyId: rows[i].agreement_fibery_id,
        name: rows[i].agreement_name,
        companyName: rows[i].company_name,
        ownerEmail: rows[i].assigned_owner_email,
        ownerName: rows[i].assigned_owner_name,
        reviewType: rows[i].review_type,
      });
    }
    projects.sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    return {
      ok: true,
      period: p,
      monthId: byPeriod.month.id,
      projects: projects,
      userEmail: auth.email,
    };
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
        criteria: [],
      });
    }
    return lbPatchProject_(row.id, {
      selected: true,
      review_type: 'manual',
      reason: why,
      selected_by_email: auth.email,
      updated_by_email: auth.email,
      criteria: [],
    });
  } catch (e) {
    return lbApiFail_(e);
  }
}

/**
 * Soft-remove a selected Lookback project (Manual or Automatic) back to Green.
 * FEATURE-056-04 (product 2026-09-09: Automatic rows removable too).
 * Marks criteria with user_removed so re-run does not re-auto-select.
 *
 * @param {string} monthId
 * @param {string} agreementFiberyId
 * @return {!Object}
 */
function removeLookbackSelectedProject(monthId, agreementFiberyId) {
  try {
    var auth = requireLookbackAccessForApi_();
    var bundle = lbGetMonthBundle_(monthId);
    if (!bundle.ok) return bundle;
    if (!lookbackMonthWritable_(bundle.month)) {
      return { ok: false, message: 'This Lookback month is read-only.' };
    }
    var aid = String(agreementFiberyId || '').trim();
    if (!aid) return { ok: false, message: 'Project is required.' };
    var row = null;
    var projects = bundle.projects || [];
    for (var i = 0; i < projects.length; i++) {
      if (String(projects[i].agreement_fibery_id) === aid) {
        row = projects[i];
        break;
      }
    }
    if (!row) return { ok: false, message: 'That project is not in this Lookback month.' };
    if (!row.selected) {
      return { ok: false, message: 'That project is not selected for Lookback review.' };
    }
    if (!lookbackCanOptIn_(auth, row)) {
      return {
        ok: false,
        message: 'You can only remove projects you own, unless you are on the Lookback allowlist.',
      };
    }
    return lbPatchProject_(row.id, {
      selected: false,
      review_type: null,
      reason: 'Removed by user',
      selected_by_email: auth.email,
      criteria: [LOOKBACK_USER_REMOVED_CRITERION_],
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

/**
 * BUG-056-03: lock/delete require Admin server-side (belt-and-suspenders).
 * @return {!Object}
 */
function test_lookbackAdminLockDeleteGates_() {
  var lockSrc = String(lockLookbackMonth);
  var delSrc = String(deleteLookbackMonth);
  var lockHasAdmin = /requireAdminRole_/.test(lockSrc);
  var delHasAdmin = /requireAdminRole_/.test(delSrc);
  var pass = lockHasAdmin && delHasAdmin;
  return {
    ok: true,
    pass: pass,
    lockRequiresAdmin: lockHasAdmin,
    deleteRequiresAdmin: delHasAdmin,
    message: pass
      ? 'PASS: lockLookbackMonth and deleteLookbackMonth both call requireAdminRole_.'
      : 'FAIL: Admin gate missing on lock and/or delete API.',
  };
}

/**
 * FEATURE-056-04: soft-remove marker helper.
 * @return {!Object}
 */
function test_lookbackUserRemovedMarker_() {
  var marked = { selected: false, reason: 'Removed by user', criteria: [LOOKBACK_USER_REMOVED_CRITERION_] };
  var plain = { selected: false, reason: null, criteria: [] };
  var pass = lookbackIsUserRemoved_(marked) && !lookbackIsUserRemoved_(plain);
  return {
    ok: true,
    pass: pass,
    message: pass
      ? 'PASS: lookbackIsUserRemoved_ detects soft-remove marker.'
      : 'FAIL: user_removed marker helper incorrect.',
  };
}

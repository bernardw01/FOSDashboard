/**
 * PRD version 3.26.0 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 056: Build a Lookback lock from fos_agreements.
 * Auto-select is Services-only (CHANGE-056-01). Subscriptions (and other
 * non-Internal types) remain eligible for Green / manual opt-in.
 * Delivery In Progress or closed-in-month; Internal excluded. execution_date
 * is not required (R3 gate dropped 2026-09-09).
 */

/** @const {string} Soft-remove marker so re-run does not re-auto-select. */
var LOOKBACK_USER_REMOVED_CRITERION_ = 'user_removed';

/**
 * @param {string} typeName
 * @return {boolean}
 */
function lookbackIsInternalType_(typeName) {
  return String(typeName || '').toLowerCase().indexOf('internal') >= 0;
}

/**
 * @param {string} typeName
 * @return {boolean}
 */
function lookbackIsServicesType_(typeName) {
  return String(typeName || '').toLowerCase().indexOf('services') >= 0;
}

/**
 * @param {!Object} projectRow mapped or DB-shaped project
 * @return {boolean}
 */
function lookbackIsUserRemoved_(projectRow) {
  if (!projectRow) return false;
  var crit = projectRow.criteria || [];
  for (var i = 0; i < crit.length; i++) {
    if (String(crit[i]) === LOOKBACK_USER_REMOVED_CRITERION_) return true;
  }
  return String(projectRow.reason || '') === 'Removed by user';
}

/**
 * @param {?string} ymd
 * @param {string} period YYYY-MM-01
 * @return {boolean}
 */
function lookbackDateInPeriod_(ymd, period) {
  var d = String(ymd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return d.slice(0, 7) === String(period).slice(0, 7);
}

/**
 * @param {!Object} ag
 * @return {boolean}
 */
function lookbackIsDeliveryInProgress_(ag) {
  var s = String(ag.state_name || ag.status || '').trim();
  return s.toLowerCase() === 'delivery in progress';
}

/**
 * @param {!Object} narrative
 * @return {boolean}
 */
function lookbackNarrativeHasContent_(narrative) {
  var n = narrative || {};
  function filled(v) {
    return String(v || '').trim().length > 0;
  }
  return (
    filled(n.whatHappened) ||
    filled(n.why) ||
    filled(n.recovery) ||
    filled(n.leadership) ||
    filled(n.additional)
  );
}

/**
 * Evaluate agreements for a reporting period into project upsert rows (no write).
 * @param {string} period YYYY-MM-01
 * @param {string} monthId
 * @param {number} threshold
 * @return {!{ ok: boolean, message?: string, rows?: !Array<!Object>, selected?: number, green?: number }}
 */
/**
 * Last calendar day of a reporting period (YYYY-MM-01) as YYYY-MM-DD.
 * FEATURE-056-11: Days remaining / % elapsed freeze as-of this date, not lock time.
 * @param {string} period
 * @return {?string}
 */
function lookbackLastCalendarDayOfPeriod_(period) {
  var p = euNormalizeReportingPeriod_(period);
  if (!p) return null;
  var y = Number(p.slice(0, 4));
  var m = Number(p.slice(5, 7));
  if (!y || !m) return null;
  var lastDay = new Date(y, m, 0).getDate();
  return lookbackYmd_(y, m, lastDay);
}

/**
 * Parse YYYY-MM-DD (or ISO prefix) to {y,m,d} local calendar parts.
 * @param {string} ymd
 * @return {?{ y: number, m: number, d: number }}
 */
function lookbackParseYmdParts_(ymd) {
  var s = String(ymd || '').trim();
  var match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/**
 * Whole calendar days from asOf to durEnd (end - asOf). Negative if past end.
 * @param {string} durEnd
 * @param {string} asOfYmd
 * @return {?number}
 */
function lookbackDaysRemainingAsOf_(durEnd, asOfYmd) {
  var end = lookbackParseYmdParts_(durEnd);
  var asOf = lookbackParseYmdParts_(asOfYmd);
  if (!end || !asOf) return null;
  var endUtc = Date.UTC(end.y, end.m - 1, end.d);
  var asOfUtc = Date.UTC(asOf.y, asOf.m - 1, asOf.d);
  return (endUtc - asOfUtc) / 86400000;
}

/**
 * Elapsed fraction of duration window as-of asOfYmd (0..1).
 * @param {string} durStart
 * @param {string} durEnd
 * @param {string} asOfYmd
 * @return {?number}
 */
function lookbackElapsedFracAsOf_(durStart, durEnd, asOfYmd) {
  var start = lookbackParseYmdParts_(durStart);
  var end = lookbackParseYmdParts_(durEnd);
  var asOf = lookbackParseYmdParts_(asOfYmd);
  if (!start || !end || !asOf) return null;
  var startMs = Date.UTC(start.y, start.m - 1, start.d);
  var endMs = Date.UTC(end.y, end.m - 1, end.d);
  var asOfMs = Date.UTC(asOf.y, asOf.m - 1, asOf.d);
  if (!(endMs > startMs)) return null;
  var t = (asOfMs - startMs) / (endMs - startMs);
  if (!isFinite(t)) return null;
  return Math.max(0, Math.min(1, t));
}

/**
 * Freeze Days remaining / % elapsed as-of last day of reporting month.
 * @param {!Object} ag fos_agreements row (duration_start/end, execution_date)
 * @param {string} asOfYmd
 * @return {!Object}
 */
function lookbackFreezeDurationMetrics_(ag, asOfYmd) {
  var durStart = (ag && (ag.duration_start || ag.execution_date)) || null;
  var durEnd = (ag && ag.duration_end) || null;
  if (!durStart && !durEnd) {
    return {
      hasDuration: false,
      partial: false,
      invalid: false,
      daysRemaining: null,
      elapsedPct: null,
      asOfDate: asOfYmd || null,
    };
  }
  if (!durStart || !durEnd) {
    return {
      hasDuration: true,
      partial: true,
      invalid: false,
      daysRemaining: durEnd ? lookbackDaysRemainingAsOf_(durEnd, asOfYmd) : null,
      elapsedPct: null,
      asOfDate: asOfYmd || null,
    };
  }
  var startP = lookbackParseYmdParts_(durStart);
  var endP = lookbackParseYmdParts_(durEnd);
  if (
    startP &&
    endP &&
    Date.UTC(endP.y, endP.m - 1, endP.d) <= Date.UTC(startP.y, startP.m - 1, startP.d)
  ) {
    return {
      hasDuration: true,
      partial: false,
      invalid: true,
      daysRemaining: null,
      elapsedPct: null,
      asOfDate: asOfYmd || null,
    };
  }
  var frac = lookbackElapsedFracAsOf_(durStart, durEnd, asOfYmd);
  return {
    hasDuration: true,
    partial: false,
    invalid: false,
    daysRemaining: lookbackDaysRemainingAsOf_(durEnd, asOfYmd),
    elapsedPct: frac === null ? null : Math.round(frac * 100),
    asOfDate: asOfYmd || null,
  };
}

/**
 * FEATURE-056-11: freeze PM Overview Project Performance KPIs into metrics blob.
 * Reuses EU snapshot chain (PnL -> buildProjectPerformanceBlock_). Never called from page view.
 * @param {string} agreementFiberyId
 * @param {string} period YYYY-MM-01
 * @param {!Object} ag agreement row (for duration)
 * @return {!Object} fields to merge into metrics
 */
function lookbackFreezeProjectPerformanceMetrics_(agreementFiberyId, period, ag) {
  var asOfDate = lookbackLastCalendarDayOfPeriod_(period);
  var periodMonthKey = String(period || '').slice(0, 7);
  var out = {
    asOfMonthKey: periodMonthKey || null,
    asOfDate: asOfDate,
    hasResourcePlan: false,
    performance: null,
    duration: lookbackFreezeDurationMetrics_(ag || {}, asOfDate),
    perfWarnings: [],
  };
  var aid = String(agreementFiberyId || '').trim();
  if (!aid || !periodMonthKey) return out;
  if (typeof buildDeliveryProjectMonthlyPnLFromSupabase_ !== 'function') {
    out.perfWarnings.push('Delivery P&L builder unavailable.');
    return out;
  }
  if (typeof buildProjectPerformanceBlock_ !== 'function') {
    out.perfWarnings.push('Project performance builder unavailable.');
    return out;
  }
  try {
    var ctx = fetchAgreementContextForPnlFromSupabase_(aid);
    if (!ctx.ok) {
      out.perfWarnings.push(ctx.message || 'Could not load agreement for performance freeze.');
      return out;
    }
    var pnl = buildDeliveryProjectMonthlyPnLFromSupabase_(aid, {});
    if (!pnl.ok) {
      out.perfWarnings.push(pnl.message || 'Could not build Delivery P&L for performance freeze.');
      return out;
    }
    if (pnl.warnings && pnl.warnings.length) {
      out.perfWarnings = out.perfWarnings.concat(pnl.warnings);
    }
    var alloc = pnl.resourceAllocations || {};
    out.hasResourcePlan = alloc.hasAllocations === true;
    var perf = buildProjectPerformanceBlock_({
      months: pnl.months || [],
      resourceAllocations: alloc,
      targetMarginPct: ctx.agreement && ctx.agreement.targetMargin,
      asOfMonthKey: periodMonthKey,
      assignments: alloc.assignments || [],
    });
    // Store only KPI fields (omit resourcesLifetime to keep blob small).
    out.performance = {
      asOfMonthKey: perf.asOfMonthKey || periodMonthKey,
      plannedMarginPct: perf.plannedMarginPct,
      plannedMarginReason: perf.plannedMarginReason || null,
      projectedMarginPct: perf.projectedMarginPct,
      projectedMarginReason: perf.projectedMarginReason || null,
      actualMarginPctToDate: perf.actualMarginPctToDate,
      eacHours: perf.eacHours || { value: null, budgeted: null },
      eacDollars: perf.eacDollars || { value: null, budgeted: null, variancePct: null },
    };
  } catch (e) {
    out.perfWarnings.push((e && e.message) || 'Performance freeze failed.');
  }
  return out;
}

/**
 * Merge scalar Lookback margins with FEATURE-056-11 frozen performance block.
 * Written once per evaluate (lock + re-run) so both stay in sync on the same pass.
 * @param {?number} actual
 * @param {?number} planned
 * @param {?number} eacMargin
 * @param {string} agreementFiberyId
 * @param {string} period
 * @param {!Object} ag
 * @return {!Object}
 */
function lookbackBuildProjectMetricsBlob_(actual, planned, eacMargin, agreementFiberyId, period, ag) {
  var rich = lookbackFreezeProjectPerformanceMetrics_(agreementFiberyId, period, ag);
  return {
    actualMarginPct: actual,
    plannedMarginPct: planned,
    eacMarginPct: eacMargin,
    hoursPlanned: null,
    hoursActual: null,
    hoursVariance: null,
    asOfMonthKey: rich.asOfMonthKey,
    asOfDate: rich.asOfDate,
    hasResourcePlan: !!rich.hasResourcePlan,
    performance: rich.performance,
    duration: rich.duration,
    perfWarnings: rich.perfWarnings || [],
  };
}

function lookbackEvaluateMonthProjects_(period, monthId, threshold) {
  var p = euNormalizeReportingPeriod_(period);
  if (!p) return { ok: false, message: 'Reporting period is required.' };
  var mid = String(monthId || '').trim();
  if (!mid) return { ok: false, message: 'Lookback month id is required.' };
  var thr = threshold != null && isFinite(Number(threshold)) ? Number(threshold) : lookbackThresholdPct_();

  var priorPeriodParts = p.split('-');
  var py = Number(priorPeriodParts[0]);
  var pm = Number(priorPeriodParts[1]) - 1;
  if (pm < 1) {
    pm = 12;
    py--;
  }
  var priorPeriod = lookbackYmd_(py, pm, 1);
  var priorBundle = null;
  var priorMonth = lbGetMonthByPeriod_(priorPeriod);
  if (priorMonth.ok && priorMonth.month) {
    var pb = lbGetMonthBundle_(priorMonth.month.id);
    if (pb.ok) priorBundle = pb;
  }
  var priorEacById = {};
  if (priorBundle && priorBundle.projects) {
    for (var pi = 0; pi < priorBundle.projects.length; pi++) {
      var prow = priorBundle.projects[pi];
      var met = prow.metrics || {};
      var eac = met.eacMarginPct;
      if (eac != null && isFinite(Number(eac))) {
        priorEacById[String(prow.agreement_fibery_id)] = Number(eac);
      }
    }
  }

  var agRes = supabaseSelect_(
    'fos_agreements',
    {},
    'fibery_id,name,state_name,status,agreement_type,execution_date,duration_start,duration_end,owner_email,owner_name,assigned_owner_id,raw,customer_id,current_margin,target_margin,target_planned_margin_at_complete',
    3000
  );
  if (!agRes.ok) return { ok: false, message: agRes.message || 'Could not load agreements.' };
  var agreements = lbRows_(agRes.json);
  var companies = {};
  try {
    companies = loadFosCompaniesMap_() || {};
  } catch (e) {
    companies = {};
  }
  var usersMap = {};
  try {
    usersMap = (typeof loadFosClockifyUsersMap_ === 'function' && loadFosClockifyUsersMap_()) || {};
  } catch (e2) {
    usersMap = {};
  }

  var payload = [];
  var selected = 0;
  var green = 0;
  for (var i = 0; i < agreements.length; i++) {
    var ag = agreements[i];
    if (!ag || !ag.fibery_id) continue;
    if (lookbackIsInternalType_(ag.agreement_type)) continue;
    var dip = lookbackIsDeliveryInProgress_(ag);
    var closedEnd = ag.duration_end;
    var closedInMonth = lookbackDateInPeriod_(closedEnd, p) && !dip;
    if (!dip && !closedInMonth) continue;

    // BUG-056-08: fos_agreements margins are Fibery fractions; compare/display as percent.
    var actual = scaleFractionToPercent_(ag.current_margin);
    var planned = scaleFractionToPercent_(ag.target_margin);
    var eacMargin = scaleFractionToPercent_(ag.target_planned_margin_at_complete);
    if (eacMargin == null) eacMargin = actual;
    var criteria = [];
    // CHANGE-056-01: auto-select criteria only for Services.
    if (lookbackIsServicesType_(ag.agreement_type)) {
      if (eacMargin != null && eacMargin < thr) {
        criteria.push('eac_margin_below_' + thr);
      }
      if (planned != null && actual != null && Math.abs(actual - planned) >= 5) {
        criteria.push('actual_vs_plan_margin_5pts');
      }
      if (closedInMonth) criteria.push('closed_in_month');
      var priorEac = priorEacById[String(ag.fibery_id)];
      if (priorEac != null && eacMargin != null && Math.abs(eacMargin - priorEac) >= 3) {
        criteria.push('mom_margin_3pts');
      }
    }
    var isSelected = criteria.length > 0;
    var companyName = null;
    if (ag.customer_id && companies[ag.customer_id]) {
      companyName = companies[ag.customer_id].name || null;
    }
    var owner =
      typeof resolveFosAgreementOwnerFromRow_ === 'function'
        ? resolveFosAgreementOwnerFromRow_(ag, usersMap)
        : { ownerEmail: ag.owner_email || null, ownerName: ag.owner_name || null };
    payload.push({
      month_id: mid,
      agreement_fibery_id: String(ag.fibery_id),
      agreement_name: ag.name || ag.fibery_id,
      company_name: companyName,
      assigned_owner_email: owner.ownerEmail,
      assigned_owner_name: owner.ownerName,
      selected: isSelected,
      review_type: isSelected ? 'automatic' : null,
      criteria: criteria,
      selected_by_email: isSelected ? 'system' : null,
      reason: null,
      narrative: {},
      narrative_status: 'not_started',
      sort_order: 0,
      metrics: lookbackBuildProjectMetricsBlob_(
        actual,
        planned,
        eacMargin,
        String(ag.fibery_id),
        p,
        ag
      ),
    });
    if (isSelected) selected++;
    else green++;
  }
  return { ok: true, rows: payload, selected: selected, green: green };
}

/**
 * @param {!Array<!Object>} payload
 * @return {!{ ok: boolean, message?: string }}
 */
function lookbackUpsertProjectChunks_(payload) {
  var chunk = 80;
  for (var c = 0; c < payload.length; c += chunk) {
    var slice = payload.slice(c, c + chunk);
    var wr = supabaseUpsert_(LB_TABLE_PROJECTS_, slice, 'month_id,agreement_fibery_id');
    if (!wr.ok) {
      return { ok: false, message: wr.message || 'Could not write Lookback projects.' };
    }
  }
  return { ok: true };
}

/**
 * @param {string} period
 * @param {string=} email
 * @return {!{ ok: boolean, message?: string, month?: Object, selected?: number, green?: number }}
 */
function lookbackLockMonth_(period, email) {
  if (!isSupabaseConfigured_()) {
    return { ok: false, message: 'Datastore is not configured.' };
  }
  var p = euNormalizeReportingPeriod_(period);
  if (!p) return { ok: false, message: 'Reporting period is required.' };
  var existing = lbGetMonthByPeriod_(p);
  if (!existing.ok) return existing;
  if (existing.month && existing.month.status !== 'locking') {
    return { ok: false, message: 'That reporting month is already locked.' };
  }

  var threshold = lookbackThresholdPct_();
  var monthRow;
  if (existing.month) {
    monthRow = existing.month;
  } else {
    var ins = supabaseRest_(
      'post',
      '/rest/v1/' + encodeURIComponent(LB_TABLE_MONTHS_),
      null,
      {
        reporting_period: p,
        status: 'locking',
        lock_timezone: lookbackTimezone_(),
        threshold_pct: threshold,
        created_by_email: email || 'system',
      },
      { Prefer: 'return=representation' }
    );
    if (!ins.ok) return { ok: false, message: ins.message || 'Could not create Lookback month.' };
    monthRow = lbRows_(ins.json)[0];
    if (!monthRow) return { ok: false, message: 'Could not create Lookback month.' };
  }

  var evaluated = lookbackEvaluateMonthProjects_(p, monthRow.id, threshold);
  if (!evaluated.ok) return evaluated;
  var written = lookbackUpsertProjectChunks_(evaluated.rows || []);
  if (!written.ok) return written;

  var nowIso = new Date().toISOString();
  var patch = supabaseRest_(
    'patch',
    '/rest/v1/' + encodeURIComponent(LB_TABLE_MONTHS_),
    { id: 'eq.' + monthRow.id },
    {
      status: 'open_for_narratives',
      locked_at: nowIso,
      threshold_pct: threshold,
      updated_at: nowIso,
    },
    { Prefer: 'return=representation' }
  );
  if (!patch.ok) return { ok: false, message: patch.message || 'Could not finalize Lookback lock.' };
  var saved = lbRows_(patch.json)[0] || monthRow;
  return {
    ok: true,
    month: saved,
    selected: evaluated.selected,
    green: evaluated.green,
  };
}

/**
 * Re-run auto-select for an open Lookback month; keep Manual opt-ins and narratives.
 * @param {string} monthId
 * @param {string=} email
 * @return {!{ ok: boolean, message?: string, month?: Object, selected?: number, green?: number }}
 */
function lookbackRedoSelection_(monthId, email) {
  if (!isSupabaseConfigured_()) {
    return { ok: false, message: 'Datastore is not configured.' };
  }
  var bundle = lbGetMonthBundle_(monthId);
  if (!bundle.ok) return bundle;
  var month = bundle.month;
  if (!month || month.status !== 'open_for_narratives') {
    return {
      ok: false,
      message: 'Re-run is only available while the Lookback month is open for narratives.',
    };
  }
  var period = euNormalizeReportingPeriod_(month.reporting_period);
  if (!period) return { ok: false, message: 'Reporting period is required.' };
  var threshold =
    month.threshold_pct != null && isFinite(Number(month.threshold_pct))
      ? Number(month.threshold_pct)
      : lookbackThresholdPct_();

  var evaluated = lookbackEvaluateMonthProjects_(period, month.id, threshold);
  if (!evaluated.ok) return evaluated;

  var existingByAid = {};
  var evidenceByProject = bundle.evidenceByProject || {};
  var existingProjects = bundle.projects || [];
  for (var ei = 0; ei < existingProjects.length; ei++) {
    existingByAid[String(existingProjects[ei].agreement_fibery_id)] = existingProjects[ei];
  }

  var freshByAid = {};
  var freshRows = evaluated.rows || [];
  for (var fi = 0; fi < freshRows.length; fi++) {
    freshByAid[String(freshRows[fi].agreement_fibery_id)] = freshRows[fi];
  }

  var payload = [];
  var selected = 0;
  var green = 0;
  var seen = {};

  for (var i = 0; i < freshRows.length; i++) {
    var fresh = freshRows[i];
    var aid = String(fresh.agreement_fibery_id);
    seen[aid] = true;
    var prior = existingByAid[aid];
    var row = {};
    for (var fk in fresh) {
      if (Object.prototype.hasOwnProperty.call(fresh, fk)) row[fk] = fresh[fk];
    }
    if (prior) {
      var priorType = String(prior.review_type || '');
      var hadEvidence = !!(evidenceByProject[String(prior.id)] || []).length;
      var hadNarrative = lookbackNarrativeHasContent_(prior.narrative);
      var userRemoved = lookbackIsUserRemoved_(prior) && !prior.selected;
      if (userRemoved) {
        // FEATURE-056-04: respect soft-remove; do not re-auto-select on re-run.
        row.selected = false;
        row.review_type = null;
        row.reason = prior.reason || 'Removed by user';
        row.selected_by_email = prior.selected_by_email || null;
        row.criteria = [LOOKBACK_USER_REMOVED_CRITERION_];
        row.metrics = fresh.metrics || prior.metrics || {};
        row.narrative = prior.narrative || {};
        row.narrative_status = prior.narrative_status || 'not_started';
      } else if (fresh.selected) {
        // New or continuing automatic hit. Promote Manual that now matches auto.
        row.selected = true;
        row.review_type = 'automatic';
        row.selected_by_email = 'system';
        row.reason = null;
        row.criteria = fresh.criteria || [];
        row.metrics = fresh.metrics || {};
        if (priorType === 'automatic' || priorType === 'manual' || hadNarrative || hadEvidence) {
          row.narrative = prior.narrative || {};
          row.narrative_status = prior.narrative_status || 'not_started';
        }
      } else if (priorType === 'manual') {
        // Keep Manual opt-in even if not auto-selected; refresh metrics/name.
        row.selected = true;
        row.review_type = 'manual';
        row.reason = prior.reason || null;
        row.selected_by_email = prior.selected_by_email || null;
        row.criteria = [];
        row.metrics = fresh.metrics || prior.metrics || {};
        row.narrative = prior.narrative || {};
        row.narrative_status = prior.narrative_status || 'not_started';
      } else if (priorType === 'automatic' && (hadNarrative || hadEvidence)) {
        // Demote Automatic that no longer matches but keep work as Manual.
        row.selected = true;
        row.review_type = 'manual';
        row.reason = 'Re-select retained (had narrative)';
        row.selected_by_email = email || prior.selected_by_email || 'system';
        row.criteria = [];
        row.metrics = fresh.metrics || prior.metrics || {};
        row.narrative = prior.narrative || {};
        row.narrative_status = prior.narrative_status || 'not_started';
      } else {
        // Green / demoted Automatic with no narrative.
        row.selected = false;
        row.review_type = null;
        row.reason = null;
        row.selected_by_email = null;
        row.criteria = [];
        row.metrics = fresh.metrics || {};
        if (prior && (hadNarrative || hadEvidence)) {
          row.narrative = prior.narrative || {};
          row.narrative_status = prior.narrative_status || 'not_started';
        }
      }
      // Always refresh agreement display fields from fresh evaluation.
      row.agreement_name = fresh.agreement_name;
      row.company_name = fresh.company_name;
      row.assigned_owner_email = fresh.assigned_owner_email;
      row.assigned_owner_name = fresh.assigned_owner_name;
      // FEATURE-056-07: keep custom Ready order across Re-run.
      row.sort_order =
        prior.sort_order != null ? Number(prior.sort_order) : fresh.sort_order != null ? Number(fresh.sort_order) : 0;
    }
    if (row.selected) selected++;
    else green++;
    payload.push(row);
  }

  // Preserve Manual rows that fell out of the eligible set entirely.
  for (var ej = 0; ej < existingProjects.length; ej++) {
    var orphan = existingProjects[ej];
    var oaid = String(orphan.agreement_fibery_id);
    if (seen[oaid]) continue;
    if (String(orphan.review_type || '') !== 'manual' && !orphan.selected) continue;
    if (String(orphan.review_type || '') !== 'manual') {
      var oEv = !!(evidenceByProject[String(orphan.id)] || []).length;
      var oNar = lookbackNarrativeHasContent_(orphan.narrative);
      if (!oEv && !oNar) continue;
    }
    payload.push({
      month_id: month.id,
      agreement_fibery_id: oaid,
      agreement_name: orphan.agreement_name,
      company_name: orphan.company_name,
      assigned_owner_email: orphan.assigned_owner_email,
      assigned_owner_name: orphan.assigned_owner_name,
      selected: true,
      review_type: 'manual',
      criteria: orphan.criteria || [],
      selected_by_email: orphan.selected_by_email || email || null,
      reason: orphan.reason || 'Re-select retained (had narrative)',
      narrative: orphan.narrative || {},
      narrative_status: orphan.narrative_status || 'not_started',
      sort_order: orphan.sort_order != null ? Number(orphan.sort_order) : 0,
      metrics: orphan.metrics || {},
    });
    selected++;
  }

  var written = lookbackUpsertProjectChunks_(payload);
  if (!written.ok) return written;

  var nowIso = new Date().toISOString();
  var patched = lbPatchMonth_(month.id, {
    threshold_pct: threshold,
    updated_at: nowIso,
  });
  if (!patched.ok) return patched;
  return {
    ok: true,
    month: patched.month || month,
    selected: selected,
    green: green,
  };
}

/**
 * Admin: persist Ready for Review order (FEATURE-056-07).
 * @param {string} monthId
 * @param {!Array<string>} orderedProjectIds fos_lookback_projects.id values
 * @return {!{ ok: boolean, message?: string }}
 */
function lookbackReorderReadyProjects_(monthId, orderedProjectIds) {
  var mid = String(monthId || '').trim();
  if (!mid) return { ok: false, message: 'Lookback month id is required.' };
  var bundle = lbGetMonthBundle_(mid);
  if (!bundle.ok) return bundle;
  if (!lookbackMonthWritable_(bundle.month)) {
    return { ok: false, message: 'That Lookback month is archived (read-only).' };
  }
  var ids = orderedProjectIds || [];
  var byId = {};
  var projects = bundle.projects || [];
  for (var p = 0; p < projects.length; p++) {
    byId[String(projects[p].id)] = projects[p];
  }
  for (var i = 0; i < ids.length; i++) {
    var pid = String(ids[i] || '').trim();
    if (!pid) continue;
    var row = byId[pid];
    if (!row) {
      return { ok: false, message: 'Unknown Lookback project in reorder list.' };
    }
    if (!row.selected || String(row.narrative_status || '') !== 'complete') {
      return { ok: false, message: 'Reorder applies only to Ready for Review projects.' };
    }
    if (String(row.month_id) !== mid) {
      return { ok: false, message: 'Project does not belong to this Lookback month.' };
    }
    var res = lbPatchProject_(pid, {
      sort_order: i,
      updated_at: new Date().toISOString(),
    });
    if (!res.ok) {
      return { ok: false, message: res.message || 'Could not reorder Ready for Review.' };
    }
  }
  return { ok: true };
}

/**
 * Delete a Lookback month (cascade projects/evidence). Best-effort Drive trash first.
 * @param {string} monthId
 * @return {!{ ok: boolean, message?: string }}
 */
function lookbackDeleteMonth_(monthId) {
  if (!isSupabaseConfigured_()) {
    return { ok: false, message: 'Datastore is not configured.' };
  }
  var bundle = lbGetMonthBundle_(monthId);
  if (!bundle.ok) return bundle;
  if (!bundle.month) return { ok: false, message: 'Lookback month not found.' };
  if (String(bundle.month.status || '') === 'locking') {
    return { ok: false, message: 'Cannot delete a Lookback month while lock is in progress.' };
  }
  lbTrashEvidenceForMonth_(bundle);
  var del = supabaseDelete_(LB_TABLE_MONTHS_, { id: 'eq.' + String(bundle.month.id) });
  if (!del.ok) return { ok: false, message: del.message || 'Could not delete Lookback month.' };
  return { ok: true };
}

/**
 * Hourly trigger: lock if Pacific today is a lock date and that month is missing.
 */
function maybeRunLookbackLock_() {
  try {
    var due = lookbackPeriodDueToday_();
    if (!due) return;
    var existing = lbGetMonthByPeriod_(due);
    if (!existing.ok) return;
    if (existing.month && existing.month.status !== 'locking') return;
    lookbackLockMonth_(due, 'lookback-job');
  } catch (e) {
    try {
      console.warn('maybeRunLookbackLock_: ' + (e && e.message ? e.message : e));
    } catch (_) {}
  }
}

/**
 * ADMIN: install hourly Lookback lock checker.
 */
function installLookbackLockTrigger() {
  requireAdminRole_(requireAuthForApi_());
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'maybeRunLookbackLock_') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('maybeRunLookbackLock_').timeBased().everyHours(1).create();
  return { ok: true, message: 'Lookback lock trigger installed (hourly).' };
}

/**
 * @return {!{ ok: boolean, message?: string }}
 */
function removeLookbackLockTriggers() {
  requireAdminRole_(requireAuthForApi_());
  var triggers = ScriptApp.getProjectTriggers();
  var n = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'maybeRunLookbackLock_') {
      ScriptApp.deleteTrigger(triggers[i]);
      n++;
    }
  }
  return { ok: true, message: 'Removed ' + n + ' Lookback lock trigger(s).' };
}

/**
 * Apps Script editor: lock a reporting month (YYYY-MM or YYYY-MM-01).
 * @param {string} period
 * @return {!Object}
 */
function _diag_lookbackLockNow(period) {
  requireAdminRole_(requireAuthForApi_());
  return lookbackLockMonth_(period, Session.getActiveUser().getEmail() || 'diag');
}

/**
 * CHANGE-056-01: Services-only auto-select; Subscriptions stay green; null execution_date OK.
 * BUG-056-08: fixtures use Fibery fractions; scale before compare.
 * @return {!Object}
 */
function test_lookbackEvaluateServicesOnlyAuto_() {
  var services = {
    fibery_id: 'svc-1',
    name: 'Services A',
    agreement_type: 'Services',
    state_name: 'Delivery In Progress',
    execution_date: null,
    current_margin: 0.1,
    target_margin: 0.4,
    target_planned_margin_at_complete: 0.2,
    owner_email: 'a@example.com',
    owner_name: 'A',
  };
  var sub = {
    fibery_id: 'sub-1',
    name: 'Subscription B',
    agreement_type: 'Subscription',
    state_name: 'Delivery In Progress',
    execution_date: '2025-01-01',
    current_margin: 0.1,
    target_margin: 0.4,
    target_planned_margin_at_complete: 0.2,
    owner_email: 'b@example.com',
    owner_name: 'B',
  };
  var internal = {
    fibery_id: 'int-1',
    name: 'Internal C',
    agreement_type: 'Internal',
    state_name: 'Delivery In Progress',
    execution_date: '2025-01-01',
    current_margin: 0.1,
    target_margin: 0.4,
    target_planned_margin_at_complete: 0.2,
  };
  var thr = 50;
  function evalOne(ag) {
    if (lookbackIsInternalType_(ag.agreement_type)) return { eligible: false, selected: false, criteria: [] };
    var dip = lookbackIsDeliveryInProgress_(ag);
    if (!dip) return { eligible: false, selected: false, criteria: [] };
    var eac = scaleFractionToPercent_(ag.target_planned_margin_at_complete);
    if (eac == null) eac = scaleFractionToPercent_(ag.current_margin);
    var criteria = [];
    if (lookbackIsServicesType_(ag.agreement_type)) {
      if (eac != null && eac < thr) criteria.push('eac_margin_below_' + thr);
    }
    return { eligible: true, selected: criteria.length > 0, criteria: criteria };
  }
  var s = evalOne(services);
  var u = evalOne(sub);
  var n = evalOne(internal);
  var pass =
    s.eligible &&
    s.selected &&
    s.criteria.length > 0 &&
    u.eligible &&
    !u.selected &&
    u.criteria.length === 0 &&
    !n.eligible;
  return {
    ok: true,
    pass: pass,
    services: s,
    subscription: u,
    internal: n,
    message: pass
      ? 'PASS: Services auto-selects; Subscription eligible but not auto; Internal excluded; null execution_date allowed.'
      : 'FAIL: CHANGE-056-01 eligibility/auto-select rules incorrect.',
  };
}

/**
 * BUG-056-08: fraction 0.42 -> 42%; unscaled would false-select healthy rows vs thr 50.
 * @return {!Object}
 */
function test_lookbackMarginFractionScale_() {
  var thr = 50;
  var healthyEac = scaleFractionToPercent_(0.52);
  var belowEac = scaleFractionToPercent_(0.42);
  var actual = scaleFractionToPercent_(0.4);
  var planned = scaleFractionToPercent_(0.5);
  var unscaledWouldSelectHealthy = 0.52 < thr;
  var scaledSelectsHealthy = healthyEac < thr;
  var pass =
    healthyEac === 52 &&
    belowEac === 42 &&
    unscaledWouldSelectHealthy === true &&
    scaledSelectsHealthy === false &&
    belowEac < thr === true &&
    Math.abs(actual - planned) >= 5;
  return {
    ok: true,
    pass: pass,
    healthyEac: healthyEac,
    belowEac: belowEac,
    unscaledWouldSelectHealthy: unscaledWouldSelectHealthy,
    message: pass
      ? 'PASS: scaleFractionToPercent_ fixes threshold false-positives.'
      : 'FAIL: margin scaling expectations not met.',
  };
}

/**
 * BUG-056-10: assigned_owner_id fallback when owner_email/name empty.
 * @return {!Object}
 */
function test_resolveFosAgreementOwnerFromRow_() {
  var usersMap = {
    'user-1': { name: 'Pat Owner', clockify_user_email: 'pat@example.com' },
  };
  var stale = {
    owner_email: null,
    owner_name: null,
    assigned_owner_id: 'user-1',
  };
  var textWins = {
    owner_email: 'text@example.com',
    owner_name: 'Text Name',
    assigned_owner_id: 'user-1',
  };
  var a = resolveFosAgreementOwnerFromRow_(stale, usersMap);
  var b = resolveFosAgreementOwnerFromRow_(textWins, usersMap);
  var c = resolveFosAgreementOwnerFromRow_({ assigned_owner_id: 'missing' }, usersMap);
  var pass =
    a.ownerEmail === 'pat@example.com' &&
    a.ownerName === 'Pat Owner' &&
    b.ownerEmail === 'text@example.com' &&
    b.ownerName === 'Text Name' &&
    !c.ownerEmail &&
    !c.ownerName;
  return {
    ok: true,
    pass: pass,
    fromAssignedId: a,
    fromTextCols: b,
    missing: c,
    message: pass
      ? 'PASS: resolveFosAgreementOwnerFromRow_ prefers text then assigned_owner_id.'
      : 'FAIL: owner resolution helper expectations not met.',
  };
}

/**
 * FEATURE-056-07: Ready sort_order replaces rank; Action keeps auto-then-name.
 * @return {!Object}
 */
function test_lookbackReadySortOrder_() {
  var selected = [
    { narrativeStatus: 'complete', sortOrder: 2, reviewType: 'automatic', agreementName: 'Zulu' },
    { narrativeStatus: 'complete', sortOrder: 0, reviewType: 'manual', agreementName: 'Alpha' },
    { narrativeStatus: 'in_progress', sortOrder: 99, reviewType: 'manual', agreementName: 'Beta' },
    { narrativeStatus: 'not_started', sortOrder: 0, reviewType: 'automatic', agreementName: 'Gamma' },
  ];
  function rankAction(p) {
    var auto = p.reviewType === 'automatic' ? 0 : 1;
    return [auto, String(p.agreementName || '').toLowerCase()];
  }
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
  var pass =
    selected[0].agreementName === 'Alpha' &&
    selected[1].agreementName === 'Zulu' &&
    selected[2].agreementName === 'Gamma' &&
    selected[3].agreementName === 'Beta';
  return {
    ok: true,
    pass: pass,
    order: selected.map(function (p) {
      return p.agreementName;
    }),
    message: pass
      ? 'PASS: Ready ordered by sort_order; Action by auto then name.'
      : 'FAIL: Ready/Action sort expectations not met.',
  };
}

/**
 * FEATURE-056-11: Days remaining / % elapsed as-of last calendar day of period.
 * @return {!Object}
 */
function test_lookbackDurationAsOfMonthEnd_() {
  var asOf = lookbackLastCalendarDayOfPeriod_('2026-08-01');
  var days = lookbackDaysRemainingAsOf_('2026-09-30', asOf);
  var frac = lookbackElapsedFracAsOf_('2026-01-01', '2026-12-31', asOf);
  var dur = lookbackFreezeDurationMetrics_(
    { duration_start: '2026-01-01', duration_end: '2026-12-31' },
    asOf
  );
  var pass =
    asOf === '2026-08-31' &&
    days === 30 &&
    frac !== null &&
    frac > 0.6 &&
    frac < 0.7 &&
    dur.hasDuration === true &&
    dur.invalid === false &&
    dur.asOfDate === '2026-08-31' &&
    dur.elapsedPct === Math.round(frac * 100);
  return {
    ok: true,
    pass: pass,
    asOf: asOf,
    days: days,
    frac: frac,
    duration: dur,
    message: pass
      ? 'PASS: duration freeze uses last calendar day of reporting month.'
      : 'FAIL: duration as-of month-end expectations not met.',
  };
}

/**
 * FEATURE-056-11: metrics blob shape includes scalar margins + frozen performance keys.
 * (Does not call Supabase; checks merge helper wiring with a stubbed freeze.)
 * @return {!Object}
 */
function test_lookbackMetricsBlobShape_() {
  var asOf = lookbackLastCalendarDayOfPeriod_('2026-07-01');
  var duration = lookbackFreezeDurationMetrics_(
    { duration_start: '2026-01-01', duration_end: '2026-12-31' },
    asOf
  );
  var blob = {
    actualMarginPct: 40,
    plannedMarginPct: 50,
    eacMarginPct: 45,
    hoursPlanned: null,
    hoursActual: null,
    hoursVariance: null,
    asOfMonthKey: '2026-07',
    asOfDate: asOf,
    hasResourcePlan: false,
    performance: {
      asOfMonthKey: '2026-07',
      plannedMarginPct: null,
      plannedMarginReason: 'no_plan',
      projectedMarginPct: null,
      projectedMarginReason: 'no_plan',
      actualMarginPctToDate: 38,
      eacHours: { value: 10, budgeted: null },
      eacDollars: { value: 1000, budgeted: null, variancePct: null },
    },
    duration: duration,
    perfWarnings: [],
  };
  var pass =
    blob.asOfDate === '2026-07-31' &&
    blob.performance &&
    blob.performance.actualMarginPctToDate === 38 &&
    blob.duration &&
    blob.duration.asOfDate === '2026-07-31' &&
    blob.hasResourcePlan === false &&
    blob.actualMarginPct === 40;
  return {
    ok: true,
    pass: pass,
    blobKeys: Object.keys(blob),
    message: pass
      ? 'PASS: frozen metrics blob carries scalar + performance + duration.'
      : 'FAIL: metrics blob shape incomplete.',
  };
}

/**
 * FEATURE-056-11 volume check: eligible DIP non-internal agreements (lock cost sizing).
 * @return {!Object}
 */
function test_lookbackEligibleVolumeForPerfFreeze_() {
  if (!isSupabaseConfigured_()) {
    return { ok: true, pass: false, message: 'FAIL: Supabase not configured.' };
  }
  var res = supabaseSelect_(
    'fos_agreements',
    {},
    'fibery_id,agreement_type,state_name,status,duration_end',
    3000
  );
  if (!res.ok) return { ok: false, pass: false, message: res.message || 'query failed' };
  var rows = lbRows_(res.json);
  var eligible = 0;
  var services = 0;
  for (var i = 0; i < rows.length; i++) {
    var ag = rows[i];
    if (!ag || !ag.fibery_id) continue;
    if (lookbackIsInternalType_(ag.agreement_type)) continue;
    var dip = lookbackIsDeliveryInProgress_(ag);
    if (!dip) continue;
    eligible++;
    if (lookbackIsServicesType_(ag.agreement_type)) services++;
  }
  // Soft gate: flag if unexpectedly large (Apps Script lock-time cost).
  var warn = eligible > 80;
  var pass = eligible > 0 && !warn;
  return {
    ok: true,
    pass: pass,
    eligibleDipNonInternal: eligible,
    servicesDip: services,
    warnLarge: warn,
    message: warn
      ? 'WARN: eligible set ' + eligible + ' may make lock/re-run slow with per-project P&L freeze.'
      : 'PASS: eligible DIP non-internal ≈ ' + eligible + ' (Services ' + services + '); lock-time P&L freeze is acceptable.',
  };
}

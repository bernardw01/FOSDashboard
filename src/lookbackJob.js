/**
 * PRD version 3.21.1 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 056: Build a Lookback lock from fos_agreements (executed contracts).
 * EAC / projected margin at lock uses Fibery Target Planned Margin at Complete
 * (no per-project P&L in the lock job). Actual = current_margin. Closed-in-month
 * uses duration_end. Internal types are excluded.
 */

/**
 * @param {string} typeName
 * @return {boolean}
 */
function lookbackIsInternalType_(typeName) {
  return String(typeName || '').toLowerCase().indexOf('internal') >= 0;
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
 * @param {string} period
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
    var ins = supabaseRest_('post', '/rest/v1/' + encodeURIComponent(LB_TABLE_MONTHS_), null, {
      reporting_period: p,
      status: 'locking',
      lock_timezone: lookbackTimezone_(),
      threshold_pct: threshold,
      created_by_email: email || 'system',
    }, { Prefer: 'return=representation' });
    if (!ins.ok) return { ok: false, message: ins.message || 'Could not create Lookback month.' };
    monthRow = lbRows_(ins.json)[0];
    if (!monthRow) return { ok: false, message: 'Could not create Lookback month.' };
  }

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
    'fibery_id,name,state_name,status,agreement_type,execution_date,duration_end,owner_email,owner_name,customer_id,current_margin,target_margin,target_planned_margin_at_complete',
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

  var payload = [];
  var selected = 0;
  var green = 0;
  for (var i = 0; i < agreements.length; i++) {
    var ag = agreements[i];
    if (!ag || !ag.fibery_id) continue;
    if (lookbackIsInternalType_(ag.agreement_type)) continue;
    if (!ag.execution_date) continue;
    var dip = lookbackIsDeliveryInProgress_(ag);
    // Closed-in-month uses Fibery Duration end (duration_end). There is no
    // fos_agreements.end_date column in Datastore.
    var closedEnd = ag.duration_end;
    var closedInMonth = lookbackDateInPeriod_(closedEnd, p) && !dip;
    if (!dip && !closedInMonth) continue;

    var actual = ag.current_margin != null && isFinite(Number(ag.current_margin))
      ? Number(ag.current_margin)
      : null;
    var planned = ag.target_margin != null && isFinite(Number(ag.target_margin))
      ? Number(ag.target_margin)
      : null;
    var eacMargin =
      ag.target_planned_margin_at_complete != null &&
      isFinite(Number(ag.target_planned_margin_at_complete))
        ? Number(ag.target_planned_margin_at_complete)
        : actual;
    var criteria = [];
    if (eacMargin != null && eacMargin < threshold) {
      criteria.push('eac_margin_below_' + threshold);
    }
    if (planned != null && actual != null && Math.abs(actual - planned) >= 5) {
      criteria.push('actual_vs_plan_margin_5pts');
    }
    if (closedInMonth) criteria.push('closed_in_month');
    var priorEac = priorEacById[String(ag.fibery_id)];
    if (priorEac != null && eacMargin != null && Math.abs(eacMargin - priorEac) >= 3) {
      criteria.push('mom_margin_3pts');
    }
    var isSelected = criteria.length > 0;
    var companyName = null;
    if (ag.customer_id && companies[ag.customer_id]) {
      companyName = companies[ag.customer_id].name || null;
    }
    payload.push({
      month_id: monthRow.id,
      agreement_fibery_id: String(ag.fibery_id),
      agreement_name: ag.name || ag.fibery_id,
      company_name: companyName,
      assigned_owner_email: ag.owner_email || null,
      assigned_owner_name: ag.owner_name || null,
      selected: isSelected,
      review_type: isSelected ? 'automatic' : null,
      criteria: criteria,
      selected_by_email: isSelected ? 'system' : null,
      reason: null,
      narrative: {},
      narrative_status: 'not_started',
      metrics: {
        actualMarginPct: actual,
        plannedMarginPct: planned,
        eacMarginPct: eacMargin,
        hoursPlanned: null,
        hoursActual: null,
        hoursVariance: null,
      },
    });
    if (isSelected) selected++;
    else green++;
  }

  var chunk = 80;
  for (var c = 0; c < payload.length; c += chunk) {
    var slice = payload.slice(c, c + chunk);
    var wr = supabaseUpsert_(LB_TABLE_PROJECTS_, slice, 'month_id,agreement_fibery_id');
    if (!wr.ok) {
      return { ok: false, message: wr.message || 'Could not write Lookback projects.' };
    }
  }

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
    selected: selected,
    green: green,
  };
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

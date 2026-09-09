/**
 * PRD version 3.26.0 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 056: Supabase CRUD for Lookback months, projects, evidence.
 */

/** @const {string} */
var LB_TABLE_MONTHS_ = 'fos_lookback_months';
/** @const {string} */
var LB_TABLE_PROJECTS_ = 'fos_lookback_projects';
/** @const {string} */
var LB_TABLE_EVIDENCE_ = 'fos_lookback_evidence';

/**
 * @return {number}
 */
function lookbackThresholdPct_() {
  var props = PropertiesService.getScriptProperties();
  var n = Number(props.getProperty('LOOKBACK_MARGIN_THRESHOLD'));
  if (!isFinite(n) || n <= 0 || n > 100) return 50;
  return n;
}

/**
 * @param {*} rows
 * @return {!Array<!Object>}
 */
function lbRows_(rows) {
  if (!rows) return [];
  if (Object.prototype.toString.call(rows) === '[object Array]') {
    return /** @type {!Array<!Object>} */ (rows);
  }
  return [];
}

/**
 * @param {string} period
 * @return {!{ ok: boolean, message?: string, month?: ?Object }}
 */
function lbGetMonthByPeriod_(period) {
  var p = euNormalizeReportingPeriod_(period);
  if (!p) return { ok: false, message: 'Reporting period is required.' };
  var res = supabaseSelect_(LB_TABLE_MONTHS_, { reporting_period: 'eq.' + p }, '*', 1);
  if (!res.ok) return { ok: false, message: res.message || 'Could not load Lookback month.' };
  var rows = lbRows_(res.json);
  return { ok: true, month: rows[0] || null };
}

/**
 * @return {!{ ok: boolean, message?: string, months?: !Array }}
 */
function lbListMonths_() {
  if (!isSupabaseConfigured_()) {
    return { ok: false, message: 'Datastore is not configured.' };
  }
  var res = supabaseSelect_(
    LB_TABLE_MONTHS_,
    { order: 'reporting_period.desc' },
    '*',
    48
  );
  if (!res.ok) return { ok: false, message: res.message || 'Could not list Lookback months.' };
  return { ok: true, months: lbRows_(res.json) };
}

/**
 * @param {string} monthId
 * @return {!{ ok: boolean, message?: string, month?: Object, projects?: !Array, evidenceByProject?: !Object }}
 */
function lbGetMonthBundle_(monthId) {
  var id = String(monthId || '').trim();
  if (!id) return { ok: false, message: 'Lookback month id is required.' };
  var mRes = supabaseSelect_(LB_TABLE_MONTHS_, { id: 'eq.' + id }, '*', 1);
  if (!mRes.ok) return { ok: false, message: mRes.message || 'Could not load Lookback.' };
  var months = lbRows_(mRes.json);
  if (!months.length) return { ok: false, message: 'Lookback month not found.' };
  var pRes = supabaseSelect_(
    LB_TABLE_PROJECTS_,
    { month_id: 'eq.' + id, order: 'selected.desc,agreement_name.asc' },
    '*',
    2000
  );
  if (!pRes.ok) return { ok: false, message: pRes.message || 'Could not load Lookback projects.' };
  var projects = lbRows_(pRes.json);
  var evMap = {};
  var ids = [];
  for (var i = 0; i < projects.length; i++) {
    if (projects[i].id) ids.push(projects[i].id);
  }
  if (ids.length) {
    var evRes = supabaseSelect_(
      LB_TABLE_EVIDENCE_,
      { project_id: 'in.(' + ids.join(',') + ')', order: 'uploaded_at.asc' },
      '*',
      2000
    );
    if (evRes.ok) {
      var evs = lbRows_(evRes.json);
      for (var e = 0; e < evs.length; e++) {
        var pid = String(evs[e].project_id || '');
        if (!evMap[pid]) evMap[pid] = [];
        evMap[pid].push(evs[e]);
      }
    }
  }
  return {
    ok: true,
    month: months[0],
    projects: projects,
    evidenceByProject: evMap,
  };
}

/**
 * @param {!Object} row
 * @return {!Object}
 */
function lbMapProject_(row) {
  return {
    id: row.id,
    monthId: row.month_id,
    agreementFiberyId: row.agreement_fibery_id,
    agreementName: row.agreement_name,
    companyName: row.company_name,
    assignedOwnerEmail: row.assigned_owner_email,
    assignedOwnerName: row.assigned_owner_name,
    selected: !!row.selected,
    reviewType: row.review_type,
    criteria: row.criteria || [],
    selectedByEmail: row.selected_by_email,
    reason: row.reason,
    narrative: row.narrative || {},
    narrativeStatus: row.narrative_status || 'not_started',
    metrics: row.metrics || {},
    sortOrder: row.sort_order != null ? Number(row.sort_order) : 0,
    updatedAt: row.updated_at,
  };
}

/**
 * @param {!Object} row
 * @return {!Object}
 */
function lbMapMonth_(row) {
  return {
    id: row.id,
    reportingPeriod: row.reporting_period,
    lockedAt: row.locked_at,
    lockTimezone: row.lock_timezone,
    status: row.status,
    thresholdPct: row.threshold_pct != null ? Number(row.threshold_pct) : lookbackThresholdPct_(),
    createdByEmail: row.created_by_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * @param {string} projectId
 * @return {!{ ok: boolean, message?: string, project?: Object }}
 */
function lbGetProjectById_(projectId) {
  var id = String(projectId || '').trim();
  if (!id) return { ok: false, message: 'Project id is required.' };
  var res = supabaseSelect_(LB_TABLE_PROJECTS_, { id: 'eq.' + id }, '*', 1);
  if (!res.ok) return { ok: false, message: res.message || 'Could not load Lookback project.' };
  var rows = lbRows_(res.json);
  if (!rows.length) return { ok: false, message: 'Lookback project not found.' };
  return { ok: true, project: rows[0] };
}

/**
 * @param {string} projectId
 * @param {!Object} fields
 * @return {!{ ok: boolean, message?: string, project?: Object }}
 */
function lbPatchProject_(projectId, fields) {
  var id = String(projectId || '').trim();
  if (!id) return { ok: false, message: 'Project id is required.' };
  var body = fields || {};
  body.updated_at = new Date().toISOString();
  var res = supabaseRest_(
    'patch',
    '/rest/v1/' + encodeURIComponent(LB_TABLE_PROJECTS_),
    { id: 'eq.' + id },
    body,
    { Prefer: 'return=representation' }
  );
  if (!res.ok) return { ok: false, message: res.message || 'Could not update Lookback project.' };
  var rows = lbRows_(res.json);
  return { ok: true, project: rows[0] || null };
}

/**
 * @param {string} monthId
 * @param {!Object} fields
 * @return {!{ ok: boolean, message?: string, month?: Object }}
 */
function lbPatchMonth_(monthId, fields) {
  var id = String(monthId || '').trim();
  if (!id) return { ok: false, message: 'Lookback month id is required.' };
  var body = fields || {};
  body.updated_at = new Date().toISOString();
  var res = supabaseRest_(
    'patch',
    '/rest/v1/' + encodeURIComponent(LB_TABLE_MONTHS_),
    { id: 'eq.' + id },
    body,
    { Prefer: 'return=representation' }
  );
  if (!res.ok) return { ok: false, message: res.message || 'Could not update Lookback month.' };
  var rows = lbRows_(res.json);
  return { ok: true, month: rows[0] || null };
}

/**
 * @param {!Object} n
 * @return {boolean}
 */
function lbNarrativeRequiredComplete_(n) {
  var o = n || {};
  function filled(v) {
    return String(v || '').trim().length > 0;
  }
  return filled(o.whatHappened) && filled(o.why) && filled(o.recovery);
}

/**
 * @param {string} lockYmd YYYY-MM-DD
 * @return {string}
 */
function lookbackOwnerWindowEnd_(lockYmd) {
  var d = String(lockYmd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  var i;
  for (i = 0; i < 4; i++) {
    d = lookbackNextBusinessDay_(d);
  }
  return d;
}

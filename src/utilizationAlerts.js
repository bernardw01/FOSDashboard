/**
 * PRD version 1.27.3 — sync with docs/FOS-Dashboard-PRD.md
 *
 * Phase C — Utilization rule evaluator. Returns an ordered list of
 * attention items for the Operations panel, mirroring the
 * Agreement Dashboard's §6 alert pattern (src/agreementAlerts.js).
 *
 * Three rule families:
 *   1. Under-utilized       — Warning. A person whose mean weekly utilization%
 *                             across the last 3 complete ISO weeks in the
 *                             range is `< thresholds.underPercent`. Persons
 *                             who logged zero hours in the trailing window
 *                             are excluded (they are likely on PTO).
 *   2. Over-allocated       — Critical. A person whose weekly utilization%
 *                             is `> thresholds.overPercent` in any two
 *                             consecutive complete weeks in the range.
 *   3. Stale approvals      — Warning when `isPending && now - startDateTime
 *                             >= staleApprovalWarnDays`; escalates to
 *                             Critical past `staleApprovalCritDays`. Oldest
 *                             first inside each severity bucket.
 *
 * Output shape (each entry):
 *   {
 *     id: string,            // stable per-target for client dedupe
 *     severity: 'critical' | 'warning' | 'info',
 *     kind: string,          // 'under_utilized' | 'over_allocated' | 'stale_approval' | 'all_clear'
 *     title: string,         // single-line UI title
 *     body: string,          // one or two short sentences
 *     target: {              // hint the client uses to deep-link / drill
 *       person?: string,     //   personKey (userId || userName)
 *       rowId?: string,      //   labor-cost row id
 *       weeks?: !Array<string>
 *     }
 *   }
 *
 * Returns at least one item even when no rule fires (the all-clear info card),
 * so the client never has to handle an empty array as a special case.
 */

/** @const {string} */
var UTIL_ALERT_SEV_CRITICAL_ = 'critical';
/** @const {string} */
var UTIL_ALERT_SEV_WARNING_ = 'warning';
/** @const {string} */
var UTIL_ALERT_SEV_INFO_ = 'info';

/** @const {!Object<string,number>} Severity sort order — same as §6. */
var UTIL_ALERT_SEV_RANK_ = { critical: 0, warning: 1, info: 2 };

/**
 * Cap on per-row stale-approval cards in the Alerts panel (v1.14.1).
 * Anything beyond the cap is folded into a single rollup info card so the
 * panel doesn't balloon to thousands of items when a sync backlog exists.
 * @const {number}
 */
var UTIL_ALERT_STALE_CAP_ = 20;

/**
 * Evaluates the Phase C rule set and returns the ranked alert list.
 *
 * @param {!Array<!Object>} rows  Normalized labor-cost rows.
 * @param {!Array<!Object>} byPersonWeek  Output of `buildByPersonWeek_` —
 *   one entry per (personKey, week) with `utilizationPct`, `partial`, etc.
 * @param {!Object} thresholds  Output of `getUtilizationThresholds_()`.
 * @param {!{start: string, end: string}} range  Active fetch window.
 * @param {!Date} now
 * @return {!Array<!Object>}
 */
function buildUtilizationAlerts_(rows, byPersonWeek, thresholds, range, now) {
  var alerts = [];

  // Rule 1 + Rule 2 need a per-person trajectory of complete weeks ordered
  // ascending so we can window over them.
  var perPerson = groupByPerson_(byPersonWeek);
  var perPersonKeys = Object.keys(perPerson);

  for (var pi = 0; pi < perPersonKeys.length; pi++) {
    var key = perPersonKeys[pi];
    var trajectory = perPerson[key];
    if (!trajectory.length) {
      continue;
    }

    // Sort ascending by ISO week key — alphabetic on 'YYYY-Www' works because
    // both segments are zero-padded.
    trajectory.sort(function (a, b) {
      return String(a.week).localeCompare(String(b.week));
    });

    var completeWeeks = filterCompleteWeeks_(trajectory);
    if (!completeWeeks.length) {
      continue;
    }
    var personName = trajectory[0].personName || key;

    // Rule 1 — Under-utilized.
    var tail = completeWeeks.slice(-3);
    if (tail.length === 3) {
      var sum = 0;
      var hoursSum = 0;
      for (var ti = 0; ti < tail.length; ti++) {
        sum += Number(tail[ti].utilizationPct || 0);
        hoursSum += Number(tail[ti].hours || 0);
      }
      // Skip persons who didn't log any hours in the trailing window — likely
      // on PTO; surfacing them as under-utilized would be noise.
      if (hoursSum > 0) {
        var meanPct = sum / tail.length;
        if (meanPct < thresholds.underPercent) {
          alerts.push({
            id: 'util-under:' + key,
            severity: UTIL_ALERT_SEV_WARNING_,
            kind: 'under_utilized',
            title: personName + ' — Under-utilized (' + formatPct_(meanPct) + '%)',
            body:
              'Mean utilization across the last 3 complete weeks (' +
              tail[0].week + ' → ' + tail[tail.length - 1].week +
              ') is below the ' + thresholds.underPercent + '% threshold. ' +
              'Consider routing additional billable work.',
            target: { person: key, weeks: tail.map(weekKey_) },
          });
        }
      }
    }

    // Rule 2 — Over-allocated. Slide a 2-week window over the complete weeks.
    for (var w = 0; w + 1 < completeWeeks.length; w++) {
      var a = completeWeeks[w];
      var b = completeWeeks[w + 1];
      if (
        Number(a.utilizationPct || 0) > thresholds.overPercent &&
        Number(b.utilizationPct || 0) > thresholds.overPercent
      ) {
        alerts.push({
          id: 'util-over:' + key + ':' + a.week,
          severity: UTIL_ALERT_SEV_CRITICAL_,
          kind: 'over_allocated',
          title:
            personName + ' — Over-allocated (' + formatPct_(a.utilizationPct) +
            '% → ' + formatPct_(b.utilizationPct) + '%)',
          body:
            'Logged ' +
            formatHours_(a.hours) + ' hrs in ' + a.week + ' and ' +
            formatHours_(b.hours) + ' hrs in ' + b.week + ' — both above the ' +
            thresholds.overPercent + '% capacity threshold (' +
            thresholds.weeklyCapacityHours + ' hrs/wk baseline). Burnout risk.',
          target: { person: key, weeks: [a.week, b.week] },
        });
        // Only report the first over-allocated pair per person; the user can
        // drill in from there.
        break;
      }
    }
  }

  // Rule 3 — Stale approvals. Independent of the byPersonWeek index.
  // v1.14.1: collect candidates first, then cap at UTIL_ALERT_STALE_CAP_
  // oldest individual cards + one rollup info card so the Alerts panel
  // stays scannable even when a multi-thousand-row approval backlog exists.
  var staleCandidates = [];
  for (var ri = 0; ri < rows.length; ri++) {
    var r = rows[ri];
    if (!r || !r.isPending) {
      continue;
    }
    var ageDays = daysBetween_(r.startDateTime, now);
    if (ageDays === null || ageDays < thresholds.staleApprovalWarnDays) {
      continue;
    }
    staleCandidates.push({ row: r, ageDays: ageDays });
  }
  // Oldest first.
  staleCandidates.sort(function (a, b) {
    return Number(b.ageDays || 0) - Number(a.ageDays || 0);
  });
  var staleVisible = staleCandidates.slice(0, UTIL_ALERT_STALE_CAP_);
  var staleHiddenCount = Math.max(0, staleCandidates.length - staleVisible.length);
  for (var sci = 0; sci < staleVisible.length; sci++) {
    var entry = staleVisible[sci];
    var sr = entry.row;
    var sAgeDays = entry.ageDays;
    var sev = sAgeDays >= thresholds.staleApprovalCritDays ? UTIL_ALERT_SEV_CRITICAL_ : UTIL_ALERT_SEV_WARNING_;
    alerts.push({
      id: 'util-stale:' + (sr.id || (sr.userId + ':' + sr.startDateTime)),
      severity: sev,
      kind: 'stale_approval',
      title:
        (sr.userName || 'Unknown user') + ' — Pending approval ' +
        Math.round(sAgeDays) + ' days old',
      body:
        formatHours_(sr.hours) + ' hrs on ' + (sr.customer || '(Unassigned)') +
        ' · ' + (sr.projectName || '(No project)') +
        ' (' + (sr.day || sr.startDateTime || '—') + ').',
      target: { rowId: sr.id || null, person: sr.userId || sr.userName || null },
    });
  }
  if (staleHiddenCount > 0) {
    // Roll up the rest into one Warning card. The body summarises age range +
    // a count breakdown so the Pending Approvals widget remains the
    // drill-into surface for the long tail.
    var oldestHidden = staleVisible[staleVisible.length - 1];
    var hiddenList = staleCandidates.slice(UTIL_ALERT_STALE_CAP_);
    var critHidden = 0;
    for (var hi = 0; hi < hiddenList.length; hi++) {
      if (hiddenList[hi].ageDays >= thresholds.staleApprovalCritDays) {
        critHidden++;
      }
    }
    var oldestHiddenAge = hiddenList[0] ? Math.round(hiddenList[0].ageDays) : 0;
    var newestHiddenAge = hiddenList[hiddenList.length - 1]
      ? Math.round(hiddenList[hiddenList.length - 1].ageDays)
      : 0;
    alerts.push({
      id: 'util-stale-rollup',
      severity: UTIL_ALERT_SEV_WARNING_,
      kind: 'stale_approval_rollup',
      title:
        '+' + staleHiddenCount + ' more pending ≥ ' +
        thresholds.staleApprovalWarnDays + ' days' +
        (critHidden ? ' (' + critHidden + ' ≥ ' + thresholds.staleApprovalCritDays + ')' : ''),
      body:
        'Showing the ' + staleVisible.length + ' oldest individual cards (oldest ' +
        Math.round(oldestHidden.ageDays) + ' days). The remaining ' +
        staleHiddenCount + ' span ' + newestHiddenAge + '–' + oldestHiddenAge + ' days. ' +
        'Open the Pending Approvals widget to drill into the full list.',
      target: {},
    });
  }

  if (!alerts.length) {
    alerts.push({
      id: 'util-all-clear',
      severity: UTIL_ALERT_SEV_INFO_,
      kind: 'all_clear',
      title: 'No utilization alerts in the current range',
      body: 'All persons are within target utilization and no pending approvals are aging.',
      target: {},
    });
  }

  alerts.sort(function (a, b) {
    var ra = UTIL_ALERT_SEV_RANK_[a.severity];
    var rb = UTIL_ALERT_SEV_RANK_[b.severity];
    if (ra !== rb) {
      return ra - rb;
    }
    // Stale approvals: oldest first inside the same severity bucket; everything
    // else falls back to title for deterministic ordering.
    if (a.kind === 'stale_approval' && b.kind === 'stale_approval') {
      return String(b.id).localeCompare(String(a.id));
    }
    return String(a.title).localeCompare(String(b.title));
  });
  return alerts;
}

/* ------------------------------------------------------------------------- */
/* Private helpers                                                            */
/* ------------------------------------------------------------------------- */

/**
 * @param {!Array<!Object>} byPersonWeek
 * @return {!Object<string,!Array<!Object>>}
 * @private
 */
function groupByPerson_(byPersonWeek) {
  var out = {};
  for (var i = 0; i < byPersonWeek.length; i++) {
    var entry = byPersonWeek[i];
    var key = entry.personKey;
    if (!key) {
      continue;
    }
    if (!out[key]) {
      out[key] = [];
    }
    out[key].push(entry);
  }
  return out;
}

/**
 * Returns only the entries whose week is fully inside the active range
 * (i.e. `partial = false`). Partial-week entries are not eligible for the
 * trajectory rules because their utilization% has been pro-rated.
 *
 * @param {!Array<!Object>} ordered
 * @return {!Array<!Object>}
 * @private
 */
function filterCompleteWeeks_(ordered) {
  var out = [];
  for (var i = 0; i < ordered.length; i++) {
    if (!ordered[i].partial) {
      out.push(ordered[i]);
    }
  }
  return out;
}

/** @private */
function weekKey_(e) {
  return e ? e.week : null;
}

/**
 * Whole-day difference between an ISO timestamp and a Date. Returns null
 * when the timestamp can't be parsed.
 *
 * @param {?string} iso
 * @param {!Date} now
 * @return {?number}
 * @private
 */
function daysBetween_(iso, now) {
  if (!iso) {
    return null;
  }
  var d;
  try {
    d = new Date(iso);
  } catch (_) {
    return null;
  }
  if (!isFinite(d.getTime())) {
    return null;
  }
  return Math.max(0, (now.getTime() - d.getTime()) / 86400000);
}

/** @private */
function formatPct_(n) {
  var v = Number(n);
  if (!isFinite(v)) {
    return '0';
  }
  return (Math.round(v * 10) / 10).toString();
}

/** @private */
function formatHours_(n) {
  var v = Number(n);
  if (!isFinite(v)) {
    return '0';
  }
  return (Math.round(v * 10) / 10).toString();
}

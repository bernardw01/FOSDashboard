/**
 * PRD version 2.26.1 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Phase C - Utilization rule evaluator. Returns an ordered list of
 * attention items for the Operations panel, mirroring the
 * Agreement Dashboard's Section 6 alert pattern (src/agreementAlerts.js).
 *
 * Two rule families:
 *   1. Under-utilized       - Warning. A person whose mean weekly utilization%
 *                             across the last 3 complete ISO weeks in the
 *                             range is `< thresholds.underPercent`. Persons
 *                             who logged zero hours in the trailing window
 *                             are excluded (they are likely on PTO).
 *   2. Over-allocated       - Critical. A person whose weekly utilization%
 *                             is `> thresholds.overPercent` in any two
 *                             consecutive complete weeks in the range.
 *
 * Output shape (each entry):
 *   {
 *     id: string,            // stable per-target for client dedupe
 *     severity: 'critical' | 'warning' | 'info',
 *     kind: string,          // 'under_utilized' | 'over_allocated' | 'all_clear'
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

/** @const {!Object<string,number>} Severity sort order - same as Section 6. */
var UTIL_ALERT_SEV_RANK_ = { critical: 0, warning: 1, info: 2 };

/**
 * Evaluates the Phase C rule set and returns the ranked alert list.
 *
 * @param {!Array<!Object>} rows  Normalized labor-cost rows (reserved; unused).
 * @param {!Array<!Object>} byPersonWeek  Output of `buildByPersonWeek_`  - 
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

    // Sort ascending by ISO week key - alphabetic on 'YYYY-Www' works because
    // both segments are zero-padded.
    trajectory.sort(function (a, b) {
      return String(a.week).localeCompare(String(b.week));
    });

    var completeWeeks = filterCompleteWeeks_(trajectory);
    if (!completeWeeks.length) {
      continue;
    }
    var personName = trajectory[0].personName || key;

    // Rule 1 - Under-utilized.
    var tail = completeWeeks.slice(-3);
    if (tail.length === 3) {
      var sum = 0;
      var hoursSum = 0;
      for (var ti = 0; ti < tail.length; ti++) {
        sum += Number(tail[ti].utilizationPct || 0);
        hoursSum += Number(tail[ti].hours || 0);
      }
      // Skip persons who didn't log any hours in the trailing window - likely
      // on PTO; surfacing them as under-utilized would be noise.
      if (hoursSum > 0) {
        var meanPct = sum / tail.length;
        if (meanPct < thresholds.underPercent) {
          alerts.push({
            id: 'util-under:' + key,
            severity: UTIL_ALERT_SEV_WARNING_,
            kind: 'under_utilized',
            title: personName + ' - Under-utilized (' + formatPct_(meanPct) + '%)',
            body:
              'Mean utilization across the last 3 complete weeks (' +
              tail[0].week + '  ->  ' + tail[tail.length - 1].week +
              ') is below the ' + thresholds.underPercent + '% threshold. ' +
              'Consider routing additional billable work.',
            target: { person: key, weeks: tail.map(weekKey_) },
          });
        }
      }
    }

    // Rule 2 - Over-allocated. Slide a 2-week window over the complete weeks.
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
            personName + ' - Over-allocated (' + formatPct_(a.utilizationPct) +
            '%  ->  ' + formatPct_(b.utilizationPct) + '%)',
          body:
            'Logged ' +
            formatHours_(a.hours) + ' hrs in ' + a.week + ' and ' +
            formatHours_(b.hours) + ' hrs in ' + b.week + ' - both above the ' +
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

  if (!alerts.length) {
    alerts.push({
      id: 'util-all-clear',
      severity: UTIL_ALERT_SEV_INFO_,
      kind: 'all_clear',
      title: 'No utilization alerts in the current range',
      body: 'All persons are within target utilization in the current range.',
      target: {},
    });
  }

  alerts.sort(function (a, b) {
    var ra = UTIL_ALERT_SEV_RANK_[a.severity];
    var rb = UTIL_ALERT_SEV_RANK_[b.severity];
    if (ra !== rb) {
      return ra - rb;
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

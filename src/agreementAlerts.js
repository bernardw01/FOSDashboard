/**
 * PRD version 1.27.0 — sync with docs/FOS-Dashboard-PRD.md
 *
 * §6 alert evaluation for the Agreement Management dashboard. Each rule maps
 * directly to agreement-dashboard-prd-v2.md §6.1–§6.7, plus v1.21.0
 * delivery-risk heuristics (pacing, cost vs recognition, low recognition near
 * duration end). Output is a list of
 * { kind, severity, id, title, body, agreementId } cards sorted Critical →
 * Warning → Informational, ready for the client to render in the Attention
 * Items panel (§7.7). Field `kind` groups cards in the UI: `margin`, `revenue`,
 * `internal`, `renewal`, and `all_clear` (standalone, not grouped).
 */

/** @const {string} */
var ALERT_SEV_CRITICAL_ = 'critical';
/** @const {string} */
var ALERT_SEV_WARNING_ = 'warning';
/** @const {string} */
var ALERT_SEV_INFO_ = 'info';

/** @const {!Object<string,number>} Sort order for severity grouping. */
var ALERT_SEV_RANK_ = { critical: 0, warning: 1, info: 2 };

/**
 * Evaluates §6.1–§6.7 plus delivery-risk rules against the enriched agreement
 * set + future revenue items. Returns an empty-but-valid list (one "all good"
 * info card) when no rule fires (§6.7).
 *
 * @param {!Array<!Object>} agreements  Enriched per fiberyAgreementDashboard.js
 *   (each has `name`, `state`, `type`, `progress`, `customer`, `plannedRev`,
 *   `revRec`, `laborCosts`, `materialsOdc`, `margin`, `targetMargin`, `durStart`,
 *   `durEnd`, `schedulingStatus`,
 *   plus `id` and `revenueItemCount`).
 * @param {!Array<!Object>} futureRevenueItems
 * @param {!{
 *   lowMargin: number,
 *   internalLabor: number,
 *   expiryDays: number
 * }} thresholds
 * @return {!Array<!{
 *   id: string,
 *   kind: string,
 *   severity: string,
 *   title: string,
 *   body: string,
 *   agreementId: ?string
 * }>}
 */
function evaluateAlerts_(agreements, futureRevenueItems, thresholds) {
  var alerts = [];

  for (var i = 0; i < agreements.length; i++) {
    var a = agreements[i];

    // 6.1 Negative current margin (non-Internal).
    if (a.type !== 'Internal' && isNumber_(a.margin) && a.margin < 0) {
      alerts.push({
        id: 'neg-margin:' + a.id,
        kind: 'margin',
        severity: ALERT_SEV_CRITICAL_,
        title: a.name + ' — Negative Margin (' + formatMargin_(a.margin) + '%)',
        body:
          formatCurrency_(a.laborCosts) +
          ' in labor costs logged against ' +
          formatCurrency_(a.revRec) +
          ' recognized. ' +
          formatCurrency_(a.plannedRev) +
          ' in planned revenue total. Immediate review recommended.',
        agreementId: a.id,
      });
    }

    // 6.2 Low margin warning (non-Internal, non-negative, with recognized rev).
    if (
      a.type !== 'Internal' &&
      isNumber_(a.margin) &&
      a.margin >= 0 &&
      a.margin < thresholds.lowMargin &&
      Number(a.revRec) > 0
    ) {
      var remaining = Math.max(0, Number(a.plannedRev || 0) - Number(a.revRec || 0));
      alerts.push({
        id: 'low-margin:' + a.id,
        kind: 'margin',
        severity: ALERT_SEV_WARNING_,
        title: a.name + ' — Low Margin (' + formatMargin_(a.margin) + '%)',
        body:
          'Margin is below the ' +
          thresholds.lowMargin +
          '% threshold. Monitor labor pacing against remaining planned revenue of ' +
          formatCurrency_(remaining) +
          '.',
        agreementId: a.id,
      });
    }

    // 6.3 Unscheduled revenue on active agreement.
    if (a.state === 'Delivery In Progress' && a.schedulingStatus === 'Not Scheduled') {
      alerts.push({
        id: 'unsched:' + a.id,
        kind: 'revenue',
        severity: ALERT_SEV_WARNING_,
        title: a.name + ' — Revenue Not Scheduled',
        body:
          'This agreement is in active delivery but revenue milestones are not scheduled. ' +
          'Activate the billing schedule in Fibery.',
        agreementId: a.id,
      });
    }

    // 6.4 Internal agreement with significant labor.
    if (a.type === 'Internal' && Number(a.laborCosts || 0) > thresholds.internalLabor) {
      alerts.push({
        id: 'internal-labor:' + a.id,
        kind: 'internal',
        severity: ALERT_SEV_WARNING_,
        title: a.name + ' (Internal) — ' + formatCurrency_(a.laborCosts) + ' Unattributed Labor',
        body:
          'Internal agreement has significant labor costs with no associated revenue. ' +
          'Confirm these costs are captured in overhead budgeting.',
        agreementId: a.id,
      });
    }

    // 6.5 Proposal with no revenue items.
    if (a.state === 'Proposal Delivered' && Number(a.revenueItemCount || 0) === 0) {
      alerts.push({
        id: 'proposal-empty:' + a.id,
        kind: 'revenue',
        severity: ALERT_SEV_WARNING_,
        title: a.name + ' — Proposal Pending Activation',
        body:
          'Proposal is delivered but no revenue milestones have been created. ' +
          'Activate billing schedule if engagement is confirmed.',
        agreementId: a.id,
      });
    }

    // 6.6 Renewal / expiring agreement.
    if (a.state === 'Delivery In Progress' && a.durEnd) {
      var daysToEnd = daysFromNowTo_(a.durEnd);
      if (daysToEnd !== null && daysToEnd >= 0 && daysToEnd <= thresholds.expiryDays) {
        alerts.push({
          id: 'expiring:' + a.id,
          kind: 'renewal',
          severity: ALERT_SEV_INFO_,
          title: a.name + ' — Expiring in ' + Math.round(daysToEnd) + ' days',
          body: 'Agreement is approaching its end date. Initiate renewal discussion if applicable.',
          agreementId: a.id,
        });
      }
    }

    // v1.21.0 — Recognition pacing vs linear duration plan (non-Internal).
    if (
      a.type !== 'Internal' &&
      a.state === 'Delivery In Progress' &&
      Number(a.plannedRev || 0) > 0 &&
      a.durStart &&
      a.durEnd
    ) {
      var elapsedFrac = agreementDurationElapsedFrac_(a.durStart, a.durEnd);
      if (elapsedFrac !== null && elapsedFrac >= 0.2) {
        var expectedRec = Number(a.plannedRev) * elapsedFrac;
        var rec = Number(a.revRec || 0);
        if (expectedRec > 15000 && rec < expectedRec * 0.65) {
          alerts.push({
            id: 'pace-behind:' + a.id,
            kind: 'revenue',
            severity: ALERT_SEV_WARNING_,
            title: a.name + ' — Recognition behind linear plan',
            body:
              'About ' +
              formatMargin_(elapsedFrac * 100) +
              '% through the agreement window by calendar, but only ' +
              formatCurrency_(rec) +
              ' is recognized vs roughly ' +
              formatCurrency_(expectedRec) +
              ' on a straight-line plan against ' +
              formatCurrency_(a.plannedRev) +
              ' planned revenue.',
            agreementId: a.id,
          });
        }
      }
    }

    // v1.21.0 — Labor + ODC materially above recognized revenue.
    if (
      a.type !== 'Internal' &&
      Number(a.revRec || 0) >= 8000
    ) {
      var totalCost = Number(a.laborCosts || 0) + Number(a.materialsOdc || 0);
      if (totalCost > Number(a.revRec) * 1.28) {
        alerts.push({
          id: 'cost-exceeds-rec:' + a.id,
          kind: 'margin',
          severity: ALERT_SEV_CRITICAL_,
          title: a.name + ' — Costs exceed recognized revenue',
          body:
            formatCurrency_(totalCost) +
            ' in labor + materials & ODC vs ' +
            formatCurrency_(a.revRec) +
            ' recognized. Review cost pacing and remaining milestones.',
          agreementId: a.id,
        });
      }
    }

    // v1.21.0 — Low recognition with duration ending soon.
    if (
      a.type !== 'Internal' &&
      a.state === 'Delivery In Progress' &&
      a.durEnd &&
      Number(a.plannedRev || 0) > 0
    ) {
      var daysLeft = daysFromNowTo_(a.durEnd);
      var recRatio = Number(a.revRec || 0) / Number(a.plannedRev);
      if (
        daysLeft !== null &&
        daysLeft >= 0 &&
        daysLeft <= 55 &&
        recRatio < 0.35
      ) {
        alerts.push({
          id: 'low-rec-near-end:' + a.id,
          kind: 'revenue',
          severity: ALERT_SEV_WARNING_,
          title: a.name + ' — Low recognition before duration end',
          body:
            'Ends in about ' +
            Math.round(daysLeft) +
            ' days with ' +
            formatCurrency_(a.revRec) +
            ' recognized of ' +
            formatCurrency_(a.plannedRev) +
            ' planned (' +
            formatMargin_(recRatio * 100) +
            '%). Confirm billing milestones and delivery wrap-up.',
          agreementId: a.id,
        });
      }
    }
  }

  // 6.7 No alerts present.
  if (!alerts.length) {
    alerts.push({
      id: 'all-clear',
      kind: 'all_clear',
      severity: ALERT_SEV_INFO_,
      title: 'No attention items',
      body: 'All agreements are within normal parameters.',
      agreementId: null,
    });
  }

  alerts.sort(function (a, b) {
    var ra = ALERT_SEV_RANK_[a.severity];
    var rb = ALERT_SEV_RANK_[b.severity];
    if (ra !== rb) {
      return ra - rb;
    }
    return a.title.localeCompare(b.title);
  });
  return alerts;
}

/* ------------------------------------------------------------------------- */
/* Private helpers                                                            */
/* ------------------------------------------------------------------------- */

/**
 * @param {*} n
 * @return {boolean}
 * @private
 */
function isNumber_(n) {
  return typeof n === 'number' && !isNaN(n) && isFinite(n);
}

/**
 * @param {*} n
 * @return {string}
 * @private
 */
function formatMargin_(n) {
  if (!isNumber_(n)) {
    return '—';
  }
  return (Math.round(n * 10) / 10).toString();
}

/**
 * @param {*} n
 * @return {string}
 * @private
 */
function formatCurrency_(n) {
  var v = Number(n);
  if (!isFinite(v)) {
    return '$0';
  }
  var abs = Math.abs(v);
  var sign = v < 0 ? '-' : '';
  if (abs >= 1e6) {
    return sign + '$' + (abs / 1e6).toFixed(2) + 'M';
  }
  if (abs >= 1e3) {
    return sign + '$' + (abs / 1e3).toFixed(1) + 'K';
  }
  return sign + '$' + Math.round(abs);
}

/**
 * @param {?string} isoOrDate
 * @return {?number} Days until the given date, or null if it can't be parsed.
 * @private
 */
function daysFromNowTo_(isoOrDate) {
  if (!isoOrDate) {
    return null;
  }
  var d;
  try {
    d = new Date(isoOrDate);
  } catch (_) {
    return null;
  }
  if (isNaN(d.getTime())) {
    return null;
  }
  var now = new Date();
  return (d.getTime() - now.getTime()) / 86400000;
}

/**
 * @param {?string} startIso
 * @param {?string} endIso
 * @return {?number} 0..1 elapsed share, or null.
 * @private
 */
function agreementDurationElapsedFrac_(startIso, endIso) {
  var start = parseAgreeDateUtcDay_(startIso);
  var end = parseAgreeDateUtcDay_(endIso);
  if (!start || !end || !(end > start)) {
    return null;
  }
  var now = Date.now();
  var t = (now - start) / (end - start);
  if (!isFinite(t)) {
    return null;
  }
  return Math.max(0, Math.min(1, t));
}

/**
 * @param {?string} isoOrDate
 * @return {?number} UTC ms at start of local calendar day (best-effort).
 * @private
 */
function parseAgreeDateUtcDay_(isoOrDate) {
  if (!isoOrDate) {
    return null;
  }
  var s = String(isoOrDate).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  try {
    var d = new Date(s);
    if (isNaN(d.getTime())) {
      return null;
    }
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  } catch (_) {
    return null;
  }
}

/**
 * PRD version 1.18.0 — sync with docs/FOS-Dashboard-PRD.md
 *
 * §6 alert evaluation for the Agreement Management dashboard. Each rule maps
 * directly to agreement-dashboard-prd-v2.md §6.1–§6.7. Output is a list of
 * {severity, id, title, body} cards sorted Critical → Warning → Informational,
 * ready for the client to render in the Attention Items panel (§7.7).
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
 * Evaluates §6.1–§6.7 against the enriched agreement set + future revenue
 * items. Returns an empty-but-valid list (one "all good" info card) when no
 * rule fires (§6.7).
 *
 * @param {!Array<!Object>} agreements  Enriched per fiberyAgreementDashboard.js
 *   (each has `name`, `state`, `type`, `progress`, `customer`, `plannedRev`,
 *   `revRec`, `laborCosts`, `margin`, `targetMargin`, `durEnd`, `schedulingStatus`,
 *   plus `id` and `revenueItemCount`).
 * @param {!Array<!Object>} futureRevenueItems
 * @param {!{
 *   lowMargin: number,
 *   internalLabor: number,
 *   expiryDays: number
 * }} thresholds
 * @return {!Array<!{
 *   id: string,
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
          severity: ALERT_SEV_INFO_,
          title: a.name + ' — Expiring in ' + Math.round(daysToEnd) + ' days',
          body: 'Agreement is approaching its end date. Initiate renewal discussion if applicable.',
          agreementId: a.id,
        });
      }
    }
  }

  // 6.7 No alerts present.
  if (!alerts.length) {
    alerts.push({
      id: 'all-clear',
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

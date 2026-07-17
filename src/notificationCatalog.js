/**
 * PRD version 2.26.2 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Fine-grained notification catalog for Feature 033. Maps existing alert
 * id prefixes / kinds to stable catalogId values for Profile subscriptions
 * and notification jobs.
 */

/**
 * @return {!Array<!{
 *   catalogId: string,
 *   label: string,
 *   description: string,
 *   dashboardNavId: string,
 *   source: string,
 *   alertIdPrefix: string
 * }>}
 */
function getNotificationCatalog_() {
  return [
    {
      catalogId: 'agreement.neg_margin',
      label: 'Negative margin',
      description: 'Agreement has a negative current margin.',
      dashboardNavId: 'agreement-dashboard',
      source: 'agreement',
      alertIdPrefix: 'neg-margin:',
    },
    {
      catalogId: 'agreement.low_margin',
      label: 'Low margin',
      description: 'Agreement margin is below the configured warning threshold.',
      dashboardNavId: 'agreement-dashboard',
      source: 'agreement',
      alertIdPrefix: 'low-margin:',
    },
    {
      catalogId: 'agreement.unsched_revenue',
      label: 'Revenue not scheduled',
      description: 'Active delivery agreement with unscheduled revenue.',
      dashboardNavId: 'agreement-dashboard',
      source: 'agreement',
      alertIdPrefix: 'unsched:',
    },
    {
      catalogId: 'agreement.internal_labor',
      label: 'Internal labor',
      description: 'Internal agreement with significant unattributed labor.',
      dashboardNavId: 'agreement-dashboard',
      source: 'agreement',
      alertIdPrefix: 'internal-labor:',
    },
    {
      catalogId: 'agreement.proposal_empty',
      label: 'Proposal pending activation',
      description: 'Delivered proposal with no revenue milestones.',
      dashboardNavId: 'agreement-dashboard',
      source: 'agreement',
      alertIdPrefix: 'proposal-empty:',
    },
    {
      catalogId: 'agreement.expiring',
      label: 'Expiring agreement',
      description: 'Agreement approaching its end date.',
      dashboardNavId: 'agreement-dashboard',
      source: 'agreement',
      alertIdPrefix: 'expiring:',
    },
    {
      catalogId: 'agreement.pace_behind',
      label: 'Recognition behind plan',
      description: 'Recognition pacing behind linear duration plan.',
      dashboardNavId: 'agreement-dashboard',
      source: 'agreement',
      alertIdPrefix: 'pace-behind:',
    },
    {
      catalogId: 'agreement.cost_exceeds_rec',
      label: 'Costs exceed recognized revenue',
      description: 'Labor + ODC materially above recognized revenue.',
      dashboardNavId: 'agreement-dashboard',
      source: 'agreement',
      alertIdPrefix: 'cost-exceeds-rec:',
    },
    {
      catalogId: 'agreement.low_rec_near_end',
      label: 'Low recognition near end',
      description: 'Low recognition with duration ending soon.',
      dashboardNavId: 'agreement-dashboard',
      source: 'agreement',
      alertIdPrefix: 'low-rec-near-end:',
    },
    {
      catalogId: 'utilization.under_utilized',
      label: 'Under-utilized',
      description: 'Person mean utilization below under-utilized threshold.',
      dashboardNavId: 'operations',
      source: 'utilization',
      alertIdPrefix: 'util-under:',
    },
    {
      catalogId: 'utilization.over_allocated',
      label: 'Over-allocated',
      description: 'Person over-allocated across consecutive weeks.',
      dashboardNavId: 'operations',
      source: 'utilization',
      alertIdPrefix: 'util-over:',
    },
  ];
}

/**
 * @param {string} catalogId
 * @return {?Object}
 */
function getNotificationCatalogEntry_(catalogId) {
  var id = String(catalogId || '').trim();
  var list = getNotificationCatalog_();
  for (var i = 0; i < list.length; i++) {
    if (list[i].catalogId === id) {
      return list[i];
    }
  }
  return null;
}

/**
 * @param {!Object} alert
 * @return {?string}
 */
function catalogIdForAlert_(alert) {
  if (!alert) {
    return null;
  }
  var id = String(alert.id || '');
  if (!id || id === 'all-clear' || id === 'util-all-clear') {
    return null;
  }
  var kind = String(alert.kind || '');
  if (kind === 'all_clear') {
    return null;
  }
  var list = getNotificationCatalog_();
  for (var i = 0; i < list.length; i++) {
    var prefix = list[i].alertIdPrefix;
    if (prefix && id.indexOf(prefix) === 0) {
      return list[i].catalogId;
    }
  }
  return null;
}

/**
 * Client-facing catalog for Profile UI (no internal prefixes needed beyond ids).
 * @return {!Array<!{ catalogId: string, label: string, description: string, dashboardNavId: string, source: string }>}
 */
function getNotificationCatalogForClient_() {
  var list = getNotificationCatalog_();
  var out = [];
  for (var i = 0; i < list.length; i++) {
    out.push({
      catalogId: list[i].catalogId,
      label: list[i].label,
      description: list[i].description,
      dashboardNavId: list[i].dashboardNavId,
      source: list[i].source,
    });
  }
  return out;
}

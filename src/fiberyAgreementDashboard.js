/**
 * PRD version 1.6 — sync with docs/FOS-Dashboard-PRD.md
 *
 * Agreement / Finance dashboard: Fibery-backed view models for HtmlService.
 * No persistent server-side cache of payloads (Fibery is source of truth).
 */

/** @const {number} Bumped when client cache shape changes. */
var AGREEMENT_DASHBOARD_CACHE_SCHEMA_VERSION_ = 1;

/**
 * Returns normalized agreement dashboard JSON for the Finance panel.
 * Re-checks spreadsheet authorization via requireAuthForApi_().
 * Stub: empty collections until Fibery UrlFetchApp queries are implemented.
 * @return {{
 *   ok: boolean,
 *   partial?: boolean,
 *   source: string,
 *   fetchedAt: string,
 *   cacheSchemaVersion: number,
 *   agreements: Array,
 *   companies: Array,
 *   futureRevenueItems: Array,
 *   historicalRevenueItems: Array,
 *   kpis: Object,
 *   warnings?: Array<string>
 * }}
 */
function getAgreementDashboardData() {
  requireAuthForApi_();
  var now = new Date().toISOString();
  return {
    ok: true,
    partial: true,
    source: 'fibery-stub',
    fetchedAt: now,
    cacheSchemaVersion: AGREEMENT_DASHBOARD_CACHE_SCHEMA_VERSION_,
    agreements: [],
    companies: [],
    futureRevenueItems: [],
    historicalRevenueItems: [],
    kpis: {
      totalAgreements: 0,
      externalCustomers: 0,
      totalContractValue: 0,
      revenueRecognized: 0,
      portfolioRecognitionRate: 0,
      inDeliveryCount: 0,
      proposalsCount: 0,
      completeCount: 0,
      topCustomerName: '—',
      topCustomerPortfolioPct: 0,
      topCustomerSowCount: 0,
      flaggedMarginPct: null,
      flaggedMarginIsNegative: false,
      flaggedMarginAgreement: '—',
    },
    warnings: [
      'Fibery API not wired yet; returning an empty portfolio. See docs/features/003-agreement-dashboard-fibery-client-cache.md.',
    ],
  };
}

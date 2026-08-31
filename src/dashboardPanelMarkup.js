/**
 * PRD version 3.20.14 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 047 workstream D2: lazy panel markup served after the shell paints.
 */

/** @const {string} */
var DASHBOARD_DEFERRED_PANELS_FILE_ = 'DashboardShellPanels';

/**
 * HtmlService include helper (referenced from DashboardShell.html templates).
 *
 * @param {string} filename File under src/ without extension
 * @return {string}
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Whether lazy deferred panel markup is enabled for this deployment.
 *
 * @return {boolean}
 */
function isLazyPanelMarkupEnabled_() {
  return typeof perfFlag_ === 'function' && perfFlag_('PERF_LAZY_PANEL_MARKUP');
}

/**
 * Returns deferred dashboard panel markup for client injection when lazy mode
 * is on. Empty string when lazy mode is off (panels ship inline).
 *
 * @return {string}
 */
function getDashboardDeferredPanelMarkup() {
  requireAuthForApi_();
  if (!isLazyPanelMarkupEnabled_()) {
    return '';
  }
  return HtmlService.createHtmlOutputFromFile(DASHBOARD_DEFERRED_PANELS_FILE_).getContent();
}

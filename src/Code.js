/**
 * PRD version 1.2 — sync with docs/FOS-Dashboard-PRD.md
 *
 * FOS Dashboard — Apps Script entry points.
 */

/** @const {string} Must match the version line in docs/FOS-Dashboard-PRD.md */
var FOS_PRD_VERSION = '1.2';

/**
 * @return {string}
 */
function getFosPrdVersion_() {
  return FOS_PRD_VERSION;
}

/**
 * Serves the dashboard Web App HTML shell, or the not-authorized page.
 * @return {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet() {
  var auth = getAuthorizationForActiveUser_();
  if (!auth.ok) {
    var deny = HtmlService.createTemplateFromFile('NotAuthorized');
    deny.reason = auth.reason;
    deny.prdVersion = getFosPrdVersion_();
    return deny
      .evaluate()
      .setTitle('Access not granted')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
  }

  var template = HtmlService.createTemplateFromFile('DashboardShell');
  template.prdVersion = getFosPrdVersion_();
  return template
    .evaluate()
    .setTitle('harpin AI Ops Dashboards')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/**
 * Returns navigation + user hints for the signed-in user (re-checks sheet authorization).
 * @return {{
 *   userEmail: string,
 *   userLabel: string,
 *   role: string,
 *   team: string,
 *   items: Array<{ id: string, label: string, active: boolean }>
 * }}
 */
function getDashboardNavigation() {
  var auth = requireAuthForApi_();
  return buildNavigationModel_(auth);
}

/**
 * @param {{ email: string, role: string, team: string }} auth
 * @return {{
 *   userEmail: string,
 *   userLabel: string,
 *   role: string,
 *   team: string,
 *   items: Array<{ id: string, label: string, active: boolean }>
 * }}
 * @private
 */
function buildNavigationModel_(auth) {
  var label = auth.email || 'Signed-in user';

  var allItems = [
    { id: 'home', label: 'Home', active: true },
    { id: 'finance', label: 'Finance', active: false },
    { id: 'operations', label: 'Operations', active: false },
    { id: 'delivery', label: 'Delivery', active: false },
  ];

  return {
    userEmail: auth.email,
    userLabel: label,
    role: auth.role,
    team: auth.team,
    items: allItems.slice(),
  };
}

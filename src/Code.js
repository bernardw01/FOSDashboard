/**
 * FOS Dashboard — Apps Script entry points.
 * Web App shell: doGet serves DashboardShell.html.
 */

/**
 * Serves the dashboard Web App HTML shell.
 * @return {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet() {
  const template = HtmlService.createTemplateFromFile('DashboardShell');
  template.initialNav = getDashboardNavigation_();
  return template
    .evaluate()
    .setTitle('harpin AI Ops Dashboards')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/**
 * Returns navigation + user hints for the signed-in user.
 * Stub: filter by domain / allowlist until a real RBAC source exists.
 * Called from template at load; may be extended for client refresh via google.script.run.
 * @return {{
 *   userEmail: string,
 *   userLabel: string,
 *   items: Array<{ id: string, label: string, active: boolean }>
 * }}
 */
function getDashboardNavigation() {
  return getDashboardNavigation_();
}

/**
 * @return {{
 *   userEmail: string,
 *   userLabel: string,
 *   items: Array<{ id: string, label: string, active: boolean }>
 * }}
 * @private
 */
function getDashboardNavigation_() {
  const user = Session.getActiveUser();
  const email = user.getEmail() || '';
  const label = email || 'Signed-in user';

  const allItems = [
    { id: 'home', label: 'Home', active: true },
    { id: 'finance', label: 'Finance', active: false },
    { id: 'operations', label: 'Operations', active: false },
    { id: 'delivery', label: 'Delivery', active: false },
  ];

  const items = filterNavItemsForUser_(email, allItems);

  return {
    userEmail: email,
    userLabel: label,
    items: items,
  };
}

/**
 * Placeholder RBAC: same catalog for all @harpin.ai users; trim finance for others if email present.
 * Replace with Script Properties, Sheet, or Directory-backed roles.
 * @param {string} email
 * @param {Array<{ id: string, label: string, active: boolean }>} items
 * @return {Array<{ id: string, label: string, active: boolean }>}
 * @private
 */
function filterNavItemsForUser_(email, items) {
  if (!email) {
    return items.filter(function (i) {
      return i.id === 'home';
    });
  }
  // Example stub: non-harpin users only see Home until policies are defined.
  var domain = email.split('@')[1] || '';
  if (domain.toLowerCase() !== 'harpin.ai') {
    return items.filter(function (i) {
      return i.id === 'home';
    });
  }
  return items.slice();
}

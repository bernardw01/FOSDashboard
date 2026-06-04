/**
 * PRD version 2.8.0 - sync with docs/FOS-Dashboard-PRD.md
 *
 * FOS Dashboard - Apps Script entry points.
 */

/** @const {string} Must match the version line in docs/FOS-Dashboard-PRD.md */
var FOS_PRD_VERSION = '2.8.0';

/**
 * Brief release note stored on the App Versions tab when this deployment
 * registers itself (feature 013). Update on every PRD version bump.
 * @const {string}
 */
var FOS_RELEASE_DESCRIPTION =
  'Historical snapshots now include Expenses and Pipeline datasets (expenses.json, pipeline.json).';

/**
 * @return {string}
 */
function getFosPrdVersion_() {
  return FOS_PRD_VERSION;
}

/**
 * Shared HtmlService chrome for Web App pages (favicon, viewport, sandbox).
 * Favicon must use setFaviconUrl with an HTTPS PNG URL - HtmlService ignores
 * <link rel="icon"> in HTML files and rejects data: URLs.
 *
 * @param {GoogleAppsScript.HTML.HtmlOutput} output
 * @param {string} title
 * @return {GoogleAppsScript.HTML.HtmlOutput}
 * @private
 */
function applyWebAppHtmlChrome_(output, title) {
  var chrome = output
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
  var faviconUrl = getFaviconUrlForWebApp_();
  if (faviconUrl) {
    chrome = chrome.setFaviconUrl(faviconUrl);
  }
  return chrome;
}

/**
 * Serves the dashboard Web App HTML shell, or the not-authorized page.
 * @param {GoogleAppsScript.Events.DoGet} [e]
 * @return {GoogleAppsScript.HTML.HtmlOutput|GoogleAppsScript.Base.Blob}
 */
function doGet(e) {
  if (e && e.parameter && String(e.parameter.favicon) === '1') {
    return getFaviconPngBlob_();
  }

  var auth = getAuthorizationForActiveUser_();
  if (!auth.ok) {
    var deny = HtmlService.createTemplateFromFile('NotAuthorized');
    deny.reason = auth.reason;
    deny.prdVersion = getFosPrdVersion_();
    return applyWebAppHtmlChrome_(deny.evaluate(), 'Access not granted');
  }

  // Append a `page_load` row to the User Activity tab (FR-60-FR-66).
  // Wrapped - logging failures must never break the dashboard render.
  try {
    recordPageLoad_(auth);
  } catch (e) {
    try {
      console.warn('doGet: recordPageLoad_ threw: ' + (e && e.message ? e.message : e));
    } catch (_) {
      /* ignore */
    }
  }

  try {
    syncCurrentAppVersionToCatalog_();
  } catch (e) {
    try {
      console.warn(
        'doGet: syncCurrentAppVersionToCatalog_ threw: ' + (e && e.message ? e.message : e)
      );
    } catch (_) {
      /* ignore */
    }
  }

  var template = HtmlService.createTemplateFromFile('DashboardShell');
  template.prdVersion = getFosPrdVersion_();
  template.homeHeroImageUrl = getHomeHeroImageDataUrl_();
  return applyWebAppHtmlChrome_(template.evaluate(), 'harpin AI Ops Dashboards');
}

/**
 * Returns navigation + user hints for the signed-in user (re-checks sheet authorization).
 * @return {{
 *   userEmail: string,
 *   userLabel: string,
 *   role: string,
 *   team: string,
 *   fiberyAccess: boolean,
 *   isAdmin: boolean,
 *   fibery?: {
 *     scheme: string,
 *     host: string,
 *     laborCostPathTemplate: string,
 *     agreementPathTemplate: string,
 *     companyPathTemplate: string
 *   },
 *   items: Array<
 *     | { id: string, label: string, active: boolean }
 *     | { type: 'group', id: string, label: string, active: boolean, children: Array<{ id: string, label: string, active: boolean }> }
 *   >
 * }}
 */
function getDashboardNavigation() {
  var auth = requireAuthForApi_();
  return buildNavigationModel_(auth);
}

/**
 * @param {{ email: string, role: string, team: string, fiberyAccess?: boolean }} auth
 * @return {{
 *   userEmail: string,
 *   userLabel: string,
 *   role: string,
 *   team: string,
 *   fiberyAccess: boolean,
 *   isAdmin: boolean,
 *   fibery?: {
 *     scheme: string,
 *     host: string,
 *     laborCostPathTemplate: string,
 *     agreementPathTemplate: string,
 *     companyPathTemplate: string
 *   },
 *   items: Array<
 *     | { id: string, label: string, active: boolean }
 *     | { type: 'group', id: string, label: string, active: boolean, children: Array<{ id: string, label: string, active: boolean }> }
 *   >
 * }}
 * @private
 */
function buildNavigationModel_(auth) {
  var label = auth.email || 'Signed-in user';

  var allItems = [
    { id: 'home', label: 'Home', active: true },
    {
      id: 'sales-group',
      type: 'group',
      label: 'Sales',
      active: false,
      children: [
        { id: 'pipeline', label: 'Pipeline', active: false },
      ],
    },
    {
      id: 'operations-group',
      type: 'group',
      label: 'Operations',
      active: false,
      children: [
        { id: 'agreement-dashboard', label: 'Agreements', active: false },
        { id: 'operations', label: 'Utilization', active: false },
        { id: 'labor-hours', label: 'Labor hours', active: false },
      ],
    },
    {
      id: 'delivery-group',
      type: 'group',
      label: 'Delivery',
      active: false,
      children: [
        { id: 'delivery', label: 'Projects & P&L', active: false },
        { id: 'revenue-review', label: 'Revenue review', active: false },
      ],
    },
    {
      id: 'finance-group',
      type: 'group',
      label: 'Finance',
      active: false,
      children: [
        { id: 'expenses', label: 'Expenses', active: false },
      ],
    },
  ];

  var fiberyAccess = !!(auth && auth.fiberyAccess);
  var expensesAccess = canAccessExpensesDashboard_(auth);
  var pipelineAccess = canAccessPipelineDashboard_(auth);
  var navItems = allItems.slice();
  if (!expensesAccess) {
    navItems = navItems.filter(function (item) {
      return item.id !== 'finance-group';
    });
  }
  if (!pipelineAccess) {
    navItems = navItems.filter(function (item) {
      return item.id !== 'sales-group';
    });
  }
  var model = {
    userEmail: auth.email,
    userLabel: label,
    role: auth.role,
    team: auth.team,
    fiberyAccess: fiberyAccess,
    expensesAccess: expensesAccess,
    pipelineAccess: pipelineAccess,
    isAdmin: isAdminUser_(auth),
    items: navItems,
  };

  // Only attach the public Fibery deep-link config when the signed-in user
  // is explicitly cleared via the `fibery_access` column. Users without the
  // flag never receive the host or path template - defense in depth so
  // browser devtools / view-source can't surface a workspace URL.
  if (fiberyAccess) {
    var deepLinkCfg = null;
    try {
      deepLinkCfg = getFiberyDeepLinkConfig_();
    } catch (e) {
      try {
        console.warn('buildNavigationModel_: getFiberyDeepLinkConfig_ threw: ' +
          (e && e.message ? e.message : e));
      } catch (_) {
        /* ignore */
      }
      deepLinkCfg = null;
    }
    if (deepLinkCfg) {
      model.fibery = deepLinkCfg;
    }
  }

  return model;
}

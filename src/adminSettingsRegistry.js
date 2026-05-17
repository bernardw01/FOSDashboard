/**
 * PRD version 2.2.0 — Admin settings catalog (feature 011).
 * Single source of truth for Script Property metadata exposed in the Settings panel.
 */

/** @const {!Array<{ id: string, title: string }>} */
var ADMIN_SETTINGS_GROUPS_ = [
  { id: 'platform-auth', title: 'Platform — Authorization & sheets' },
  { id: 'platform-activity', title: 'Platform — User activity logging' },
  { id: 'fibery-api', title: 'Fibery — API connection' },
  { id: 'fibery-deeplinks', title: 'Fibery — Deep link templates' },
  { id: 'agreement', title: 'Agreement Dashboard' },
  { id: 'utilization', title: 'Utilization (Operations)' },
  { id: 'labor-hours', title: 'Labor hours' },
  { id: 'delivery', title: 'Delivery — Projects & P&L' },
  { id: 'snapshots', title: 'Historical snapshots' },
];

/**
 * @typedef {'number'|'boolean'|'string'|'csv'|'json'|'secret'} AdminSettingType
 */

/**
 * @param {string} key
 * @param {string} group
 * @param {string} label
 * @param {string} description
 * @param {AdminSettingType} type
 * @param {*} defaultValue
 * @param {{ min?: number, max?: number, required?: boolean, readOnly?: boolean, sensitive?: boolean }} opts
 * @return {!Object}
 */
function adminSettingEntry_(key, group, label, description, type, defaultValue, opts) {
  opts = opts || {};
  return {
    key: key,
    group: group,
    label: label,
    description: description,
    type: type,
    defaultValue: defaultValue,
    min: opts.min,
    max: opts.max,
    required: !!opts.required,
    readOnly: !!opts.readOnly,
    sensitive: !!opts.sensitive,
    allowDefaultToggle: defaultValue !== null && defaultValue !== undefined && !opts.required && !opts.readOnly,
  };
}

/**
 * @return {!Array<!Object>}
 */
function getAdminSettingsCatalog_() {
  return [
    adminSettingEntry_(
      'AUTH_SPREADSHEET_ID',
      'platform-auth',
      'Auth spreadsheet ID',
      'Google Spreadsheet ID for the Users tab and activity log. Not editable here; set in Apps Script project settings if needed.',
      'string',
      null,
      { required: true, readOnly: true }
    ),
    adminSettingEntry_('AUTH_USERS_SHEET_NAME', 'platform-auth', 'Users tab name', 'Sheet tab name for authorized users.', 'string', 'Users'),
    adminSettingEntry_('AUTH_COL_EMAIL', 'platform-auth', 'Email column header', 'Header in row 1 for the email column.', 'string', 'Email'),
    adminSettingEntry_('AUTH_COL_ROLE', 'platform-auth', 'Role column header', 'Header for role; use ADMIN for settings access.', 'string', 'Role'),
    adminSettingEntry_('AUTH_COL_TEAM', 'platform-auth', 'Team column header', 'Header for team.', 'string', 'Team'),
    adminSettingEntry_(
      'AUTH_COL_FIBERY_ACCESS',
      'platform-auth',
      'Fibery access column header',
      'Header for per-user Open in Fibery gate (fibery_access).',
      'string',
      'fibery_access'
    ),
    adminSettingEntry_(
      'AUTH_USER_ACTIVITY_SHEET_NAME',
      'platform-activity',
      'User Activity tab name',
      'Sheet tab for append-only usage logging.',
      'string',
      'User Activity'
    ),
    adminSettingEntry_(
      'USER_ACTIVITY_LOGGING_ENABLED',
      'platform-activity',
      'Activity logging enabled',
      'When off, no rows are appended to User Activity (false, no, or 0).',
      'boolean',
      true
    ),
    adminSettingEntry_(
      'FIBERY_HOST',
      'fibery-api',
      'Fibery host',
      'Workspace host without https:// (e.g. harpin-ai.fibery.io). Required for live Fibery dashboards.',
      'string',
      null,
      { required: true }
    ),
    adminSettingEntry_(
      'FIBERY_API_TOKEN',
      'fibery-api',
      'Fibery API token',
      'Bearer token for Fibery REST API. Leave blank to keep the current token; enter a new value to replace.',
      'secret',
      null,
      { required: true, sensitive: true }
    ),
    adminSettingEntry_('FIBERY_PUBLIC_SCHEME', 'fibery-deeplinks', 'Public URL scheme', 'http or https for Open in Fibery links.', 'string', 'https'),
    adminSettingEntry_(
      'FIBERY_DEEP_LINK_HOST',
      'fibery-deeplinks',
      'Deep link host',
      'Browser host for deep links if different from Fibery API host; leave default to use FIBERY_HOST.',
      'string',
      ''
    ),
    adminSettingEntry_(
      'FIBERY_LABOR_COST_PATH_TEMPLATE',
      'fibery-deeplinks',
      'Labor cost path template',
      'Path with {slug} and {publicId} placeholders.',
      'string',
      '/Agreement_Management/Labor_Costs/{slug}-{publicId}'
    ),
    adminSettingEntry_(
      'FIBERY_AGREEMENT_PATH_TEMPLATE',
      'fibery-deeplinks',
      'Agreement path template',
      'Path with {slug} and {publicId} for Agreement entities.',
      'string',
      '/Agreement_Management/Agreements/{slug}-{publicId}'
    ),
    adminSettingEntry_(
      'FIBERY_COMPANY_PATH_TEMPLATE',
      'fibery-deeplinks',
      'Company path template',
      'Path with {slug} and {publicId} for Companies (Revenue review drawer).',
      'string',
      '/Agreement_Management/Companies/{slug}-{publicId}'
    ),
    adminSettingEntry_(
      'AGREEMENT_CACHE_TTL_MINUTES',
      'agreement',
      'Agreement cache TTL (minutes)',
      'Server seed for client auto-refresh on Agreement and Revenue review.',
      'number',
      10,
      { min: 0, max: 1440 }
    ),
    adminSettingEntry_(
      'AGREEMENT_THRESHOLD_LOW_MARGIN',
      'agreement',
      'Low margin threshold (%)',
      'Attention alert when margin falls below this percent.',
      'number',
      35,
      { min: 0, max: 100 }
    ),
    adminSettingEntry_(
      'AGREEMENT_THRESHOLD_INTERNAL_LABOR',
      'agreement',
      'Internal labor threshold ($)',
      'Attention alert when internal labor exceeds this dollar amount.',
      'number',
      5000,
      { min: 0 }
    ),
    adminSettingEntry_(
      'AGREEMENT_THRESHOLD_EXPIRY_DAYS',
      'agreement',
      'Expiry warning (days)',
      'Renewal / expiring agreement window in days.',
      'number',
      60,
      { min: 1, max: 3650 }
    ),
    adminSettingEntry_(
      'AGREEMENT_TOP_N_RECOGNITION_BARS',
      'agreement',
      'Top N recognition bars',
      'Number of agreements in the revenue recognition stacked bar chart.',
      'number',
      10,
      { min: 1, max: 50 }
    ),
    adminSettingEntry_(
      'AGREEMENT_INTERNAL_COMPANY_NAMES',
      'agreement',
      'Internal company names',
      'Comma-separated company names treated as internal.',
      'csv',
      'harpin.ai'
    ),
    adminSettingEntry_(
      'AGREEMENT_SANKEY_LINK_OPACITY',
      'agreement',
      'Sankey link opacity',
      'Revenue flow Sankey link opacity from 0 to 1.',
      'number',
      0.35,
      { min: 0, max: 1 }
    ),
    adminSettingEntry_(
      'AGREEMENT_SANKEY_INCLUDE_INTERNAL',
      'agreement',
      'Sankey include internal',
      'Include Internal-type agreements in the Sankey aggregate.',
      'boolean',
      false
    ),
    adminSettingEntry_(
      'UTILIZATION_CACHE_TTL_MINUTES',
      'utilization',
      'Utilization cache TTL (minutes)',
      'Server seed for Operations panel auto-refresh.',
      'number',
      10,
      { min: 0, max: 1440 }
    ),
    adminSettingEntry_(
      'UTILIZATION_DEFAULT_RANGE_DAYS',
      'utilization',
      'Default range (days)',
      'Default date range when the client does not pass explicit bounds.',
      'number',
      90,
      { min: 1, max: 3650 }
    ),
    adminSettingEntry_(
      'UTILIZATION_MAX_RANGE_DAYS',
      'utilization',
      'Max range (days)',
      'Hard cap on requested utilization range length.',
      'number',
      365,
      { min: 1, max: 3650 }
    ),
    adminSettingEntry_(
      'UTILIZATION_WEEKLY_CAPACITY_HOURS',
      'utilization',
      'Weekly capacity (hours)',
      'Per-person weekly capacity for utilization %.',
      'number',
      40,
      { min: 1, max: 168 }
    ),
    adminSettingEntry_(
      'UTILIZATION_TARGET_PERCENT',
      'utilization',
      'Target utilization (%)',
      'Top of the green utilization band.',
      'number',
      85,
      { min: 1, max: 200 }
    ),
    adminSettingEntry_(
      'UTILIZATION_UNDER_PERCENT',
      'utilization',
      'Under-utilized threshold (%)',
      'Alert when mean utilization falls below this.',
      'number',
      60,
      { min: 0, max: 200 }
    ),
    adminSettingEntry_(
      'UTILIZATION_OVER_PERCENT',
      'utilization',
      'Over-allocated threshold (%)',
      'Alert when utilization exceeds this.',
      'number',
      110,
      { min: 1, max: 300 }
    ),
    adminSettingEntry_(
      'UTILIZATION_INTERNAL_COMPANY_NAMES',
      'utilization',
      'Internal company names',
      'Comma-separated Clockify company names for internal labor.',
      'csv',
      'harpin.ai,Harpin'
    ),
    adminSettingEntry_(
      'UTILIZATION_TOP_N_PERSONS',
      'utilization',
      'Top N persons (chart)',
      'Max rows on Hours-by-Person chart.',
      'number',
      20,
      { min: 1, max: 100 }
    ),
    adminSettingEntry_(
      'UTILIZATION_TOP_N_PROJECTS',
      'utilization',
      'Top N projects (chart)',
      'Max rows on Hours-by-Project chart.',
      'number',
      20,
      { min: 1, max: 100 }
    ),
    adminSettingEntry_(
      'UTILIZATION_TOP_N_CUSTOMERS',
      'utilization',
      'Top N customers (chart)',
      'Max rows on Hours-by-Customer chart.',
      'number',
      20,
      { min: 1, max: 100 }
    ),
    adminSettingEntry_(
      'UTILIZATION_HEATMAP_TOP_N_PERSONS',
      'utilization',
      'Heatmap top N persons',
      'Max person rows on the utilization heatmap.',
      'number',
      30,
      { min: 1, max: 100 }
    ),
    adminSettingEntry_(
      'UTILIZATION_STALE_APPROVAL_WARN_DAYS',
      'utilization',
      'Stale approval warn (days)',
      'Warning age for pending approvals.',
      'number',
      7,
      { min: 1, max: 365 }
    ),
    adminSettingEntry_(
      'UTILIZATION_STALE_APPROVAL_CRIT_DAYS',
      'utilization',
      'Stale approval critical (days)',
      'Critical age; must be greater than warn days.',
      'number',
      14,
      { min: 2, max: 365 }
    ),
    adminSettingEntry_(
      'LABOR_HOURS_DEFAULT_WEEKLY_TARGET',
      'labor-hours',
      'Default weekly target (hours)',
      'Default weekly hour target for Labor hours.',
      'number',
      40,
      { min: 1, max: 168 }
    ),
    adminSettingEntry_(
      'LABOR_HOURS_PARTNER_WEEKLY_TARGET',
      'labor-hours',
      'Partner weekly target (hours)',
      'Weekly target when clockifyUserCompany matches a partner substring.',
      'number',
      45,
      { min: 1, max: 168 }
    ),
    adminSettingEntry_(
      'LABOR_HOURS_PARTNER_COMPANY_SUBSTRINGS',
      'labor-hours',
      'Partner company substrings',
      'Comma-separated case-insensitive substrings on clockifyUserCompany.',
      'csv',
      'ret,coherent,kforce'
    ),
    adminSettingEntry_(
      'LABOR_HOURS_COMPANY_TARGETS_JSON',
      'labor-hours',
      'Company targets JSON',
      'JSON object mapping exact company name to weekly hours (positive numbers).',
      'json',
      ''
    ),
    adminSettingEntry_(
      'LABOR_HOURS_EXCLUDED_PERSON_SUBSTRINGS',
      'labor-hours',
      'Excluded person substrings',
      'Comma-separated tokens; userName containing any token is excluded.',
      'csv',
      ''
    ),
    adminSettingEntry_(
      'DELIVERY_CACHE_TTL_MINUTES',
      'delivery',
      'Delivery cache TTL (minutes)',
      'Server seed for Delivery panel auto-refresh.',
      'number',
      10,
      { min: 0, max: 1440 }
    ),
    adminSettingEntry_(
      'DELIVERY_ACTIVE_STATES',
      'delivery',
      'Active workflow states',
      'Comma-separated states for active projects; empty uses default (not Closed-Lost).',
      'csv',
      ''
    ),
    adminSettingEntry_(
      'DELIVERY_EXCLUDE_INTERNAL',
      'delivery',
      'Exclude internal projects',
      'Hide Internal-type projects from the active projects list.',
      'boolean',
      true
    ),
    adminSettingEntry_(
      'DELIVERY_PNL_INCLUDE_PROJECTED_ODC',
      'delivery',
      'Include projected ODC',
      'Include projected Other Direct Costs in monthly P&L.',
      'boolean',
      true
    ),
    adminSettingEntry_(
      'DELIVERY_PNL_MAX_LABOR_ROWS',
      'delivery',
      'Max labor rows per P&L',
      'Cap labor rows per project fetch; 0 means unlimited.',
      'number',
      10000,
      { min: 0, max: 100000 }
    ),
    adminSettingEntry_(
      'DELIVERY_COMPLETION_UNDER_PCT',
      'delivery',
      'Completion under (%)',
      'Percent complete bar — upper bound of under bucket.',
      'number',
      25,
      { min: 0, max: 100 }
    ),
    adminSettingEntry_(
      'DELIVERY_COMPLETION_BUILDING_PCT',
      'delivery',
      'Completion building (%)',
      'Upper bound of building bucket.',
      'number',
      75,
      { min: 0, max: 100 }
    ),
    adminSettingEntry_(
      'DELIVERY_COMPLETION_OVER_PCT',
      'delivery',
      'Completion over (%)',
      'Over when completion exceeds this percent.',
      'number',
      100,
      { min: 0, max: 200 }
    ),
    adminSettingEntry_(
      'DELIVERY_MARGIN_VARIANCE_AMBER_PTS',
      'delivery',
      'Margin variance amber (pts)',
      'Amber band below target margin in percentage points.',
      'number',
      5,
      { min: 0, max: 50 }
    ),
    adminSettingEntry_(
      'FOS_SNAPSHOT_DRIVE_FOLDER_ID',
      'snapshots',
      'Snapshot Drive folder ID',
      'Read-only. Set via ensureSnapshotDriveFolder() in the Apps Script editor.',
      'string',
      null,
      { readOnly: true }
    ),
    adminSettingEntry_(
      'FOS_SNAPSHOT_TIMEZONE',
      'snapshots',
      'Snapshot timezone',
      'IANA timezone for snapshot calendar date (e.g. America/Chicago).',
      'string',
      'America/Chicago'
    ),
    adminSettingEntry_(
      'SNAPSHOT_UTILIZATION_LOOKBACK_DAYS',
      'snapshots',
      'Utilization lookback (days)',
      'Days of utilization data included in each daily snapshot.',
      'number',
      90,
      { min: 1, max: 365 }
    ),
    adminSettingEntry_(
      'SNAPSHOT_PNL_BATCH_SIZE',
      'snapshots',
      'P&L batch size',
      'Delivery P&L projects processed per snapshot execution (1–25).',
      'number',
      8,
      { min: 1, max: 25 }
    ),
    adminSettingEntry_(
      'SNAPSHOT_RETENTION_DAYS',
      'snapshots',
      'Retention (days)',
      'Delete snapshot folders older than this many days.',
      'number',
      90,
      { min: 1, max: 3650 }
    ),
    adminSettingEntry_(
      'SNAPSHOT_TRIGGER_HOUR',
      'snapshots',
      'Daily trigger hour',
      'Hour (0–23) for the daily snapshot trigger in script timezone.',
      'number',
      2,
      { min: 0, max: 23 }
    ),
    adminSettingEntry_(
      'FOS_SNAPSHOT_LOG_SHEET_NAME',
      'snapshots',
      'Snapshot log tab name',
      'Tab name for Snapshot Runs log on the auth spreadsheet.',
      'string',
      'Snapshot Runs'
    ),
  ];
}

/**
 * @return {!Object<string, !Object>}
 */
function getAdminSettingsByKey_() {
  var list = getAdminSettingsCatalog_();
  var map = {};
  for (var i = 0; i < list.length; i++) {
    map[list[i].key] = list[i];
  }
  return map;
}

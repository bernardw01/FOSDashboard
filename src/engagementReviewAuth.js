/**
 * PRD version 3.26.0 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 037: Engagement Review access gates.
 * View / create reviews & updates: CLIENT-ENGAGEMENT, EXEC, or ADMIN.
 * Admin-only: reorder, calendar, Drive, AI synopsis, delete review.
 */

/**
 * @param {{ email?: string, role?: string, team?: string }} auth
 * @return {boolean}
 */
function canAccessEngagementReview_(auth) {
  if (!auth || !auth.email) {
    return false;
  }
  var role = String(auth.role || '').trim().toUpperCase();
  if (role === 'ADMIN' || role === 'EXEC') {
    return true;
  }
  return String(auth.team || '').trim().toUpperCase() === 'CLIENT-ENGAGEMENT';
}

/**
 * Assigned owners and named opt-in users (LOOKBACK_OPT_IN_EMAILS, e.g. Guy)
 * can open Engagement review for the Lookback tab without CE/EXEC/ADMIN.
 * @param {{ email?: string, role?: string, team?: string }} auth
 * @return {boolean}
 */
function canAccessLookback_(auth) {
  if (canAccessEngagementReview_(auth)) return true;
  if (isLookbackOptInEmail_(auth && auth.email)) return true;
  return lookbackUserIsAssignedOwner_(auth);
}

/**
 * @param {{ email?: string }} auth
 * @return {boolean}
 */
function lookbackUserIsAssignedOwner_(auth) {
  if (!auth || !auth.email) return false;
  if (typeof isSupabaseConfigured_ !== 'function' || !isSupabaseConfigured_()) return false;
  try {
    var res = supabaseSelect_(
      'fos_agreements',
      { owner_email: 'eq.' + String(auth.email) },
      'fibery_id',
      1
    );
    if (!res.ok || !res.json) return false;
    var rows = res.json;
    return Object.prototype.toString.call(rows) === '[object Array]' && rows.length > 0;
  } catch (e) {
    return false;
  }
}

/**
 * @param {string=} email
 * @return {boolean}
 */
function isLookbackOptInEmail_(email) {
  var mine = normalizeEmail_(email);
  if (!mine) return false;
  var raw = '';
  try {
    raw = String(PropertiesService.getScriptProperties().getProperty('LOOKBACK_OPT_IN_EMAILS') || '');
  } catch (e) {
    raw = '';
  }
  var parts = raw.split(/[,;\s]+/);
  for (var i = 0; i < parts.length; i++) {
    if (normalizeEmail_(parts[i]) === mine) return true;
  }
  return false;
}

/**
 * Nav + Lookback APIs: CE/EXEC/ADMIN or Lookback allowlist.
 * @param {{ email?: string, role?: string, team?: string }} auth
 * @return {boolean}
 */
function canAccessEngagementReviewNav_(auth) {
  return canAccessLookback_(auth);
}

/**
 * CE / EXEC / ADMIN may create reviews and Engagement Updates.
 * @param {{ email?: string, role?: string, team?: string }} auth
 * @return {boolean}
 */
function canCreateEngagementReview_(auth) {
  return canAccessEngagementReview_(auth);
}

/**
 * @return {{ email: string, role: string, team: string, fiberyAccess: boolean }}
 * @throws {Error} NOT_AUTHORIZED | FORBIDDEN
 */
function requireEngagementReviewAccessForApi_() {
  var auth = requireAuthForApi_();
  if (!canAccessEngagementReview_(auth)) {
    throw new Error('FORBIDDEN');
  }
  return auth;
}

/**
 * @return {{ email: string, role: string, team: string, fiberyAccess: boolean }}
 * @throws {Error} NOT_AUTHORIZED | FORBIDDEN
 */
function requireEngagementReviewCreateForApi_() {
  var auth = requireEngagementReviewAccessForApi_();
  if (!canCreateEngagementReview_(auth)) {
    throw new Error('FORBIDDEN');
  }
  return auth;
}

/**
 * @return {{ email: string, role: string, team: string, fiberyAccess: boolean }}
 * @throws {Error} NOT_AUTHORIZED | FORBIDDEN
 */
function requireEngagementReviewAdminForApi_() {
  var auth = requireEngagementReviewAccessForApi_();
  if (!isAdminUser_(auth)) {
    throw new Error('FORBIDDEN');
  }
  return auth;
}

/**
 * @param {string} msg
 * @return {string}
 */
function requireLookbackAccessForApi_() {
  var auth = requireAuthForApi_();
  if (!canAccessLookback_(auth)) {
    throw new Error('FORBIDDEN');
  }
  return auth;
}

/**
 * @param {string} msg
 * @return {string}
 */
function engagementReviewGateMessage_(msg) {
  if (msg === 'NOT_AUTHORIZED') {
    return 'Your session is not authorized. Reload the page.';
  }
  if (msg === 'FORBIDDEN') {
    return 'Project performance review and Lookback are available to Client Engagement, Execs, Admins, assigned owners, and named Lookback opt-in users.';
  }
  return msg || 'Request failed.';
}

/**
 * BUG-056-06 (A): whether the Reviews mode tab should be hidden.
 * Mirrors client erHideReviewsTab_ (lookbackOnly OR not Admin).
 * Does not change create-review gates (037 #5).
 *
 * @param {boolean} isAdmin
 * @param {boolean} lookbackOnly
 * @return {boolean}
 */
function erShouldHideReviewsTab_(isAdmin, lookbackOnly) {
  return !!lookbackOnly || !isAdmin;
}

/**
 * BUG-056-06: Reviews tab visibility matrix.
 * @return {!Object}
 */
function test_erShouldHideReviewsTab_() {
  var cases = [
    { label: 'Admin', isAdmin: true, lookbackOnly: false, hide: false },
    { label: 'EXEC/CE', isAdmin: false, lookbackOnly: false, hide: true },
    { label: 'lookbackOnly cohort', isAdmin: false, lookbackOnly: true, hide: true },
    { label: 'Admin+lookbackOnly (impossible)', isAdmin: true, lookbackOnly: true, hide: true },
  ];
  var fail = [];
  for (var i = 0; i < cases.length; i++) {
    var c = cases[i];
    var got = erShouldHideReviewsTab_(c.isAdmin, c.lookbackOnly);
    if (got !== c.hide) fail.push(c.label + ' expected hide=' + c.hide + ' got ' + got);
  }
  return {
    ok: true,
    pass: fail.length === 0,
    fail: fail,
    message:
      fail.length === 0
        ? 'PASS: Reviews tab hidden for non-Admin and lookbackOnly; visible for Admin.'
        : 'FAIL: ' + fail.join('; '),
  };
}

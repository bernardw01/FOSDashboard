/**
 * PRD version 3.14.1 - sync with docs/FOS-Dashboard-PRD.md
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
function engagementReviewGateMessage_(msg) {
  if (msg === 'NOT_AUTHORIZED') {
    return 'Your session is not authorized. Reload the page.';
  }
  if (msg === 'FORBIDDEN') {
    return 'Engagement review is available to the Client Engagement team, Execs, and Admins.';
  }
  return msg || 'Request failed.';
}

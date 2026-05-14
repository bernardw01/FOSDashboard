/**
 * PRD version 1.21.1 — sync with docs/FOS-Dashboard-PRD.md
 *
 * Composes public Fibery deep-link URLs (e.g. for the Operations dashboard's
 * row-detail drawer "Open in Fibery →" anchor). Lives server-side so the
 * workspace host + URL pattern is configurable via Script Properties and so
 * the client only sees template fragments that don't include the API token.
 *
 * Script Properties (all optional):
 *   FIBERY_PUBLIC_SCHEME           — defaults to `https`
 *   FIBERY_DEEP_LINK_HOST          — overrides FIBERY_HOST for browser URLs
 *                                    (use this when the API host differs from
 *                                    the workspace's public web host)
 *   FIBERY_LABOR_COST_PATH_TEMPLATE — defaults to
 *     `/Agreement_Management/Labor_Costs/{slug}-{publicId}`
 *   FIBERY_AGREEMENT_PATH_TEMPLATE — defaults to
 *     `/Agreement_Management/Agreements/{slug}-{publicId}`
 *
 * The path template supports two placeholders:
 *   {slug}     — entity name with whitespace replaced by `-` (per Fibery's
 *                public URL convention; see example URL in FR-84).
 *   {publicId} — entity public-id (Fibery's `fibery/public-id` field).
 */

/** @private */
var FIBERY_DEEP_LINK_DEFAULT_SCHEME_ = 'https';
/** @private */
var FIBERY_LABOR_COST_DEFAULT_PATH_TEMPLATE_ = '/Agreement_Management/Labor_Costs/{slug}-{publicId}';
/** @private */
var FIBERY_AGREEMENT_DEFAULT_PATH_TEMPLATE_ = '/Agreement_Management/Agreements/{slug}-{publicId}';

/**
 * Returns the deep-link config the client needs to compose row URLs, or
 * `null` if no host is configured (in which case the client should suppress
 * the "Open in Fibery" anchor).
 *
 * Importantly this does NOT return the API token or any credential. The
 * scheme + host + template are public, browser-renderable values; even if a
 * malicious page scraped them they couldn't read Fibery without an
 * authenticated user session.
 *
 * @return {{
 *   scheme: string,
 *   host: string,
 *   laborCostPathTemplate: string,
 *   agreementPathTemplate: string
 * }|null}
 */
function getFiberyDeepLinkConfig_() {
  var props = PropertiesService.getScriptProperties();
  // Prefer the explicit deep-link host. Fall back to FIBERY_HOST because for
  // most deployments the API host IS the public web host (e.g.
  // `harpin-ai.fibery.io`).
  var host = (props.getProperty('FIBERY_DEEP_LINK_HOST') || '').trim();
  if (!host) {
    host = (props.getProperty('FIBERY_HOST') || '').trim();
  }
  if (!host) {
    return null;
  }
  // Defensive: strip scheme / trailing slash / accidental path the same way
  // fiberyClient.js does, so the URL we hand to the browser is never a
  // double-scheme string like `https://https://harpin-ai.fibery.io/...`. This
  // is what surfaced as "Open in Fibery link not showing up" when operators
  // pasted the workspace URL into FIBERY_HOST verbatim (FR-88, v1.18.0).
  host = host.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!host) {
    return null;
  }

  var scheme = (props.getProperty('FIBERY_PUBLIC_SCHEME') || '').trim()
    || FIBERY_DEEP_LINK_DEFAULT_SCHEME_;

  var template = (props.getProperty('FIBERY_LABOR_COST_PATH_TEMPLATE') || '').trim()
    || FIBERY_LABOR_COST_DEFAULT_PATH_TEMPLATE_;

  var agreementTemplate = (props.getProperty('FIBERY_AGREEMENT_PATH_TEMPLATE') || '').trim()
    || FIBERY_AGREEMENT_DEFAULT_PATH_TEMPLATE_;

  return {
    scheme: scheme,
    host: host,
    laborCostPathTemplate: template,
    agreementPathTemplate: agreementTemplate,
  };
}

/**
 * Server-side helper for diagnostics. Builds the same URL the client will
 * build for a given (name, publicId). Returns `''` if config is missing or
 * either input is empty.
 *
 * @param {string} name Entity name (e.g. `2026-03-20 - Alex Anakin - 0.5 hrs`).
 * @param {string|number} publicId Fibery public id (e.g. `167141`).
 * @return {string}
 */
function buildLaborCostDeepLinkUrl_(name, publicId) {
  if (!name || publicId == null || publicId === '') return '';
  var cfg = getFiberyDeepLinkConfig_();
  if (!cfg) return '';
  var slug = fiberySlugify_(name);
  var path = cfg.laborCostPathTemplate
    .split('{slug}').join(slug)
    .split('{publicId}').join(String(publicId));
  return cfg.scheme + '://' + cfg.host + path;
}

/**
 * @param {string} name Agreement name.
 * @param {string|number} publicId Fibery public id.
 * @return {string}
 */
function buildAgreementDeepLinkUrl_(name, publicId) {
  if (!name || publicId == null || publicId === '') return '';
  var cfg = getFiberyDeepLinkConfig_();
  if (!cfg) return '';
  var slug = fiberySlugify_(name);
  var path = (cfg.agreementPathTemplate || FIBERY_AGREEMENT_DEFAULT_PATH_TEMPLATE_)
    .split('{slug}').join(slug)
    .split('{publicId}').join(String(publicId));
  return cfg.scheme + '://' + cfg.host + path;
}

/**
 * Replicates Fibery's public-URL slug rule: each whitespace character is
 * converted to a single `-`, no collapse. Other characters are left
 * untouched.
 *
 * Example: `2026-03-20 - Alex Anakin - 0.5 hrs`
 *       →  `2026-03-20---Alex-Anakin---0.5-hrs`
 *
 * @param {string} s
 * @return {string}
 * @private
 */
function fiberySlugify_(s) {
  return String(s == null ? '' : s).trim().replace(/\s/g, '-');
}

/**
 * Manual sanity check — paste into the Apps Script editor and run.
 * @private
 */
function _diag_fiberyDeepLinkSample() {
  var cfg = getFiberyDeepLinkConfig_();
  console.log('config: ' + JSON.stringify(cfg));
  var url = buildLaborCostDeepLinkUrl_('2026-03-20 - Alex Anakin - 0.5 hrs', '167141');
  console.log('sample labor url: ' + url);
  var agreeUrl = buildAgreementDeepLinkUrl_('Acme Corp — SOW 2025', '12345');
  console.log('sample agreement url: ' + agreeUrl);
  return { config: cfg, sampleLabor: url, sampleAgreement: agreeUrl };
}

/**
 * Operator self-service helper for "Open in Fibery link is not showing up".
 * Run from the Apps Script editor as the affected user — returns whether the
 * gate is open and whether the deep-link config is complete. Used to triage
 * FR-88 reports without needing to dig through Cloud Logs.
 *
 * @return {{
 *   email: string,
 *   authOk: boolean,
 *   fiberyAccess: boolean,
 *   deepLinkConfig: ?{
 *     scheme: string,
 *     host: string,
 *     laborCostPathTemplate: string,
 *     agreementPathTemplate: string
 *   },
 *   sampleUrl: string,
 *   notes: !Array<string>
 * }}
 * @private
 */
function _diag_fiberyAccess() {
  var notes = [];
  var email = '';
  try {
    email = Session.getActiveUser().getEmail() || '';
  } catch (_) { /* ignore */ }

  var auth = null;
  try {
    auth = getAuthorizationForActiveUser_();
  } catch (e) {
    notes.push('auth threw: ' + (e && e.message ? e.message : e));
  }
  var authOk = !!(auth && auth.ok);
  var fiberyAccess = !!(auth && auth.ok && auth.fiberyAccess);
  if (auth && !auth.ok) {
    notes.push('auth not ok: ' + auth.reason);
  }
  if (authOk && !fiberyAccess) {
    notes.push('user is authorized but fibery_access did not resolve to TRUE — check that cell');
  }

  var cfg = null;
  try {
    cfg = getFiberyDeepLinkConfig_();
  } catch (e) {
    notes.push('deep-link config threw: ' + (e && e.message ? e.message : e));
  }
  if (!cfg) {
    notes.push('deep-link config is null — set FIBERY_HOST (and optionally FIBERY_DEEP_LINK_HOST) in Script Properties');
  } else if (/^https?:\/\//i.test(cfg.host)) {
    notes.push('deep-link host still contains a scheme prefix after scrub: ' + cfg.host);
  }

  var sampleUrl = '';
  try {
    sampleUrl = buildLaborCostDeepLinkUrl_('2026-03-20 - Alex Anakin - 0.5 hrs', '167141');
  } catch (_) { /* ignore */ }

  return {
    email: email,
    authOk: authOk,
    fiberyAccess: fiberyAccess,
    deepLinkConfig: cfg,
    sampleUrl: sampleUrl,
    notes: notes,
  };
}

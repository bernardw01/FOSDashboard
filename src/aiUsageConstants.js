/**
 * PRD version 2.16.1 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Shared constants for AI usage sync (feature 017).
 */

/** @const {string} */
var AI_USAGE_FIBERY_APP_PROP_ = 'FIBERY_AI_USAGE_APP';

/** @const {string} */
var AI_USAGE_SYNC_ENABLED_PROP_ = 'AI_USAGE_SYNC_ENABLED';

/** @const {string} */
var AI_USAGE_TIMEZONE_PROP_ = 'AI_USAGE_SYNC_TIMEZONE';

/** @const {string} */
var AI_USAGE_LOOKBACK_PROP_ = 'AI_USAGE_DAILY_LOOKBACK_DAYS';

/** @const {string} */
var AI_USAGE_MAX_BACKFILL_PROP_ = 'AI_USAGE_MAX_BACKFILL_DAYS';

/** @const {string} */
var AI_USAGE_LOG_SHEET_PROP_ = 'AI_USAGE_LOG_SHEET_NAME';

/** @const {string} */
var AI_USAGE_TRIGGER_HOUR_PROP_ = 'AI_USAGE_SYNC_TRIGGER_HOUR';

/** @const {string} */
var AI_USAGE_INITIAL_LOOKBACK_PROP_ = 'AI_USAGE_INITIAL_LOOKBACK_DAYS';

/** @const {string} */
var AI_USAGE_MAX_DAYS_PER_RUN_PROP_ = 'AI_USAGE_MAX_DAYS_PER_RUN';

/** @const {number} */
var AI_USAGE_DEFAULT_MAX_DAYS_PER_RUN_ = 3;

/** @const {number} */
var AI_USAGE_DEFAULT_LOOKBACK_DAYS_ = 3;

/** @const {number} */
var AI_USAGE_DEFAULT_MAX_BACKFILL_DAYS_ = 90;

/** @const {number} */
var AI_USAGE_DEFAULT_TRIGGER_HOUR_ = 3;

/** @const {string} */
var AI_USAGE_DEFAULT_LOG_SHEET_ = 'AI Usage Sync Runs';

/** @const {string} */
var AI_USAGE_DEFAULT_TIMEZONE_ = 'America/Chicago';

/** @const {number} */
var AI_USAGE_FIBERY_UPSERT_BATCH_ = 50;

/** @const {number} */
var AI_USAGE_LOCK_WAIT_MS_ = 30000;

/** @const {number} Stop fetch/upsert before Apps Script 6-minute limit (ms). */
var AI_USAGE_SYNC_TIME_BUDGET_MS_ = 270000;

/** @const {number} Treat sheet "running" rows older than this as stale (ms). */
var AI_USAGE_STALE_RUNNING_MS_ = 420000;

/**
 * @return {string}
 */
function aiUsageFiberyAppPrefix_() {
  var raw = PropertiesService.getScriptProperties().getProperty(AI_USAGE_FIBERY_APP_PROP_);
  var prefix = (raw || 'AI Usage Data').trim();
  return prefix || 'AI Usage Data';
}

/**
 * @param {string} fieldSuffix
 * @return {string}
 */
function aiUsageField_(fieldSuffix) {
  return aiUsageFiberyAppPrefix_() + '/' + fieldSuffix;
}

/**
 * @return {string}
 */
function aiUsageUsageDatabase_() {
  return aiUsageFiberyAppPrefix_() + '/Usage';
}

/**
 * Anthropic cost_report rows (feature 023 dashboard read path).
 *
 * @return {string}
 */
function aiUsageClaudeApiCostsDatabase_() {
  return aiUsageFiberyAppPrefix_() + '/Claude API Costs';
}

/**
 * Clockify Users relation on Usage (live schema). Not `AI Usage Data/Clockify User`.
 *
 * @return {string}
 */
function aiUsageUsageClockifyUserField_() {
  return aiUsageField_('Actor Mapping Clockify User');
}

/**
 * @return {string}
 */
function aiUsageActorMappingDatabase_() {
  return aiUsageFiberyAppPrefix_() + '/Actor Mapping';
}

/**
 * @return {string}
 */
function aiUsageSyncRunsDatabase_() {
  return aiUsageFiberyAppPrefix_() + '/Sync Runs';
}

/**
 * @param {*} value
 * @return {string}
 */
function aiUsageSafeKeyPart_(value) {
  var s = value === null || value === undefined ? '' : String(value);
  return s.replace(/:/g, '_').trim();
}

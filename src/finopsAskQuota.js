/**
 * PRD version 3.0.12 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 032 - Users-tab daily Ask AI quota (ai_query_count / ai_query_date).
 */

/** @const {number} */
var FINOPS_ASK_QUOTA_LOCK_MS_ = 5000;

/**
 * @return {number}
 */
function finopsAskDailyCap_() {
  var raw = PropertiesService.getScriptProperties().getProperty('FINOPS_ASK_DAILY_CAP');
  var n = parseInt(raw, 10);
  if (!isFinite(n) || n < 1) {
    return 20;
  }
  return Math.min(500, n);
}

/**
 * @return {string}
 */
function finopsAskQuotaTimezone_() {
  var props = PropertiesService.getScriptProperties();
  var tz = (props.getProperty('FINOPS_ASK_TIMEZONE') || '').trim();
  if (tz) {
    return tz;
  }
  tz = (props.getProperty('NOTIFICATIONS_DEFAULT_TIMEZONE') || '').trim();
  return tz || 'America/Chicago';
}

/**
 * @return {string} YYYY-MM-DD
 */
function finopsAskTodayYmd_() {
  return Utilities.formatDate(new Date(), finopsAskQuotaTimezone_(), 'yyyy-MM-dd');
}

/**
 * @return {string}
 */
function finopsAskCountColumnHeader_() {
  var props = PropertiesService.getScriptProperties();
  return (props.getProperty('AUTH_COL_AI_QUERY_COUNT') || 'ai_query_count').trim() || 'ai_query_count';
}

/**
 * @return {string}
 */
function finopsAskDateColumnHeader_() {
  var props = PropertiesService.getScriptProperties();
  return (props.getProperty('AUTH_COL_AI_QUERY_DATE') || 'ai_query_date').trim() || 'ai_query_date';
}

/**
 * @param {!Array<!Array<*>>} values
 * @param {string} header
 * @return {number} 0-based column index or -1
 */
function finopsAskHeaderIndex_(values, header) {
  if (!values || !values.length) {
    return -1;
  }
  var row = values[0];
  var want = String(header || '')
    .trim()
    .toLowerCase();
  for (var c = 0; c < row.length; c++) {
    if (
      String(row[c] || '')
        .trim()
        .toLowerCase() === want
    ) {
      return c;
    }
  }
  return -1;
}

/**
 * @param {string} email
 * @return {!{
 *   ok: boolean,
 *   allowed?: boolean,
 *   count?: number,
 *   cap?: number,
 *   remaining?: number,
 *   message?: string
 * }}
 */
function finopsAskConsumeQuota_(email) {
  var norm = typeof normalizeEmail_ === 'function' ? normalizeEmail_(email) : String(email || '').trim().toLowerCase();
  if (!norm) {
    return { ok: false, message: 'Missing user email for Ask quota.' };
  }
  var sheet = typeof getUsersAuthSheetOrNull_ === 'function' ? getUsersAuthSheetOrNull_() : null;
  if (!sheet) {
    return { ok: false, message: 'Users sheet not found for Ask quota.' };
  }
  var cap = finopsAskDailyCap_();
  var today = finopsAskTodayYmd_();
  var lock = LockService.getScriptLock();
  var nest = beginScriptLockNest_(lock, FINOPS_ASK_QUOTA_LOCK_MS_);
  try {
    var values = sheet.getDataRange().getValues();
    if (!values || values.length < 2) {
      return { ok: false, message: 'Users sheet has no data rows.' };
    }
    var props = PropertiesService.getScriptProperties();
    var colEmail = (props.getProperty('AUTH_COL_EMAIL') || 'Email').trim() || 'Email';
    var idxEmail = finopsAskHeaderIndex_(values, colEmail);
    var idxCount = finopsAskHeaderIndex_(values, finopsAskCountColumnHeader_());
    var idxDate = finopsAskHeaderIndex_(values, finopsAskDateColumnHeader_());
    if (idxEmail < 0) {
      return { ok: false, message: 'Users Email column not found.' };
    }
    if (idxCount < 0 || idxDate < 0) {
      return {
        ok: false,
        message:
          'Users tab needs columns "' +
          finopsAskCountColumnHeader_() +
          '" and "' +
          finopsAskDateColumnHeader_() +
          '".',
      };
    }
    var rowIndex = -1;
    for (var r = 1; r < values.length; r++) {
      var cellEmail =
        typeof normalizeEmail_ === 'function'
          ? normalizeEmail_(values[r][idxEmail])
          : String(values[r][idxEmail] || '')
              .trim()
              .toLowerCase();
      if (cellEmail === norm) {
        rowIndex = r;
        break;
      }
    }
    if (rowIndex < 0) {
      return { ok: false, message: 'User is not on the Users tab.' };
    }
    var dateCell = String(values[rowIndex][idxDate] || '').trim();
    var countRaw = values[rowIndex][idxCount];
    var count = parseInt(countRaw, 10);
    if (!isFinite(count) || count < 0) {
      count = 0;
    }
    if (dateCell !== today) {
      count = 0;
      dateCell = today;
    }
    if (count >= cap) {
      sheet.getRange(rowIndex + 1, idxCount + 1).setValue(count);
      sheet.getRange(rowIndex + 1, idxDate + 1).setValue(dateCell);
      return {
        ok: true,
        allowed: false,
        count: count,
        cap: cap,
        remaining: 0,
        message: 'Daily Ask AI limit reached (' + cap + ' questions per day).',
      };
    }
    count += 1;
    sheet.getRange(rowIndex + 1, idxCount + 1).setValue(count);
    sheet.getRange(rowIndex + 1, idxDate + 1).setValue(today);
    return {
      ok: true,
      allowed: true,
      count: count,
      cap: cap,
      remaining: Math.max(0, cap - count),
    };
  } finally {
    endScriptLockNest_(nest);
  }
}

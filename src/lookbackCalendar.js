/**
 * PRD version 3.21.1 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 056: Lookback lock calendar (first Sunday after month-end + 1 US
 * federal business day, 23:59 America/Los_Angeles).
 */

/** @const {string} */
var LOOKBACK_TZ_DEFAULT_ = 'America/Los_Angeles';

/**
 * @return {string}
 */
function lookbackTimezone_() {
  var props = PropertiesService.getScriptProperties();
  var tz = String(props.getProperty('LOOKBACK_TIMEZONE') || '').trim();
  return tz || LOOKBACK_TZ_DEFAULT_;
}

/**
 * @param {number} y
 * @param {number} month 1-12
 * @param {number} day
 * @return {string} YYYY-MM-DD
 */
function lookbackYmd_(y, month, day) {
  var mm = month < 10 ? '0' + month : String(month);
  var dd = day < 10 ? '0' + day : String(day);
  return y + '-' + mm + '-' + dd;
}

/**
 * @param {string} ymd
 * @return {!Date} UTC noon on that calendar date
 */
function lookbackUtcNoon_(ymd) {
  var p = String(ymd).split('-');
  return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0));
}

/**
 * US federal holiday on a calendar date (observed on weekday if weekend).
 * @param {string} ymd
 * @return {boolean}
 */
function lookbackIsUsFederalHoliday_(ymd) {
  var p = String(ymd).split('-');
  var y = Number(p[0]);
  var m = Number(p[1]);
  var d = Number(p[2]);
  var set = {};
  function addObserved(month, day) {
    var dt = new Date(Date.UTC(y, month - 1, day, 12, 0, 0));
    var wd = dt.getUTCDay();
    if (wd === 6) dt.setUTCDate(dt.getUTCDate() - 1);
    if (wd === 0) dt.setUTCDate(dt.getUTCDate() + 1);
    set[lookbackYmd_(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())] = true;
  }
  function nthWeekday(month, weekday, n) {
    var dt = new Date(Date.UTC(y, month - 1, 1, 12, 0, 0));
    var count = 0;
    while (dt.getUTCMonth() === month - 1) {
      if (dt.getUTCDay() === weekday) {
        count++;
        if (count === n) {
          set[lookbackYmd_(y, month, dt.getUTCDate())] = true;
          return;
        }
      }
      dt.setUTCDate(dt.getUTCDate() + 1);
    }
  }
  function lastWeekday(month, weekday) {
    var dt = new Date(Date.UTC(y, month, 0, 12, 0, 0));
    while (dt.getUTCDay() !== weekday) dt.setUTCDate(dt.getUTCDate() - 1);
    set[lookbackYmd_(y, month, dt.getUTCDate())] = true;
  }
  addObserved(1, 1);
  nthWeekday(1, 1, 3);
  nthWeekday(2, 1, 3);
  lastWeekday(5, 1);
  addObserved(6, 19);
  addObserved(7, 4);
  nthWeekday(9, 1, 1);
  nthWeekday(10, 1, 2);
  addObserved(11, 11);
  nthWeekday(11, 4, 4);
  addObserved(12, 25);
  return !!set[ymd];
}

/**
 * @param {string} ymd
 * @return {boolean}
 */
function lookbackIsWeekend_(ymd) {
  var wd = lookbackUtcNoon_(ymd).getUTCDay();
  return wd === 0 || wd === 6;
}

/**
 * @param {string} ymd
 * @return {boolean}
 */
function lookbackIsBusinessDay_(ymd) {
  return !lookbackIsWeekend_(ymd) && !lookbackIsUsFederalHoliday_(ymd);
}

/**
 * @param {string} ymd
 * @return {string}
 */
function lookbackNextBusinessDay_(ymd) {
  var dt = lookbackUtcNoon_(ymd);
  dt.setUTCDate(dt.getUTCDate() + 1);
  var next = lookbackYmd_(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  while (!lookbackIsBusinessDay_(next)) {
    dt.setUTCDate(dt.getUTCDate() + 1);
    next = lookbackYmd_(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  return next;
}

/**
 * First Sunday on or after month-end, then one business day.
 * @param {string} period YYYY-MM-01
 * @return {{ monthEnd: string, timeDeadlineSunday: string, lockDate: string }}
 */
function lookbackComputeLockSchedule_(period) {
  var p = euNormalizeReportingPeriod_(period);
  var parts = p.split('-');
  var y = Number(parts[0]);
  var m = Number(parts[1]);
  var monthEndDt = new Date(Date.UTC(y, m, 0, 12, 0, 0));
  var monthEnd = lookbackYmd_(
    monthEndDt.getUTCFullYear(),
    monthEndDt.getUTCMonth() + 1,
    monthEndDt.getUTCDate()
  );
  var sun = lookbackUtcNoon_(monthEnd);
  while (sun.getUTCDay() !== 0) {
    sun.setUTCDate(sun.getUTCDate() + 1);
  }
  var sunday = lookbackYmd_(sun.getUTCFullYear(), sun.getUTCMonth() + 1, sun.getUTCDate());
  var lockDate = lookbackNextBusinessDay_(sunday);
  return { monthEnd: monthEnd, timeDeadlineSunday: sunday, lockDate: lockDate };
}

/**
 * Reporting period the daily job should lock today (Pacific calendar date).
 * @param {Date=} now
 * @return {?string} YYYY-MM-01 or ''
 */
function lookbackPeriodDueToday_(now) {
  var tz = lookbackTimezone_();
  var d = now || new Date();
  var today = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  var y = Number(today.slice(0, 4));
  var mo = Number(today.slice(5, 7));
  var candidates = [];
  var i;
  for (i = 0; i < 3; i++) {
    var mm = mo - i;
    var yy = y;
    while (mm < 1) {
      mm += 12;
      yy--;
    }
    candidates.push(lookbackYmd_(yy, mm, 1));
  }
  for (i = 0; i < candidates.length; i++) {
    var sched = lookbackComputeLockSchedule_(candidates[i]);
    if (sched.lockDate === today) return candidates[i];
  }
  return '';
}

/**
 * PRD version 2.12.7 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Spreadsheet-backed **Expenses** dashboard (feature 015). Reads expense lines
 * from AUTH_SPREADSHEET_ID tab AUTH_EXPENSES_SHEET_NAME (default `expenses`).
 *
 * Script Properties (see docs/features/015-expenses-dashboard.md):
 *   AUTH_EXPENSES_SHEET_NAME, AUTH_EXPENSES_MAX_ROWS
 *   AUTH_EXPENSES_COL_* column header overrides
 *   EXPENSES_CHART_CATEGORY_TOP_N, EXPENSES_CHART_DEPT_TOP_N,
 *   EXPENSES_CHART_VENDOR_TOP_N, EXPENSES_CHART_SUBMISSION_CYCLE_TOP_N,
 *   EXPENSES_SOFTWARE_CATEGORY_MATCH
 */

/** @const {number} */
var EXPENSES_CACHE_SCHEMA_VERSION_ = 2;

/** @const {number} Rows with |amount| at or below this are omitted (USD). */
var EXPENSES_AMOUNT_EPSILON_ = 0.005;

/**
 * @return {{ email: string, role: string, team: string, fiberyAccess: boolean }}
 * @throws {Error} NOT_AUTHORIZED | FORBIDDEN
 */
function requireExpensesAccessForApi_() {
  var auth = requireAuthForApi_();
  if (!canAccessExpensesDashboard_(auth)) {
    throw new Error('FORBIDDEN');
  }
  return auth;
}

/**
 * @return {{
 *   ok: boolean,
 *   source?: string,
 *   fetchedAt?: string|null,
 *   cacheSchemaVersion?: number,
 *   rows?: !Array<!Object>,
 *   partial?: boolean,
 *   warnings?: !Array<string>,
 *   meta?: !Object,
 *   chartConfig?: { categoryTopN: number, deptTopN: number, submissionCycleTopN: number },
 *   message?: string
 * }}
 */
function getExpensesDashboardData() {
  requireExpensesAccessForApi_();
  try {
    return buildExpensesDashboardPayload_();
  } catch (e) {
    var msg = e && e.message ? String(e.message) : 'Could not load expenses.';
    if (msg === 'NOT_AUTHORIZED') {
      msg = 'Your session is not authorized. Reload the page.';
    }
    if (msg === 'FORBIDDEN') {
      msg = 'Expenses is available to the Finance team, Execs, and Admins.';
    }
    try {
      console.warn('getExpensesDashboardData: ' + msg);
    } catch (_) {
      /* ignore */
    }
    return {
      ok: false,
      message: msg,
      fetchedAt: new Date().toISOString(),
      cacheSchemaVersion: EXPENSES_CACHE_SCHEMA_VERSION_,
    };
  }
}

/**
 * @return {!Object}
 * @private
 */
function getExpensesProps_() {
  var p = PropertiesService.getScriptProperties();
  function num(key, def) {
    var raw = (p.getProperty(key) || '').trim();
    if (!raw) return def;
    var n = parseInt(raw, 10);
    return isFinite(n) && n > 0 ? n : def;
  }
  function str(key, def) {
    var v = (p.getProperty(key) || '').trim();
    return v || def;
  }
  return {
    sheetName: str('AUTH_EXPENSES_SHEET_NAME', 'expenses'),
    maxRows: num('AUTH_EXPENSES_MAX_ROWS', 20000),
    colPurchase: str('AUTH_EXPENSES_COL_PURCHASE_DATE', 'Purchase date'),
    colPosted: str('AUTH_EXPENSES_COL_POSTED_DATE', 'Posted Date'),
    colSubmission: str('AUTH_EXPENSES_COL_SUBMISSION_DATE', 'Submission Date'),
    colAmount: str('AUTH_EXPENSES_COL_AMOUNT', 'Amount by category'),
    colDepartment: str('AUTH_EXPENSES_COL_DEPARTMENT', 'Department Name'),
    colCustomer: str('AUTH_EXPENSES_COL_CUSTOMER', 'GL Customer Name'),
    colVendor: str('AUTH_EXPENSES_COL_VENDOR', 'Vendor'),
    colCategory: str('AUTH_EXPENSES_COL_CATEGORY', 'Category'),
    colMemo: str('AUTH_EXPENSES_COL_MEMO', 'Memo'),
    colTransaction: str('AUTH_EXPENSES_COL_TRANSACTION_ID', 'Transaction ID'),
    colActivity: str('AUTH_EXPENSES_COL_ACTIVITY_TYPE', 'Activity type'),
    colEmployeeId: str('AUTH_EXPENSES_COL_EMPLOYEE_ID', 'Employee - ID'),
    colEmployeeName: str('AUTH_EXPENSES_COL_EMPLOYEE_NAME', 'Full name'),
    colEmployeeShort: str('AUTH_EXPENSES_COL_EMPLOYEE_SHORT', 'Employee'),
    colCurrency: str('AUTH_EXPENSES_COL_CURRENCY', 'Amount (by category) - Currency'),
    colApproval: str('AUTH_EXPENSES_COL_APPROVAL', 'Approval state'),
    colAttendees: str('AUTH_EXPENSES_COL_ATTENDEES', 'Attendees'),
    categoryTopN: num('EXPENSES_CHART_CATEGORY_TOP_N', 10),
    deptTopN: num('EXPENSES_CHART_DEPT_TOP_N', 10),
    vendorTopN: num('EXPENSES_CHART_VENDOR_TOP_N', 12),
    submissionCycleTopN: num('EXPENSES_CHART_SUBMISSION_CYCLE_TOP_N', 25),
    softwareCategoryMatch: str('EXPENSES_SOFTWARE_CATEGORY_MATCH', 'software'),
  };
}

/**
 * @param {*} cell
 * @return {Date|null}
 * @private
 */
function expensesCellToDate_(cell) {
  if (cell === null || cell === undefined || cell === '') {
    return null;
  }
  if (Object.prototype.toString.call(cell) === '[object Date]') {
    return isNaN(cell.getTime()) ? null : cell;
  }
  if (typeof cell === 'number' && isFinite(cell)) {
    // Google Sheets serial date (days since 1899-12-30).
    var ms = (cell - 25569) * 86400 * 1000;
    var d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  var s = String(cell).trim();
  if (!s) {
    return null;
  }
  var parsed = new Date(s);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * @param {Date|null} date
 * @return {string|null}
 * @private
 */
function expensesFormatIsoDay_(date) {
  if (!date) {
    return null;
  }
  try {
    return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  } catch (e) {
    return null;
  }
}

/**
 * @param {*} cell
 * @return {number}
 * @private
 */
function expensesParseAmount_(cell) {
  if (cell === null || cell === undefined || cell === '') {
    return NaN;
  }
  if (typeof cell === 'number' && isFinite(cell)) {
    return cell;
  }
  var s = String(cell).trim();
  if (!s) {
    return NaN;
  }
  var neg = false;
  if (s.charAt(0) === '(' && s.charAt(s.length - 1) === ')') {
    neg = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/\$/g, '').replace(/,/g, '').trim();
  var n = parseFloat(s);
  if (!isFinite(n)) {
    return NaN;
  }
  return neg ? -Math.abs(n) : n;
}

/**
 * @param {Array} headers
 * @return {Array<string>}
 * @private
 */
function expensesDupHeaderWarn_(headers) {
  var seen = {};
  var dups = [];
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i] === null || headers[i] === undefined ? '' : String(headers[i]).trim().toLowerCase();
    if (!h) {
      continue;
    }
    if (seen[h]) {
      dups.push(headers[i]);
    }
    seen[h] = true;
  }
  return dups;
}

/**
 * Normalized expenses payload (live API and daily snapshot job).
 * Does not check user authorization; callers must gate access.
 *
 * @return {!Object}
 * @private
 */
function buildExpensesDashboardPayload_() {
  var cfg = getExpensesProps_();
  var fetchedAt = new Date().toISOString();
  var warnings = [];
  var meta = {
    skippedZeroAmountCount: 0,
    skippedInvalidCount: 0,
    skippedUndatedCount: 0,
    usedDateFallbackCount: 0,
    rowCountRaw: 0,
  };

  var props = PropertiesService.getScriptProperties();
  var spreadsheetId = (props.getProperty('AUTH_SPREADSHEET_ID') || '').trim();
  if (!spreadsheetId) {
    return {
      ok: false,
      message: 'Missing AUTH_SPREADSHEET_ID in Script Properties.',
      fetchedAt: fetchedAt,
      cacheSchemaVersion: EXPENSES_CACHE_SCHEMA_VERSION_,
    };
  }

  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sheet = ss.getSheetByName(cfg.sheetName);
  if (!sheet) {
    return {
      ok: false,
      message:
        'Expenses sheet tab "' +
        cfg.sheetName +
        '" was not found. Set AUTH_EXPENSES_SHEET_NAME or add the tab.',
      fetchedAt: fetchedAt,
      cacheSchemaVersion: EXPENSES_CACHE_SCHEMA_VERSION_,
    };
  }

  var values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) {
    return {
      ok: true,
      source: 'spreadsheet',
      fetchedAt: fetchedAt,
      cacheSchemaVersion: EXPENSES_CACHE_SCHEMA_VERSION_,
      rows: [],
      partial: false,
      warnings: [],
      meta: meta,
      chartConfig: {
        categoryTopN: cfg.categoryTopN,
        deptTopN: cfg.deptTopN,
        submissionCycleTopN: cfg.submissionCycleTopN,
      },
    };
  }

  var headers = values[0];
  var dupLabels = expensesDupHeaderWarn_(headers);
  if (dupLabels.length) {
    warnings.push(
      'Duplicate header labels detected (' +
        dupLabels.slice(0, 6).join(', ') +
        (dupLabels.length > 6 ? ', ...' : '') +
        '). Verify column mapping.'
    );
  }

  var h = headers;
  var idxPurchase = findHeaderIndex_(h, cfg.colPurchase);
  var idxPosted = findHeaderIndex_(h, cfg.colPosted);
  var idxSubmission = findHeaderIndex_(h, cfg.colSubmission);
  var idxAmount = findHeaderIndex_(h, cfg.colAmount);
  var idxDepartment = findHeaderIndex_(h, cfg.colDepartment);
  var idxCustomer = findHeaderIndex_(h, cfg.colCustomer);
  var idxVendor = findHeaderIndex_(h, cfg.colVendor);
  var idxCategory = findHeaderIndex_(h, cfg.colCategory);
  var idxMemo = findHeaderIndex_(h, cfg.colMemo);
  var idxTransaction = findHeaderIndex_(h, cfg.colTransaction);
  var idxActivity = findHeaderIndex_(h, cfg.colActivity);
  var idxEmployeeId = findHeaderIndex_(h, cfg.colEmployeeId);
  var idxEmployeeName = findHeaderIndex_(h, cfg.colEmployeeName);
  var idxEmployeeShort = findHeaderIndex_(h, cfg.colEmployeeShort);
  var idxCurrency = findHeaderIndex_(h, cfg.colCurrency);
  var idxApproval = findHeaderIndex_(h, cfg.colApproval);
  var idxAttendees = findHeaderIndex_(h, cfg.colAttendees);

  if (idxAmount < 0) {
    return {
      ok: false,
      message:
        'Missing amount column "' +
        cfg.colAmount +
        '" in sheet headers. Check AUTH_EXPENSES_COL_AMOUNT.',
      fetchedAt: fetchedAt,
      cacheSchemaVersion: EXPENSES_CACHE_SCHEMA_VERSION_,
    };
  }

  if (idxDepartment < 0) {
    warnings.push('Department column "' + cfg.colDepartment + '" not found - rows use "Unknown".');
  }
  if (idxCustomer < 0) {
    warnings.push('Customer column "' + cfg.colCustomer + '" not found - all rows treated as unattributed.');
  }

  var rows = [];
  var partial = false;
  meta.rowCountRaw = Math.max(0, values.length - 1);

  var lastRowInclusive = Math.min(values.length - 1, cfg.maxRows);
  if (values.length - 1 > cfg.maxRows) {
    partial = true;
    warnings.push('Imported first ' + cfg.maxRows + ' data rows only (AUTH_EXPENSES_MAX_ROWS cap).');
  }

  for (var r = 1; r <= lastRowInclusive; r++) {
    var row = values[r];

    var purchaseD = idxPurchase >= 0 ? expensesCellToDate_(row[idxPurchase]) : null;
    var postedD = idxPosted >= 0 ? expensesCellToDate_(row[idxPosted]) : null;
    var submissionD = idxSubmission >= 0 ? expensesCellToDate_(row[idxSubmission]) : null;

    var effective =
      purchaseD ||
      postedD ||
      submissionD;
    if (!effective) {
      meta.skippedUndatedCount++;
      continue;
    }

    var amt = expensesParseAmount_(row[idxAmount]);
    if (!isFinite(amt)) {
      meta.skippedInvalidCount++;
      continue;
    }
    if (Math.abs(amt) <= EXPENSES_AMOUNT_EPSILON_) {
      meta.skippedZeroAmountCount++;
      continue;
    }

    if (!purchaseD && (postedD || submissionD)) {
      meta.usedDateFallbackCount++;
    }

    var purchaseIso = expensesFormatIsoDay_(purchaseD);
    var effectiveIso = expensesFormatIsoDay_(effective);
    var postedIso = expensesFormatIsoDay_(postedD);
    var submissionIso = expensesFormatIsoDay_(submissionD);

    var deptRaw = idxDepartment >= 0 ? row[idxDepartment] : '';
    var department =
      deptRaw === null || deptRaw === undefined ? '' : String(deptRaw).trim();
    if (!department) {
      department = 'Unknown';
    }

    var custRaw = idxCustomer >= 0 ? row[idxCustomer] : '';
    var customer = custRaw === null || custRaw === undefined ? '' : String(custRaw).trim();

    var txn =
      idxTransaction >= 0 && row[idxTransaction] !== null && row[idxTransaction] !== undefined
        ? String(row[idxTransaction]).trim()
        : '';

    /** @type {string} */
    var id = txn || 'row-' + (r + 1) + '-' + fetchedAt;

    rows.push({
      id: id,
      purchaseDate: purchaseIso,
      effectiveDate: effectiveIso,
      amount: amt,
      currencyCode:
        idxCurrency >= 0 && row[idxCurrency] !== null && row[idxCurrency] !== undefined
          ? String(row[idxCurrency]).trim()
          : '',
      department: department,
      customer: customer,
      vendor:
        idxVendor >= 0 && row[idxVendor] !== null && row[idxVendor] !== undefined
          ? String(row[idxVendor]).trim()
          : '',
      category:
        idxCategory >= 0 && row[idxCategory] !== null && row[idxCategory] !== undefined
          ? String(row[idxCategory]).trim()
          : '',
      memo:
        idxMemo >= 0 && row[idxMemo] !== null && row[idxMemo] !== undefined
          ? String(row[idxMemo]).trim()
          : '',
      transactionId: txn || null,
      activityType:
        idxActivity >= 0 && row[idxActivity] !== null && row[idxActivity] !== undefined
          ? String(row[idxActivity]).trim()
          : '',
      employeeId:
        idxEmployeeId >= 0 && row[idxEmployeeId] !== null && row[idxEmployeeId] !== undefined
          ? String(row[idxEmployeeId]).trim()
          : '',
      employeeName: (function () {
        var full =
          idxEmployeeName >= 0 && row[idxEmployeeName] !== null && row[idxEmployeeName] !== undefined
            ? String(row[idxEmployeeName]).trim()
            : '';
        if (full) {
          return full;
        }
        if (
          idxEmployeeShort >= 0 &&
          row[idxEmployeeShort] !== null &&
          row[idxEmployeeShort] !== undefined
        ) {
          return String(row[idxEmployeeShort]).trim();
        }
        return '';
      })(),
      postedDate: postedIso,
      submissionDate: submissionIso,
      approvalState:
        idxApproval >= 0 && row[idxApproval] !== null && row[idxApproval] !== undefined
          ? String(row[idxApproval]).trim()
          : '',
      attendees:
        idxAttendees >= 0 && row[idxAttendees] !== null && row[idxAttendees] !== undefined
          ? String(row[idxAttendees]).trim()
          : '',
    });
  }

  if (meta.usedDateFallbackCount > 0) {
    warnings.push(
      String(meta.usedDateFallbackCount) +
        ' expense line(s) used Posted or Submission date (Purchase date blank).'
    );
  }
  if (meta.skippedUndatedCount > 0) {
    warnings.push('Skipped ' + meta.skippedUndatedCount + ' row(s) with no effective date.');
  }

  return {
    ok: true,
    source: 'spreadsheet',
    fetchedAt: fetchedAt,
    cacheSchemaVersion: EXPENSES_CACHE_SCHEMA_VERSION_,
    rows: rows,
    partial: partial,
    warnings: warnings,
    meta: meta,
    chartConfig: {
      categoryTopN: cfg.categoryTopN,
      deptTopN: cfg.deptTopN,
      vendorTopN: cfg.vendorTopN,
      submissionCycleTopN: cfg.submissionCycleTopN,
      softwareCategoryMatch: cfg.softwareCategoryMatch,
    },
  };
}

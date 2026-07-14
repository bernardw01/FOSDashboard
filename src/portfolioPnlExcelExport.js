/**
 * PRD version 2.24.0 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Portfolio P&L Excel export (feature 031).
 * Builds a temporary Spreadsheet from a client-supplied outline tree
 * (already-loaded panel data), applies row groups, returns .xlsx as base64.
 */

/**
 * @param {*} request
 * @return {!Object}
 */
function getPortfolioPnlExcelExport(request) {
  var auth = requireAuthForApi_();
  requirePortfolioPnlAccess_(auth);
  try {
    return buildPortfolioPnlExcelExport_(request || {});
  } catch (err) {
    return {
      ok: false,
      message: err && err.message ? String(err.message) : 'Excel export failed.',
    };
  }
}

/**
 * @param {!Object} request
 * @return {!Object}
 * @private
 */
function buildPortfolioPnlExcelExport_(request) {
  var columns = request.columns;
  var rows = request.rows;
  if (!columns || !columns.length) {
    return { ok: false, message: 'Export is missing column definitions.' };
  }
  if (!rows || !rows.length) {
    return { ok: false, message: 'Nothing to export. Load Portfolio P&L first.' };
  }
  if (rows.length > 5000) {
    return {
      ok: false,
      message: 'Export is too large (' + rows.length + ' rows). Narrow filters and try again.',
    };
  }

  var meta = request.meta || {};
  var year = Number(meta.calendarYear) || new Date().getFullYear();
  var stamp = portfolioPnlExcelTimestamp_();
  var fileName = 'Portfolio-PnL-' + year + '-' + stamp + '.xlsx';

  var ss = null;
  try {
    ss = SpreadsheetApp.create('FOS Portfolio P&L Export ' + stamp);
    var sheet = ss.getSheets()[0];
    sheet.setName('Portfolio P&L');

    writePortfolioPnlExcelMainSheet_(sheet, columns, rows, meta);
    writePortfolioPnlExcelNotesSheet_(ss, meta, request.failedDetails || []);

    SpreadsheetApp.flush();

    // SpreadsheetApp.getAs(xlsx) is unsupported (native blob is PDF). Export via
    // the Sheets export endpoint with an OAuth bearer token instead.
    var blob = portfolioPnlExcelFetchXlsxBlob_(ss.getId(), fileName);
    var bytes = blob.getBytes();
    var contentBase64 = Utilities.base64Encode(bytes);

    return {
      ok: true,
      fileName: fileName,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      contentBase64: contentBase64,
      meta: {
        calendarYear: year,
        rowCount: rows.length,
        columnCount: columns.length,
        byteLength: bytes.length,
        generatedAt: new Date().toISOString(),
      },
    };
  } finally {
    if (ss) {
      try {
        DriveApp.getFileById(ss.getId()).setTrashed(true);
      } catch (eTrash) {
        /* ignore cleanup failures */
      }
    }
  }
}

/**
 * Export a Google Sheet as a true .xlsx blob.
 *
 * @param {string} spreadsheetId
 * @param {string} fileName
 * @return {!GoogleAppsScript.Base.Blob}
 * @private
 */
function portfolioPnlExcelFetchXlsxBlob_(spreadsheetId, fileName) {
  var url =
    'https://docs.google.com/spreadsheets/d/' +
    String(spreadsheetId) +
    '/export?format=xlsx';
  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
    },
    muteHttpExceptions: true,
  });
  var code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(
      'Excel export download failed (HTTP ' + code + '). Try again or contact an admin.'
    );
  }
  var blob = resp.getBlob();
  blob.setName(fileName || 'Portfolio-PnL.xlsx');
  return blob;
}

/**
 * @return {string}
 * @private
 */
function portfolioPnlExcelTimestamp_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Chicago', 'yyyyMMdd-HHmm');
}

/**
 * @param {!GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {!Array<!Object>} columns
 * @param {!Array<!Object>} rows
 * @param {!Object} meta
 * @private
 */
function writePortfolioPnlExcelMainSheet_(sheet, columns, rows, meta) {
  var colCount = columns.length + 1;
  var header = ['Label'];
  var projectedFlags = [];
  for (var c = 0; c < columns.length; c++) {
    header.push(String(columns[c].label || columns[c].id || ''));
    projectedFlags.push(!!columns[c].isProjected);
  }
  sheet.getRange(1, 1, 1, colCount).setValues([header]);
  sheet.getRange(1, 1, 1, colCount).setFontWeight('bold').setBackground('#0e3554').setFontColor('#ffffff');

  for (var pc = 0; pc < columns.length; pc++) {
    if (projectedFlags[pc]) {
      sheet.getRange(1, pc + 2).setBackground('#9a6b2f');
    } else if (columns[pc].kind === 'quarter') {
      sheet.getRange(1, pc + 2).setBackground('#0e3554');
    } else if (columns[pc].kind === 'year' || columns[pc].id === 'FY') {
      sheet.getRange(1, pc + 2).setBackground('#104060');
    }
  }

  var values = [];
  var levels = [];
  var kinds = [];
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r] || {};
    var level = Math.max(0, Math.min(8, Number(row.outlineLevel) || 0));
    levels.push(level);
    kinds.push(String(row.kind || ''));
    var line = [];
    var indent = '';
    for (var t = 0; t < level; t++) indent += '  ';
    line.push(indent + String(row.label || ''));
    var rowVals = row.values || [];
    for (var v = 0; v < columns.length; v++) {
      var cell = rowVals[v];
      if (cell == null || cell === '' || (typeof cell === 'number' && !isFinite(cell))) {
        line.push('');
      } else {
        line.push(cell);
      }
    }
    values.push(line);
  }

  if (values.length) {
    sheet.getRange(2, 1, values.length, colCount).setValues(values);
  }

  for (var i = 0; i < rows.length; i++) {
    var kind = kinds[i];
    var sheetRow = i + 2;
    var isCost =
      kind === 'costs' || kind === 'employee' || kind === 'contractor' || kind === 'odc';
    var isPct = kind === 'margin_pct';
    var labelCell = sheet.getRange(sheetRow, 1);
    if (kind === 'portfolio' || kind === 'customer') {
      labelCell.setFontWeight('bold');
    }
    if (kind === 'customer') {
      labelCell.setFontColor('#1B8DB0');
    }

    for (var j = 0; j < columns.length; j++) {
      var range = sheet.getRange(sheetRow, j + 2);
      var raw = values[i][j + 1];
      if (raw === '' || raw == null) continue;
      if (isPct) {
        range.setNumberFormat('0.0"%"');
        if (typeof raw === 'number' && raw < 0) {
          range.setFontColor('#B91C1C');
        }
      } else if (isCost) {
        range.setNumberFormat('($#,##0);($#,##0)');
        range.setFontColor('#B91C1C');
      } else {
        range.setNumberFormat('$#,##0;($#,##0)');
        if (typeof raw === 'number' && raw < 0) {
          range.setFontColor('#B91C1C');
        }
      }
    }
  }

  portfolioPnlExcelApplyRowGroups_(sheet, levels);
  try {
    sheet.setRowGroupControlPosition(SpreadsheetApp.GroupControlTogglePosition.BEFORE);
  } catch (ePos) {
    /* older runtimes may lack this API */
  }
  try {
    sheet.collapseAllRowGroups();
    if (typeof sheet.expandRowGroupsToDepth === 'function') {
      sheet.expandRowGroupsToDepth(1);
    }
  } catch (eCollapse) {
    /* best effort */
  }

  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(1);
  sheet.setColumnWidth(1, 320);
  for (var w = 2; w <= colCount; w++) {
    sheet.setColumnWidth(w, 88);
  }

  var titleNote =
    'Calendar year ' +
    (meta.calendarYear || '') +
    ' · generated from FOS Portfolio P&L panel data';
  sheet.getRange(1, 1).setNote(titleNote);
}

/**
 * Apply outline depth from export tree levels onto sheet rows (1-indexed data
 * starts at row 2). Depth 0 = portfolio summary (ungrouped); deeper values nest.
 *
 * @param {!GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {!Array<number>} levels
 * @private
 */
function portfolioPnlExcelApplyRowGroups_(sheet, levels) {
  for (var i = 0; i < levels.length; i++) {
    var depth = Math.max(0, Math.min(8, Number(levels[i]) || 0));
    if (depth < 1) continue;
    try {
      sheet.getRange(i + 2, 1).shiftRowGroupDepth(depth);
    } catch (eGroup) {
      /* skip invalid nest */
    }
  }
}

/**
 * @param {!GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {!Object} meta
 * @param {!Array<!Object>} failedDetails
 * @private
 */
function writePortfolioPnlExcelNotesSheet_(ss, meta, failedDetails) {
  var notes = ss.insertSheet('Export notes');
  var lines = [
    ['Portfolio P&L Excel export'],
    ['Generated at', meta.generatedAt || new Date().toISOString()],
    ['Calendar year', meta.calendarYear || ''],
    ['Projects in export', meta.projectCount != null ? meta.projectCount : ''],
    ['Agreement types', meta.typeFilterLabel || ''],
    ['Group by quarter', meta.collapseMonthsByQuarter ? 'Yes' : 'No'],
    ['Include projected months', meta.includeProjected ? 'Yes' : 'No'],
    ['Data source', meta.loadSourceLabel || 'Panel (already loaded)'],
    ['Last panel refresh', meta.fetchedAt || ''],
    [''],
    ['Legend'],
    ['Cost rows', 'Parentheses / red (expense presentation)'],
    ['Negative margin', 'Red font'],
    ['Blank cells', 'Zero or missing amounts'],
    ['Outline', 'Use Excel row group +/- controls (Customer → Project → Revenue/Costs)'],
    [''],
    ['Primary acceptance', 'Microsoft Excel desktop'],
  ];

  if (failedDetails && failedDetails.length) {
    lines.push(['']);
    lines.push(['Partial load - projects that failed in the panel']);
    lines.push(['Project', 'Message']);
    for (var i = 0; i < failedDetails.length; i++) {
      var f = failedDetails[i] || {};
      lines.push([f.name || f.id || '', f.message || '']);
    }
  }

  var maxCols = 2;
  var matrix = [];
  for (var r = 0; r < lines.length; r++) {
    var row = lines[r];
    if (row.length > maxCols) maxCols = row.length;
    matrix.push(row);
  }
  for (var p = 0; p < matrix.length; p++) {
    while (matrix[p].length < maxCols) matrix[p].push('');
  }
  notes.getRange(1, 1, matrix.length, maxCols).setValues(matrix);
  notes.getRange(1, 1).setFontWeight('bold');
  notes.setColumnWidth(1, 220);
  notes.setColumnWidth(2, 420);
}

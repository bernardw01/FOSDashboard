/**
 * PRD version 2.26.1 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Sales opportunity tracker spreadsheet reader (feature 030). Reads the sales
 * team's Opportunity Tracker tab and optional Stage Definitions tab.
 *
 * Script Properties:
 *   SALES_PIPELINE_SPREADSHEET_ID
 *   SALES_PIPELINE_DEALS_SHEET_NAME (default Opportunity Tracker)
 *   SALES_PIPELINE_STAGE_DEFS_SHEET_NAME (default Stage Definitions)
 *   SALES_PIPELINE_HEADER_ROW (default 5)
 *   SALES_PIPELINE_MAX_ROWS (default 500)
 */

/** @const {number} */
var SALES_PIPELINE_DEFAULT_HEADER_ROW_ = 5;

/**
 * @return {{
 *   spreadsheetId: string,
 *   dealsSheetName: string,
 *   stageDefsSheetName: string,
 *   headerRow: number,
 *   maxRows: number
 * }}
 * @private
 */
function getSalesPipelineSheetProps_() {
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
    spreadsheetId: str(
      'SALES_PIPELINE_SPREADSHEET_ID',
      '1jZDCN75kFN53-UXN65zA6GaoWmirowbzfOrDLRaWqs4'
    ),
    dealsSheetName: str('SALES_PIPELINE_DEALS_SHEET_NAME', 'Opportunity Tracker'),
    stageDefsSheetName: str('SALES_PIPELINE_STAGE_DEFS_SHEET_NAME', 'Stage Definitions'),
    headerRow: num('SALES_PIPELINE_HEADER_ROW', SALES_PIPELINE_DEFAULT_HEADER_ROW_),
    maxRows: num('SALES_PIPELINE_MAX_ROWS', 500),
  };
}

/**
 * @param {*} cell
 * @return {number}
 * @private
 */
function salesPipelineParseMoney_(cell) {
  if (cell === null || cell === undefined || cell === '') {
    return 0;
  }
  if (typeof cell === 'number' && isFinite(cell)) {
    return cell < 0 ? 0 : cell;
  }
  var s = String(cell).trim();
  if (!s || s === '-' || s === '—') {
    return 0;
  }
  s = s.replace(/\$/g, '').replace(/,/g, '').trim();
  var n = parseFloat(s);
  if (!isFinite(n) || n < 0) {
    return 0;
  }
  return n;
}

/**
 * @param {*} cell
 * @return {number}
 * @private
 */
function salesPipelineParseProbability_(cell) {
  if (cell === null || cell === undefined || cell === '') {
    return 0;
  }
  if (typeof cell === 'number' && isFinite(cell)) {
    return cell > 1 ? cell / 100 : cell;
  }
  var s = String(cell).trim().replace(/%/g, '');
  if (!s || s === '-') {
    return 0;
  }
  var n = parseFloat(s);
  if (!isFinite(n)) {
    return 0;
  }
  return n > 1 ? n / 100 : n;
}

/**
 * @param {Date|*} cell
 * @return {string|null}
 * @private
 */
function salesPipelineFormatDateCell_(cell) {
  if (cell === null || cell === undefined || cell === '') {
    return null;
  }
  if (Object.prototype.toString.call(cell) === '[object Date]') {
    if (isNaN(cell.getTime())) return null;
    try {
      return Utilities.formatDate(cell, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } catch (e) {
      return null;
    }
  }
  var s = String(cell).trim();
  if (!s || /^tbd$/i.test(s) || /^n\/a$/i.test(s)) {
    return null;
  }
  var d = new Date(s);
  if (!isNaN(d.getTime())) {
    try {
      return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } catch (e2) {
      return s;
    }
  }
  return s;
}

/**
 * @param {Array} headers
 * @param {string} name
 * @param {Array<string>=} fallbacks
 * @return {number}
 * @private
 */
function salesPipelineHeaderIndex_(headers, name, fallbacks) {
  var idx = findHeaderIndex_(headers, name);
  if (idx >= 0) {
    return idx;
  }
  if (fallbacks) {
    for (var i = 0; i < fallbacks.length; i++) {
      idx = findHeaderIndex_(headers, fallbacks[i]);
      if (idx >= 0) {
        return idx;
      }
    }
  }
  return -1;
}

/**
 * @param {Array} row
 * @param {number} idx
 * @return {string}
 * @private
 */
function salesPipelineCellText_(row, idx) {
  if (idx < 0 || !row || idx >= row.length) {
    return '';
  }
  var v = row[idx];
  if (v === null || v === undefined) {
    return '';
  }
  return String(v).trim();
}

/**
 * Read normalized opportunity rows from the sales spreadsheet.
 *
 * @return {{
 *   ok: boolean,
 *   rows?: !Array<!Object>,
 *   oneLineRead?: string,
 *   stageDefinitions?: !Array<!Object>,
 *   sheetUpdatedAt?: string|null,
 *   warnings?: !Array<string>,
 *   message?: string
 * }}
 */
function readSalesPipelineSheetRows_() {
  var cfg = getSalesPipelineSheetProps_();
  var warnings = [];
  if (!cfg.spreadsheetId) {
    return { ok: false, message: 'SALES_PIPELINE_SPREADSHEET_ID is not configured.' };
  }

  var ss;
  try {
    ss = SpreadsheetApp.openById(cfg.spreadsheetId);
  } catch (e) {
    return { ok: false, message: 'Could not open sales pipeline spreadsheet.' };
  }

  var sheet = ss.getSheetByName(cfg.dealsSheetName);
  if (!sheet) {
    return {
      ok: false,
      message: 'Sheet "' + cfg.dealsSheetName + '" was not found in the sales pipeline spreadsheet.',
    };
  }

  var headerRow = cfg.headerRow;
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < headerRow) {
    return { ok: true, rows: [], oneLineRead: '', stageDefinitions: [], warnings: warnings };
  }

  var oneLineRead = '';
  if (headerRow > 1) {
    var bannerRow = sheet.getRange(headerRow - 1, 1, 1, Math.max(lastCol, 3)).getValues()[0];
    for (var b = 0; b < bannerRow.length; b++) {
      var cell = bannerRow[b];
      if (cell && String(cell).length > 40 && String(cell).indexOf('One Line Read') < 0) {
        oneLineRead = String(cell).trim();
        break;
      }
    }
    if (!oneLineRead) {
      for (var b2 = 0; b2 < bannerRow.length; b2++) {
        if (bannerRow[b2] && String(bannerRow[b2]).trim()) {
          var t = String(bannerRow[b2]).trim();
          if (t !== 'One Line Read:') {
            oneLineRead = t;
          }
        }
      }
    }
  }

  var headerValues = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];
  var headers = [];
  for (var h = 0; h < headerValues.length; h++) {
    headers.push(headerValues[h] === null || headerValues[h] === undefined ? '' : String(headerValues[h]).trim());
  }

  var col = {
    hubspotDealId: salesPipelineHeaderIndex_(headers, 'Hubspot Deal ID', ['HubSpot Deal ID']),
    oppId: salesPipelineHeaderIndex_(headers, 'Opportunity ID'),
    company: salesPipelineHeaderIndex_(headers, 'Company'),
    contact: salesPipelineHeaderIndex_(headers, 'Contact Name'),
    contactTitle: salesPipelineHeaderIndex_(headers, 'Contact Title'),
    contactEmail: salesPipelineHeaderIndex_(headers, 'Contact Email'),
    contactPhone: salesPipelineHeaderIndex_(headers, 'Contact Phone'),
    vertical: salesPipelineHeaderIndex_(headers, 'Industry / Vertical', ['Vertical']),
    source: salesPipelineHeaderIndex_(headers, 'Source'),
    partner: salesPipelineHeaderIndex_(headers, 'Partner Sourced (Y/N)'),
    stage: salesPipelineHeaderIndex_(headers, 'Stage'),
    product: salesPipelineHeaderIndex_(headers, 'Product Interest'),
    acv: salesPipelineHeaderIndex_(headers, 'Est. ACV ($)', ['Est. ACV']),
    assumptions: salesPipelineHeaderIndex_(headers, 'Assumptions'),
    probability: salesPipelineHeaderIndex_(headers, 'Probability (%)', ['Probability']),
    weightedAcv: salesPipelineHeaderIndex_(headers, 'Weighted ACV ($)', ['Weighted ACV']),
    discoveryDate: salesPipelineHeaderIndex_(headers, 'Discovery Date'),
    nextStep: salesPipelineHeaderIndex_(headers, 'Next Step'),
    nextStepDate: salesPipelineHeaderIndex_(headers, 'Next Step Date'),
    execSponsor: salesPipelineHeaderIndex_(headers, 'Exec Sponsor'),
    notes: salesPipelineHeaderIndex_(headers, 'Notes'),
    tcv: salesPipelineHeaderIndex_(headers, 'Est. TCV ($)', ['TCV', 'Total Contract Value']),
  };

  if (col.company < 0 || col.stage < 0) {
    return { ok: false, message: 'Opportunity Tracker is missing required Company or Stage columns.' };
  }

  var dataStart = headerRow + 1;
  var numRows = Math.min(lastRow - headerRow, cfg.maxRows);
  if (numRows <= 0) {
    return {
      ok: true,
      rows: [],
      oneLineRead: oneLineRead,
      stageDefinitions: readSalesPipelineStageDefs_(ss, cfg.stageDefsSheetName),
      warnings: warnings,
    };
  }

  var values = sheet.getRange(dataStart, 1, numRows, lastCol).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var company = salesPipelineCellText_(row, col.company);
    var oppId = salesPipelineCellText_(row, col.oppId);
    if (!company && !oppId) {
      continue;
    }

    var acv = salesPipelineParseMoney_(col.acv >= 0 ? row[col.acv] : '');
    var prob = salesPipelineParseProbability_(col.probability >= 0 ? row[col.probability] : '');
    var weighted = salesPipelineParseMoney_(col.weightedAcv >= 0 ? row[col.weightedAcv] : '');
    if (!weighted && acv > 0 && prob > 0) {
      weighted = Math.round(acv * prob);
    }

    var hubspotDealId = salesPipelineCellText_(row, col.hubspotDealId).replace(/\D/g, '');
    var partnerRaw = salesPipelineCellText_(row, col.partner).toUpperCase();
    rows.push({
      rowNumber: dataStart + i,
      hubspotDealId: hubspotDealId,
      salesOppId: oppId,
      company: company || oppId,
      contact: salesPipelineCellText_(row, col.contact),
      contactTitle: salesPipelineCellText_(row, col.contactTitle),
      contactEmail: salesPipelineCellText_(row, col.contactEmail),
      contactPhone: salesPipelineCellText_(row, col.contactPhone),
      vertical: salesPipelineCellText_(row, col.vertical),
      source: salesPipelineCellText_(row, col.source),
      partnerSourced: partnerRaw === 'Y',
      salesStage: salesPipelineCellText_(row, col.stage) || 'Prospect',
      product: salesPipelineCellText_(row, col.product),
      acv: acv,
      assumptions: salesPipelineCellText_(row, col.assumptions),
      probability: prob,
      weightedAcv: weighted,
      discoveryDate: salesPipelineFormatDateCell_(col.discoveryDate >= 0 ? row[col.discoveryDate] : ''),
      nextStep: salesPipelineCellText_(row, col.nextStep),
      nextStepDate: salesPipelineFormatDateCell_(col.nextStepDate >= 0 ? row[col.nextStepDate] : ''),
      execSponsor: salesPipelineCellText_(row, col.execSponsor),
      notes: salesPipelineCellText_(row, col.notes),
      tcv: salesPipelineParseMoney_(col.tcv >= 0 ? row[col.tcv] : ''),
    });
  }

  if (lastRow - headerRow > cfg.maxRows) {
    warnings.push('Sales pipeline sheet truncated at ' + cfg.maxRows + ' rows.');
  }

  var stageDefinitions = readSalesPipelineStageDefs_(ss, cfg.stageDefsSheetName);
  var updatedAt = null;
  try {
    updatedAt = sheet.getParent().getLastUpdated().toISOString();
  } catch (e3) {
    updatedAt = null;
  }

  return {
    ok: true,
    rows: rows,
    oneLineRead: oneLineRead,
    stageDefinitions: stageDefinitions,
    sheetUpdatedAt: updatedAt,
    warnings: warnings,
  };
}

/**
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} sheetName
 * @return {!Array<!Object>}
 * @private
 */
function readSalesPipelineStageDefs_(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    return [];
  }
  var lastRow = sheet.getLastRow();
  if (lastRow < 4) {
    return [];
  }
  var values = sheet.getRange(1, 1, lastRow, 4).getValues();
  var headerIdx = -1;
  for (var r = 0; r < values.length; r++) {
    if (String(values[r][0] || '').trim().toLowerCase() === 'stage') {
      headerIdx = r;
      break;
    }
  }
  if (headerIdx < 0) {
    return [];
  }
  var out = [];
  for (var i = headerIdx + 1; i < values.length; i++) {
    var stage = String(values[i][0] || '').trim();
    if (!stage) {
      continue;
    }
    out.push({
      stage: stage,
      probability: salesPipelineParseProbability_(values[i][1]),
      definition: String(values[i][2] || '').trim(),
      exitCriteria: String(values[i][3] || '').trim(),
    });
  }
  return out;
}

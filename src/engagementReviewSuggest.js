/**
 * PRD version 3.20.16 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 037: Suggest agreements from alerts; participants from Agreement Owner âˆ© Users.
 */

/**
 * @return {!Object<string, true>}
 */
function erAuthUserEmailSet_() {
  var set = {};
  try {
    var props = PropertiesService.getScriptProperties();
    var spreadsheetId = (props.getProperty('AUTH_SPREADSHEET_ID') || '').trim();
    if (!spreadsheetId) return set;
    var sheetName = (props.getProperty('AUTH_USERS_SHEET_NAME') || 'Users').trim() || 'Users';
    var colEmail = (props.getProperty('AUTH_COL_EMAIL') || 'Email').trim() || 'Email';
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return set;
    var values = sheet.getDataRange().getValues();
    if (!values || values.length < 2) return set;
    var idxEmail = findHeaderIndex_(values[0], colEmail);
    if (idxEmail < 0) return set;
    for (var r = 1; r < values.length; r++) {
      var cell = values[r][idxEmail];
      var em = normalizeEmail_(cell === null || cell === undefined ? '' : String(cell));
      if (em) set[em] = true;
    }
  } catch (e) {
    try {
      console.warn(
        'erAuthUserEmailSet_: ' + (e && e.message ? e.message : e)
      );
    } catch (_) {
      /* ignore */
    }
  }
  return set;
}

/**
 * @param {string} email
 * @return {boolean}
 */
function erIsAuthUserEmail_(email) {
  var em = normalizeEmail_(String(email || ''));
  if (!em) return false;
  var set = erAuthUserEmailSet_();
  return !!set[em];
}

/**
 * Best-effort owner from fos_agreements row or raw jsonb.
 * @param {?Object} row
 * @return {{ email: ?string, name: ?string }}
 */
function erOwnerFromAgreementRow_(row) {
  if (!row) return { email: null, name: null };
  var email = row.owner_email ? String(row.owner_email).trim() : '';
  var name = row.owner_name ? String(row.owner_name).trim() : '';
  if (!email && row.raw && typeof row.raw === 'object') {
    var raw = row.raw;
    email =
      String(
        raw.ownerEmail ||
          raw.owner_email ||
          (raw.owner && (raw.owner.email || raw.owner.Email)) ||
          ''
      ).trim();
    name =
      String(
        raw.ownerName ||
          raw.owner_name ||
          (raw.owner && (raw.owner.name || raw.owner.Name)) ||
          ''
      ).trim();
  }
  return { email: email || null, name: name || null };
}

/**
 * Load agreement dimension map from Datastore.
 * @return {!Object<string, !Object>}
 */
function erAgreementDimMap_() {
  var map = {};
  if (!isSupabaseConfigured_()) return map;
  var res = supabaseSelect_(
    'fos_agreements',
    {},
    'fibery_id,name,status,agreement_type,company_fibery_id,owner_email,owner_name,raw',
    2000
  );
  if (!res.ok) return map;
  var rows = erRows_(res.json);
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r && r.fibery_id) {
      map[String(r.fibery_id)] = r;
    }
  }
  return map;
}

/**
 * @return {{ ok: boolean, message?: string, alerts?: !Array, agreements?: !Array }}
 */
function erLoadAgreementAlertsPayload_() {
  if (!isSupabaseConfigured_()) {
    return { ok: false, message: 'Datastore is not configured.' };
  }
  var res = supabaseSelect_(
    'fos_panel_payloads',
    { panel_key: 'eq.agreement-dashboard' },
    'payload,as_of,synced_at',
    1
  );
  if (!res.ok) {
    return { ok: false, message: res.message || 'Could not load Agreement payload.' };
  }
  var rows = erRows_(res.json);
  if (!rows.length || !rows[0].payload) {
    return { ok: false, message: 'Agreement dashboard has not been hydrated yet.' };
  }
  var payload = rows[0].payload;
  var alerts = payload.alerts || [];
  var agreements = payload.agreements || payload.rows || [];
  return { ok: true, alerts: alerts, agreements: agreements, asOf: rows[0].as_of };
}

/**
 * @param {string} reviewId
 * @return {!{ ok: boolean, message?: string, added?: number, skipped?: number }}
 */
function erSuggestAgreementsFromAlerts_(reviewId) {
  var loaded = erLoadAgreementAlertsPayload_();
  if (!loaded.ok) return loaded;
  var alerts = loaded.alerts || [];
  var dims = erAgreementDimMap_();
  var byId = {};
  for (var i = 0; i < alerts.length; i++) {
    var a = alerts[i];
    if (!a || !a.agreementId) continue;
    var sev = String(a.severity || '').toLowerCase();
    var kind = String(a.kind || '').toLowerCase();
    if (kind === 'all_clear') continue;
    if (sev !== 'critical' && sev !== 'warning') continue;
    var aid = String(a.agreementId);
    if (!byId[aid]) {
      byId[aid] = { titles: [], severities: [] };
    }
    byId[aid].titles.push(String(a.title || a.id || ''));
    byId[aid].severities.push(sev);
  }
  var added = 0;
  var skipped = 0;
  var ids = Object.keys(byId);
  if (!ids.length) {
    return { ok: true, added: 0, skipped: 0, message: 'No Critical or Warning alerts to suggest.' };
  }
  // Enrich names from payload agreements when present.
  var nameById = {};
  var customerById = {};
  var list = loaded.agreements || [];
  for (var j = 0; j < list.length; j++) {
    var ag = list[j];
    if (!ag || !ag.id) continue;
    nameById[String(ag.id)] = ag.name || ag.agreementName || '';
    customerById[String(ag.id)] = ag.customer || ag.customerName || '';
  }
  for (var k = 0; k < ids.length; k++) {
    var agreementId = ids[k];
    var dim = dims[agreementId];
    var owner = erOwnerFromAgreementRow_(dim);
    var up = erUpsertAgreementLink_(reviewId, {
      agreementFiberyId: agreementId,
      agreementName: nameById[agreementId] || (dim && dim.name) || agreementId,
      companyName: customerById[agreementId] || null,
      ownerEmail: owner.email,
      ownerName: owner.name,
      suggestedFromAlert: true,
      alertSnapshot: byId[agreementId],
      sortOrder: k,
    });
    if (up.ok) added++;
    else skipped++;
  }
  return { ok: true, added: added, skipped: skipped };
}

/**
 * @param {string} reviewId
 * @return {!{ ok: boolean, message?: string, added?: number, skippedNotOnUsers?: !Array<string> }}
 */
function erSuggestParticipantsFromOwners_(reviewId) {
  var bundle = erGetReviewBundle_(reviewId);
  if (!bundle.ok) return bundle;
  var userSet = erAuthUserEmailSet_();
  var added = 0;
  var skipped = [];
  var agreements = bundle.agreements || [];
  var dims = erAgreementDimMap_();
  for (var i = 0; i < agreements.length; i++) {
    var link = agreements[i];
    var email = normalizeEmail_(String(link.owner_email || ''));
    var name = link.owner_name || '';
    if (!email) {
      var dim = dims[String(link.agreement_fibery_id || '')];
      var owner = erOwnerFromAgreementRow_(dim);
      email = normalizeEmail_(String(owner.email || ''));
      name = owner.name || name;
    }
    if (!email) continue;
    if (!userSet[email]) {
      skipped.push(email);
      continue;
    }
    var up = erUpsertParticipant_(reviewId, {
      email: email,
      displayName: name || email,
      participantRole: 'owner',
      suggested: true,
    });
    if (up.ok) added++;
  }
  return { ok: true, added: added, skippedNotOnUsers: skipped };
}

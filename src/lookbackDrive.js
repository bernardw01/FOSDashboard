/**
 * PRD version 3.21.1 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 056: Drive uploads for Lookback narrative screenshots.
 */

/** @const {number} */
var LB_MAX_EVIDENCE_BYTES_ = 8 * 1024 * 1024;

/**
 * @return {GoogleAppsScript.Drive.Folder}
 */
function lbResolveEvidenceFolder_() {
  var props = PropertiesService.getScriptProperties();
  var explicit = String(props.getProperty('LOOKBACK_EVIDENCE_DRIVE_FOLDER_ID') || '').trim();
  if (explicit) return DriveApp.getFolderById(explicit);
  var parent = erResolveRecordingsFolder_();
  var name = 'lookback-evidence';
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}

/**
 * @param {string} projectId
 * @param {string} fileName
 * @param {string} mimeType
 * @param {string} base64Data
 * @param {string} uploadedByEmail
 * @return {!{ ok: boolean, message?: string, evidence?: Object }}
 */
function lbUploadEvidence_(projectId, fileName, mimeType, base64Data, uploadedByEmail) {
  var id = String(projectId || '').trim();
  if (!id) return { ok: false, message: 'Project id is required.' };
  var mime = String(mimeType || '').toLowerCase();
  if (mime.indexOf('image/') !== 0) {
    return { ok: false, message: 'Only image files can be attached as evidence.' };
  }
  var name = String(fileName || 'evidence').trim() || 'evidence';
  var b64 = String(base64Data || '').replace(/^data:[^;]+;base64,/, '');
  if (!b64) return { ok: false, message: 'File content is empty.' };
  var bytes;
  try {
    bytes = Utilities.base64Decode(b64);
  } catch (e) {
    return { ok: false, message: 'Could not decode file content.' };
  }
  if (!bytes || !bytes.length) return { ok: false, message: 'File content is empty.' };
  if (bytes.length > LB_MAX_EVIDENCE_BYTES_) {
    return { ok: false, message: 'File exceeds the 8 MB limit.' };
  }
  var folder;
  try {
    folder = lbResolveEvidenceFolder_();
  } catch (err) {
    return {
      ok: false,
      message: err && err.message ? String(err.message) : 'Drive folder not configured.',
    };
  }
  var blob = Utilities.newBlob(bytes, mime, name);
  var file;
  try {
    file = folder.createFile(blob);
    var subIt = folder.getFoldersByName(id);
    var sub = subIt.hasNext() ? subIt.next() : folder.createFolder(id);
    file.moveTo(sub);
  } catch (err2) {
    return {
      ok: false,
      message: err2 && err2.message ? String(err2.message) : 'Drive upload failed.',
    };
  }
  var ins = supabaseRest_('post', '/rest/v1/' + encodeURIComponent(LB_TABLE_EVIDENCE_), null, {
    project_id: id,
    drive_file_id: file.getId(),
    file_name: file.getName(),
    mime_type: file.getMimeType(),
    byte_size: bytes.length,
    uploaded_by_email: uploadedByEmail,
  }, { Prefer: 'return=representation' });
  if (!ins.ok) return { ok: false, message: ins.message || 'Could not save evidence metadata.' };
  return { ok: true, evidence: lbRows_(ins.json)[0] || null };
}

/**
 * @param {string} evidenceId
 * @return {!{ ok: boolean, message?: string }}
 */
function lbDeleteEvidence_(evidenceId) {
  var id = String(evidenceId || '').trim();
  if (!id) return { ok: false, message: 'Evidence id is required.' };
  var res = supabaseSelect_(LB_TABLE_EVIDENCE_, { id: 'eq.' + id }, '*', 1);
  if (!res.ok) return { ok: false, message: res.message || 'Could not load evidence.' };
  var row = lbRows_(res.json)[0];
  if (!row) return { ok: false, message: 'Evidence not found.' };
  if (row.drive_file_id) {
    try {
      DriveApp.getFileById(row.drive_file_id).setTrashed(true);
    } catch (e) {
      /* Drive delete is best-effort; still drop the Hub row. */
    }
  }
  var del = supabaseDelete_(LB_TABLE_EVIDENCE_, { id: 'eq.' + id });
  if (!del.ok) return { ok: false, message: del.message || 'Could not delete evidence.' };
  return { ok: true };
}

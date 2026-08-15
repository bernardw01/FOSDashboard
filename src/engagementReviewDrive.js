/**
 * PRD version 3.7.4 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 037: Drive storage for Engagement Review call recordings.
 */

/** @const {number} Max upload bytes (Apps Script-friendly). */
var ER_MAX_RECORDING_BYTES_ = 25 * 1024 * 1024;

/**
 * @return {GoogleAppsScript.Drive.Folder}
 */
function erResolveRecordingsFolder_() {
  var props = PropertiesService.getScriptProperties();
  var explicit = String(props.getProperty('ENGAGEMENT_REVIEW_DRIVE_FOLDER_ID') || '').trim();
  if (explicit) {
    return DriveApp.getFolderById(explicit);
  }
  var snapId = String(props.getProperty('FOS_SNAPSHOT_DRIVE_FOLDER_ID') || '').trim();
  if (!snapId) {
    throw new Error('ENGAGEMENT_REVIEW_DRIVE_FOLDER_ID or FOS_SNAPSHOT_DRIVE_FOLDER_ID required.');
  }
  var parent = DriveApp.getFolderById(snapId);
  var name = 'engagement-review-recordings';
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) {
    return it.next();
  }
  return parent.createFolder(name);
}

/**
 * @param {string} reviewId
 * @param {string} fileName
 * @param {string} mimeType
 * @param {string} base64Data
 * @param {string} uploadedByEmail
 * @return {!{ ok: boolean, message?: string, recording?: !Object }}
 */
function erUploadRecording_(reviewId, fileName, mimeType, base64Data, uploadedByEmail) {
  var id = String(reviewId || '').trim();
  if (!id) return { ok: false, message: 'Review id is required.' };
  var name = String(fileName || 'recording').trim() || 'recording';
  var mime = String(mimeType || 'application/octet-stream').trim();
  var b64 = String(base64Data || '').replace(/^data:[^;]+;base64,/, '');
  if (!b64) return { ok: false, message: 'File content is empty.' };

  var bytes;
  try {
    bytes = Utilities.base64Decode(b64);
  } catch (e) {
    return { ok: false, message: 'Could not decode file content.' };
  }
  if (!bytes || !bytes.length) {
    return { ok: false, message: 'File content is empty.' };
  }
  if (bytes.length > ER_MAX_RECORDING_BYTES_) {
    return {
      ok: false,
      message: 'File exceeds the ' + Math.round(ER_MAX_RECORDING_BYTES_ / (1024 * 1024)) + ' MB limit.',
    };
  }

  var folder;
  try {
    folder = erResolveRecordingsFolder_();
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
    // Nest under review id subfolder for hygiene.
    var subName = String(id);
    var subIt = folder.getFoldersByName(subName);
    var sub = subIt.hasNext() ? subIt.next() : folder.createFolder(subName);
    file.moveTo(sub);
  } catch (upErr) {
    return {
      ok: false,
      message:
        'Drive upload failed: ' + (upErr && upErr.message ? upErr.message : 'unknown error'),
    };
  }

  return erInsertRecording_({
    review_id: id,
    drive_file_id: file.getId(),
    file_name: file.getName(),
    mime_type: file.getMimeType(),
    byte_size: bytes.length,
    uploaded_by_email: uploadedByEmail,
  });
}

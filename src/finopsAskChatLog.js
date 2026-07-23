/**
 * PRD version 3.0.12 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 032 - Drive daily Ask AI chat archives:
 *   finops-ask-chats/YYYY/MM/YYYY-MM-DD.jsonl
 */

/** @const {number} */
var FINOPS_ASK_CHAT_LOG_LOCK_MS_ = 5000;

/**
 * @return {GoogleAppsScript.Drive.Folder}
 */
function finopsAskChatLogRootFolder_() {
  var props = PropertiesService.getScriptProperties();
  var explicit = (props.getProperty('FINOPS_ASK_DRIVE_FOLDER_ID') || '').trim();
  if (explicit) {
    return DriveApp.getFolderById(explicit);
  }
  var snapId = (props.getProperty('FOS_SNAPSHOT_DRIVE_FOLDER_ID') || '').trim();
  if (!snapId) {
    throw new Error('Set FINOPS_ASK_DRIVE_FOLDER_ID or FOS_SNAPSHOT_DRIVE_FOLDER_ID for Ask chat logs.');
  }
  var snap = DriveApp.getFolderById(snapId);
  var it = snap.getFoldersByName('finops-ask-chats');
  if (it.hasNext()) {
    return it.next();
  }
  return snap.createFolder('finops-ask-chats');
}

/**
 * @param {!GoogleAppsScript.Drive.Folder} parent
 * @param {string} name
 * @return {!GoogleAppsScript.Drive.Folder}
 */
function finopsAskEnsureChildFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) {
    return it.next();
  }
  return parent.createFolder(name);
}

/**
 * @param {!Object} record
 * @return {{ ok: boolean, message?: string, path?: string }}
 */
function finopsAskAppendChatLog_(record) {
  var lock = LockService.getScriptLock();
  var nest = beginScriptLockNest_(lock, FINOPS_ASK_CHAT_LOG_LOCK_MS_);
  try {
    var ymd = finopsAskTodayYmd_();
    var parts = ymd.split('-');
    var year = parts[0];
    var month = parts[1];
    var root = finopsAskChatLogRootFolder_();
    var yearFolder = finopsAskEnsureChildFolder_(root, year);
    var monthFolder = finopsAskEnsureChildFolder_(yearFolder, month);
    var fileName = ymd + '.jsonl';
    var line = JSON.stringify(record || {}) + '\n';
    var files = monthFolder.getFilesByName(fileName);
    var file;
    if (files.hasNext()) {
      file = files.next();
      var existing = file.getBlob().getDataAsString() || '';
      file.setContent(existing + line);
    } else {
      file = monthFolder.createFile(fileName, line, MimeType.PLAIN_TEXT);
    }
    return {
      ok: true,
      path: 'finops-ask-chats/' + year + '/' + month + '/' + fileName,
    };
  } catch (e) {
    var msg = e && e.message ? e.message : String(e);
    try {
      console.warn('finopsAskAppendChatLog_: ' + msg);
    } catch (_) {
      /* ignore */
    }
    return { ok: false, message: msg };
  } finally {
    endScriptLockNest_(nest);
  }
}

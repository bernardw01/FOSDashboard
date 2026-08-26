/**
 * PRD version 3.17.0 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Drive mirror helpers for bundled shell images (hero, logo). Apps Script
 * HtmlService serves HTTPS URLs efficiently; inline base64 in the initial HTML
 * bloats every page load (feature 047 workstream D1).
 */

/**
 * Parses a data URL into mime, base64 payload, and a file extension.
 *
 * @param {string} dataUrl
 * @return {{ mime: string, base64: string, extension: string }}
 * @private
 */
function parseShellImageDataUrl_(dataUrl) {
  var raw = String(dataUrl || '');
  var m = /^data:([^;,]+);base64,(.+)$/i.exec(raw);
  if (!m) {
    throw new Error('Invalid shell image data URL');
  }
  var mime = m[1].toLowerCase();
  var extension = 'bin';
  if (mime.indexOf('jpeg') >= 0 || mime.indexOf('jpg') >= 0) {
    extension = 'jpg';
  } else if (mime.indexOf('png') >= 0) {
    extension = 'png';
  } else if (mime.indexOf('webp') >= 0) {
    extension = 'webp';
  } else if (mime.indexOf('gif') >= 0) {
    extension = 'gif';
  } else if (mime.indexOf('svg') >= 0) {
    extension = 'svg';
  }
  return { mime: mime, base64: m[2], extension: extension };
}

/**
 * SHA-256 hex digest of decoded bytes.
 *
 * @param {string} base64
 * @return {string}
 * @private
 */
function shellImageContentHash_(base64) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.base64Decode(base64));
  return digest
    .map(function (b) {
      var n = b < 0 ? b + 256 : b;
      var h = n.toString(16);
      return h.length === 1 ? '0' + h : h;
    })
    .join('');
}

/**
 * Drive download URL with a file extension suffix for picky consumers.
 *
 * @param {string} fileId
 * @param {string} extension
 * @return {string}
 * @private
 */
function shellImageDriveUrl_(fileId, extension) {
  return (
    'https://drive.google.com/uc?id=' +
    encodeURIComponent(fileId) +
    '&.' +
    encodeURIComponent(extension || 'bin')
  );
}

/**
 * Creates or updates a public Drive mirror of bundled image bytes.
 *
 * @param {GoogleAppsScript.Base.Blob} blob
 * @param {string} hash
 * @param {string} fileIdProp
 * @param {string} hashProp
 * @param {GoogleAppsScript.Properties.Properties} props
 * @return {string} Drive file id
 * @private
 */
function ensureShellImageDriveMirror_(blob, hash, fileIdProp, hashProp, props) {
  var fileId = props.getProperty(fileIdProp);
  if (fileId) {
    try {
      var oldFile = DriveApp.getFileById(fileId);
      var folder = null;
      var parents = oldFile.getParents();
      if (parents.hasNext()) {
        folder = parents.next();
      }
      oldFile.setTrashed(true);
      var replacement = folder ? folder.createFile(blob) : DriveApp.createFile(blob);
      replacement.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      props.setProperty(fileIdProp, replacement.getId());
      props.setProperty(hashProp, hash);
      return replacement.getId();
    } catch (e) {
      /* fall through - create fresh */
    }
  }

  var created = DriveApp.createFile(blob);
  created.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  props.setProperty(fileIdProp, created.getId());
  props.setProperty(hashProp, hash);
  return created.getId();
}

/**
 * Returns an HTTPS Drive URL for a bundled data URL, mirroring on first use.
 * Falls back to the original data URL when Drive is unavailable.
 *
 * @param {string} dataUrl
 * @param {string} fileName
 * @param {string} fileIdProp
 * @param {string} hashProp
 * @return {string}
 * @private
 */
function getShellImageUrlForWebApp_(dataUrl, fileName, fileIdProp, hashProp) {
  try {
    var parsed = parseShellImageDataUrl_(dataUrl);
    var props = PropertiesService.getScriptProperties();
    var hash = shellImageContentHash_(parsed.base64);
    var storedHash = props.getProperty(hashProp);
    var fileId = props.getProperty(fileIdProp);
    var blob = Utilities.newBlob(Utilities.base64Decode(parsed.base64), parsed.mime, fileName);

    if (fileId && storedHash === hash) {
      try {
        DriveApp.getFileById(fileId);
        return shellImageDriveUrl_(fileId, parsed.extension);
      } catch (e) {
        fileId = null;
      }
    }

    fileId = ensureShellImageDriveMirror_(blob, hash, fileIdProp, hashProp, props);
    return shellImageDriveUrl_(fileId, parsed.extension);
  } catch (e) {
    try {
      console.warn(
        'getShellImageUrlForWebApp_: Drive mirror failed for ' +
          fileName +
          ': ' +
          (e && e.message ? e.message : e)
      );
    } catch (_) {
      /* ignore */
    }
    return dataUrl;
  }
}

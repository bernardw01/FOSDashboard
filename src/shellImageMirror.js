/**
 * PRD version 3.20.14 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Shell image helpers for the Web App (hero, logo). Feature 047 D1 moved images
 * out of inline base64 initially; Drive /uc and doGet ?asset= routes do not work
 * reliably in HtmlService img tags (403 / no session on cross-site img requests).
 * Logo and hero ship as inline data URLs again via getBrandLogoUrlForWebApp_ /
 * getHomeHeroImageUrlForWebApp_. doGet ?asset= routes remain for diagnostics.
 */

/**
 * Parses a data URL into mime, base64 payload, and a file extension.
 *
 * @param {string} dataUrl
 * @return {{ mime: string, base64: string, extension: string }}
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
 * Same-origin asset URL for img src (falls back to data URL in editor preview).
 *
 * @param {string} assetId
 * @param {string} dataUrlFallback
 * @return {string}
 */
function getWebAppShellAssetUrl_(assetId, dataUrlFallback) {
  try {
    var service = ScriptApp.getService();
    if (service) {
      var base = service.getUrl();
      if (base) {
        var sep = base.indexOf('?') >= 0 ? '&' : '?';
        return base + sep + 'asset=' + encodeURIComponent(String(assetId || ''));
      }
    }
  } catch (e) {
    /* HtmlService preview may not expose a deployment URL */
  }
  return String(dataUrlFallback || '');
}

/**
 * Blob for doGet asset routes (brand-logo, home-hero).
 *
 * @param {string} assetId
 * @return {GoogleAppsScript.Base.Blob|null}
 */
function getShellAssetBlobForDoGet_(assetId) {
  var id = String(assetId || '').trim();
  if (id === 'brand-logo') {
    return getBrandLogoBlob_();
  }
  if (id === 'home-hero') {
    return getHomeHeroImageBlob_();
  }
  return null;
}

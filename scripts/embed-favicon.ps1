# Regenerates src/faviconAsset.js from src/assets/favicon.svg.
# Run after replacing the SVG so doGet can call setFaviconUrl with a bundled data URL.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$svg = Join-Path $root 'src\assets\favicon.svg'
$out = Join-Path $root 'src\faviconAsset.js'
if (-not (Test-Path $svg)) {
  Write-Error "Missing $svg"
}
$bytes = [IO.File]::ReadAllBytes($svg)
$b64 = [Convert]::ToBase64String($bytes)
$dataUrl = "data:image/svg+xml;base64,$b64"
$js = @"
/**
 * PRD version 2.6.10 - sync with docs/FOS-Dashboard-PRD.md
 *
 * harpin favicon as a data URL for HtmlOutput.setFaviconUrl (no external CDN).
 * Source: src/assets/favicon.svg (from harpin.ai brand asset).
 * Regenerate: powershell -File scripts/embed-favicon.ps1
 */

/** @const {string} */
var FOS_FAVICON_DATA_URL_ = '$dataUrl';

/**
 * @return {string}
 */
function getFaviconDataUrl_() {
  return FOS_FAVICON_DATA_URL_;
}

"@
[System.IO.File]::WriteAllText($out, $js)
Write-Host "Wrote $out ($($b64.Length) base64 chars from favicon.svg)"

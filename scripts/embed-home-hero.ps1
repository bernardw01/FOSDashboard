# Regenerates src/homeHeroImage.js from src/assets/home-hero-deap.png.
# Run after replacing the PNG so the Web App serves the updated image (Apps Script
# has no static file URLs for HtmlService CSS backgrounds).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$png = Join-Path $root 'src\assets\home-hero-deap.png'
$out = Join-Path $root 'src\homeHeroImage.js'
if (-not (Test-Path $png)) {
  Write-Error "Missing $png"
}
$bytes = [IO.File]::ReadAllBytes($png)
$b64 = [Convert]::ToBase64String($bytes)
$mime = 'image/png'
if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xD8) {
  $mime = 'image/jpeg'
} elseif ($bytes.Length -ge 4 -and $bytes[0] -eq 0x89 -and $bytes[1] -eq 0x50) {
  $mime = 'image/png'
}
$dataUrl = "data:$mime;base64,$b64"
$js = @"
/**
 * PRD version 2.6.5 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Home hero background image as a data URL (loaded via google.script.run, not inline template).
 * Source file: src/assets/home-hero-deap.png
 * Regenerate: powershell -File scripts/embed-home-hero.ps1
 */

/** @const {string} */
var HOME_HERO_IMAGE_DATA_URL_ = '$dataUrl';

/**
 * @return {string}
 */
function getHomeHeroImageDataUrl_() {
  return HOME_HERO_IMAGE_DATA_URL_;
}

/**
 * Client-callable hero image (large payload; do not inject into HtmlService template).
 * @return {string}
 */
function getHomeHeroImageDataUrl() {
  requireAuthForApi_();
  return getHomeHeroImageDataUrl_();
}

"@
[System.IO.File]::WriteAllText($out, $js)
Write-Host "Wrote $out ($($b64.Length) base64 chars from $(Split-Path $png -Leaf))"

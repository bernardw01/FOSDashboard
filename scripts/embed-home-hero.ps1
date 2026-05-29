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
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($png))
$js = @"
/**
 * PRD version 2.6.4 — sync with docs/FOS-Dashboard-PRD.md
 *
 * Home hero background image as a data URL for HtmlService (no static asset URLs).
 * Source PNG: src/assets/home-hero-deap.png
 * Regenerate: powershell -File scripts/embed-home-hero.ps1
 */

/** @const {string} */
var HOME_HERO_IMAGE_DATA_URL_ = 'data:image/png;base64,$b64';

/**
 * @return {string}
 */
function getHomeHeroImageDataUrl_() {
  return HOME_HERO_IMAGE_DATA_URL_;
}

"@
[System.IO.File]::WriteAllText($out, $js)
Write-Host "Wrote $out ($($b64.Length) base64 chars from $(Split-Path $png -Leaf))"

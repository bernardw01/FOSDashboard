# Regenerates src/faviconAsset.js from src/assets/favicon.png.
# Source art: src/assets/favicon.svg (rasterized here). Apps Script setFaviconUrl
# accepts PNG/ICO/GIF only — not SVG data URLs.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$svg = Join-Path $root 'src\assets\favicon.svg'
$png = Join-Path $root 'src\assets\favicon.png'
$out = Join-Path $root 'src\faviconAsset.js'

function Ensure-FaviconPng_ {
  param([string]$SvgPath, [string]$PngPath)
  $needRaster = -not (Test-Path $PngPath)
  if (-not $needRaster -and (Test-Path $SvgPath)) {
    $needRaster = (Get-Item $SvgPath).LastWriteTimeUtc -gt (Get-Item $PngPath).LastWriteTimeUtc
  }
  if (-not $needRaster) { return }
  if (-not (Test-Path $SvgPath)) {
    Write-Error "Missing $SvgPath (and no $PngPath to embed)"
  }
  $npx = Get-Command npx -ErrorAction SilentlyContinue
  if (-not $npx) {
    Write-Error "favicon.png is missing or older than favicon.svg; install Node.js and run: npx @resvg/resvg-js-cli `"$SvgPath`" `"$PngPath`" --fit-width 32"
  }
  & npx --yes @resvg/resvg-js-cli $SvgPath $PngPath --fit-width 32
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $PngPath)) {
    Write-Error "Failed to rasterize $SvgPath to $PngPath"
  }
  Write-Host "Rasterized $SvgPath -> $PngPath"
}

Ensure-FaviconPng_ -SvgPath $svg -PngPath $png

$bytes = [IO.File]::ReadAllBytes($png)
$b64 = [Convert]::ToBase64String($bytes)
$dataUrl = "data:image/png;base64,$b64"
$js = @"
/**
 * PRD version 2.6.11 - sync with docs/FOS-Dashboard-PRD.md
 *
 * harpin favicon as a PNG data URL for HtmlOutput.setFaviconUrl (no external CDN).
 * Apps Script does not support SVG favicons — source SVG is rasterized to favicon.png.
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
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($out, $js, $utf8NoBom)
Write-Host "Wrote $out ($($b64.Length) base64 chars from favicon.png)"

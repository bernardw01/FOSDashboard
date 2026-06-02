# Regenerates src/faviconAsset.js from src/assets/favicon.png.
# Source art: src/assets/favicon.svg (rasterized here). Tab icon uses HtmlOutput.setFaviconUrl
# with a Drive mirror URL (Apps Script ignores <link rel="icon"> in HTML files).
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

# Preserve hand-written Drive mirror helpers after the base64 constant.
$existing = Get-Content -Raw $out -ErrorAction SilentlyContinue
$helperStart = $existing.IndexOf('/** @const {string} Script property: Drive file id')
if ($helperStart -lt 0) {
  Write-Error "Could not find Drive mirror helpers in $out — restore faviconAsset.js from git and re-run."
}
$helpers = $existing.Substring($helperStart)

$header = @"
/**
 * PRD version 2.6.15 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Bundled favicon PNG bytes (base64). Mirrored to Drive for HtmlOutput.setFaviconUrl
 * (Apps Script ignores <link rel="icon"> in HTML files and rejects data: URLs).
 * Regenerate: powershell -File scripts/embed-favicon.ps1
 */

/** @const {string} */
var FOS_FAVICON_PNG_BASE64_ = '$b64';

"@

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($out, ($header + $helpers), $utf8NoBom)
Write-Host "Wrote $out ($($b64.Length) base64 chars from favicon.png)"

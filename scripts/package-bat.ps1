$ErrorActionPreference = 'Stop'

$workspace = Split-Path -Parent $PSScriptRoot
$distPath = Join-Path $workspace 'dist'
$releasePath = Join-Path $workspace 'release'
$sitePath = Join-Path $releasePath 'site'
$serveScriptSource = Join-Path $PSScriptRoot 'serve-site.ps1'
$serveScriptTarget = Join-Path $releasePath 'serve-site.ps1'

if (-not (Test-Path -LiteralPath $distPath)) {
  throw "dist folder not found. Run npm run build first."
}

if (Test-Path -LiteralPath $releasePath) {
  Remove-Item -LiteralPath $releasePath -Recurse -Force
}

New-Item -ItemType Directory -Path $releasePath | Out-Null
Copy-Item -LiteralPath $distPath -Destination $sitePath -Recurse
Copy-Item -LiteralPath $serveScriptSource -Destination $serveScriptTarget -Force

$launcher = @'
@echo off
setlocal
set "ROOT=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%serve-site.ps1" -Root "%ROOT%site" -Port 4173
'@

Set-Content -LiteralPath (Join-Path $releasePath 'open-site.bat') -Value $launcher -Encoding ASCII

$readme = @'
Packaging output:
- site\ : website static files
- open-site.bat : double-click to launch the local site
- serve-site.ps1 : local static server used by the BAT launcher
Notes:
- Keep the PowerShell window open while using the local site
- The BAT launcher keeps the site on a trusted local origin, so PWA caching and offline support still work
'@

Set-Content -LiteralPath (Join-Path $releasePath 'README.txt') -Value $readme -Encoding UTF8

Write-Host "Created BAT launcher: $(Join-Path $releasePath 'open-site.bat')"
Write-Host "Created local site directory: $sitePath"

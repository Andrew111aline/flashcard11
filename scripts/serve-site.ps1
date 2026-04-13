param(
  [string]$Root = (Join-Path $PSScriptRoot 'site'),
  [int]$Port = 4173
)

$ErrorActionPreference = 'Stop'

function Get-ContentType([string]$Path) {
  switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    '.html' { 'text/html; charset=utf-8' }
    '.js' { 'application/javascript; charset=utf-8' }
    '.css' { 'text/css; charset=utf-8' }
    '.json' { 'application/json; charset=utf-8' }
    '.webmanifest' { 'application/manifest+json; charset=utf-8' }
    '.png' { 'image/png' }
    '.jpg' { 'image/jpeg' }
    '.jpeg' { 'image/jpeg' }
    '.svg' { 'image/svg+xml' }
    '.ico' { 'image/x-icon' }
    '.woff2' { 'font/woff2' }
    default { 'application/octet-stream' }
  }
}

function Resolve-RequestPath([string]$BaseRoot, [string]$RequestPath) {
  $relative = [System.Uri]::UnescapeDataString($RequestPath.TrimStart('/')).Replace('/', '\')
  if ([string]::IsNullOrWhiteSpace($relative)) {
    $relative = 'index.html'
  }

  $candidate = Join-Path $BaseRoot $relative
  if (Test-Path -LiteralPath $candidate -PathType Container) {
    $candidate = Join-Path $candidate 'index.html'
  }

  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
    $candidate = Join-Path $BaseRoot 'index.html'
  }

  return $candidate
}

$resolvedRoot = [System.IO.Path]::GetFullPath($Root)
if (-not (Test-Path -LiteralPath $resolvedRoot -PathType Container)) {
  throw "Site root not found: $resolvedRoot"
}

$prefix = "http://127.0.0.1:$Port/"
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($prefix)

try {
  $listener.Start()
} catch {
  Start-Process $prefix
  Write-Host "Port $Port is already in use. Opened $prefix instead."
  exit 0
}

Start-Process $prefix
Write-Host "Serving $resolvedRoot at $prefix"
Write-Host 'Close this window to stop the local site.'

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      $response = $context.Response
      $filePath = Resolve-RequestPath -BaseRoot $resolvedRoot -RequestPath $context.Request.Url.AbsolutePath
      $resolvedFile = [System.IO.Path]::GetFullPath($filePath)

      if (-not $resolvedFile.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        $response.StatusCode = 403
        $response.Close()
        continue
      }

      $bytes = [System.IO.File]::ReadAllBytes($resolvedFile)
      $response.StatusCode = 200
      $response.ContentType = Get-ContentType -Path $resolvedFile
      $response.ContentLength64 = $bytes.Length
      $response.AddHeader('Cache-Control', 'no-cache')
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
      $response.OutputStream.Close()
    } catch {
      try {
        $context.Response.StatusCode = 500
        $message = [System.Text.Encoding]::UTF8.GetBytes('Internal Server Error')
        $context.Response.OutputStream.Write($message, 0, $message.Length)
        $context.Response.OutputStream.Close()
      } catch {
      }
    }
  }
} finally {
  if ($listener.IsListening) {
    $listener.Stop()
  }
  $listener.Close()
}

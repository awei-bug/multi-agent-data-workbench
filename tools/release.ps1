param(
  [string]$ImagePrefix = "workbench",
  [string]$Tag = "",
  [switch]$Push,
  [switch]$Deploy,
  [string]$EnvFile = ".env",
  [string]$Registry = "",
  [string]$Username = "",
  [string]$Password = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Get-GitVersion {
  $tag = ""
  try {
    $tag = (git describe --tags --exact-match 2>$null)
  } catch {
    $tag = ""
  }
  if ($tag) { return $tag.Trim() }

  $sha = ""
  try {
    $sha = (git rev-parse --short HEAD 2>$null)
  } catch {
    $sha = ""
  }
  if ($sha) { return "sha-$($sha.Trim())" }
  return "local"
}

if (-not $Tag) {
  $Tag = Get-GitVersion
}

$backendImage = "$ImagePrefix/backend:$Tag"
$frontendImage = "$ImagePrefix/frontend:$Tag"

Write-Host "Release version: $Tag"
Write-Host "Backend image : $backendImage"
Write-Host "Frontend image: $frontendImage"
Write-Host "Worker image  : $backendImage"

Write-Host "`n[1/4] Build backend image..."
docker build -t $backendImage -f backend/Dockerfile backend
if ($LASTEXITCODE -ne 0) { throw "backend image build failed" }

Write-Host "`n[2/4] Build frontend image..."
docker build -t $frontendImage -f frontend/Dockerfile frontend
if ($LASTEXITCODE -ne 0) { throw "frontend image build failed" }

if ($Push) {
  if ($Registry -and $Username -and $Password) {
    Write-Host "`nLogin registry: $Registry"
    $Password | docker login $Registry -u $Username --password-stdin
    if ($LASTEXITCODE -ne 0) { throw "docker login failed" }
  }

  Write-Host "`n[3/4] Push images..."
  docker push $backendImage
  if ($LASTEXITCODE -ne 0) { throw "backend push failed" }
  docker push $frontendImage
  if ($LASTEXITCODE -ne 0) { throw "frontend push failed" }
} else {
  Write-Host "`n[3/4] Skip push (use -Push to enable)"
}

$manifestDir = Join-Path $root "dist"
New-Item -ItemType Directory -Force -Path $manifestDir | Out-Null
$manifestPath = Join-Path $manifestDir "release-manifest.json"
$manifest = @{
  version = $Tag
  imagePrefix = $ImagePrefix
  images = @{
    backend = $backendImage
    frontend = $frontendImage
    worker = $backendImage
  }
  pushed = [bool]$Push
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  composeFile = "docker-compose.release.yml"
} | ConvertTo-Json -Depth 5
Set-Content -Path $manifestPath -Value $manifest -Encoding UTF8
Write-Host "`nManifest written: $manifestPath"

if ($Deploy) {
  Write-Host "`n[4/4] Deploy with docker-compose.release.yml..."
  $env:IMAGE_PREFIX = $ImagePrefix
  $env:IMAGE_TAG = $Tag
  $composeArgs = @("-f", "docker-compose.release.yml")
  if (Test-Path $EnvFile) {
    $composeArgs += @("--env-file", $EnvFile)
  }
  $composeArgs += @("up", "-d")
  docker compose @composeArgs
  if ($LASTEXITCODE -ne 0) { throw "compose deploy failed" }
  Write-Host "Deployed. Check: docker compose -f docker-compose.release.yml ps"
} else {
  Write-Host "`n[4/4] Skip deploy (use -Deploy to enable)"
  Write-Host "Example deploy:"
  Write-Host "  `$env:IMAGE_PREFIX='$ImagePrefix'; `$env:IMAGE_TAG='$Tag'"
  Write-Host "  docker compose -f docker-compose.release.yml --env-file .env up -d"
}

Write-Host "`nRelease complete."

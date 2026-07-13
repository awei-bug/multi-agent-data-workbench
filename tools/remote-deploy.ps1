param(
  [Parameter(Mandatory = $true)][string]$ImagePrefix,
  [Parameter(Mandatory = $true)][string]$Tag,
  [string]$EnvFile = ".env",
  [string]$ComposeFile = "docker-compose.release.yml",
  [string]$HealthUrl = "http://127.0.0.1:8787/api/health/ready",
  [int]$HealthRetries = 30,
  [int]$HealthIntervalSeconds = 2,
  [string]$Registry = "ghcr.io",
  [string]$RegistryUser = "",
  [string]$RegistryToken = "",
  [switch]$SkipLogin,
  [switch]$SkipPull
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path $ComposeFile)) {
  throw "Compose file not found: $ComposeFile"
}

$env:IMAGE_PREFIX = $ImagePrefix
$env:IMAGE_TAG = $Tag

Write-Host "==> Deploy configuration"
Write-Host "    IMAGE_PREFIX=$ImagePrefix"
Write-Host "    IMAGE_TAG=$Tag"
Write-Host "    COMPOSE_FILE=$ComposeFile"
Write-Host "    ENV_FILE=$EnvFile"
Write-Host "    HEALTH_URL=$HealthUrl"

if (-not $SkipLogin -and $RegistryUser -and $RegistryToken) {
  Write-Host "==> Login registry: $Registry"
  $RegistryToken | docker login $Registry -u $RegistryUser --password-stdin
  if ($LASTEXITCODE -ne 0) { throw "docker login failed" }
}

$composeArgs = @("-f", $ComposeFile)
if (Test-Path $EnvFile) {
  $composeArgs += @("--env-file", $EnvFile)
} else {
  Write-Host "Warning: env file not found ($EnvFile), continue with process env only"
}

if (-not $SkipPull) {
  Write-Host "==> Pull images"
  docker compose @composeArgs pull
  if ($LASTEXITCODE -ne 0) { throw "compose pull failed" }
}

Write-Host "==> Start/update services"
docker compose @composeArgs up -d --remove-orphans
if ($LASTEXITCODE -ne 0) { throw "compose up failed" }

Write-Host "==> Service status"
docker compose @composeArgs ps

Write-Host "==> Health check: $HealthUrl"
$ok = $false
for ($i = 1; $i -le $HealthRetries; $i++) {
  try {
    $resp = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 5
    if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300) {
      Write-Host "Health check passed on attempt $i"
      Write-Host $resp.Content
      $ok = $true
      break
    }
  } catch {
    Write-Host "Attempt $i/$HealthRetries failed, retry in ${HealthIntervalSeconds}s..."
  }
  Start-Sleep -Seconds $HealthIntervalSeconds
}

if (-not $ok) {
  docker compose @composeArgs ps
  docker compose @composeArgs logs --tail=100 backend worker
  throw "Health check failed after $HealthRetries attempts"
}

$manifestDir = Join-Path $root "dist"
New-Item -ItemType Directory -Force -Path $manifestDir | Out-Null
$result = @{
  imagePrefix = $ImagePrefix
  imageTag = $Tag
  composeFile = $ComposeFile
  envFile = $EnvFile
  healthUrl = $HealthUrl
  deployedAt = (Get-Date).ToUniversalTime().ToString("o")
  status = "ok"
} | ConvertTo-Json -Depth 5
Set-Content -Path (Join-Path $manifestDir "deploy-result.json") -Value $result -Encoding UTF8

Write-Host "==> Deploy complete"
Write-Host "    Result: dist/deploy-result.json"

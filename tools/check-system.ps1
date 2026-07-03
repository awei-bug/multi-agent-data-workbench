$ErrorActionPreference = 'Stop'

$apiHost = if ($env:WORKSPACE_API_HOST) { $env:WORKSPACE_API_HOST } else { '127.0.0.1' }
$frontendHost = if ($env:WORKSPACE_WEB_HOST) { $env:WORKSPACE_WEB_HOST } else { '127.0.0.1' }
$backendPort = if ($env:WORKSPACE_API_PORT) { $env:WORKSPACE_API_PORT } else { '8787' }
$frontendPort = if ($env:WORKSPACE_WEB_PORT) { $env:WORKSPACE_WEB_PORT } else { '5174' }

function Read-Json {
  param([string]$Url)
  Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 8
}

$frontend = Invoke-WebRequest -Uri "http://$frontendHost`:$frontendPort/" -UseBasicParsing -TimeoutSec 8
$health = Read-Json -Url "http://$apiHost`:$backendPort/api/health"

if ($frontend.StatusCode -ne 200) {
  throw "Frontend unhealthy: HTTP $($frontend.StatusCode)"
}

if ($health.status -ne 'ok' -or -not $health.database.ok) {
  throw "Backend unhealthy: $($health | ConvertTo-Json -Depth 5)"
}

Write-Output "frontend=ok http://$frontendHost`:$frontendPort/"
Write-Output "backend=ok http://$apiHost`:$backendPort/api/health"
Write-Output "database=$($health.database.type)"
Write-Output "model=$($health.model.name)"

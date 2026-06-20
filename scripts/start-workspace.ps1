$ErrorActionPreference = 'Stop'

$workspace = Split-Path -Parent $PSScriptRoot
Set-Location $workspace

$frontendPort = 5174
$backendPort = 8787
$databaseUrl = if ($env:WORKSPACE_DATABASE_URL) { $env:WORKSPACE_DATABASE_URL } else { 'postgresql://postgres:123456@127.0.0.1:5432/workbench' }
$apiHost = if ($env:WORKSPACE_API_HOST) { $env:WORKSPACE_API_HOST } else { '127.0.0.1' }
$frontendHost = if ($env:WORKSPACE_WEB_HOST) { $env:WORKSPACE_WEB_HOST } else { '127.0.0.1' }

function Stop-PortProcess {
  param([int]$Port)

  $lines = netstat -ano | Select-String ":$Port"
  foreach ($line in $lines) {
    $parts = ($line -replace '\s+', ' ').Trim().Split(' ')
    $targetPid = $parts[-1]
    if ($targetPid -match '^[0-9]+$') {
      try {
        Stop-Process -Id ([int]$targetPid) -Force -ErrorAction Stop
      } catch {
      }
    }
  }
}

foreach ($file in @('backend-api.out.log', 'backend-api.err.log', 'frontend-vite.out.log', 'frontend-vite.err.log')) {
  if (Test-Path $file) {
    Remove-Item -Force $file
  }
}

Stop-PortProcess -Port $frontendPort
Stop-PortProcess -Port $backendPort
Start-Sleep -Seconds 2

$env:WORKSPACE_DATABASE_URL = $databaseUrl
$env:WORKSPACE_API_PORT = "$backendPort"
$env:WORKSPACE_API_HOST = $apiHost
$env:BROWSER = 'none'

$pythonExe = $null
$pythonArgs = @('scripts/start-workspace-api.py')

if (Test-Path 'D:\学习\Anaconda\python.exe') {
  $pythonExe = 'D:\学习\Anaconda\python.exe'
} else {
  $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
  if ($pythonCommand) {
    $pythonExe = $pythonCommand.Source
  }
}

if (-not $pythonExe) {
  throw 'Python executable not found.'
}

$backend = Start-Process -FilePath $pythonExe -ArgumentList $pythonArgs -WorkingDirectory $workspace -WindowStyle Hidden -RedirectStandardOutput 'backend-api.out.log' -RedirectStandardError 'backend-api.err.log' -PassThru
$frontend = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'dev', '--', '--host', $frontendHost, '--port', "$frontendPort") -WorkingDirectory $workspace -WindowStyle Hidden -RedirectStandardOutput 'frontend-vite.out.log' -RedirectStandardError 'frontend-vite.err.log' -PassThru

Start-Sleep -Seconds 8

$frontendStatus = try { (Invoke-WebRequest -Uri "http://$frontendHost`:$frontendPort/" -UseBasicParsing -TimeoutSec 5).StatusCode } catch { $_.Exception.Message }
$backendStatus = try { Invoke-RestMethod -Uri "http://$apiHost`:$backendPort/api/active-task" -Method Get -TimeoutSec 5 | ConvertTo-Json -Depth 3 } catch { $_.Exception.Message }

Write-Output "frontend_pid=$($frontend.Id)"
Write-Output "backend_pid=$($backend.Id)"
Write-Output "frontend_status=$frontendStatus"
Write-Output "backend_status=$backendStatus"

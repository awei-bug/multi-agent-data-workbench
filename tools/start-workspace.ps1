$ErrorActionPreference = 'Stop'

$workspace = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $workspace 'backend'
$frontendDir = Join-Path $workspace 'frontend'
Set-Location $workspace

function Import-DotEnv {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return
  }

  Get-Content -Path $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#') -or -not $line.Contains('=')) {
      return
    }

    $parts = $line.Split('=', 2)
    $name = $parts[0].Trim()
    $value = $parts[1].Trim().Trim('"').Trim("'")
    if ($name) {
      Set-Item -Path "Env:$name" -Value $value
    }
  }
}

Import-DotEnv -Path (Join-Path $workspace '.env')

$frontendPort = 5174
$backendPort = 8787
$databaseUrl = if ($env:WORKSPACE_DATABASE_URL) { $env:WORKSPACE_DATABASE_URL } else { 'postgresql://postgres:123456@127.0.0.1:5432/workbench' }
$apiHost = if ($env:WORKSPACE_API_HOST) { $env:WORKSPACE_API_HOST } else { '127.0.0.1' }
$frontendHost = if ($env:WORKSPACE_WEB_HOST) { $env:WORKSPACE_WEB_HOST } else { '127.0.0.1' }

function Assert-PathExists {
  param([string]$Path, [string]$Message)

  if (-not (Test-Path $Path)) {
    throw $Message
  }
}

Assert-PathExists -Path $backendDir -Message "Backend directory not found: $backendDir"
Assert-PathExists -Path $frontendDir -Message "Frontend directory not found: $frontendDir"
Assert-PathExists -Path (Join-Path $backendDir 'start-workspace-api.py') -Message 'Backend entrypoint missing: backend\start-workspace-api.py'
Assert-PathExists -Path (Join-Path $backendDir 'requirements.txt') -Message 'Backend requirements missing: backend\requirements.txt'
Assert-PathExists -Path (Join-Path $frontendDir 'package.json') -Message 'Frontend package missing: frontend\package.json'

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw 'npm.cmd not found. Install Node.js or add npm to PATH.'
}

if (-not ($env:AGNES_API_KEY -or $env:OPENAI_API_KEY -or $env:APIHUB_API_KEY)) {
  throw 'Missing model API key. Set AGNES_API_KEY, OPENAI_API_KEY, or APIHUB_API_KEY.'
}

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

function Test-HttpOk {
  param([string]$Url, [string]$Name)

  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 8
    if ($response.StatusCode -ne 200) {
      throw "$Name returned HTTP $($response.StatusCode)"
    }
    return $response.StatusCode
  } catch {
    $backendError = Get-LogTail -Path (Join-Path $workspace 'backend-api.err.log')
    $frontendError = Get-LogTail -Path (Join-Path $workspace 'frontend-vite.err.log')
    throw "$Name is not reachable at $Url. $($_.Exception.Message)`nbackend-api.err.log:`n$backendError`nfrontend-vite.err.log:`n$frontendError"
  }
}

function Get-LogTail {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return '(log file not created)'
  }

  $content = Get-Content -Path $Path -Tail 30 -ErrorAction SilentlyContinue
  if (-not $content) {
    return '(log file is empty)'
  }

  return ($content -join "`n")
}

function Test-TcpReachable {
  param([string]$HostName, [int]$Port, [string]$Name)

  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $connect = $client.ConnectAsync($HostName, $Port)
    if (-not $connect.Wait(1500) -or -not $client.Connected) {
      throw "$Name is not reachable at $HostName`:$Port"
    }
  } finally {
    $client.Dispose()
  }
}

function Test-DatabaseReachable {
  param([string]$DatabaseUrl)

  if (-not $DatabaseUrl.StartsWith('postgresql://') -and -not $DatabaseUrl.StartsWith('postgres://')) {
    return
  }

  try {
    $uri = [Uri]$DatabaseUrl
    $port = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
    Test-TcpReachable -HostName $uri.Host -Port $port -Name 'PostgreSQL'
  } catch {
    throw "PostgreSQL preflight failed. Check WORKSPACE_DATABASE_URL or start PostgreSQL first. $($_.Exception.Message)"
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

Test-DatabaseReachable -DatabaseUrl $databaseUrl

$env:WORKSPACE_DATABASE_URL = $databaseUrl
$env:WORKSPACE_API_PORT = "$backendPort"
$env:WORKSPACE_API_HOST = $apiHost
$env:BROWSER = 'none'

$pythonExe = $null
$pythonArgs = @('start-workspace-api.py')

if (Get-Command py -ErrorAction SilentlyContinue) {
  $pythonExe = 'py'
} elseif (Test-Path 'D:\学习\Anaconda\python.exe') {
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

$backend = Start-Process -FilePath $pythonExe -ArgumentList $pythonArgs -WorkingDirectory $backendDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $workspace 'backend-api.out.log') -RedirectStandardError (Join-Path $workspace 'backend-api.err.log') -PassThru
$frontend = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'dev', '--', '--host', $frontendHost, '--port', "$frontendPort") -WorkingDirectory $frontendDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $workspace 'frontend-vite.out.log') -RedirectStandardError (Join-Path $workspace 'frontend-vite.err.log') -PassThru

Start-Sleep -Seconds 8

$frontendStatus = Test-HttpOk -Url "http://$frontendHost`:$frontendPort/" -Name 'Frontend'
$backendStatus = Test-HttpOk -Url "http://$apiHost`:$backendPort/api/health" -Name 'Backend health'

Write-Output "frontend_pid=$($frontend.Id)"
Write-Output "backend_pid=$($backend.Id)"
Write-Output "frontend_status=$frontendStatus"
Write-Output "backend_status=$backendStatus"

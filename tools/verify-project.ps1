$ErrorActionPreference = 'Stop'

$workspace = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $workspace 'backend'
$frontendDir = Join-Path $workspace 'frontend'
$pythonExe = Join-Path $workspace '.venv\Scripts\python.exe'

if (-not (Test-Path $pythonExe)) {
  throw 'Python virtual environment missing. Run: py -m venv .venv; .\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt'
}

function Run-Step {
  param([string]$Name, [scriptblock]$Command)

  Write-Output "==> $Name"
  & $Command
}

function Run-Native {
  param([string]$FilePath, [string[]]$Arguments)

  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "$FilePath failed with exit code $LASTEXITCODE"
    }
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
}

Run-Step 'backend tests' {
  Push-Location $backendDir
  try {
    Run-Native $pythonExe @('-m', 'unittest', 'tests.test_agnes_client', 'tests.test_config', 'tests.test_migrations', 'tests.test_workspace_api', 'tests.test_workflow_service')
  } finally {
    Pop-Location
  }
}

Run-Step 'frontend tests' {
  Push-Location $frontendDir
  try {
    Run-Native 'npm.cmd' @('test', '--', '--reporter=dot')
  } finally {
    Pop-Location
  }
}

Run-Step 'frontend build' {
  Push-Location $frontendDir
  try {
    Run-Native 'npm.cmd' @('run', 'build')
  } finally {
    Pop-Location
  }
}

Write-Output 'verify=ok'

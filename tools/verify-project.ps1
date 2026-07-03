$ErrorActionPreference = 'Stop'

$workspace = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $workspace 'backend'
$frontendDir = Join-Path $workspace 'frontend'

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
    Run-Native 'py' @('-m', 'unittest', 'tests.test_config', 'tests.test_migrations', 'tests.test_workspace_api', 'tests.test_workflow_service')
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

foreach ($target in @('frontend\dist', 'backend\backend_py\__pycache__', 'backend\tests\__pycache__')) {
  $path = Join-Path $workspace $target
  if (Test-Path $path) {
    Remove-Item -LiteralPath $path -Recurse -Force
  }
}

Get-ChildItem -Path $workspace -Recurse -Force -Directory -Filter __pycache__ -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notlike '*\node_modules\*' } |
  Remove-Item -Recurse -Force

Get-ChildItem -Path $workspace -Recurse -Force -Include *.pyc,*.tsbuildinfo -ErrorAction SilentlyContinue | Remove-Item -Force

Write-Output 'verify=ok'

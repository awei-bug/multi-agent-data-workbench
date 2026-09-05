# Install Playwright into this project's virtualenv and download Chromium.
# Usage (from repo root in PowerShell):
#   powershell -ExecutionPolicy Bypass -File tools/install-playwright.ps1

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

$Py = Join-Path $RootDir ".venv\Scripts\python.exe"
if (-not (Test-Path $Py)) {
  Write-Host "[install-playwright] .venv not found. Create it first: python -m venv .venv"
  exit 1
}

Write-Host "[install-playwright] using: $Py"
& $Py -m pip install -U pip
& $Py -m pip install "playwright==1.49.1"
& $Py -m playwright install chromium

Write-Host "[install-playwright] verifying..."
& $Py -c "from playwright.sync_api import sync_playwright; print('playwright-ready'); p=sync_playwright().start(); b=p.chromium.launch(headless=True); b.close(); p.stop(); print('chromium-ready')"

Write-Host "[install-playwright] done. Restart backend, then enable browser rendering in Smart Scrape."

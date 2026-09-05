#!/usr/bin/env bash
set -euo pipefail

# Install Playwright into this project's virtualenv and download Chromium.
# Usage (from repo root):
#   bash tools/install-playwright.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -x "$ROOT_DIR/.venv/Scripts/python.exe" ]]; then
  PY="$ROOT_DIR/.venv/Scripts/python.exe"
elif [[ -x "$ROOT_DIR/.venv/bin/python" ]]; then
  PY="$ROOT_DIR/.venv/bin/python"
else
  echo "[install-playwright] .venv not found. Create it first:"
  echo "  python -m venv .venv"
  exit 1
fi

echo "[install-playwright] using: $PY"
"$PY" -m pip install -U pip
"$PY" -m pip install "playwright==1.49.1"
"$PY" -m playwright install chromium

echo "[install-playwright] verifying import..."
"$PY" - <<'PY'
from playwright.sync_api import sync_playwright
print("playwright-ready")
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    browser.close()
print("chromium-ready")
PY

echo "[install-playwright] done. Restart backend, then enable '浏览器渲染' in Smart Scrape."

@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where powershell.exe >nul 2>&1 || goto no_powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start-workspace.ps1"
if errorlevel 1 goto failed

start "" "http://127.0.0.1:5174/dashboard"
echo [OK] Workspace is running at http://127.0.0.1:5174/dashboard
pause
exit /b 0

:no_powershell
echo [ERROR] PowerShell was not found.
pause
exit /b 1

:failed
echo [ERROR] Startup failed. Check the error above and the project log files.
pause
exit /b 1

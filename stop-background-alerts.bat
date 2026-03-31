@echo off
title ExamRigor — Stop Background Alerts
cd /d "%~dp0"

echo ============================================================
echo   ExamRigor — Stopping Background Alert Service
echo ============================================================
echo.

if not exist "bg-notifier.pid" (
    echo [INFO] No running instance found (no PID file).
    echo        Trying to kill any stray node processes running bg-notifier...
    wmic process where "commandline like '%%bg-notifier.cjs%%'" delete >nul 2>&1
    wmic process where "commandline like '%%bg-notifier.js%%'"  delete >nul 2>&1
    echo [DONE] Cleanup complete.
    pause
    exit /b 0
)

set /p PID=<bg-notifier.pid

echo [INFO] Found PID: %PID%
echo [INFO] Stopping process...

taskkill /PID %PID% /F >nul 2>&1

if errorlevel 1 (
    echo [WARN] Process already stopped or could not be found.
) else (
    echo [OK]  Process %PID% terminated successfully.
)

REM Clean up PID file
if exist "bg-notifier.pid" del "bg-notifier.pid"

echo.
echo [DONE] Background alerts stopped.
echo        Run start-background-alerts.bat to restart.
echo.
pause

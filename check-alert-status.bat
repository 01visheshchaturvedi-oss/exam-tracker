@echo off
title ExamRigor — Alert Service Status
cd /d "%~dp0"

echo ============================================================
echo   ExamRigor Background Alert Service — Status Check
echo ============================================================
echo.

REM Check PID file
if not exist "bg-notifier.pid" (
    echo   Status:  STOPPED (no PID file found)
    echo   Action:  Run start-background-alerts.bat to start
    echo.
    goto :CHECK_STARTUP
)

set /p PID=<bg-notifier.pid
echo   PID file found: %PID%

REM Verify process is actually running
tasklist /FI "PID eq %PID%" 2>nul | find "%PID%" >nul
if errorlevel 1 (
    echo   Status:  STOPPED (process %PID% is not running — stale PID file)
    del "bg-notifier.pid" >nul 2>&1
    echo   Action:  Run start-background-alerts.bat to restart
) else (
    echo   Status:  RUNNING (PID %PID%)
    echo   Alerts:  Every 4 hours
    echo   Action:  Run stop-background-alerts.bat to stop
)

echo.

REM Show last few log lines
:CHECK_STARTUP
if exist "bg-notifier.log" (
    echo   Recent log entries:
    echo   --------------------------------------------------
    powershell -NoProfile -Command "Get-Content 'bg-notifier.log' -Tail 8 | ForEach-Object { '  ' + $_ }"
    echo.
)

REM Check startup status
set STARTUP_FILE=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ExamRigor-Background-Alerts.vbs
if exist "%STARTUP_FILE%" (
    echo   Auto-start: ENABLED (starts on Windows boot)
) else (
    echo   Auto-start: DISABLED (run add-to-startup.bat to enable)
)

echo.
echo ============================================================
pause

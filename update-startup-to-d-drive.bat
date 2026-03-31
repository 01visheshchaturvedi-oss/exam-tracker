@echo off
title ExamRigor — Update Startup to D Drive
cd /d "%~dp0"

echo ============================================================
echo   ExamRigor — Fixing Startup to D Drive
echo ============================================================
echo.

set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup

REM ── Remove old C drive startup entries if they exist ──────────────────────
set OLD_VBS=%STARTUP_DIR%\ExamRigor-Background-Alerts.vbs
set OLD_LNK=%STARTUP_DIR%\ExamRigor Background Notifier.lnk

if exist "%OLD_VBS%" (
    del "%OLD_VBS%" /Q
    echo [OK] Removed old C drive VBS startup entry
)
if exist "%OLD_LNK%" (
    del "%OLD_LNK%" /Q
    echo [OK] Removed old C drive LNK startup entry
)

REM ── Copy THIS folder's launch-hidden.vbs to startup ───────────────────────
set NEW_VBS=%STARTUP_DIR%\ExamRigor-Background-Alerts.vbs
copy "%~dp0launch-hidden.vbs" "%NEW_VBS%" /Y >nul
if errorlevel 1 (
    echo [ERROR] Failed to copy VBS file. Check permissions.
    pause & exit /b 1
)
echo [OK] Startup entry created from D drive

echo.
echo ============================================================
echo   DONE! Startup is now pointing to D drive.
echo   Background alerts will auto-start on every Windows login.
echo.
echo   You can now safely delete the C drive copy.
echo ============================================================
echo.
pause

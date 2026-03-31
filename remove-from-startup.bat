@echo off
title ExamRigor — Remove from Windows Startup
cd /d "%~dp0"

set SHORTCUT_DEST=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ExamRigor-Background-Alerts.vbs

echo ============================================================
echo   ExamRigor — Remove from Windows Startup
echo ============================================================
echo.

if not exist "%SHORTCUT_DEST%" (
    echo [INFO] Not found in startup folder — nothing to remove.
    pause
    exit /b 0
)

del "%SHORTCUT_DEST%"

if errorlevel 1 (
    echo [ERROR] Could not delete startup entry. Try deleting manually:
    echo         %SHORTCUT_DEST%
) else (
    echo [OK]  Removed from Windows Startup successfully.
    echo       ExamRigor will no longer auto-start on boot.
)
echo.
pause

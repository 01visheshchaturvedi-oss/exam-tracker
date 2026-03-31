@echo off
title ExamRigor — Add to Windows Startup
cd /d "%~dp0"

echo ============================================================
echo   ExamRigor — Add to Windows Startup
echo ============================================================
echo.
echo This will make ExamRigor background alerts start automatically
echo every time you turn on your PC.
echo.
echo No admin rights required — uses your personal Startup folder.
echo.

set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set VBS_SOURCE=%~dp0launch-hidden.vbs
set SHORTCUT_DEST=%STARTUP_DIR%\ExamRigor-Background-Alerts.vbs

echo [INFO] Startup folder: %STARTUP_DIR%
echo.

REM Check source file exists
if not exist "%VBS_SOURCE%" (
    echo [ERROR] launch-hidden.vbs not found in current directory!
    echo         Make sure you run this from the exam tracker folder.
    pause
    exit /b 1
)

REM Copy the launcher to startup folder
copy "%VBS_SOURCE%" "%SHORTCUT_DEST%" /Y >nul

if errorlevel 1 (
    echo [ERROR] Failed to copy to Startup folder. Check permissions.
    pause
    exit /b 1
)

echo [OK]  Added to Startup folder successfully!
echo.
echo   File: %SHORTCUT_DEST%
echo.
echo   RESULT: ExamRigor background alerts will now start
echo   automatically every time Windows boots.
echo.
echo   To REMOVE from startup: run remove-from-startup.bat
echo   or delete: %SHORTCUT_DEST%
echo.
echo ============================================================
pause

@echo off
title ExamRigor — Background Alerts
cd /d "%~dp0"

echo ============================================================
echo   ExamRigor Background Alert Service
echo ============================================================
echo.

REM Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found! Install from https://nodejs.org
    pause
    exit /b 1
)

echo [OK] Starting background notifier via PowerShell...
echo.

REM Use PowerShell to launch node hidden — handles spaces in path correctly
REM cd first, then use relative path to avoid quoting issues
powershell -NoProfile -ExecutionPolicy Bypass -File "launch-bg.ps1"

if errorlevel 1 (
    echo.
    echo [ERROR] Failed to start! Trying direct launch in visible window...
    start "ExamRigor BG Notifier" /MIN node "%~dp0bg-notifier.cjs"
)

echo.
echo [OK] Background notifier is running.
echo      - Beep + toast + Telegram when reminders fire
echo      - YouTube channels checked every 15 minutes
echo      - Log: %~dp0bg-notifier.log
echo.
echo This window will close in 5 seconds.
echo ============================================================
timeout /t 5 /nobreak >nul

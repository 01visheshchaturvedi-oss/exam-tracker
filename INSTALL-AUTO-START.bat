@echo off
title ExamRigor — Install Auto-Start
cd /d "%~dp0"
echo ============================================================
echo   ExamRigor — Installing Auto-Start on Windows Login
echo ============================================================
echo.
echo This will make the background notifier start automatically
echo every time you log into Windows. Run this ONCE.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "install-startup.ps1"
pause

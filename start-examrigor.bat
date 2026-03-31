@echo off
cd /d "D:\Claude Workspace\exam tracker"

echo Starting ExamRigor background alerts...
powershell -NoProfile -ExecutionPolicy Bypass -File "launch-bg.ps1"
timeout /t 2 /nobreak > nul

echo Starting ExamRigor dev server...
start "ExamRigor Dev Server" cmd /k npm run dev
echo Waiting for server to be ready...
timeout /t 5 /nobreak > nul
start "" http://localhost:3002
echo ExamRigor launched at http://localhost:3002

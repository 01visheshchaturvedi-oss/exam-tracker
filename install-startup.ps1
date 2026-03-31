# install-startup.ps1
# Installs ExamRigor notifier to Windows Startup folder
# Run this ONCE — notifier will auto-start on every Windows login

$dir        = Split-Path -Parent $MyInvocation.MyCommand.Definition
$startupDir = [System.Environment]::GetFolderPath('Startup')
$shortcut   = Join-Path $startupDir "ExamRigor Background Notifier.lnk"
$ps1        = Join-Path $dir "launch-bg.ps1"

# Create a .lnk shortcut in the Windows Startup folder
$wsh              = New-Object -ComObject WScript.Shell
$lnk              = $wsh.CreateShortcut($shortcut)
$lnk.TargetPath   = "powershell.exe"
$lnk.Arguments    = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ps1`""
$lnk.WorkingDirectory = $dir
$lnk.WindowStyle  = 7
$lnk.Description  = "ExamRigor Background Alert Notifier"
$lnk.Save()

Write-Host ""
Write-Host "ExamRigor - Auto-start INSTALLED" -ForegroundColor Green
Write-Host ""
Write-Host "Shortcut created:" -ForegroundColor Cyan
Write-Host "  $shortcut"
Write-Host ""
Write-Host "The notifier will now start automatically on every Windows login."
Write-Host "Starting it now for the first time..."
Write-Host ""

# Start it immediately
& "$dir\launch-bg.ps1"
Start-Sleep -Seconds 3

Write-Host ""
Write-Host "Done! Check bg-notifier.log to confirm it is running." -ForegroundColor Green
Write-Host ""
Start-Sleep -Seconds 4

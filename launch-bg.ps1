# ExamRigor Background Notifier — PowerShell Launcher
# This script starts bg-notifier.cjs hidden in the background
# Called by start-background-alerts.bat AND Windows Startup shortcut

$dir = Split-Path -Parent $MyInvocation.MyCommand.Definition

# Kill any old instance
$pidFile = Join-Path $dir "bg-notifier.pid"
if (Test-Path $pidFile) {
    $oldPid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($oldPid) {
        Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

# Start node completely hidden
$proc = Start-Process -FilePath "node" `
    -ArgumentList "`"$(Join-Path $dir 'bg-notifier.cjs')`"" `
    -WorkingDirectory $dir `
    -WindowStyle Hidden `
    -PassThru

if ($proc) {
    Write-Host "ExamRigor bg-notifier started. PID: $($proc.Id)"
    # Write PID so future launches can kill old instance
    $proc.Id | Out-File -FilePath $pidFile -Encoding ascii
} else {
    Write-Host "ERROR: Could not start node process"
    exit 1
}

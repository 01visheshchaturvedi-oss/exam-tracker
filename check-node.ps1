$procs = Get-Process node -ErrorAction SilentlyContinue
foreach ($p in $procs) {
    $wmi = Get-WmiObject Win32_Process -Filter "ProcessId=$($p.Id)" -ErrorAction SilentlyContinue
    Write-Host "PID $($p.Id): $($wmi.CommandLine)"
}

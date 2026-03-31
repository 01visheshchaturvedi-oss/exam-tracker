' launch-hidden.vbs  — runs bg-notifier.cjs completely invisibly
' .cjs extension forces CommonJS mode even when package.json has "type":"module"
' Uses PowerShell to start node so spaces in the path work correctly

Dim shell, fso, scriptDir, nodeCmd
Set shell     = CreateObject("WScript.Shell")
Set fso       = CreateObject("Scripting.FileSystemObject")
scriptDir     = fso.GetParentFolderName(WScript.ScriptFullName)

' Kill any previous instance first
shell.Run "powershell -NoProfile -NonInteractive -Command ""Get-Content '" & scriptDir & "\bg-notifier.pid' -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }""", 0, True

' Build the node command using PowerShell Start-Process (handles spaces in path perfectly)
nodeCmd = "powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command """ & _
          "Start-Process -FilePath 'node' -ArgumentList '" & _
          scriptDir & "\bg-notifier.cjs' -WorkingDirectory '" & _
          scriptDir & "' -WindowStyle Hidden -NoNewWindow:$false"""

' Window style 0 = completely hidden
shell.Run nodeCmd, 0, False

Set shell = Nothing
Set fso   = Nothing

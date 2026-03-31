Set shell = CreateObject("WScript.Shell")
Set fso   = CreateObject("Scripting.FileSystemObject")
appDir    = "D:\Claude Workspace\exam tracker"

' ── 1. Start background notifier (hidden) ────────────────────────────────────
shell.Run "powershell -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & appDir & "\launch-bg.ps1""", 0, False

' ── 2. Wait 3 seconds for notifier to initialise ─────────────────────────────
WScript.Sleep 3000

' ── 3. Start Vite dev server in a minimised window ───────────────────────────
shell.Run "cmd /c ""cd /d """ & appDir & """ && set NODE_ENV=development && npm run dev""", 1, False

' ── 4. Wait 7 seconds for Vite to compile and serve ──────────────────────────
WScript.Sleep 7000

' ── 5. Open the app in the default browser ───────────────────────────────────
shell.Run "http://localhost:3002", 1, False

Set shell = Nothing
Set fso   = Nothing

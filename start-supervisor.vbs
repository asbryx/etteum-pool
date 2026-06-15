' etteum-pool supervisor — hidden launcher.
'
' Runs `bun scripts/supervisor.ts` with WindowStyle=0 (hidden).
' All output is redirected to logs/supervisor.stdout.log + logs/supervisor.stderr.log
' so no console window ever appears.
'
' This is invoked by start.cmd. It does NOT autostart on Windows boot —
' it only runs when the user manually launches start.cmd.

Set objShell = CreateObject("WScript.Shell")
strHome = objShell.ExpandEnvironmentStrings("%USERPROFILE%")
strDir = strHome & "\etteum-pool"
strBun = strHome & "\.bun\bin\bun.exe"

' Ensure logs/ exists
Set objFSO = CreateObject("Scripting.FileSystemObject")
If Not objFSO.FolderExists(strDir & "\logs") Then
    objFSO.CreateFolder(strDir & "\logs")
End If

' Build the cmd.exe invocation. We need cmd.exe (briefly) only to handle
' the >> redirections; cmd will exit immediately after spawning bun, leaving
' bun running detached with its stdio attached to the log files. The cmd
' window itself is hidden by Run(..., 0, ...).
strLogOut = strDir & "\logs\supervisor.stdout.log"
strLogErr = strDir & "\logs\supervisor.stderr.log"
strCmd = "cmd.exe /c """"" & strBun & """ scripts\supervisor.ts >> """ & strLogOut & """ 2>> """ & strLogErr & """"""

objShell.CurrentDirectory = strDir
objShell.Run strCmd, 0, False

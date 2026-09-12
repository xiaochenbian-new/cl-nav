' Hidden background sync for Windows Task Scheduler (run with wscript.exe, no console window).
' Param 0 (SW_HIDE) = hidden window; True = wait for git push to finish so the task completes cleanly.
' NOTE: keep this file ASCII-only (no Chinese comments) or wscript may throw runtime errors.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\16372\IdeaProjects\AI-BASE\cl-nav"
sh.Run "git push github master", 0, True

Option Explicit
Dim shell, fs, root, url, ready, i, edge, candidate
Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
root = fs.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
url = "http://127.0.0.1:8642/"
ready = ServerReady(url)
If Not ready Then
  shell.Run Chr(34) & root & "\start-server.cmd" & Chr(34), 0, False
  For i = 1 To 60
    WScript.Sleep 250
    ready = ServerReady(url)
    If ready Then Exit For
  Next
End If
If Not ready Then
  MsgBox "Game startup failed. See: " & root & "\data\startup.log", vbExclamation, "WC2 Total War"
  WScript.Quit 1
End If
edge = ""
For Each candidate In Array(shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe", shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe", shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Microsoft\Edge\Application\msedge.exe")
  If fs.FileExists(candidate) Then
    edge = candidate
    Exit For
  End If
Next
If edge <> "" Then
  shell.Run Chr(34) & edge & Chr(34) & " --app=" & url & " --start-fullscreen", 1, False
Else
  shell.Run url, 1, False
End If

Function ServerReady(address)
  On Error Resume Next
  Dim http
  Set http = CreateObject("WinHttp.WinHttpRequest.5.1")
  http.SetTimeouts 500, 500, 500, 500
  http.Open "GET", address, False
  http.Send
  ServerReady = False
  If Err.Number = 0 Then ServerReady = (http.Status = 200)
  Err.Clear
  On Error GoTo 0
End Function

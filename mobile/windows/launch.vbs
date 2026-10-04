Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
root = fs.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
shell.Run """" & root & "\node.exe"" """ & root & "\server.js""", 0, False

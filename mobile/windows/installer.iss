#ifndef NodeExe
  #error Pass /DNodeExe=path-to-node.exe
#endif
#define Root "..\.."
[Setup]
AppId={{DA938086-9AB5-451C-A540-46EA627AAD7C}
AppName=世界征服者:总体战
AppVersion=1.0.5
AppPublisher=TOM-AKA
DefaultDirName={localappdata}\Programs\WC2TotalWar
DefaultGroupName=世界征服者 总体战
DisableDirPage=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#Root}\dist
OutputBaseFilename=wc2-total-war-windows-setup-1.0.5
SetupIconFile={#Root}\public\game-icon.ico
UninstallDisplayIcon={app}\public\game-icon.ico
Compression=zip/1
SolidCompression=no
WizardStyle=modern
[Languages]
Name: "chinesesimp"; MessagesFile: "ChineseSimplified.isl"
[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; Flags: checkedonce
[Files]
Source: "{#NodeExe}"; DestDir: "{app}"; DestName: "node.exe"; Flags: ignoreversion
Source: "launch.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "start-server.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Root}\server.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Root}\auth_store.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Root}\public\*"; DestDir: "{app}\public"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#Root}\project\app\src\main\assets\*"; DestDir: "{app}\project\app\src\main\assets"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#Root}\tools\*"; DestDir: "{app}\tools"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#Root}\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
[Icons]
Name: "{group}\世界征服者 总体战"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\public\game-icon.ico"
Name: "{autodesktop}\世界征服者 总体战"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\public\game-icon.ico"; Tasks: desktopicon
[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"""; Description: "启动世界征服者 总体战"; Flags: nowait postinstall skipifsilent

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut("C:\Users\adria\Desktop\GMod Map & Asset Manager.lnk")
$shortcut.TargetPath = "cmd.exe"
$shortcut.Arguments = '/c "C:\Users\adria\.gemini\antigravity\scratch\gmod-asset-manager\Launch GMod Manager.bat"'
$shortcut.WorkingDirectory = "C:\Users\adria\.gemini\antigravity\scratch\gmod-asset-manager"
$shortcut.IconLocation = "C:\Program Files (x86)\Steam\steamapps\common\GarrysMod\gmod.exe,0"
$shortcut.Description = "Garry's Mod Map and Asset Manager"
$shortcut.Save()
Write-Output "Shortcut successfully created"

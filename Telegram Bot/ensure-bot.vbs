' ensure-bot.vbs - запускает ensure-bot.ps1 полностью скрыто (без мигания окна).
' Планировщик запускает этот файл через wscript.exe: у wscript нет консоли,
' а Run с window style 0 прячет и окно PowerShell.
Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""C:\Users\AVA\Documents\deepseek-harness\default-workspace\dsh-plugin-mobile-ui\Telegram Bot\ensure-bot.ps1""", 0, True

' bot.vbs - starts the Telegram bot supervisor in a hidden window and waits for it,
' so the launcher task stays alive while the bot runs.
' Window 0 = hidden; True = wait for exit.

Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ""C:\Users\AVA\Documents\deepseek-harness\default-workspace\dsh-plugin-mobile-ui\Telegram Bot\start.ps1""", 0, True

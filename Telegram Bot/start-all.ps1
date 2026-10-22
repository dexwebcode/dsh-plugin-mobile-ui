# start-all.ps1 — запуск Telegram-бота вместе с DeepSeek Harness.
#
# 1) если бот уже поднят — ничего не делает;
# 2) иначе запускает его супервизор (bot.vbs) в скрытом окне;
# 3) запускает harness: dsh web в текущем окне.
#
# Запуск: powershell -ExecutionPolicy Bypass -File start-all.ps1
#   или двойной клик по start-all.cmd

$ErrorActionPreference = 'Continue'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Launcher = Join-Path $Here 'bot.vbs'

function Test-BotRunning {
    return [bool](Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -match 'Telegram Bot\\bot\.py' })
}

if (Test-BotRunning) {
    Write-Host 'Telegram-бот уже запущен.'
} else {
    Write-Host 'запускаю Telegram-бота в фоне...'
    Start-Process wscript.exe -ArgumentList "`"$Launcher`""
    Start-Sleep -Seconds 4
}

Write-Host 'запускаю DeepSeek Harness: dsh web'
dsh web

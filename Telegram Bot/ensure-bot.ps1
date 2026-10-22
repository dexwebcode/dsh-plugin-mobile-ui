# ensure-bot.ps1 — сторож Telegram-бота: поднимает его, если он не отвечает.
#
# Запускается планировщиком задач (при входе в систему и каждые 5 минут) и
# вручную. Если /health отвечает — сторож ничего не делает и молча выходит.
#
# Если супервизор start.ps1 уже работает, но бот не отвечает дольше 10 минут
# (завис, а не упал), сторож убивает процесс бота: супервизор поднимет его
# заново через ~10 секунд.

$ErrorActionPreference = 'Continue'

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Logs = Join-Path $Here 'logs'
$Runtime = Join-Path $Here '.runtime'
$Stamp = Join-Path $Runtime 'watchdog-unhealthy.stamp'
$HealthUrl = 'http://127.0.0.1:8099/health'
$StuckMinutes = 10

New-Item -ItemType Directory -Force -Path $Logs | Out-Null
New-Item -ItemType Directory -Force -Path $Runtime | Out-Null

function Write-Log([string]$Message) {
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path (Join-Path $Logs 'watchdog.log') -Value $line
}

# 1. Бот отвечает по HTTP — он жив, делать нечего.
try {
    $response = Invoke-WebRequest -Uri $HealthUrl -TimeoutSec 5 -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Remove-Item -Path $Stamp -ErrorAction SilentlyContinue
        exit 0
    }
} catch {
    # Не отвечает — разбираемся ниже.
}

# 2. Сколько уже длится «не отвечает».
if (Test-Path $Stamp) {
    $since = (Get-Item $Stamp).LastWriteTime
} else {
    $since = Get-Date
    Set-Content -Path $Stamp -Value 'бот не отвечает' -Encoding utf8
}
$minutes = ((Get-Date) - $since).TotalMinutes

# 3. Супервизор жив: он сам поднимает упавшего бота, но зависшего — нет.
$supervisor = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and $_.CommandLine -match 'Telegram Bot\\start\.ps1'
}

if ($supervisor -and $minutes -lt $StuckMinutes) {
    Write-Log ('бот не отвечает {0:N1} мин, супервизор жив — жду' -f $minutes)
    exit 0
}

if ($supervisor) {
    Write-Log ('бот не отвечает {0:N0} мин — убиваю процесс, супервизор поднимет заново' -f $minutes)
    Get-CimInstance Win32_Process |
        Where-Object { $_.CommandLine -and $_.CommandLine -match 'Telegram Bot\\bot\.py' } |
        ForEach-Object {
            try {
                Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
                Write-Log ('остановлен процесс {0}' -f $_.ProcessId)
            } catch {
                Write-Log ('не смог остановить {0}: {1}' -f $_.ProcessId, $_.Exception.Message)
            }
        }
    Remove-Item -Path $Stamp -ErrorAction SilentlyContinue
    exit 0
}

# 4. Супервизора нет — запускаем его в скрытом окне через bot.vbs.
Write-Log 'бот не отвечает и супервизора нет — запускаю'
try {
    Start-Process -FilePath 'wscript.exe' `
        -ArgumentList ('"{0}"' -f (Join-Path $Here 'bot.vbs')) `
        -WindowStyle Hidden -ErrorAction Stop
} catch {
    Write-Log ('не смог запустить супервизор: {0}' -f $_.Exception.Message)
    exit 1
}
exit 0

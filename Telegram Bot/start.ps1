# start.ps1 — держит Telegram-бота запущенным и поднимает его после падения.
#
# Запускается вручную или из bot.vbs в папке автозагрузки.
# Штатный выход (код 0) означает «остановлено намеренно» — супервизор выходит.

$ErrorActionPreference = 'Continue'

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Logs = Join-Path $Here 'logs'
New-Item -ItemType Directory -Force -Path $Logs | Out-Null
$Site = Join-Path $Here '.venv\Lib\site-packages'
$Bot = Join-Path $Here 'bot.py'

function Write-Log([string]$Message) {
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path (Join-Path $Logs 'supervisor.log') -Value $line
}

# Исполнитель берётся из pyvenv.cfg: базовый python плюс пакеты из venv.
#
# Почему не .venv\Scripts\python.exe: песочница DSH даёт venv-исполнителю только
# чтение ~/.dsh, а боту нужно запускать `dsh headless`, который пишет туда файлы
# профиля. Базовому python запись разрешена, поэтому берём его, а пакеты
# подключаем через PYTHONPATH — набор зависимостей при этом остаётся в venv.
function Get-Interpreter {
    $cfg = Join-Path $Here '.venv\pyvenv.cfg'
    if (Test-Path $cfg) {
        $line = Select-String -Path $cfg -Pattern '^home\s*=\s*(.+)$' | Select-Object -First 1
        if ($line) {
            # Имя не $home: в PowerShell это read-only автоматическая переменная,
            # присваивание молча не срабатывает и путь получается мусорным.
            $baseHome = $line.Matches[0].Groups[1].Value.Trim()
            $base = Join-Path $baseHome 'python.exe'
            if (Test-Path $base) { return @{ Exe = $base; Path = $Site } }
        }
    }
    $venv = Join-Path $Here '.venv\Scripts\python.exe'
    if (Test-Path $venv) { return @{ Exe = $venv; Path = '' } }
    return @{ Exe = 'python'; Path = '' }
}

Write-Log 'supervisor start'

while ($true) {
    $interpreter = Get-Interpreter
    $env:PYTHONPATH = $interpreter.Path
    $env:PYTHONIOENCODING = 'utf-8'
    Write-Log ("запускаю {0} bot.py (PYTHONPATH={1})" -f $interpreter.Exe, $interpreter.Path)
    & $interpreter.Exe $Bot 1>> (Join-Path $Logs 'stdout.log') 2>> (Join-Path $Logs 'stderr.log')
    $code = $LASTEXITCODE
    Write-Log "бот завершился с кодом $code"
    if ($code -eq 0) { break }
    Start-Sleep -Seconds 10
}

Write-Log 'supervisor stop'

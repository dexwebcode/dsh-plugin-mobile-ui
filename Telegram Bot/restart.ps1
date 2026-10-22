# restart.ps1 - restart the Telegram bot.
# Stops bot.py/start.ps1 processes and launches the hidden supervisor (bot.vbs).
# Run it from a DSH session with Full access, or from a normal PowerShell window.

$ErrorActionPreference = 'Continue'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Launcher = Join-Path $Here 'bot.vbs'

function Test-Port {
    return [bool](netstat -ano | Select-String ':8099\s+.*LISTENING')
}

Write-Host "restarting bot from $Here"

try {
    $targets = Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
        $_.CommandLine -and $_.CommandLine -match 'Telegram Bot\\(bot\.py|start\.ps1)'
    }
} catch {
    Write-Error "cannot enumerate processes: $($_.Exception.Message)"
    exit 1
}

if (-not $targets) {
    Write-Host 'no running bot.py/start.ps1 found'
}
foreach ($target in $targets) {
    try {
        Stop-Process -Id $target.ProcessId -Force -ErrorAction Stop
        Write-Host "stopped PID $($target.ProcessId)"
    } catch {
        Write-Warning "could not stop PID $($target.ProcessId): $($_.Exception.Message)"
    }
}

# A surviving supervisor restarts the bot by itself after ~10 seconds.
Start-Sleep -Seconds 12
if (Test-Port) {
    Write-Host 'OK: bot is already back on 8099 (restarted by its supervisor)'
    exit 0
}

Start-Process wscript.exe -ArgumentList "`"$Launcher`""
Start-Sleep -Seconds 8

if (Test-Port) {
    Write-Host 'OK: bot is listening on 8099'
    exit 0
}

Write-Warning 'port 8099 is not listening; check logs\bot.log and logs\supervisor.log'
exit 1

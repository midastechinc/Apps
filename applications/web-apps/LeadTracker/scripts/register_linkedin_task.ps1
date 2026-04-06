param(
  [string]$TaskName = "MidasTech LinkedIn Pull",
  [string]$DailyAt = "08:00"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$runnerScript = Join-Path $projectRoot "scripts\run_linkedin_pull.ps1"

if (-not (Test-Path $runnerScript)) {
  throw "Runner script not found at $runnerScript"
}

$time = [datetime]::ParseExact($DailyAt, "HH:mm", $null)
$action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runnerScript`""
$trigger = New-ScheduledTaskTrigger -Daily -At $time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Runs the Midas Tech LinkedIn scraper locally and pushes fresh data to Supabase." -Force | Out-Null

Write-Host "Scheduled task '$TaskName' has been created for $DailyAt every day." -ForegroundColor Green

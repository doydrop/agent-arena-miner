# Registers a Windows Task Scheduler job that runs a dry-run every morning at 08:00.
# A dry-run never sends anything to Delphi. Switch to live only from the README steps.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$bat = Join-Path $PSScriptRoot "run-dry.bat"
if (-not (Test-Path $bat)) {
  Write-Error "Could not find $bat"
}
$action = New-ScheduledTaskAction -Execute $bat -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At 8:00am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 6)
Register-ScheduledTask -TaskName "EvidenceMiningMorning" -Action $action -Trigger $trigger -Settings $settings -Description "Evidence Mining dry-run each morning. Nothing is sent to Delphi." -Force | Out-Null
Write-Host "Scheduled EvidenceMiningMorning every day at 08:00."
Write-Host "It runs: $bat"
Write-Host "Nothing is sent to Delphi. The dashboard opens on this computer."

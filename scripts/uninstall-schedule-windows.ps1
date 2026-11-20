# Removes the morning Evidence Mining task. It does not delete your .env or your data folder.
$ErrorActionPreference = "Stop"
Unregister-ScheduledTask -TaskName "EvidenceMiningMorning" -Confirm:$false
Write-Host "Removed the EvidenceMiningMorning task."

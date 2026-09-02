# Windows 작업 스케줄러에 '매일 13:00' 작업을 등록합니다. (PowerShell 에서 실행)
#   powershell -ExecutionPolicy Bypass -File scripts\register_task.ps1
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$bat = Join-Path $root "scripts\run_daily.bat"
$action = New-ScheduledTaskAction -Execute $bat -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At 13:00
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 2 -RestartInterval (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName "CoupangAdCalculator" -Action $action -Trigger $trigger -Settings $settings -Force
Write-Host "등록 완료: 매일 13:00 에 $bat 실행 (PC 가 꺼져 있었으면 켜진 뒤 실행, 실패 시 1시간 뒤 최대 2회 재시도)"

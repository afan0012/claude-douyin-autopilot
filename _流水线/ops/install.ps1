# 安装/卸载计划任务（需要你本人运行，等于授权自动发布和自动回复）
#   powershell -ExecutionPolicy Bypass -File install.ps1           安装
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Remove   全部停掉
param([switch]$Remove)
$ap = Join-Path $PSScriptRoot 'autopilot.ps1'
$tasks = @(
  @{ Name = 'DY_produce_am';  Phase = 'produce';  Times = @('09:00') },
  @{ Name = 'DY_produce_pm';  Phase = 'produce';  Times = @('15:00') },
  @{ Name = 'DY_comments';    Phase = 'comments'; Times = @('10:30','12:30','14:30','16:30','18:30','20:30','22:30') },
  @{ Name = 'DY_review';      Phase = 'review';   Times = @('08:00','23:00') }
)
foreach ($t in $tasks) { Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false -ErrorAction SilentlyContinue }
if ($Remove) { 'removed'; return }
foreach ($t in $tasks) {
  $act = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ap`" $($t.Phase)" -WorkingDirectory $PSScriptRoot
  $trg = $t.Times | ForEach-Object { New-ScheduledTaskTrigger -Daily -At $_ }
  $set = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 4) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $t.Name -Action $act -Trigger $trg -Settings $set -Description "抖音自动运营：$($t.Phase)" | Out-Null
  "installed $($t.Name): $($t.Times -join ', ')"
}

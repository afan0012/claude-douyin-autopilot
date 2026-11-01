# 自动运营总控：powershell -ExecutionPolicy Bypass -File autopilot.ps1 <comments|produce|review>
#   comments  抓评论 → Claude 写回复进队列 → runner 限速发送
#   produce   Claude 出片、自评、写发布包 → runner 发布（每天最多 2 条，写在 runner.js）
#   review    抓数据 → Claude 更新台账/经验库/日报
# 兼容 Windows PowerShell 5.1：日志统一用 UTF-8 追加写（不用 Tee/Out-File，避免锁文件和 UTF-16），提示词走 stdin
param([Parameter(Mandatory)][ValidateSet('comments','produce','review')][string]$Phase)
$ErrorActionPreference = 'Continue'
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = $Utf8; [Console]::OutputEncoding = $Utf8; [Console]::InputEncoding = $Utf8
$Ops  = $PSScriptRoot
$Root = (Resolve-Path "$Ops\..\..").Path
$Log  = "$Ops\data\autopilot.log"
New-Item -ItemType Directory -Force "$Ops\data", "$Ops\日报", "$Ops\queue\replies", "$Ops\queue\publish" | Out-Null
function W($x) { [IO.File]::AppendAllText($Log, (($x | Out-String) -replace "`r?`n$", '') + "`r`n", $Utf8) }
function Say($m) { $l = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [$Phase] $m"; Write-Output $l; W $l }
# 两道闸：① 下面这些命令不让 Claude 调用；② 真正会发东西的脚本只认 DY_ALLOW_SEND=1，而 Claude 的环境里没有它。
# 这是防误操作的护栏，不是沙箱：Claude 能跑 node/python，理论上能绕过。要彻底隔离，用单独的系统用户跑 Claude。
$Deny = foreach ($pre in @('', '_流水线/ops/')) {
  "Bash(node ${pre}runner.js:*)", "Bash(node ${pre}publish.js:*)", "Bash(node ${pre}publish_own.js:*)",
  "Bash(node ${pre}comments.js reply:*)", "Bash(node ${pre}comments.js post:*)",
  "Bash(python ${pre}sau_publish.py:*)", "Bash(python ${pre}takeover.py:*)",
  "Bash(_参考工程/oss/.venv/Scripts/python.exe ${pre}sau_publish.py:*)", "Bash(_参考工程/oss/.venv/Scripts/python.exe ${pre}takeover.py:*)"
}
function Invoke-Agent($promptFile) {
  Remove-Item Env:DY_ALLOW_SEND -ErrorAction SilentlyContinue
  $p = [IO.File]::ReadAllText("$Ops\prompts\$promptFile", $Utf8)
  Push-Location $Root
  $out = $p | & claude.cmd -p --permission-mode acceptEdits `
    --allowedTools "Read" "Write" "Edit" "Glob" "Grep" "Skill" "WebSearch" "WebFetch" "Bash(node:*)" "Bash(python:*)" "Bash(ffmpeg:*)" "Bash(ffprobe:*)" "Bash(bash:*)" "Bash(monid:*)" "Bash(pdftotext:*)" `
    --disallowedTools $Deny 2>&1
  Pop-Location
  Say "claude($promptFile) exit=$LASTEXITCODE"; W $out
}
Set-Location $Ops
Say "start"
switch ($Phase) {
  'comments' {
    W (node comments.js fetch 2>&1 | Select-Object -Last 3)
    Invoke-Agent 'comments.md'
    $r = node runner.js replies 2>&1; Write-Output $r; W $r
  }
  'produce' {
    Invoke-Agent 'produce.md'
    $r = node runner.js publish 2>&1; Write-Output $r; W $r
  }
  'review' {
    W (node stats.js 2>&1 | Select-Object -Last 3)
    W (node comments.js fetch 2>&1 | Select-Object -Last 3)
    Invoke-Agent 'review.md'
  }
}
Say "end"

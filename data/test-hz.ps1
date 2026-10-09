$engine = (Resolve-Path (Join-Path $PSScriptRoot '..\engine\rift-boost.ps1')).Path
$src = Get-Content -LiteralPath $engine -Raw
$src = $src -replace '(?ms)^boot[\s\S]*$', ''
$tmp = Join-Path $env:TEMP ('rift_hz_' + [guid]::NewGuid().ToString('N') + '.ps1')
$src | Out-File -LiteralPath $tmp -Encoding UTF8
. $tmp
Remove-Item $tmp -Force

$script:hzType = $null
$script:logOut = @()

function emit { param($o) Write-Host ("  emit: {0} {1}{2}" -f $o.e, $o.m, $o.to) -ForegroundColor DarkCyan }
function rule { param($n) }
function log { param($m, $l) Write-Host ("  [{0}] {1}" -f $l.ToString().ToUpper(), $m) }

Write-Host "=== doWinHz ===" -ForegroundColor Cyan
doWinHz
Write-Host ""
Write-Host "RESULT: completed without error" -ForegroundColor Green
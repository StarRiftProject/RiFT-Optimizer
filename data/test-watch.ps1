param([switch]$WithDevice)

$ErrorActionPreference = 'Stop'

$enginePath = Join-Path (Split-Path $PSScriptRoot -Parent) 'engine\rift-boost.ps1'
$src = Get-Content -LiteralPath $enginePath -Raw
$src = $src -replace '(?ms)^boot[\s\S]*$', ''
$tmp = Join-Path $env:TEMP ('rift_watch_' + [guid]::NewGuid().ToString('N') + '.ps1')
$src | Out-File -LiteralPath $tmp -Encoding UTF8
. $tmp
Remove-Item $tmp -Force

$script:adb = 'adb.exe'
$script:dev = $null
$script:brand = ''
$script:model = ''
$script:andro = ''
$script:loop = $false
$script:root = $false
$script:rootMethod = ''
$script:selinux = ''
$script:congestion = $null
$script:fmin = 0
$script:fmax = 0
$script:fpeak = 0
$script:selinux = ''
$script:ports = 5555

$emitted = New-Object System.Collections.ArrayList

function emit { param($o) if ($o.e) { [void]$emitted.Add($o) } }
function log { param($m, $l) }

if ($WithDevice) { $script:fake = @('emulator-5554', '127.0.0.1:5555') }
else { $script:fake = @() }

function devices { return , @($script:fake) }
function alive { return $true }
function readDevice { $script:brand = 'Tencent'; $script:model = 'A3360'; $script:andro = '7.1.2'; $script:loop = $true }
function checkRoot { $script:root = $true; $script:rootMethod = 'uid0'; $script:selinux = 'Disabled' }
function checkLoop { }
function kget { param($p) 'bbr' }

# stop the infinite loop after the first sweep
$script:sweeps = 0
function Start-Sleep {
    param([Parameter(ValueFromRemainingArguments = $true)]$rest)
    $script:sweeps++
    # two calls are needed before the first report when no device is present,
    # because the port probe sleeps once before it can conclude
    if ($script:sweeps -ge 2) { throw '__stop__' }
}

try { watchDevice } catch { if ($_.Exception.Message -ne '__stop__') { throw } }

Write-Host "=== watch sweep ==="
$watch = @($emitted | Where-Object { $_.e -eq 'watch' })
Write-Host ("  watch event: {0} target {1}" -f $watch[0].state, $watch[0].target)

$status = @($emitted | Where-Object { $_.e -eq 'status' })
if (-not $status.Count) { Write-Host '  FAIL: no status emitted' -ForegroundColor Red; exit 1 }
$s = $status[0]
Write-Host ("  picked device : {0}" -f $(if ($s.device) { $s.device } else { 'none' }))
Write-Host ("  brand/model   : {0} {1}" -f $s.brand, $s.model)
Write-Host ("  root          : {0} via {1}" -f $s.root, $s.rootMethod)
Write-Host ("  gameloop      : {0}" -f $s.loop)

if ($WithDevice) {
    if ($s.device -ne 'emulator-5554') { Write-Host "  FAIL: emulator-5554 was not preferred" -ForegroundColor Red; exit 1 }
    if (-not $s.root) { Write-Host '  FAIL: root not reported' -ForegroundColor Red; exit 1 }
    Write-Host '  RESULT: PASS - emulator-5554 preferred and reported' -ForegroundColor Green
}
else {
    if ($null -ne $s.device) { Write-Host '  FAIL: invented a device' -ForegroundColor Red; exit 1 }
    Write-Host '  RESULT: PASS - reported no device and kept searching' -ForegroundColor Green
}
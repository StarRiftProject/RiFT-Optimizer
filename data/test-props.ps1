param([switch]$WithDevice)

$ErrorActionPreference = 'Stop'

$enginePath = Join-Path (Split-Path $PSScriptRoot -Parent) 'engine\rift-boost.ps1'
$src = Get-Content -LiteralPath $enginePath -Raw
$src = $src -replace '(?ms)^boot[\s\S]*$', ''
$tmp = Join-Path $env:TEMP ('rift_props_' + [guid]::NewGuid().ToString('N') + '.ps1')
$src | Out-File -LiteralPath $tmp -Encoding UTF8
. $tmp
Remove-Item $tmp -Force

$script:adb = 'adb.exe'
$script:dev = if ($WithDevice) { '127.0.0.1:5555' } else { $null }
$script:Json = $true
$script:ok = 0; $script:wn = 0; $script:er = 0
$script:log = New-Object System.Collections.ArrayList
$script:bu = @()

# a fake guest: these are the values the property snapshot has to capture
$script:props = @{
    'qemu.mouse.smooth'     = 'true'
    'qemu.input.raw_mouse'  = 'true'
    'debug.sf.hw'           = '1'
    'dalvik.vm.heapmaxfree' = '512m'
}

$script:sets = New-Object System.Collections.ArrayList

function emit { param($o) }
function log { param([string]$m, [string]$l) [void]$script:log.Add("$l|$m") }

function sh {
    param([string]$c, [switch]$q)
    if ($c -match "^getprop (\S+)") {
        $k = $Matches[1]
        if ($script:props.ContainsKey($k)) { return $script:props[$k] }
        return ''
    }
    if ($c -match "^setprop (\S+) '?(.*?)'?$") {
        $k = $Matches[1]; $v = $Matches[2]
        [void]$script:sets.Add("$k=$v")
        if ($script:props.ContainsKey($k)) { $script:props[$k] = $v }
        return ''
    }
    return ''
}

Write-Host "=== property snapshot ==="
$snap = snapshotAndroid
Write-Host ("  props captured: {0}" -f @($snap.props).Count)
foreach ($p in $snap.props) { Write-Host ("    {0} = {1}" -f $p.name, $p.value) }

if (@($snap.props).Count -lt 4) { Write-Host '  FAIL: expected at least the 4 seeded props' -ForegroundColor Red; exit 1 }
$names = @($snap.props | ForEach-Object { $_.name })
$mustHave = @('qemu.mouse.smooth', 'qemu.input.raw_mouse', 'debug.sf.hw', 'dalvik.vm.heapmaxfree')
foreach ($m in $mustHave) {
    if ($names -notcontains $m) { Write-Host "  FAIL: qemu/other prop '$m' missing from snapshot" -ForegroundColor Red; exit 1 }
}
Write-Host "  all four props present, including the qemu keys" -ForegroundColor Green

Write-Host ""
Write-Host "=== undo restores props (this path was previously missing) ==="
# pretend the run changed them, then roll back
$script:props['qemu.mouse.smooth'] = 'false'
$script:props['debug.sf.hw'] = '0'
$script:sets.Clear()

$restored = 0
foreach ($p in $snap.props) {
    if ([string]::IsNullOrEmpty($p.value) -or $p.value -eq 'null') { sh "setprop $($p.name) ''" -q | Out-Null }
    else { sh "setprop $($p.name) $($p.value)" -q | Out-Null }
    $restored++
}

Write-Host ("  restored {0} props" -f $restored)
foreach ($s in $script:sets) { Write-Host ("    setprop {0}" -f $s) }

if ($script:props['qemu.mouse.smooth'] -ne 'true') { Write-Host '  FAIL: qemu.mouse.smooth not rolled back' -ForegroundColor Red; exit 1 }
if ($script:props['debug.sf.hw'] -ne '1') { Write-Host '  FAIL: debug.sf.hw not rolled back' -ForegroundColor Red; exit 1 }
if ($script:props['dalvik.vm.heapmaxfree'] -ne '512m') { Write-Host '  FAIL: dalvik prop not rolled back' -ForegroundColor Red; exit 1 }
Write-Host "  every property is back to its captured value" -ForegroundColor Green

Write-Host ""
Write-Host "RESULT: PASS" -ForegroundColor Green
param()

$ErrorActionPreference = 'Stop'

$enginePath = Join-Path (Split-Path $PSScriptRoot -Parent) 'engine\rift-boost.ps1'
$src = Get-Content -LiteralPath $enginePath -Raw
$src = $src -replace '(?ms)^boot[\s\S]*$', ''
$tmp = Join-Path $env:TEMP ('rift_bench_' + [guid]::NewGuid().ToString('N') + '.ps1')
$src | Out-File -LiteralPath $tmp -Encoding UTF8
. $tmp
Remove-Item $tmp -Force

$script:dev = 'mock:5555'
$script:root = $false
$script:pubg = @('com.tencent.ig', 'com.vng.pubgmobile')
$script:benchPkg = 'com.tencent.ig'

# frames are handed out in steps, so two samples a fixed gap apart must
# produce a frame rate we can check by hand
$script:frameCursor = 1000
$script:jankCursor = 40

function emit { param($o) }
function log { param($m, $l) }

function sh {
    param([string]$c, [switch]$q)
    if ($c -match 'mCurrentFocus') { return '  mCurrentFocus=Window\{ab12 u0 com.tencent.ig/com.tencent.ig.activity.MainActivity}' }
    if ($c -match 'pidof com.tencent.ig') { return '4821' }
    if ($c -match 'pidof') { return '' }
    if ($c -match 'gfxinfo') {
        $script:frameCursor += 288          # 288 frames per call
        $script:jankCursor += 9
        return @"
Draw    Prepare    Process    Execute
  12        4         9          3

Total frames rendered: $($script:frameCursor)
Janky frames: $($script:jankCursor) (1.20%)
"@
    }
    return ''
}

Write-Host "=== benchPackage finds the focused, running game ==="
$pkg = benchPackage
Write-Host ("  picked: {0}" -f $pkg)
if ($pkg -ne 'com.tencent.ig') { Write-Host '  FAIL: wrong package' -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "=== frame rate maths ==="
$sw = [Diagnostics.Stopwatch]::StartNew()
$script:frameCursor = 1000
$script:jankCursor = 40
$r = measureFps -Seconds 1
$sw.Stop()

if (-not $r.ok) { Write-Host ("  FAIL: {0}" -f $r.message) -ForegroundColor Red; exit 1 }
Write-Host ("  package  : {0}" -f $r.package)
Write-Host ("  fps      : {0}" -f $r.fps)
Write-Host ("  frames   : {0} over {1}s" -f $r.frames, $r.seconds)
Write-Host ("  jank     : {0} frames ({1}%)" -f $r.jank, $r.jankPct)

# two samples with 288 frames drawn between them
if ([math]::Abs($r.frames - 288) -gt 1) { Write-Host '  FAIL: frame delta wrong' -ForegroundColor Red; exit 1 }
# $r.seconds is rounded to 2dp for display while fps uses the true elapsed time,
# so compare with a percentage tolerance rather than against the rounded value
$expected = 288 / $r.seconds
$drift = [math]::Abs($r.fps - $expected) / $expected
if ($drift -gt 0.01) { Write-Host ("  FAIL: fps {0} is {1:P2} away from {2}" -f $r.fps, $drift, $expected) -ForegroundColor Red; exit 1 }
Write-Host ("  {0} frames / {1}s displayed = {2} fps computed, {3:P2} from {4} (within rounding)" -f $r.frames, $r.seconds, $r.fps, $drift, $expected) -ForegroundColor Green

Write-Host ""
Write-Host "=== a game that is not drawing must not report a fake number ==="
$script:frameCursor = 5000
function sh2 { param([string]$c, [switch]$q)
    if ($c -match 'mCurrentFocus') { return '  mCurrentFocus=Window\{ab12 u0 com.tencent.ig/x}' }
    if ($c -match 'pidof com.tencent.ig') { return '4821' }
    if ($c -match 'gfxinfo') { return "Total frames rendered: 5000`nJanky frames: 40 (1.00%)" }
    return ''
}
function global:sh { param([string]$c, [switch]$q) sh2 $c }
$idle = measureFps -Seconds 1
if ($idle.ok) { Write-Host ("  FAIL: reported {0} fps with zero frames drawn" -f $idle.fps) -ForegroundColor Red; exit 1 }
Write-Host ("  reason: {0}" -f $idle.reason) -ForegroundColor Green
Write-Host ("  message: {0}" -f $idle.message)

Write-Host ""
Write-Host "RESULT: PASS" -ForegroundColor Green